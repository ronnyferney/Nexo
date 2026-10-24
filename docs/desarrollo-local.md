# Desarrollo local: conexión de proveedores IA y vinculación con agentes

Todo el flujo de conexión de un LLM se puede probar en el equipo del desarrollador, sin dominio público, sin cuentas en
los proveedores y sin claves reales.

## Arranque

```bash
npm run local          # Postgres y Redis en Docker, migraciones, API (:3000) y web (:4200)
npm run local:status   # estado
npm run local:stop     # detener
```

`npm run local` activa `LLM_DEV_SIMULATOR=true` en `apps/api/.env`. La variable se ignora con `NODE_ENV=production`.

## Proveedor simulado (`LLM_DEV_SIMULATOR`)

En **Administración → Proveedores IA** aparece «Proveedor simulado (desarrollo)». Lo sirve la propia API en
`/api/dev/llm-sim` y se comporta como un proveedor real con inicio de sesión:

| Qué probar | Cómo |
|---|---|
| Iniciar sesión (OAuth 2.0 + PKCE S256) | Pulse «+» en la fila: se abre la pantalla de consentimiento del simulador → «Autorizar». |
| Consentimiento denegado | En la pantalla de consentimiento pulse «Denegar»: la web muestra el error y no crea conexión. |
| Código de dispositivo (RFC 8628) | «Conectar con un código (simulado)»: abra la página que indica Nexo, pegue el código y autorice. |
| Usar la conexión en un agente | Pestaña «Modelo» del agente → proveedor simulado → `sim-rapido` o `sim-experto`. Responde con eco; `/tool <nombre> <json>` invoca una herramienta del agente. |
| Renovación automática | El access token dura 2 minutos: siga conversando y Nexo lo renueva con el refresh token. |
| Sesión revocada en el proveedor | En la pantalla de consentimiento pulse «Revocar todas las sesiones». En la siguiente renovación la conexión queda como «Sesión cerrada» y el agente usa su modelo de respaldo, si lo tiene. |
| Cerrar sesión / volver a iniciarla | Menú «⋯» de la tarjeta: «Cerrar sesión» conserva conexión, modelos y agentes; «Volver a iniciar sesión» renueva la **misma** conexión. |
| Protección de agentes | «Eliminar conexión» se bloquea mientras un agente la use (principal o respaldo); el diálogo lista los agentes. |

Las pruebas automáticas del flujo están en `apps/api/test/llm-dev-simulator.e2e-spec.ts` y
`apps/api/test/llm-agent-binding.e2e-spec.ts`.

## Vinculación agente ↔ conexión

- Al guardar un agente, la API valida que el proveedor, el modelo y los respaldos existan en los proveedores del
  workspace (nunca una conexión de otro workspace).
- Conexión deshabilitada, sesión cerrada o revocada y modelo deshabilitado son estados operativos: el agente usa su
  cadena de respaldo y avisa. Un proveedor o modelo inexistente es un error de configuración y no activa el respaldo.
- La página del agente avisa cuando su modelo no está disponible; el diálogo del proveedor muestra qué agentes lo usan.

## Proveedores reales en local

- **Clave de API** (Anthropic, OpenAI, Mistral…): funciona en local sin nada más.
- **OpenRouter**: su PKCE no requiere registrar la app y acepta `localhost`.
- **Inicio de sesión con Google, Microsoft o Hugging Face**: registre una app de desarrollo propia con el redirect URI
  `http://localhost:3000/api/llm/oauth/<proveedor>/callback` (si el proveedor admite `localhost` para apps de prueba) y
  defina `OAUTH_LLM_<PROVEEDOR>_CLIENT_ID/SECRET` en `apps/api/.env`. Nunca use el client_id de otro producto ni
  credenciales personales en el repositorio.
- **Federación de identidad (WIF) con Anthropic**: el proveedor debe poder leer el emisor OIDC de Nexo, por lo que
  requiere una URL pública (staging) o un túnel temporal; el resto del flujo se prueba con el simulador.
