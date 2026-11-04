import { expect, test } from '@playwright/test';
import { irPorMenu, registerNewUser, trackPageErrors } from './helpers/app';

/**
 * A6 (parte 2) — Bandeja de excepciones (E7 · HU05 · RF20/RF21).
 *
 * Pantalla construida sin recorrido de navegador. Las excepciones las crea el MOTOR durable ante fallos o escrituras
 * inciertas; no hay alta pública (se verifican pobladas en los e2e de API). El recorrido de navegador cubre, por tanto,
 * el «chrome» de la bandeja: encabezado, explicación del propósito (reintentar no re-ejecuta lo confirmado), los filtros
 * (estado/clase/origen/tarea) y el estado vacío —el shell operativo desde el que una persona decide la siguiente acción.
 */
test.describe('A6 · Bandeja de excepciones', () => {
  test('bandeja: encabezado, propósito, filtros y estado vacío', async ({ page }) => {
    const errors = trackPageErrors(page);
    await registerNewUser(page);

    await irPorMenu(page, 'Excepciones');
    await expect(page.getByRole('heading', { name: 'Excepciones', level: 1 })).toBeVisible();
    await expect(page.getByText(/Reintentar no re-ejecuta/)).toBeVisible();

    // Filtros clave de la bandeja (siguiente acción = decisión humana).
    await expect(page.getByLabel('Estado')).toBeVisible();
    await expect(page.getByLabel('Clase de fallo')).toBeVisible();
    await expect(page.getByLabel('Origen')).toBeVisible();
    await expect(page.getByLabel('Tarea')).toBeVisible();

    // Workspace recién creado: sin excepciones.
    await expect(page.getByRole('heading', { name: 'Sin excepciones' })).toBeVisible();

    // Los filtros son interactivos (no rompen la vista).
    await page.getByLabel('Clase de fallo').selectOption({ index: 1 });
    await page.getByLabel('Tarea').fill('tarea-inexistente');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page.getByRole('heading', { name: 'Sin excepciones' })).toBeVisible();

    errors.assertClean();
  });
});
