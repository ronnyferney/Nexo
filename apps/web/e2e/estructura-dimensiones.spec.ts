import { expect, test } from '@playwright/test';
import { irPorMenu, registerNewUser, trackPageErrors } from './helpers/app';

/**
 * Estructura (ADR 0011 E1) y Dimensiones (E1b): como OWNER (EDITOR+) se crea una subunidad (área) bajo la raíz del
 * workspace y una dimensión propia del cliente; ambas deben aparecer en sus tablas.
 */
test.describe('Estructura y dimensiones', () => {
  test('crear una subunidad en la estructura y verla en el árbol', async ({ page }) => {
    const errors = trackPageErrors(page);
    await registerNewUser(page);

    await irPorMenu(page, 'Estructura');
    await expect(page.getByRole('heading', { name: 'Estructura', level: 1 })).toBeVisible();

    // Crear una subunidad bajo la raíz del workspace.
    const area = `Área QA ${Date.now()}`;
    await page.getByRole('button', { name: 'Crear subunidad' }).first().click();
    await expect(page.getByRole('heading', { name: 'Nueva subunidad' })).toBeVisible();
    await page.getByLabel('Nombre').fill(area);
    await page.getByRole('button', { name: 'Crear', exact: true }).click();

    // La nueva unidad aparece en la tabla de unidades.
    await expect(page.getByText(area)).toBeVisible({ timeout: 15_000 });

    errors.assertClean();
  });

  test('crear una dimensión propia y verla en el catálogo', async ({ page }) => {
    const errors = trackPageErrors(page);
    await registerNewUser(page);

    await irPorMenu(page, 'Dimensiones');
    await expect(page.getByRole('heading', { name: 'Dimensiones', level: 1 })).toBeVisible();

    const codigo = `qa${Date.now()}`;
    await page.getByRole('button', { name: 'Nueva dimensión' }).click();
    await expect(page.getByRole('heading', { name: 'Nueva dimensión' })).toBeVisible();
    await page.getByLabel('Código').fill(codigo);
    await page.getByLabel('Nombre').fill('Proyecto QA');
    await page.getByRole('button', { name: 'Crear' }).click();

    // La dimensión creada (origen «Cliente») aparece en la tabla.
    await expect(page.getByText(codigo)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Proyecto QA')).toBeVisible();

    errors.assertClean();
  });
});
