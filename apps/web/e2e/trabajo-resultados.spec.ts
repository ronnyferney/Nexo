import { expect, test } from '@playwright/test';
import { irPorMenu, registerNewUser, trackPageErrors } from './helpers/app';

/**
 * Trabajo por resultados (RF36/RF24): una solicitud no ejecuta sola; se convierte en tarea autorizada con autoridad
 * (EDITOR+). Como OWNER se crea un canal, se abre un hilo y se convierte en tarea con criterio de aceptación; la tarea
 * resultante aparece luego en la bandeja «Mi trabajo».
 */
test.describe('Trabajo por resultados', () => {
  test('convertir una solicitud en tarea autorizada y verla en Mi trabajo', async ({ page }) => {
    const errors = trackPageErrors(page);
    await registerNewUser(page);

    await irPorMenu(page, 'Canales');
    await expect(page.getByRole('heading', { name: 'Canales', level: 1 })).toBeVisible();

    // Crear un canal.
    await page.getByRole('button', { name: 'Nuevo canal' }).click();
    const canal = `Canal QA ${Date.now()}`;
    await page.getByLabel('Nombre').fill(canal);
    await page.getByRole('button', { name: 'Crear canal' }).click();
    await expect(page.getByRole('heading', { name: canal })).toBeVisible({ timeout: 15_000 });

    // Abrir un hilo (solicitud) en el canal.
    await page.getByLabel('Nuevo hilo').fill('Solicitud de reporte mensual');
    await page.getByRole('button', { name: 'Abrir hilo' }).click();
    await expect(page.getByText('Solicitud de reporte mensual')).toBeVisible({ timeout: 15_000 });

    // Convertir la solicitud en tarea autorizada con criterio de aceptación.
    const titulo = `Reporte mensual QA ${Date.now()}`;
    await page.getByRole('button', { name: 'Convertir en tarea' }).click();
    await page.getByLabel('Título de la tarea autorizada').fill(titulo);
    await page.getByLabel('Criterio de aceptación (opcional)').fill('Entregado en PDF antes del día 5');
    await page.getByRole('button', { name: 'Crear tarea' }).click();

    // El hilo queda marcado como convertido en tarea.
    await expect(page.getByText('Tarea creada')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: /Ver tarea/ })).toBeVisible();

    // La tarea aparece en la bandeja «Mi trabajo» (ampliando el alcance a todo el workspace).
    await irPorMenu(page, 'Mi trabajo');
    await expect(page.getByRole('heading', { name: 'Mi trabajo', level: 1 })).toBeVisible();
    await page.getByLabel('Alcance').selectOption('todas');
    await expect(page.getByRole('link', { name: titulo })).toBeVisible({ timeout: 15_000 });

    errors.assertClean();
  });
});
