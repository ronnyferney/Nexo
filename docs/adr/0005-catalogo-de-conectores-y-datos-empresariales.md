# 0005. Catálogo de conectores nativos, OAuth2 de usuario, conector de base de datos y Nexo Edge

- **Estado:** Aceptado
- **Fecha:** 2026-10-23
- **Responsables:** nexo-architect
- **Supuestos por defecto (ampliables):** CRM HubSpot, Salesforce y Pipedrive; bases SQL Server, PostgreSQL y MySQL
  (Oracle en fase 2); acceso de **solo lectura por defecto**, escrituras habilitadas explícitamente por el cliente.

## Contexto
Cada cliente (p. ej. áreas comerciales, operaciones con el TMS ASTRANS, WatchTower, Seven) debe ser **autónomo** para
conectar sus sistemas y construir flujos sin depender del equipo de Nexo. Los datos operativos suelen vivir en bases
de datos **en redes privadas**, que la nube de Nexo no debe alcanzar directamente (protección SSRF multi-tenant).

## Decisiones

### D1. Orden de preferencia de integración
1. **API del sistema** (REST/SOAP/GraphQL) o **servidor MCP** del proveedor: respeta reglas de negocio y no acopla a Nexo
   al esquema interno.
2. **Base de datos en la nube** del cliente con IP pública controlada: conector `DATABASE` en **modo directo** (TLS,
   lista de IPs permitidas de Nexo).
3. **Base de datos en red privada / on-premise**: conector `DATABASE` en **modo Edge** a través de **Nexo Edge**.

### D2. Catálogo de conectores nativos ("instalar con un clic")
- Definiciones versionadas en código (`apps/api/src/modules/connectors/catalog/`), una por integración: metadatos
  (nombre, categoría, ícono, descripción, documentación), tipo de conector, plantilla de configuración, **campos de
  credenciales** (que se guardan en la bóveda de secretos, nunca en el conector), método de autenticación y
  **operaciones prediseñadas** con descripciones optimizadas para agentes.
- Primera tanda (comercial y productividad): **Lusha** (MCP y REST), **HubSpot** (token de app privada u OAuth2),
  **Salesforce** (OAuth2), **Pipedrive** (token), **Google Sheets** y **Gmail** (OAuth2), **Microsoft 365 Outlook**
  (OAuth2), **WhatsApp Business Cloud API** (token), **Slack** (token de bot).
- Segunda tanda: **LinkedIn** (OAuth2 de usuario sin PKCE, que LinkedIn no admite en el flujo web): perfil del
  miembro y publicaciones como miembro (verificadas); publicaciones como página de empresa (requieren el producto
  Community Management API aprobado por LinkedIn).
- Tercera tanda (productividad): **Microsoft 365** (Calendario corporativo, To Do, Planner, Teams), **Google Calendar**
  (con enlace de Meet), **Google Meet** (salas, asistentes, transcripciones), **Gmail (bandeja y respuestas)** separado de
  **Gmail (envío)** para no exigir scopes restringidos a quien solo envía, y **Slack** completo con "Agregar a Slack"
  (OAuth v2, scopes separados por coma) además del token de bot.
- Instalar crea: secretos (`<SLUG>_<CAMPO>`), el conector (`catalogId`), sus operaciones y queda listo para agentes y flujos.
- Se acompaña de **skills comerciales** (prospección, calificación BANT, seguimiento de oportunidades, preparación de
  reunión) y una **plantilla de flujo** "Lead entrante → enriquecer → calificar con IA → crear en CRM → notificar".

### D3. OAuth2 de usuario (authorization code + PKCE + refresh)
- Nuevo tipo de autenticación `oauth2_code`: `authorizeUrl`, `tokenUrl`, `scopes`, credenciales de la app OAuth.
- La app OAuth puede ser **de la plataforma** (variables de entorno `OAUTH_<PROVEEDOR>_CLIENT_ID/SECRET`) o **propia del
  cliente** (secretos del workspace) para clientes que exigen su propia app.
- `state` firmado (JWT de 10 min con workspace, conector, usuario y `code_verifier`), PKCE S256, callback público
  `GET /api/oauth/callback` que redirige a la web. Tokens cifrados (AES-256-GCM) en `OAuthCredential`; renovación
  automática con `refresh_token` antes de expirar; revocación al desconectar.
- Ligadura al navegador (auditoría M1b): `oauth/start` (y la instalación OAuth del catálogo) entregan la cookie
  `nexo_connector_oauth` (HttpOnly, SameSite=Lax, `Path=/api/oauth`, 10 min) con un nonce aleatorio; el `state` lleva
  solo su huella (`bt`). El callback exige la cookie correspondiente o redirige con `reason=browser_mismatch` sin canjear
  el código. Helper compartido con el OAuth de proveedores LLM: `apps/api/src/common/oauth/browser-binding.ts`.
- `PUBLIC_URL` (URL pública de la API) y `WEB_URL` (para la redirección final) en configuración.

### D4. Conector de base de datos (`ConnectorType.DATABASE`)
- Motores: `postgres` (`pg`), `mysql` (`mysql2`), `mssql` (`mssql`).
- **Operaciones = consultas declaradas** con parámetros nombrados (`:placa`), nunca SQL libre desde agentes o flujos:
  `definition = { sql, mode: 'read'|'write', maxRows (≤ 5000, def. 500), timeoutMs (≤ 60000, def. 15000) }`.
  Parámetros siempre **enlazados** por el driver (sin concatenación). Modo `read` se ejecuta en transacción de solo
  lectura donde el motor lo soporta y valida que la sentencia sea `SELECT`/`WITH`.
- Escrituras: solo si el conector tiene `allowWrites: true`; se recomienda usarlas vía procedimientos almacenados y con
  aprobación humana en los agentes.
- **Descubrimiento de esquema**: lista tablas/vistas y columnas (filtrables) y genera operaciones `SELECT` sugeridas.
- **Modo directo**: credenciales en la bóveda, host validado contra SSRF, TLS configurable, pool por conector con cierre
  por inactividad.

### D5. Nexo Edge (agente on-premise)
- Aplicación Node independiente (`apps/edge`, imagen Docker `nexo/edge`) que el cliente ejecuta en su red:
  `docker run -e NEXO_URL=... -e NEXO_EDGE_TOKEN=... -v ./edge.yaml:/app/edge.yaml nexo/edge`.
- **Conexión saliente** WSS hacia `GET /api/edge/ws` (sin puertos entrantes en el cliente). Autenticación con token
  `nexoedge_...` (hash SHA-256 en BD, se muestra una sola vez), heartbeat y reconexión con backoff.
- **Credenciales locales**: el archivo `edge.yaml` del cliente define conexiones nombradas
  (`connections.astrans: { engine, host, port, database, user, password: ${ENV} }`) y políticas locales
  (`allowWrites`, `maxRows`, tablas permitidas opcionales). Nexo solo referencia `connectionKey`.
- El Edge **re-valida** todo localmente (modo lectura, límites, `allowWrites`) aunque Nexo ya lo haya hecho: defensa en profundidad.
- Escalabilidad: la conexión WS vive en una instancia de la API; las solicitudes desde workers u otras instancias se
  enrutan por **Redis pub/sub** (`edge:req:<edgeId>` → respuesta en `edge:res:<requestId>`) con timeout.
- Auditoría: cada consulta registra edge, operación, filas, duración y estado (sin datos).

## Contrato de API (rutas bajo `/api`)
### Catálogo
- `GET /connector-catalog` → `{ id; name; category: 'CRM'|'PROSPECCION'|'PRODUCTIVIDAD'|'MENSAJERIA'|'DATOS'; description; icon; docsUrl; connectorType; authMethods: ('apiKey'|'bearer'|'oauth2_code'|'mcp')[]; credentialFields: { key; label; secret: boolean; required: boolean; help?: string }[]; operations: { key; name; description }[]; installed: number }[]`
- `POST /connector-catalog/:id/install` `{ name?, authMethod, credentials: Record<string,string> }` → conector creado
  (para `oauth2_code` devuelve además `{ authorizeUrl }` para iniciar el consentimiento). EDITOR+.
### OAuth2
- `POST /connectors/:id/oauth/start` → `{ authorizeUrl }` (EDITOR+) · `GET /oauth/callback?code&state` (público, redirige a
  `WEB_URL/connectors/:id?oauth=ok|error`) · `GET /connectors/:id/oauth` → `{ connected; accountLabel; scope; expiresAt }`
  · `DELETE /connectors/:id/oauth` (desconectar).
### Secretos permitidos por conector (auditoría A4)
- `Connector.allowedSecrets`: secretos de la bóveda que el conector puede resolver. Al ejecutar (invocar, probar,
  descubrir, esquema, OAuth) solo se descifran los secretos referenciados **y** permitidos; cualquier otra referencia en
  `config`, `auth` o la definición de la operación responde 403 («El conector referencia secretos no permitidos: X…»)
  antes de leer la bóveda, por lo que el error no revela si el secreto existe. `{{ secrets }}` (la bóveda completa)
  nunca se permite.
- `PUT /connectors/:id/allowed-secrets` `{ names: string[] }` (ADMIN+). `GET /connectors/:id` (y las respuestas de
  crear/editar) incluyen `allowedSecrets`, `secretReferences` y `blockedSecrets`.
- Un EDITOR o una API key nunca amplían la lista: crean conectores con la lista vacía y sus referencias nuevas quedan
  bloqueadas. Un ADMIN que crea o edita un conector (o una operación) permite solo las referencias que **su** cambio
  introduce; guardar una referencia que dejó un EDITOR no la aprueba. La instalación del catálogo permite los secretos
  que el instalador ingresó (un ADMIN: todos los de la plantilla).
- Un EDITOR no puede cambiar el destino (`baseUrl`, `endpoint`, `url`, `openApiUrl`, `wsdlUrl`, host/puerto/Edge de
  BD, URLs OAuth) de un conector con secretos permitidos (403): equivaldría a reenviar esos secretos a otro servidor.
- Migración `20261024040030_secretos_permitidos_por_conector`: cada conector existente queda autorizado para los
  secretos que ya referenciaba (configuración, autenticación u operaciones) y que existían en la bóveda de su workspace
  al migrar; los demás quedan bloqueados hasta que un ADMIN los permita.
### Base de datos
- Conector `type: 'DATABASE'`, `config = { engine, mode: 'direct'|'edge', edgeId?, connectionKey?, host?, port?, database?,
  user?, password?: '{{ secrets.X }}', ssl?: boolean, allowWrites?: boolean }`.
- `POST /connectors/:id/discover` (reutilizado) → crea operaciones `SELECT` sugeridas por tabla/vista elegida:
  body opcional `{ tables?: string[] }`; `GET /connectors/:id/schema` → `{ tables: { schema; name; type: 'TABLE'|'VIEW'; columns: { name; type; nullable }[] }[] }`.
### Edge
- `GET /admin/edges` → `{ id; name; status: 'ONLINE'|'OFFLINE'; lastSeenAt; version; hostname; connections: string[] }[]`
- `POST /admin/edges` `{ name }` → `{ id; name; token }` (token visible una sola vez) · `DELETE /admin/edges/:id` ·
  `POST /admin/edges/:id/rotate-token` → `{ token }`. ADMIN+.
- `GET /edges` (cualquier rol, para selectores) → `{ id; name; status; connections: string[] }[]`.

## Consecuencias
- Migración: `ConnectorType.DATABASE`, `Connector.catalogId`, `OAuthCredential`, `EdgeAgent`.
- Nuevas dependencias: `pg`, `mysql2`, `mssql`, `@nestjs/websockets`, `@nestjs/platform-ws`, `ws`.
- Los conectores del catálogo se verifican contra la documentación oficial de cada proveedor; los endpoints pueden
  cambiar y se versionan junto con el catálogo.
- Fase 2: Oracle, texto-a-SQL restringido sobre vistas de reporte, más conectores del catálogo, Edge con actualizaciones automáticas.

## Plan
| Tarea | Dueño |
|---|---|
| ADR, esquema, dependencias, esqueletos | orquestador |
| Catálogo, OAuth2 de usuario, skills y plantilla comercial (backend) | nexo-backend-integrations |
| Conector DATABASE (directo), gateway Edge (WS + Redis), `apps/edge` y su imagen | nexo-backend-platform |
| Galería de integraciones, asistente de instalación, OAuth, UI de base de datos y de Edge | nexo-frontend-ui |
| E2E: instalación, OAuth con proveedor simulado, DB directa y vía Edge, seguridad | nexo-qa-api |
