import { expect, test } from '@playwright/test';
import { apiGet, irPorMenu, registerNewUser, seedAprobacionPendiente, trackPageErrors } from './helpers/app';

/**
 * A2 — Aprobaciones / Gobierno (E6 · HU06/HU10 · QA03/QA07/QA08 a nivel de UI).
 *
 * La pantalla ya estaba construida (con pruebas unitarias de `governance.util`), pero sin recorrido de navegador.
 * Aquí se cubre: la bandeja de aprobaciones (lista + detalle con huella de contenido y doble aprobación), que aprobar
 * registra la decisión, que el servidor impide autoaprobarse (lo VISIBLE = autorización del servidor), el CRUD de
 * políticas y el interruptor de suspensión con reactivación motivada. Como el workspace nace vacío, cada caso que
 * necesita datos los SIEMBRA por la API autenticada (no sustituye a la verificación por navegador).
 */
test.describe('A2 · Aprobaciones y gobierno', () => {
  test('bandeja de aprobaciones: estado vacío, detalle y registrar una decisión', async ({ page }) => {
    const errors = trackPageErrors(page);
    await registerNewUser(page);

    // Estado vacío con sus filtros antes de sembrar nada.
    await irPorMenu(page, 'Aprobaciones');
    await expect(page.getByRole('heading', { name: 'Aprobaciones', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sin aprobaciones' })).toBeVisible();
    await expect(page.getByLabel('Filtrar por estado')).toBeVisible();

    // Sembrar una aprobación PENDIENTE que el propio solicitante PUEDE aprobar (autoaprobación permitida).
    const tipo = `PAGO_QA_${Date.now()}`;
    await seedAprobacionPendiente(page, {
      tipoAccion: tipo,
      proposito: 'Pago de prueba E2E',
      allowSelfApproval: true,
      importe: 1234,
      moneda: 'USD',
    });

    await page.getByRole('button', { name: 'Actualizar' }).click();
    const fila = page.getByRole('row', { name: /Pago de prueba E2E/ });
    await expect(fila).toBeVisible({ timeout: 15_000 });
    await expect(fila.getByText('Riesgo alto')).toBeVisible();
    await expect(fila.getByText('1234 USD')).toBeVisible();

    // Abrir el detalle: compara la propuesta con el estado de gobierno (huella + doble aprobación).
    await fila.click();
    const drawer = page.getByRole('dialog', { name: 'Detalle de la aprobación' });
    await expect(drawer.getByRole('heading', { name: 'Pago de prueba E2E' })).toBeVisible();
    await expect(drawer.getByText('Propuesta')).toBeVisible();
    await expect(drawer.getByText('Estado de gobierno')).toBeVisible();
    await expect(drawer.getByText(/la aprobación se invalida al ejecutar/)).toBeVisible();

    // Registrar la aprobación y comprobar que el estado pasa a «Aprobada».
    await drawer.getByRole('button', { name: 'Aprobar' }).click();
    await expect(drawer.getByText('Aprobada').first()).toBeVisible({ timeout: 15_000 });

    errors.assertClean();
  });

  test('el servidor impide que el solicitante se autoapruebe (botón bloqueado con motivo)', async ({ page }) => {
    const errors = trackPageErrors(page);
    await registerNewUser(page);

    const tipo = `BORRADO_QA_${Date.now()}`;
    await seedAprobacionPendiente(page, {
      tipoAccion: tipo,
      proposito: 'Borrado sensible E2E',
      allowSelfApproval: false,
    });

    await irPorMenu(page, 'Aprobaciones');
    await page.getByRole('row', { name: /Borrado sensible E2E/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Detalle de la aprobación' });

    // Es el solicitante y la política prohíbe la autoaprobación: el botón Aprobar queda deshabilitado con aviso.
    await expect(drawer.getByText(/prohíbe la autoaprobación/)).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Aprobar' })).toBeDisabled();

    errors.assertClean();
  });

  test('políticas: crear una que exige aprobación y verla en la lista', async ({ page }) => {
    const errors = trackPageErrors(page);
    await registerNewUser(page);

    await irPorMenu(page, 'Políticas');
    await expect(page.getByRole('heading', { name: 'Políticas de acción', level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'Nueva política' }).first().click();
    const nombre = `Pagos altos QA ${Date.now()}`;
    await page.getByLabel('Nombre').fill(nombre);
    await page.getByLabel('Tipo de acción').fill('PAYMENT');
    // Efecto por defecto REQUIRE_APPROVAL; dejar sin autoaprobación.
    await page.getByRole('button', { name: /^Guardar/ }).click();

    const fila = page.getByRole('row', { name: new RegExp(nombre) });
    await expect(fila).toBeVisible({ timeout: 15_000 });
    await expect(fila.getByText('Requiere aprobación')).toBeVisible();
    await expect(fila.getByText('v1')).toBeVisible();

    // La pestaña «Decisiones registradas» debe ser navegable.
    await page.getByRole('button', { name: 'Decisiones registradas' }).click();
    await expect(page).toHaveURL(/\/admin\/politicas/);

    errors.assertClean();
  });

  test('suspensión de emergencia: activar un alcance y reactivarlo con motivo', async ({ page }) => {
    const errors = trackPageErrors(page);
    await registerNewUser(page);

    // Un agente real al que apuntar la suspensión (referencia blanda, pero realista).
    const agents = await apiGet<Array<{ id: string }>>(page, '/agents');
    const targetId = agents[0]?.id ?? `agente-${Date.now()}`;

    await irPorMenu(page, 'Suspensión');
    await expect(page.getByRole('heading', { name: 'Suspensión de emergencia', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sin suspensiones' })).toBeVisible();

    await page.getByRole('button', { name: 'Suspender alcance' }).click();
    // Alcance AGENTE viene por defecto; completar objetivo y motivo.
    await page.getByLabel('Identificador del alcance').fill(targetId);
    await page.getByLabel('Motivo').fill('Comportamiento anómalo detectado en pruebas');
    await page.getByRole('button', { name: 'Activar suspensión' }).click();

    const fila = page.getByRole('row', { name: new RegExp(targetId) });
    await expect(fila).toBeVisible({ timeout: 15_000 });
    await expect(fila.getByText('Activa', { exact: true })).toBeVisible();

    // Reactivar exige motivo; tras hacerlo, el alcance queda «Reactivada».
    await fila.getByRole('button', { name: 'Reactivar' }).click();
    const panel = page.locator('.card.stack').filter({ hasText: 'Motivo de la reactivación' });
    await panel.getByLabel('Motivo de la reactivación').fill('Causa raíz corregida; se rehabilita');
    await panel.getByRole('button', { name: 'Reactivar' }).click();
    await expect(
      page.getByRole('row', { name: new RegExp(targetId) }).getByText('Reactivada', { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    errors.assertClean();
  });
});
