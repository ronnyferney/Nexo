# Suite e2e de Nexo (Playwright) — RX-13

Recorridos de regresión y chequeos de accesibilidad (WCAG 2.2 AA) centrados en el **chat del agente**.

## Estado

Los specs están escritos y bien formados, pero **no se ejecutan en el pipeline actual**: `@playwright/test` no es
dependencia del proyecto (`apps/web`) y no debe añadirse sin coordinarlo con `nexo-frontend-core`/`nexo-backend-platform`
(dueños de `package.json` y del job de CI). Para ejecutarlos localmente hace falta instalar la dependencia y levantar la
pila completa.

## Requisitos de entorno

- Postgres (5432) y Redis (6379) levantados.
- API (`apps/api`) en `http://localhost:3000/api`, con:
  - `CONNECTOR_ALLOW_PRIVATE_NETWORKS=true` (mocks locales),
  - proveedor LLM `mock` (determinista, sin clave),
  - `REGISTRATION_MODE` abierto (cada prueba crea su usuario/workspace).
- Web (`npm start`) en `http://localhost:4200`.
- Chromium preinstalado del contenedor:
  `export CHROME_BIN=$(ls /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1)`
  (o `PLAYWRIGHT_BROWSERS_PATH`). No ejecutar `playwright install` si el navegador ya existe.

## Cómo ejecutar (cuando la dependencia esté disponible)

```bash
cd apps/web
# 1) Instalar el runner (coordinar antes de fijarlo en package.json/CI):
#    npm i -D @playwright/test
# 2) Con la API y la web arriba:
CHROME_BIN=$(ls /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1) \
  npx playwright test -c e2e/playwright.config.ts
```

Proyectos definidos: `escritorio` (1440×900) y `movil` (390×844).

## Archivos

- `playwright.config.ts` — configuración (dos viewports, binario de Chromium del contenedor).
- `helpers/app.ts` — alta de usuario, creación de agente, y rastreo de errores de consola/5xx.
- `agent-chat.spec.ts` — regresión del chat: envío/respuesta, estado del turno, navegación por teclado de las tres
  vistas (Conversación/Actividad/Diagnóstico), «Nueva» conversación y compositor (Enter / Mayús+Enter).
- `accessibility.spec.ts` — chequeos WCAG manuales: etiquetas, patrón tablist, nombres de botones-icono, foco por
  teclado, divisor redimensionable y diálogo modal (foco atrapado + Esc).
