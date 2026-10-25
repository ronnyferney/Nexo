import { expect, test, type Page } from '@playwright/test';
import { createEmptyAgent, registerNewUser, trackPageErrors } from './helpers/app';

/**
 * Chequeos de accesibilidad de las páginas principales (RX-13, WCAG 2.2 AA).
 *
 * El proyecto no incluye `@axe-core/playwright` como dependencia, así que estas comprobaciones son manuales:
 * etiquetas de formulario, roles/aria de pestañas y diálogos, nombres accesibles de los botones-icono, foco por
 * teclado y foco visible. Si en el futuro se agrega axe-core (coordinar: no añadir dependencias sin avisar),
 * puede complementarse con `new AxeBuilder({ page }).analyze()` y afirmar cero violaciones críticas/serias.
 */

/** Todo botón solo-icono debe tener nombre accesible (aria-label, title o texto). */
async function assertIconButtonsHaveNames(page: Page): Promise<void> {
  const unnamed = await page.evaluate(() => {
    const out: string[] = [];
    for (const btn of Array.from(document.querySelectorAll('button, a[role="button"]'))) {
      const text = (btn.textContent ?? '').trim();
      const label = btn.getAttribute('aria-label') ?? btn.getAttribute('title') ?? '';
      const labelledby = btn.getAttribute('aria-labelledby');
      if (!text && !label && !labelledby) out.push(btn.outerHTML.slice(0, 120));
    }
    return out;
  });
  expect(unnamed, `Botones sin nombre accesible:\n${unnamed.join('\n')}`).toEqual([]);
}

test.describe('Accesibilidad — autenticación', () => {
  test('login: campos etiquetados y navegables por teclado', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto('/login');

    // Cada campo tiene su <label for> asociado (getByLabel falla si no hay nombre accesible).
    await expect(page.getByLabel('Correo')).toBeVisible();
    await expect(page.getByLabel('Contraseña')).toBeVisible();

    // Orden de foco: correo -> contraseña -> botón.
    await page.getByLabel('Correo').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Contraseña')).toBeFocused();

    await assertIconButtonsHaveNames(page);
    errors.assertClean();
  });

  test('registro: la pista de contraseña está asociada con aria-describedby', async ({ page }) => {
    await page.goto('/register');
    const password = page.getByLabel('Contraseña');
    const describedBy = await password.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const hint = page.locator(`#${describedBy}`);
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(/Mínimo 8 caracteres/);
  });
});

test.describe('Accesibilidad — detalle del agente y chat', () => {
  test.beforeEach(async ({ page }) => {
    await registerNewUser(page);
  });

  test('las pestañas del chat exponen el patrón tablist correcto', async ({ page }) => {
    await createEmptyAgent(page);

    const tablist = page.getByRole('tablist', { name: 'Vistas del chat' });
    await expect(tablist).toBeVisible();

    const tabs = tablist.getByRole('tab');
    await expect(tabs).toHaveCount(3); // Conversación / Actividad / Diagnóstico (con permiso de edición)

    // Cada pestaña declara el panel que controla.
    for (const tab of await tabs.all()) {
      await expect(tab).toHaveAttribute('aria-controls', 'chat-panel');
    }

    // Exactamente una pestaña seleccionada.
    await expect(tablist.locator('[aria-selected="true"]')).toHaveCount(1);

    // El panel es un tabpanel con región viva para anunciar la respuesta en curso.
    const panel = page.getByRole('tabpanel');
    await expect(panel).toHaveAttribute('aria-live', 'polite');
  });

  test('los botones-icono del chat tienen nombre accesible y foco visible', async ({ page }) => {
    await createEmptyAgent(page);
    await assertIconButtonsHaveNames(page);

    // El compositor es alcanzable y etiquetado.
    const composer = page.getByLabel('Mensaje');
    await composer.focus();
    await expect(composer).toBeFocused();

    // El botón de pantalla completa expone su estado (aria-pressed) y etiqueta.
    const fullscreen = page.getByRole('button', { name: /pantalla completa/i });
    await expect(fullscreen).toHaveAttribute('aria-pressed', /true|false/);
  });

  test('el divisor redimensionable es un separator operable por teclado', async ({ page }) => {
    await createEmptyAgent(page);
    const sep = page.getByRole('separator', { name: /Ajustar el ancho/ });
    await expect(sep).toHaveAttribute('aria-orientation', 'vertical');
    const before = await sep.getAttribute('aria-valuenow');
    await sep.focus();
    await page.keyboard.press('ArrowLeft');
    const after = await sep.getAttribute('aria-valuenow');
    expect(after).not.toEqual(before);
  });
});

test.describe('Accesibilidad — diálogos', () => {
  test('el diálogo de compartir atrapa el foco y se cierra con Escape', async ({ page }) => {
    await registerNewUser(page);
    await createEmptyAgent(page);

    await page.getByRole('button', { name: /Compartir/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // El foco entra en el diálogo.
    const focusInDialog = await dialog.evaluate((el) => el.contains(document.activeElement));
    expect(focusInDialog).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
});
