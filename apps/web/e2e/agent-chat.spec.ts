import { expect, test } from '@playwright/test';
import { createEmptyAgent, registerNewUser, trackPageErrors } from './helpers/app';

/**
 * Regresión del chat del agente (RX-13): enviar un mensaje y ver la respuesta, el estado del turno y que las tres
 * vistas (Conversación / Actividad / Diagnóstico) son navegables por teclado y están correctamente etiquetadas.
 *
 * El agente usa el proveedor `mock` (determinista), por lo que la respuesta es estable sin clave de API.
 */
test.describe('Chat del agente', () => {
  test.beforeEach(async ({ page }) => {
    await registerNewUser(page);
  });

  test('envía un mensaje y recibe respuesta con estado de turno visible', async ({ page }) => {
    const errors = trackPageErrors(page);
    await createEmptyAgent(page);

    const panel = page.getByRole('tabpanel');
    const composer = page.getByLabel('Mensaje');
    await expect(composer).toBeVisible();

    // El botón enviar está deshabilitado sin texto (anti-doble-envío / compositor RX-4).
    const send = page.getByRole('button', { name: 'Enviar' });
    await expect(send).toBeDisabled();

    await composer.fill('Hola, ¿qué puedes hacer?');
    await expect(send).toBeEnabled();
    await send.click();

    // El mensaje del usuario aparece en la conversación.
    await expect(panel.getByText('Hola, ¿qué puedes hacer?')).toBeVisible();

    // Mientras genera, hay un indicador de estado de turno accesible (role="status").
    // Al terminar, debe existir al menos una respuesta del asistente.
    await expect(panel.locator('.msg.assistant').first()).toBeVisible({ timeout: 30_000 });

    // No debe quedar el indicador de progreso activo tras completar.
    await expect(page.locator('.turn-status .dots')).toHaveCount(0);

    errors.assertClean();
  });

  test('las tres vistas del chat son navegables por teclado (patrón tablist ARIA)', async ({ page }) => {
    await createEmptyAgent(page);

    const conversation = page.getByRole('tab', { name: /Conversación/ });
    const activity = page.getByRole('tab', { name: /Actividad/ });
    const diagnostics = page.getByRole('tab', { name: /Diagnóstico/ });

    await expect(conversation).toHaveAttribute('aria-selected', 'true');

    // Foco en la pestaña activa y navegación con flechas (roving tabindex).
    await conversation.focus();
    await page.keyboard.press('ArrowRight');
    await expect(activity).toBeFocused();
    await expect(activity).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('ArrowRight');
    await expect(diagnostics).toBeFocused();
    await expect(diagnostics).toHaveAttribute('aria-selected', 'true');

    // Fin/Inicio saltan a los extremos; se envuelve al principio.
    await page.keyboard.press('Home');
    await expect(conversation).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(diagnostics).toBeFocused();

    // El panel está asociado a la pestaña activa (aria-labelledby apunta a su id).
    const panel = page.getByRole('tabpanel');
    await expect(panel).toHaveAttribute('aria-labelledby', 'chat-tab-diagnostics');
  });

  test('«Nueva» reinicia la conversación y vuelve a la vista Conversación', async ({ page }) => {
    await createEmptyAgent(page);
    const composer = page.getByLabel('Mensaje');
    await composer.fill('Primer mensaje');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByRole('tabpanel').getByText('Primer mensaje')).toBeVisible();

    await page.getByRole('button', { name: /Nueva/ }).click();
    await expect(page.getByRole('tabpanel').getByText('Primer mensaje')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /Conversación/ })).toHaveAttribute('aria-selected', 'true');
    // Estado vacío de la conversación.
    await expect(page.getByText('Converse con su agente')).toBeVisible();
  });

  test('el compositor envía con Enter y no envía con Mayús+Enter', async ({ page }) => {
    await createEmptyAgent(page);
    const composer = page.getByLabel('Mensaje');
    await composer.focus();
    await composer.type('Línea uno');
    await page.keyboard.press('Shift+Enter');
    await composer.type('línea dos');
    // Mayús+Enter inserta salto de línea, no envía: el texto sigue en el compositor.
    await expect(composer).toHaveValue(/Línea uno\s+línea dos/);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tabpanel').getByText(/Línea uno/)).toBeVisible();
    await expect(composer).toHaveValue('');
  });
});
