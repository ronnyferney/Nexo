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
  await page.getByRole('button', { name: /Crear cuenta/ }).click();
  // Tras el alta queda en la aplicación (no en /register ni /login).
  await expect(page).not.toHaveURL(/\/(register|login)/, { timeout: 15_000 });
  return user;
}

/**
 * Crea un agente vacío por la interfaz (ruta «experto») y devuelve su id, leído de la URL del detalle.
 * El agente nace con el proveedor `mock` determinista del entorno de pruebas.
 */
export async function createEmptyAgent(page: Page, name = 'Agente de prueba QA'): Promise<string> {
  await page.goto('/agents/new');
  // La ruta de experto puede estar tras un botón; si ya se ve el campo, se usa directo.
  const nameField = page.getByLabel('Nombre del agente');
  if (!(await nameField.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /crear(lo)? vac[ií]o/i }).click();
  }
  await nameField.fill(name);
  await page.getByRole('button', { name: /Crear agente/ }).click();
  await expect(page).toHaveURL(/\/agents\/[^/]+$/, { timeout: 15_000 });
  const url = new URL(page.url());
  return url.pathname.split('/').pop()!;
}

/**
 * Recolecta errores de consola y respuestas 5xx. Falla la prueba si aparece alguno: ningún recorrido debe
 * producir errores en la consola del navegador ni respuestas de servidor 5xx (criterio de calidad de QA).
 */
export function trackPageErrors(page: Page): { assertClean: () => void } {
  const consoleErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
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
