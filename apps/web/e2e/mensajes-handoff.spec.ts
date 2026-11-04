import { expect, test } from '@playwright/test';
import { irPorMenu, registerNewUser, trackPageErrors } from './helpers/app';

/**
 * A6 (parte 1) — Mensajes / handoff entre agentes (E5 · HU17).
 *
 * Bandeja construida sin recorrido de navegador. Se cubre: estado vacío, componer un mensaje (ASIGNACION, que crea la
 * tarea de forma idempotente), su ciclo de vida por hechos (recibir → aceptar), y que una DEVOLUCIÓN exige motivo al
 * resolver (el motivo se conserva). Representa el patrón de coordinación entre agentes sin ejecutar efectos reales.
 */
test.describe('A6 · Mensajes y handoff', () => {
  test('componer una asignación y recorrer su ciclo de vida (recibir, aceptar)', async ({ page }) => {
    const errors = trackPageErrors(page);
    await registerNewUser(page);

    await irPorMenu(page, 'Mensajes');
    await expect(page.getByRole('heading', { name: 'Mensajes', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bandeja vacía' })).toBeVisible();

    await page.getByRole('button', { name: 'Nuevo mensaje' }).click();
    const compose = page.locator('form.compose');
    await compose.getByLabel('Tipo').selectOption('ASIGNACION');
    await compose.getByLabel('Título de la tarea asignada').fill('Revisar backlog de cobranza');
    await compose.getByRole('button', { name: 'Enviar' }).click();

    // El mensaje aparece en la bandeja con su tipo y estado inicial «Enviado».
    const msg = page.locator('.msg').filter({ hasText: 'Asignación' });
    await expect(msg.first()).toBeVisible({ timeout: 15_000 });
    await expect(msg.first().getByText('Enviado')).toBeVisible();

    // Ciclo de vida: recibir → aceptar.
    await msg.first().getByRole('button', { name: 'Recibir' }).click();
    await expect(page.locator('.msg').filter({ hasText: 'Asignación' }).first().getByText('Recibido')).toBeVisible({
      timeout: 15_000,
    });
    await page.locator('.msg').filter({ hasText: 'Asignación' }).first().getByRole('button', { name: 'Aceptar' }).click();
    await expect(page.locator('.msg').filter({ hasText: 'Asignación' }).first().getByText('Aceptado')).toBeVisible({
      timeout: 15_000,
    });

    errors.assertClean();
  });

  test('una devolución exige motivo al resolver (el motivo se conserva)', async ({ page }) => {
    const errors = trackPageErrors(page);
    await registerNewUser(page);

    await irPorMenu(page, 'Mensajes');
    await page.getByRole('button', { name: 'Nuevo mensaje' }).click();
    const compose = page.locator('form.compose');
    await compose.getByLabel('Tipo').selectOption('DEVOLUCION');
    await compose.getByRole('button', { name: 'Enviar' }).click();

    const msg = page.locator('.msg').filter({ hasText: 'Devolución' }).first();
    await expect(msg).toBeVisible({ timeout: 15_000 });

    // Al resolver una devolución se abre un formulario que obliga a indicar el motivo.
    await msg.getByRole('button', { name: 'Resolver' }).click();
    const form = page.locator('form.mini');
    await expect(form.getByText(/obligatorio en devoluciones/)).toBeVisible();
    // Sin motivo, el botón Resolver del formulario está deshabilitado.
    await expect(form.getByRole('button', { name: 'Resolver' })).toBeDisabled();
    await form.getByRole('textbox').fill('Faltan soportes del cliente');
    await form.getByRole('button', { name: 'Resolver' }).click();

    await expect(page.locator('.msg').filter({ hasText: 'Devolución' }).first().getByText('Resuelto')).toBeVisible({
      timeout: 15_000,
    });

    errors.assertClean();
  });
});
