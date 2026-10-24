# Apps OAuth de la plataforma («Iniciar sesión con…»)

Para que un cliente conecte Microsoft 365, Google o Slack con un clic, Nexo usa **una app OAuth propia de la
plataforma por proveedor** (variables `OAUTH_<PROVEEDOR>_CLIENT_ID` y `OAUTH_<PROVEEDOR>_CLIENT_SECRET`). Es el mismo
modelo de los servicios de integraciones administradas (p. ej. Composio), con una diferencia: **los tokens de los
clientes quedan en la bóveda de Nexo** (AES-256-GCM, ver `docs/rotacion-de-claves.md`), no en un tercero.

El cliente nunca ve un client ID ni un secreto: la opción «Usar una app propia» queda escondida en el asistente para
quien necesite su propia marca o cuota.

## Qué falta para que funcione «en un clic» en producción

| Proveedor | Trámite | Sin él |
|---|---|---|
| Microsoft (Entra ID) | **Verificación del editor**: ID del Microsoft AI Cloud Partner Program (antes MPN) asociado a la app, con un dominio verificado | Microsoft bloquea que los usuarios aprueben apps multiinquilino nuevas sin editor verificado: siempre hará falta la aprobación de un administrador |
| Google | **Verificación de la app** en la pantalla de consentimiento; Gmail usa alcances restringidos y exige además la evaluación de seguridad (CASA) | Pantalla «Google no verificó esta app», límite de 100 usuarios y refresh token que vence a los 7 días (L8) |
| Slack | Publicación en el Slack Marketplace (opcional) | Funciona, pero cada workspace ve la app como «no publicada» |

## Dónde se configura (consola de plataforma)

Un administrador de Nexo (`PLATFORM_ADMIN_EMAILS`) abre **Consola de plataforma → Apps de inicio de sesión** y, por cada
proveedor, pega el client ID y el secreto una sola vez. La consola muestra la URL de redirección a registrar y los
permisos que piden las integraciones. El secreto se guarda cifrado (contexto `platform-oauth-app.client-secret`) y nunca
se devuelve. Desde ese momento, cualquier cliente conecta sus cuentas con un clic, sin ver nada técnico. Las variables
`OAUTH_<PROVEEDOR>_CLIENT_ID/SECRET` siguen funcionando como respaldo si no hay fila en la consola.

## Registro de cada app

- **Redirect URI**: `${PUBLIC_URL}/api/oauth/callback` (en local, `http://localhost:3000/api/oauth/callback`). Use una app
  distinta para producción y para desarrollo.
- **Microsoft**: tipo de cuenta «Varios inquilinos de Entra ID»; permisos **delegados** mínimos por integración (correo:
  `offline_access`, `User.Read`, `Mail.ReadWrite`). Nunca permisos de aplicación (darían acceso a todos los buzones).
- **Secretos**: el «Valor» del secreto, no su «Id. de secreto». La API valida el formato al arrancar y no inicia si
  está mal (`env.validation.ts`).

## Empresas que exigen aprobación de TI

Muchas organizaciones no dejan que sus usuarios aprueben apps por su cuenta. En **Apps conectadas → la app → Cuentas**,
el botón **«Enlace para TI»** copia el enlace oficial de consentimiento de administrador de Microsoft
(`/organizations/v2.0/adminconsent` con la app de la cuenta). Quien administra Microsoft 365 lo abre una vez, aprueba, y
vuelve a Nexo con «El administrador aprobó la app». Después cada persona conecta su cuenta normalmente.

## Diagnóstico

- Cada cuenta pendiente indica qué app usará al conectar (de Nexo o propia) y su client ID abreviado.
- Los errores que el proveedor devuelve a Nexo se explican en español (`admin_consent_required`, `invalid_client`,
  `invalid_scope`…). Los que Microsoft muestra en su propia pantalla sin volver a Nexo (p. ej. AADSTS700016, «la app no
  existe en el directorio») indican un client ID equivocado: compárelo con el que muestra la cuenta.
- Al eliminar una cuenta, un ADMIN puede borrar también las credenciales que solo usaba ella, para que una
  reinstalación no reutilice valores viejos.

## Apps menos usadas

Las integraciones nativas cubren los sistemas críticos. Para el resto, Nexo admite conectores MCP: un ADMIN puede agregar
un servidor MCP externo (por ejemplo, de un proveedor de integraciones administradas), sabiendo que en ese caso los
tokens los guarda el tercero.
