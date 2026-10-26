import { expect, test } from '@playwright/test';
import { irPorMenu, registerNewUser, trackPageErrors } from './helpers/app';

/**
 * Auditoría (E13): como OWNER (admin), el visor muestra el sello de integridad de la cadena («Cadena íntegra»), los
 * filtros y, si hay hechos, cada fila se expande para ver sus hashes. En un workspace recién creado puede no haber
 * hechos: en ese caso se valida igualmente el sello y el estado vacío.
 */
test.describe('Auditoría', () => {
  test('sello de integridad, filtros y detalle con hashes', async ({ page }) => {
    const errors = trackPageErrors(page);
    await registerNewUser(page);

    await irPorMenu(page, 'Auditoría');
    await expect(page.getByRole('heading', { name: 'Auditoría', level: 1 })).toBeVisible();

    // Sello de integridad: tras verificar la cadena debe mostrarse «Cadena íntegra».
    await expect(page.getByText('Cadena íntegra')).toBeVisible({ timeout: 15_000 });

    // Hay filtros (selector de acción y botón aplicar).
    await expect(page.getByRole('button', { name: 'Aplicar' })).toBeVisible();

    // Si hay hechos, una fila se expande y muestra los hashes; si no, se valida el estado vacío.
    const expandir = page.getByRole('button', { name: 'Ver detalle' });
    if (await expandir.count()) {
      await expandir.first().click();
      await expect(page.getByText('Hash de la entrada')).toBeVisible();
      await expect(page.getByText('Hash previo')).toBeVisible();
    } else {
      await expect(page.getByText('Sin hechos registrados')).toBeVisible();
    }

    errors.assertClean();
  });
});
