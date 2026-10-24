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

## Correo local y recuperación de contraseña

Con Docker, `npm run local` arranca también **Mailpit** (perfil `dev` de `docker-compose.yml`) y, si `SMTP_URL` está
vacío en `apps/api/.env`, lo apunta a `smtp://localhost:1025`. Los correos de Nexo (invitaciones, verificación de
correo y recuperación de contraseña) llegan a la bandeja local **http://localhost:8025** y no salen a internet. Si usted
configuró su propio SMTP, el script lo respeta.

¿Olvidó su contraseña en local?

1. **Contraseña inicial del usuario maestro:** está en `.dev/credenciales.txt` (si nunca la cambió).
2. **Con Mailpit:** en el login aparece «¿Olvidó su contraseña?»; el enlace llega a http://localhost:8025. Tras
   actualizar, reinicie con `npm run local:stop && npm run local` para que la API tome el `SMTP_URL`.
3. **Sin correo (o en un servidor sin SMTP):** quien administra el servidor genera el enlace desde la terminal:
   ```bash
   cd apps/api && npm run auth:reset-link -- --email=persona@empresa.com
   # imagen de producción: node dist/modules/auth/auth-reset-link.cli.js --email=persona@empresa.com
   ```
   Imprime un enlace de un solo uso que vence en 30 minutos; al usarlo se cierran todas las sesiones de la cuenta.
   Entréguelo solo a la persona dueña de la cuenta.

## Proveedor simulado (`LLM_DEV_SIMULATOR`)

En **Administración → IA conectada** aparece «Proveedor simulado (desarrollo)». Lo sirve la propia API en
`/api/dev/llm-sim` y se comporta como un proveedor real con inicio de sesión:

| Qué probar | Cómo |
|---|---|
| Iniciar sesión (OAuth 2.0 + PKCE S256) | Pulse «+» en la fila: se abre la pantalla de consentimiento del simulador → «Autorizar». |
| Consentimiento denegado | En la pantalla de consentimiento pulse «Denegar»: la web muestra el error y no crea conexión. |
| Código de dispositivo (RFC 8628) | «Conectar con un código (simulado)»: abra la página que indica Nexo, pegue el código y autorice; vuelva a Nexo y confirme la cuenta autorizada (M1b). Escriba otra cuenta en la página del simulador para probar «No es mi cuenta». |
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
- **Federación de identidad (WIF) con Anthropic**: ver la sección siguiente.
- **Claude en Amazon Bedrock / Claude Platform on AWS con rol de IAM**: ver la sección siguiente.

## Conexiones sin claves (ADR 0002 D9, addendum L2/L3)

### Workload Identity Federation con la API de Anthropic

Nexo actúa como emisor OIDC en `${PUBLIC_URL}/api/oidc` (o `LLM_WIF_ISSUER`): publica
`/api/oidc/.well-known/openid-configuration` y `/api/oidc/jwks`, firma una aserción corta por canje (`sub =
nexo:workspace:<id>`, `aud = https://api.anthropic.com`) y la canjea en `POST https://api.anthropic.com/v1/oauth/token`.

- **Requiere un dominio público:** Anthropic descarga el JWKS del emisor y solo acepta https en el puerto 443 con un
  nombre DNS público (nada de `localhost`, IP ni otros puertos). Con `PUBLIC_URL=http://localhost:3000` el mecanismo
  aparece como «no disponible» con ese motivo.
- **Clave de firma:** en local, sin `LLM_WIF_SIGNING_KEYS`, la API genera una clave efímera y lo avisa en el registro
  (cambia en cada arranque: vuelva a «Verify issuer» en la Consola tras reiniciar). Para staging o producción:
  `openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out nexo-oidc.pem` y
  `LLM_WIF_SIGNING_KEYS=[{"kid":"nexo-2026-10","pem":"<PEM con \n>","active":true}]` (ver `apps/api/.env.example`).
- **Probar de punta a punta contra Anthropic:** publique la API con un dominio (staging) o un túnel https temporal en el
  puerto 443 con nombre público, y defina `PUBLIC_URL` (o `LLM_WIF_ISSUER`) con esa URL. En la Consola de Claude:
  Settings → Workload identity → «Connect workload» → «Custom OIDC», emisor = URL que muestra Nexo, «Verify issuer»,
  regla con el sujeto exacto del workspace y la audiencia `https://api.anthropic.com`. Luego, en Nexo, «Federación de
  identidad (sin claves)» con los ids `fdrl_…`, `svac_…`, la organización y el workspace.
- **Sin dominio (local y CI):** la suite `apps/api/test/llm-keyless.e2e-spec.ts` simula el lado de Anthropic: verifica la
  aserción con el JWKS que publica Nexo (`kid`, `iss`, `aud`, `sub`, vida y `jti` de un solo uso) y sirve la Messages
  API. El simulador de desarrollo (`LLM_DEV_SIMULATOR`) no imita el canje WIF.

### Claude en Amazon Bedrock y Claude Platform on AWS con rol de IAM + ExternalId

- El operador define `LLM_AWS_PRINCIPAL_ARN` (rol de IAM de la plataforma Nexo) y da a la API credenciales de AWS de la
  plataforma por la cadena estándar del SDK (en local, `AWS_PROFILE` o `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` de una
  cuenta de pruebas; en AWS, el rol de tarea de ECS). Nunca use claves de un cliente.
- En la consola: «Claude en Amazon Bedrock» o «Claude Platform on AWS» → «Generar ExternalId» → cree el rol en la cuenta
  de pruebas con la política de confianza y de permisos que muestra Nexo → pegue el ARN del rol y conecte. Nexo asume el
  rol con STS (credenciales de 1 hora en caché) y firma con SigV4.
- Sin cuenta de AWS: `apps/api/test/llm-keyless.e2e-spec.ts` usa un STS simulado (`LLM_AWS_STS_ENDPOINT`) que exige el
  `ExternalId` de la política de confianza y comprueba la firma SigV4 en Bedrock y en Claude Platform on AWS.

### Uso único del `state` OAuth (B2)

El `state` de los inicios de sesión de proveedores IA y de OpenRouter se reclama en Redis (`SET NX PX`): con Redis
detenido, el callback responde `invalid_state` (falla cerrado). La misma suite prueba el replay entre dos instancias.
