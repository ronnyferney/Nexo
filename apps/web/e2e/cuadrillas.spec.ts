import { expect, test } from '@playwright/test';
import { irPorMenu, registerNewUser, trackPageErrors } from './helpers/app';

/**
 * Cuadrillas (ADR 0014 · E11): recorrido de gobierno completo de una plantilla de equipo. Como OWNER (ADMIN) se crea la
 * plantilla, se agrega una versión con un miembro (editor SOLO declarativo, sin campos de código), se publica y se
 * instancia; el diálogo de resultado muestra los permisos pendientes y el aviso de que instanciar no concede acceso.
 */
test.describe('Cuadrillas', () => {
  test('crear plantilla, versión con un miembro, publicar e instanciar', async ({ page }) => {
    const errors = trackPageErrors(page);
    await registerNewUser(page);

    await irPorMenu(page, 'Cuadrillas');
    await expect(page.getByRole('heading', { name: 'Cuadrillas', level: 1 })).toBeVisible();

    // Crear la plantilla (ADMIN) en BORRADOR.
    const nombre = `Cuadrilla QA ${Date.now()}`;
    await page.getByRole('button', { name: 'Nueva Cuadrilla' }).first().click();
    const crear = page.getByRole('dialog');
    await crear.getByLabel('Nombre').fill(nombre);
    await crear.getByRole('button', { name: 'Crear Cuadrilla' }).click();

    // Navega al detalle de la plantilla recién creada.
    await expect(page).toHaveURL(/\/cuadrillas\/[^/]+$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: nombre })).toBeVisible();
    await expect(page.getByText('Sin versiones')).toBeVisible();

    // Agregar una versión con un miembro desde el editor SOLO declarativo.
    await page.getByRole('button', { name: 'Nueva versión' }).first().click();
    const editor = page.getByRole('dialog');
    await expect(editor.getByRole('heading', { name: 'Nueva versión' })).toBeVisible();
    // El editor es declarativo: declara explícitamente que no hay campos de código/scripts/hooks/URLs de arranque.
    await expect(editor.getByText(/No hay campos de código, scripts, hooks ni URLs de arranque/)).toBeVisible();
    await expect(editor.getByLabel(/código|script|hook|arranque/i)).toHaveCount(0);

    await editor.getByLabel('Rol', { exact: false }).first().fill('Analista de soporte');
    await editor.getByRole('button', { name: 'Agregar versión' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Versión 1/ })).toBeVisible();

    // Publicar (usa confirm() nativo del navegador).
    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Publicar' }).click();
    await expect(page.getByText('Publicada').first()).toBeVisible({ timeout: 15_000 });

    // Instanciar: abre el diálogo y confirma.
    await page.getByRole('button', { name: 'Instanciar' }).click();
    const inst = page.getByRole('dialog');
    await expect(inst.getByRole('heading', { name: new RegExp(`Instanciar «${nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}»`) })).toBeVisible();
    await inst.getByRole('button', { name: 'Instanciar' }).click();

    // El diálogo de resultado muestra el aviso y los permisos pendientes de conceder.
    const resultado = page.getByRole('dialog');
    await expect(resultado.getByRole('heading', { name: 'Cuadrilla instanciada' })).toBeVisible({ timeout: 15_000 });
    await expect(resultado.getByText('Instanciar no concede acceso.')).toBeVisible();
    await expect(resultado.getByText(/Permisos pendientes de conceder/)).toBeVisible();

    errors.assertClean();
  });
});
