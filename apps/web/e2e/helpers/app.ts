import { expect, type Page } from '@playwright/test';

/** Genera un correo único por prueba para garantizar independencia (workspace propio). */
export function uniqueEmail(prefix = 'qa'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${rand}@nexo.test`;
}

export interface TestUser {
  email: string;
  password: string;
  name: string;
  workspaceName: string;
}

/**
 * Registra un usuario nuevo por la interfaz y queda con sesión iniciada (REGISTRATION_MODE abierto en el entorno
 * de pruebas). Usa selectores accesibles (etiquetas y roles) para validar de paso la accesibilidad del formulario.
 */
export async function registerNewUser(page: Page, overrides: Partial<TestUser> = {}): Promise<TestUser> {
  const user: TestUser = {
    email: overrides.email ?? uniqueEmail(),
    password: overrides.password ?? 'Clave-Segura-123',
    name: overrides.name ?? 'QA Automatizado',
    workspaceName: overrides.workspaceName ?? 'Workspace QA',
  };
  await page.goto('/register');
  await page.getByLabel('Nombre').fill(user.name);
  await page.getByLabel('Empresa o espacio de trabajo').fill(user.workspaceName);
  await page.getByLabel('Correo').fill(user.email);
  await page.getByLabel('Contraseña').fill(user.password);

  // `POST /auth/register` está limitado a 10 altas por minuto por IP (A5). Como toda la suite comparte la IP, al
  // ejecutar muchas pruebas se agota la ventana y el alta responde 429 («Demasiadas solicitudes»). No es un fallo de
  // la app: se reintenta esperando a que el limitador libere la ventana (bloqueo ~60 s). La espera es contra una
  // condición concreta del entorno (el aviso de límite), no un `sleep` arbitrario para enmascarar un bug.
  const throttle = page.getByText(/Demasiadas solicitudes/i);
  const crear = page.getByRole('button', { name: /Crear cuenta/ });
  for (let intento = 0; intento < 8; intento++) {
    await crear.click();
    const entro = await page
      .waitForURL((url) => !/\/(register|login)/.test(new URL(url).pathname), { timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (entro) return user;
    if (!(await throttle.isVisible().catch(() => false))) break; // otro problema: que lo evidencie la aserción final
    await page.waitForTimeout(15_000); // esperar a que expire el bloqueo del limitador antes de reintentar
  }
  // Tras el alta queda en la aplicación (no en /register ni /login).
  await expect(page).not.toHaveURL(/\/(register|login)/, { timeout: 15_000 });
  return user;
}

/**
 * Crea un agente vacío por la interfaz (ruta «experto») y devuelve su id, leído de la URL del detalle.
 * El agente nace con el proveedor `mock` determinista del entorno de pruebas.
 */
export async function createEmptyAgent(page: Page, name = 'Agente de prueba QA'): Promise<string> {
  // `?modo=experto` enfoca directamente el formulario mínimo (camino experto). El formulario se muestra
  // siempre en la vista por defecto de /agents/new, así que basta esperar a que su campo nombre esté visible.
  await page.goto('/agents/new?modo=experto');
  const nameField = page.getByLabel('Nombre del agente');
  await expect(nameField).toBeVisible({ timeout: 15_000 });
  await nameField.fill(name);
  await page.getByRole('button', { name: /Crear agente/ }).click();
  // Espera a que se navegue al detalle del agente: su id real (no la propia ruta «/agents/new»). Si la creación
  // falla, aquí se evidencia (no más tarde con un id «new» engañoso).
  await expect(page).toHaveURL(/\/agents\/(?!new(\?|$))[^/?]+/, { timeout: 15_000 });
  const url = new URL(page.url());
  return url.pathname.split('/').pop()!;
}

/**
 * Crea una estación virtual mediante la API autenticada (cookie de sesión + doble envío CSRF por la cookie
 * `nexo_csrf`). Se usa como semilla porque el formulario de alta en `/admin/estaciones-virtuales` está bloqueado por
 * un defecto de la app (el guard de validación no recalcula al escribir; ver el reporte de QA). Devuelve el nombre.
 */
export async function seedEstacionVirtual(page: Page, nombre: string): Promise<string> {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((c) => c.name === 'nexo_csrf')?.value ?? '';
  const res = await page.request.post('/api/estaciones-virtuales', {
    headers: { 'X-CSRF-Token': csrf, 'content-type': 'application/json' },
    data: { nombre, proveedor: 'interna', descripcion: 'Estación de pruebas E2E' },
  });
  expect(res.ok(), `No se pudo sembrar la estación (HTTP ${res.status()})`).toBeTruthy();
  return nombre;
}

/**
 * Navega por el menú lateral como lo haría un usuario: escribe en el buscador del menú (lo que fuerza a desplegar
 * las secciones con coincidencias) y pulsa el enlace con la etiqueta pedida. `label` debe ser la etiqueta exacta del
 * ítem de navegación (ver `layout/sidebar.util.ts`). Deja el buscador limpio al terminar.
 */
export async function irPorMenu(page: Page, label: string): Promise<void> {
  const buscar = page.getByRole('searchbox', { name: 'Buscar en el menú' });
  await buscar.fill(label);
  const nav = page.getByRole('navigation', { name: 'Navegación principal' });
  await nav.getByRole('link', { name: label, exact: true }).click();
  await buscar.fill('');
}

/**
 * Recolecta errores de consola y respuestas 5xx. Falla la prueba si aparece alguno: ningún recorrido debe
 * producir errores en la consola del navegador ni respuestas de servidor 5xx (criterio de calidad de QA).
 */
export function trackPageErrors(page: Page): { assertClean: () => void } {
  const consoleErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Los fallos de carga de recurso (p. ej. el sondeo de sesión que responde 401 estando sin sesión) son ruido de
    // red del navegador, no errores de lógica de la app. Los 5xx se vigilan aparte con el listener de `response`.
    if (/Failed to load resource/i.test(text)) return;
    consoleErrors.push(text);
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));
  page.on('response', (res) => {
    if (res.status() >= 500) serverErrors.push(`${res.status()} ${res.url()}`);
  });
  return {
    assertClean: () => {
      expect(consoleErrors, `Errores de consola:\n${consoleErrors.join('\n')}`).toEqual([]);
      expect(serverErrors, `Respuestas 5xx:\n${serverErrors.join('\n')}`).toEqual([]);
    },
  };
}
