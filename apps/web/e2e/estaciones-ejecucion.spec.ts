import { expect, test } from '@playwright/test';
import { createEmptyAgent, irPorMenu, registerNewUser, trackPageErrors } from './helpers/app';

/**
 * Estaciones virtuales (E8) + parámetros de ejecución del agente. Recorrido completo por la interfaz:
 * un administrador crea una estación, la asigna a un empleado digital, habilita la salida a internet y guarda;
 * tras guardar, el indicador de cambios se limpia (el botón «Guardar parámetros» queda deshabilitado).
 */
test.describe('Estaciones virtuales y parámetros de ejecución', () => {
  test('crea la estación por la UI, la asigna al agente con salida a internet y limpia el estado al guardar', async ({ page }) => {
    const errors = trackPageErrors(page);
    await registerNewUser(page);
    const agentId = await createEmptyAgent(page, 'Agente Ejecución QA');

    // Alta de la estación POR LA INTERFAZ (admin).
    const estacion = `Estación QA ${Date.now()}`;
    await irPorMenu(page, 'Estaciones virtuales');
    await expect(page.getByRole('heading', { name: 'Estaciones virtuales', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Nueva estación' }).first().click();
    await page.locator('#ev-nombre').fill(estacion);
    const guardarEstacion = page.getByRole('button', { name: 'Guardar', exact: true });
    await expect(guardarEstacion).toBeEnabled(); // con nombre válido, el botón se habilita (regresión del bug de signal)
    await guardarEstacion.click();
    await expect(page.getByText('Estación creada')).toBeVisible();
    await expect(page.getByText(estacion)).toBeVisible({ timeout: 15_000 });

    // Expediente del agente, pestaña «Ejecución».
    await page.goto(`/agents/${agentId}`);
    await page.getByRole('tab', { name: 'Ejecución' }).click();

    // Asignar la estación recién creada (primera opción real del selector).
    const selector = page.getByLabel('Estación asignada');
    await expect(selector).toBeVisible();
    await selector.selectOption({ index: 1 });

    // Alternar la salida a internet y verificar el aviso de seguridad.
    const salida = page.getByRole('switch', { name: 'Permitir salida a internet' });
    await salida.click();
    await expect(page.getByText(/no.*abre acceso irrestricto/i)).toBeVisible();

    // Guardar: el PUT persiste estación + salida (HTTP 200).
    const guardar = page.getByRole('button', { name: 'Guardar parámetros' });
    const [resp] = await Promise.all([
      page.waitForResponse((r) => /\/api\/execution-params\//.test(r.url()) && r.request().method() === 'PUT'),
      guardar.click(),
    ]);
    expect(resp.status()).toBe(200);
    const guardado = resp.request().postDataJSON() as { estacionVirtualId: string | null; salidaInternet: boolean };
    expect(guardado.estacionVirtualId).toBeTruthy();
    expect(guardado.salidaInternet).toBe(true);
    await expect(page.getByText('Parámetros de ejecución guardados')).toBeVisible();

    // Tras guardar con éxito, el estado «sin guardar» se limpia (regresión del bug de snapshot no reactivo).
    await expect(guardar).toBeDisabled();
    await expect(page.getByText('Cambios sin guardar')).toHaveCount(0);

    errors.assertClean();
  });
});
