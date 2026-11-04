import { expect, test } from '@playwright/test';
import { irPorMenu, registerNewUser, seedTarea, trackPageErrors } from './helpers/app';

/**
 * A3 — Mi trabajo / Supervisión (E4/E3 · HU04/HU14/HU15).
 *
 * Pantallas ya construidas sin recorrido de navegador. Se cubre: la bandeja «Mi trabajo» (tarea con estado, siguiente
 * paso y enlace al detalle), el detalle de la tarea (operación, criterio de aceptación, ejecutor/dueño, paneles de
 * resultado y handoff) y la bandeja de Supervisión (observabilidad del chat + filtros). La tarea se SIEMBRA por la API
 * autenticada porque el workspace nace vacío; la verificación del comportamiento es por navegador.
 */
test.describe('A3 · Mi trabajo y supervisión', () => {
  test('ver una tarea en «Mi trabajo» y abrir su detalle con operación y resultado', async ({ page }) => {
    const errors = trackPageErrors(page);
    await registerNewUser(page);

    const titulo = `Conciliación mensual QA ${Date.now()}`;
    await seedTarea(page, {
      titulo,
      descripcion: 'Conciliar cuentas del mes y entregar informe',
      criterioAceptacion: 'Informe en PDF validado por finanzas',
      prioridad: 2,
    });

    await irPorMenu(page, 'Mi trabajo');
    await expect(page.getByRole('heading', { name: 'Mi trabajo', level: 1 })).toBeVisible();

    // Ampliar a todo el workspace (la tarea sembrada no tiene dueño asignado).
    await page.getByLabel('Alcance').selectOption('todas');
    const enlace = page.getByRole('link', { name: titulo });
    await expect(enlace).toBeVisible({ timeout: 15_000 });

    // Cada tarea muestra su estado operativo (badge).
    const tarjeta = page.locator('li.card', { hasText: titulo });
    await expect(tarjeta.getByText('Pendiente')).toBeVisible();

    // Abrir el detalle: id en la URL, operación, criterio de aceptación y paneles.
    await enlace.click();
    await expect(page).toHaveURL(/\/trabajo\/tareas\/[^/?]+/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: titulo, level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Operación' })).toBeVisible();
    await expect(page.getByText('Informe en PDF validado por finanzas')).toBeVisible();
    await expect(page.getByText('Siguiente paso:')).toBeVisible();
    // El detalle expone el estado del RESULTADO (contrato) y el panel de handoff entre agentes.
    await expect(page.getByRole('heading', { name: 'Incumplimientos', exact: true })).toBeVisible();

    errors.assertClean();
  });

  test('supervisión: observabilidad del chat y filtros de la bandeja', async ({ page }) => {
    const errors = trackPageErrors(page);
    await registerNewUser(page);

    await irPorMenu(page, 'Supervisión');
    await expect(page.getByRole('heading', { name: 'Supervisión', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Observabilidad del chat' })).toBeVisible();

    // Filtros clave de la bandeja de retroalimentación supervisada.
    await expect(page.getByLabel('Estado')).toBeVisible();
    await expect(page.getByLabel('Agente')).toBeVisible();

    // Sin turnos ni retroalimentación, la bandeja muestra su estado vacío («al día»).
    await expect(page.getByText('Bandeja al día')).toBeVisible({ timeout: 15_000 });

    errors.assertClean();
  });
});
