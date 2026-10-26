import { expect, test } from '@playwright/test';
import { createEmptyAgent, irPorMenu, registerNewUser, trackPageErrors } from './helpers/app';

/**
 * Organigrama (E3/RF32): el árbol de empleados digitales se ve, un administrador (OWNER) puede abrir «Reasignar
 * supervisor» (muestra el selector) y cualquiera puede abrir «Ver cadena de mando». Con un solo agente basta el nodo
 * raíz. El usuario que se registra primero es OWNER, así que ve las acciones de edición.
 */
test.describe('Organigrama', () => {
  test('muestra el árbol y abre reasignación y cadena de mando', async ({ page }) => {
    const errors = trackPageErrors(page);
    await registerNewUser(page);
    await createEmptyAgent(page, 'Agente Organigrama QA');

    await irPorMenu(page, 'Organigrama');
    await expect(page.getByRole('heading', { name: 'Organigrama', level: 1 })).toBeVisible();

    // El árbol existe y el nodo raíz es el agente recién creado.
    const arbol = page.getByRole('tree', { name: /Organigrama de empleados digitales/ });
    await expect(arbol).toBeVisible();
    await expect(arbol.getByText('Agente Organigrama QA')).toBeVisible();

    // «Ver cadena de mando» abre el diálogo correspondiente.
    await page.getByRole('button', { name: 'Ver cadena de mando' }).first().click();
    const cadena = page.getByRole('dialog');
    await expect(cadena.getByRole('heading', { name: 'Cadena de mando' })).toBeVisible();
    await cadena.getByRole('button', { name: 'Cerrar' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Como admin, «Reasignar» abre el diálogo con el selector de supervisor.
    await page.getByRole('button', { name: /Reasignar/ }).first().click();
    const reasignar = page.getByRole('dialog');
    await expect(reasignar.getByRole('heading', { name: 'Reasignar supervisor' })).toBeVisible();
    await expect(reasignar.getByLabel('Supervisor')).toBeVisible();

    errors.assertClean();
  });
});
