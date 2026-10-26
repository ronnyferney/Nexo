import { expect, test } from '@playwright/test';
import { irPorMenu, registerNewUser, trackPageErrors } from './helpers/app';

/**
 * Consola gerencial (E12): vista de dirección (solo admin/OWNER). Carga los bloques Resultados, Economía, Estado de
 * gobierno e Integridad y auditoría para el período, con el filtro de rango de fechas. Es honesta con «sin datos».
 */
test.describe('Consola gerencial', () => {
  test('carga los bloques del resumen ejecutivo con el filtro de período', async ({ page }) => {
    const errors = trackPageErrors(page);
    await registerNewUser(page);

    await irPorMenu(page, 'Consola gerencial');
    await expect(page.getByRole('heading', { name: 'Consola gerencial', level: 1 })).toBeVisible();

    // El filtro de período y el botón para aplicarlo están presentes.
    await expect(page.getByRole('button', { name: 'Aplicar' })).toBeVisible();

    // Los cuatro bloques del resumen ejecutivo se renderizan al cargar los datos.
    await expect(page.getByRole('heading', { name: 'Resultados' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Economía' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Estado de gobierno' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Integridad y auditoría' })).toBeVisible();

    // El sello de confianza de la cadena de auditoría se muestra en el bloque de integridad.
    await expect(page.getByText('Sello de confianza de la cadena de auditoría')).toBeVisible();

    errors.assertClean();
  });
});
