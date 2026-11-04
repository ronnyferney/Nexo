import { expect, test, type Locator } from '@playwright/test';
import { registerNewUser, trackPageErrors } from './helpers/app';

/**
 * A5 — Consola de cumplimiento (ADR 0020 · Ola 2). Ruta `/ajustes/cumplimiento`, solo ADMIN/OWNER.
 *
 * Pantalla nueva sin recorrido de navegador. Se cubre: listar/filtrar, crear una regla (nace INACTIVA y asesora),
 * activarla/inactivarla, su ventana de vigencia y la auditoría de los cambios. El recorrido es representativo: usa un
 * campo clave único por prueba para no depender de reglas sembradas que el workspace pueda traer.
 */
test.describe('A5 · Consola de cumplimiento', () => {
  /** El formulario de alta/edición (lo delimita su propio encabezado, aparte de la barra de filtros). */
  const formulario = (page: import('@playwright/test').Page): Locator =>
    page.locator('div.card.stack').filter({ hasText: 'regla de cumplimiento' });

  /** La tabla de reglas (su encabezado tiene «Campo clave»), separada de la tabla de auditoría. */
  const tablaReglas = (page: import('@playwright/test').Page): Locator =>
    page.locator('.card').filter({ has: page.getByRole('columnheader', { name: 'Campo clave' }) });

  test('crear una regla, activarla, filtrarla y ver la auditoría del cambio', async ({ page }) => {
    const errors = trackPageErrors(page);
    // Los diálogos de confirmación (activar/inactivar) se aceptan automáticamente.
    page.on('dialog', (d) => void d.accept());

    await registerNewUser(page);

    await page.goto('/ajustes/cumplimiento');
    await expect(page.getByRole('heading', { name: 'Cumplimiento', level: 1 })).toBeVisible();
    await expect(page.getByText(/Las reglas son .*asesoras/)).toBeVisible();

    // Crear una regla con alcance y vigencia.
    const campo = `baseLegalQA${Date.now()}`;
    await page.getByRole('button', { name: 'Nueva regla' }).first().click();
    const form = formulario(page);
    await expect(form.getByRole('heading', { name: /regla de cumplimiento/ })).toBeVisible();
    await form.getByLabel('Jurisdicción').fill('EC');
    await form.getByLabel('Sector').fill('financiero');
    await form.getByLabel('Proceso').fill('cobranza');
    await form.getByLabel(/Campo clave/).fill(campo);
    await form.getByLabel('Descripción').fill('Base legal del tratamiento (prueba E2E)');
    await form.getByLabel('Vigente desde').fill('2026-01-01');
    await form.getByLabel('Vigente hasta').fill('2026-12-31');
    await form.getByRole('button', { name: 'Guardar regla' }).click();

    // La regla aparece en la tabla de reglas, INACTIVA (nace inactiva).
    const tabla = tablaReglas(page);
    const fila = tabla.getByRole('row', { name: new RegExp(campo) });
    await expect(fila).toBeVisible({ timeout: 15_000 });
    await expect(fila.getByText('Inactiva', { exact: true })).toBeVisible();
    await expect(fila.getByText(/Jurisdicción: EC · Sector: financiero · Proceso: cobranza/)).toBeVisible();

    // Activarla (asesora, no bloqueante) → pasa a Activa.
    await fila.getByRole('button', { name: 'Activar regla' }).click();
    await expect(
      tabla.getByRole('row', { name: new RegExp(campo) }).getByText('Activa', { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Filtrar por texto deja solo la coincidencia.
    await page.getByLabel('Buscar', { exact: true }).fill(campo);
    await expect(tabla.getByRole('row', { name: new RegExp(campo) })).toBeVisible();

    // La auditoría de cambios registra el alta/activación de la regla.
    await expect(page.getByRole('heading', { name: 'Auditoría de cambios' })).toBeVisible();
    const auditoria = page.locator('.card', { hasText: 'Auditoría de cambios' });
    await expect(auditoria.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 });

    errors.assertClean();
  });

  test('inactivar una regla recién creada deja constancia del estado', async ({ page }) => {
    const errors = trackPageErrors(page);
    page.on('dialog', (d) => void d.accept());
    await registerNewUser(page);

    await page.goto('/ajustes/cumplimiento');
    const campo = `retencionQA${Date.now()}`;
    await page.getByRole('button', { name: 'Nueva regla' }).first().click();
    const form = formulario(page);
    await form.getByLabel(/Campo clave/).fill(campo);
    // Marcar «Activa» en el alta para luego inactivarla desde la tabla.
    await form.getByRole('checkbox', { name: /Activa/ }).check();
    await form.getByRole('button', { name: 'Guardar regla' }).click();

    const tabla = tablaReglas(page);
    const fila = tabla.getByRole('row', { name: new RegExp(campo) });
    await expect(fila.getByText('Activa', { exact: true })).toBeVisible({ timeout: 15_000 });
    await fila.getByRole('button', { name: 'Inactivar regla' }).click();
    await expect(
      tabla.getByRole('row', { name: new RegExp(campo) }).getByText('Inactiva', { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    errors.assertClean();
  });
});
