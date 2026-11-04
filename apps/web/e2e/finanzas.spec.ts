import { expect, test } from '@playwright/test';
import { irPorMenu, registerNewUser, trackPageErrors } from './helpers/app';

/**
 * A4 — Finanzas: presupuestos + imputación (E9 · HU11/HU24).
 *
 * Pantallas construidas sin recorrido de navegador. Se cubre: definir un presupuesto con umbrales de alerta y política
 * al agotarse, la presencia del modo piloto US$ 0 y de las autorizaciones de gasto (override), y la consola de
 * imputación con sus dos secciones (servicios internos y consolidación económica que separa estimado de medido).
 * Al registrarse se crea una unidad raíz, así que hay al menos una unidad sobre la que definir presupuesto.
 */
test.describe('A4 · Finanzas', () => {
  test('presupuestos: definir límite, umbrales 50/80/100 y política, con piloto y override presentes', async ({
    page,
  }) => {
    const errors = trackPageErrors(page);
    await registerNewUser(page, { workspaceName: 'Vigía QA Finanzas' });

    await irPorMenu(page, 'Presupuestos');
    await expect(page.getByRole('heading', { name: 'Presupuestos', level: 1 })).toBeVisible();
    // El panel advierte que los costos son ESTIMADOS (la factura del proveedor prevalece): estimado vs. medido.
    await expect(page.getByText(/Los costos son estimados/)).toBeVisible();

    // Definir el presupuesto de la unidad raíz.
    await page.getByRole('button', { name: 'Definir' }).first().click();
    await expect(page.getByRole('heading', { name: /presupuesto/ })).toBeVisible();
    await page.getByLabel('Límite (USD)').fill('500');
    await page.getByLabel('Umbrales de alerta (%)').fill('50, 80, 100');
    // Política por defecto «Bloquear»: representa el comportamiento al llegar al tope.
    await page.getByRole('button', { name: /^Guardar$/ }).click();

    // La fila muestra el consumo y los umbrales configurados.
    await expect(page.getByText('Alertas: 50, 80, 100 %')).toBeVisible({ timeout: 15_000 });

    // Gobierno del gasto: modo piloto US$ 0 y autorizaciones de override deben estar presentes.
    await expect(page.getByRole('heading', { name: 'Modo piloto US$ 0' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Autorizaciones de gasto (override)' })).toBeVisible();

    errors.assertClean();
  });

  test('imputación: consola con servicios internos y consolidación económica', async ({ page }) => {
    const errors = trackPageErrors(page);
    await registerNewUser(page);

    await irPorMenu(page, 'Imputación de costos');
    await expect(page.getByRole('heading', { name: 'Imputación de costos', level: 1 })).toBeVisible();

    // Dos pestañas: el reparto de servicios internos y la consolidación económica.
    const tabs = page.getByRole('tablist', { name: 'Secciones de la imputación de costos' });
    await expect(tabs.getByRole('tab', { name: 'Servicios internos' })).toBeVisible();
    const consolidacion = tabs.getByRole('tab', { name: 'Consolidación económica' });
    await expect(consolidacion).toBeVisible();

    // La pestaña de servicios está activa por defecto; cambiar a consolidación.
    await expect(tabs.getByRole('tab', { name: 'Servicios internos' })).toHaveAttribute('aria-selected', 'true');
    await consolidacion.click();
    await expect(consolidacion).toHaveAttribute('aria-selected', 'true');

    errors.assertClean();
  });
});
