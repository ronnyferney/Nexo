import { expect, test } from '@playwright/test';
import { irPorMenu, registerNewUser, trackPageErrors } from './helpers/app';

/**
 * Comunidad interna (E11): muro corporativo. Publicar una novedad, verla en el feed, comentarla y reaccionar.
 * Ejercita el recorrido completo contra el stack vivo (API con el módulo `community` registrado).
 */
test.describe('Comunidad interna', () => {
  test('publicar una novedad, comentar y reaccionar', async ({ page }) => {
    const errors = trackPageErrors(page);
    await registerNewUser(page);

    await irPorMenu(page, 'Comunidad');
    await expect(page.getByRole('heading', { name: 'Comunidad', level: 1 })).toBeVisible();

    // Componer una publicación tipo NOVEDAD.
    const titulo = `Novedad QA ${Date.now()}`;
    const cuerpo = 'El equipo digital cerró el piloto de cartera esta semana.';
    await page.getByRole('button', { name: 'Nueva publicación' }).first().click();
    await page.locator('#c-titulo').fill(titulo);
    await page.locator('#c-cuerpo').fill(cuerpo);
    const [resp] = await Promise.all([
      page.waitForResponse((r) => /\/api\/comunidad\/publicaciones$/.test(r.url()) && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Publicar' }).click(),
    ]);
    expect(resp.status()).toBe(201);

    // La publicación aparece en el feed.
    await expect(page.getByRole('heading', { name: titulo })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(cuerpo)).toBeVisible();

    // Expandir el detalle y comentar.
    const card = page.locator('li.pub', { hasText: titulo }).first();
    await card.getByRole('button', { name: /comentario/i }).first().click();
    const comentario = 'Gran trabajo del equipo.';
    const input = card.locator('input[id^="com-"]');
    await input.fill(comentario);
    const [cResp] = await Promise.all([
      page.waitForResponse((r) => /\/comentarios$/.test(r.url()) && r.request().method() === 'POST'),
      card.getByRole('button', { name: 'Comentar', exact: true }).click(),
    ]);
    expect(cResp.status()).toBe(201);
    await expect(card.getByText(comentario)).toBeVisible();

    // Reaccionar: la petición POST de reacción responde correctamente.
    const [rResp] = await Promise.all([
      page.waitForResponse((r) => /\/reacciones$/.test(r.url()) && r.request().method() === 'POST'),
      card.locator('button.react').first().click(),
    ]);
    expect([200, 201]).toContain(rResp.status());

    errors.assertClean();
  });
});
