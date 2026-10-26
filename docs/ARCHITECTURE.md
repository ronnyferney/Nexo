# Arquitectura de Nexo

Decisiones registradas en [`docs/adr/`](adr/) (0001–0014; 0011–0014 están Propuestos y guían el programa de
organización de empleados digitales ya construido). Este documento describe la plataforma tal como está hoy.

## Vista general

```
             ┌──────────────┐         ┌────────────────────────────────────────────────┐
 Usuarios ──▶│  Angular SPA │──/api──▶│ API NestJS (stateless, N réplicas)             │
             └──────────────┘         │  auth · connectors · agents · workflows · ...  │
 Clientes MCP ───────── /api/mcp ────▶│  mcp-server · webhooks (/api/hooks/:token)     │
 Sistemas externos ─── webhooks ─────▶│  oauth (/api/oauth/callback) · edge (WS)       │
 Nexo Edge (red del cliente) ─ WSS ──▶└──────────┬───────────────┬─────────────────────┘
                                                 │ Prisma        │ BullMQ + pub/sub (Redis)
                                            ┌────▼────┐     ┌────▼──────────────────────┐
                                            │Postgres │◀────│ Workers (N)               │
                                            └─────────┘     │ flujos · rutinas · evals  │
                                                            └────┬──────────────────────┘
                     REST · SOAP · GraphQL · MCP · bases de datos · LLM (Anthropic, OpenAI-compatibles)
```

## Despliegue

```
                         ┌──────────────── nube de Nexo ─────────────────────────────────┐
 Navegador / MCP ──443──▶│ web (nginx: SPA + /version.json, proxy /api → api, WS Upgrade)│
                         │   │                                                           │
                         │   ▼                                                           │
                         │ api  (WORKER_ENABLED=false, N réplicas)  ◀──┐                 │
                         │ worker (WORKER_ENABLED=true, N réplicas)    │ misma imagen    │
                         │   │            │                                              │
                         │   ▼            ▼                                              │
                         │ PostgreSQL 16  Redis 7 (colas BullMQ, pub/sub de Edge)        │
                         └───────────────────────────────────────────────────────────────┘
                                   ▲ WSS saliente (/api/edge/ws, token nexoedge_...)
 ┌──────── red del cliente ────────┴──┐
 │ edge (apps/edge) ──▶ BD privadas   │  credenciales locales en edge.yaml
 └────────────────────────────────────┘
```

- Local: `docker-compose.yml` levanta `postgres`, `redis`, `api`, `worker` y `web` (puerto 8080).
- AWS (`infra/`, CDK): stacks `NexoRegistry` (ECR), `NexoPilot` (ALB → servicio `web`; servicios Fargate `api` y
  `worker`; RDS PostgreSQL 16; ElastiCache Redis) y el rol OIDC de GitHub. Guía: [deploy-aws.md](deploy-aws.md).
- Imágenes publicadas por versión: `nexo-api` (API y worker), `nexo-web`, `nexo-edge`.

## Principios

1. **Módulos por dominio** (`connectors`, `agents`, `workflows`…). Cada módulo expone servicios; los controladores solo traducen HTTP.
2. **Puertos y adaptadores** donde el sistema toca el exterior:
   - `ConnectorAdapter` → `RestAdapter`, `SoapAdapter`, `GraphqlAdapter`, `McpAdapter`, `DatabaseAdapter`. Un protocolo
     nuevo es una clase nueva registrada en `ConnectorsModule`.
   - `LlmDriver` (por `LlmKind`) → `AnthropicDriver`, `OpenAiCompatibleDriver`, `MockDriver`, registrados en `LlmModule`.
     Cada driver crea un `LlmClient` que es dueño de su bucle de tool use y de su historial nativo. `LlmGatewayService`
     resuelve proveedor y modelo de un agente al cliente y su tarifa. Un proveedor nuevo (p. ej. Bedrock) es un driver nuevo.
   - `NodeExecutor` → un ejecutor por tipo de nodo. El `WorkflowEngine` es TypeScript puro, sin Nest ni base de datos, y se prueba de forma aislada.
   - Catálogo de integraciones y resolutores de destinatarios de shares como tablas declarativas (sin `if (type === ...)`).
3. **API sin estado + workers**: la API encola trabajo; los workers (BullMQ) procesan las colas `workflows`, `routines`
   y `evals`. Ambos escalan horizontalmente. `WORKER_ENABLED=false` separa los roles.
4. **Seguridad por defecto**: secretos y tokens OAuth cifrados (AES-256-GCM), API keys y tokens de Edge guardados como
   hash SHA-256, protección SSRF en todas las llamadas salientes (`HttpClientService`), plantillas sin `eval` y con
   bloqueo de `__proto__`, validación estricta de DTO, rate limiting, helmet, logs con datos sensibles redactados.
5. **Multi-tenant**: toda consulta filtra por `workspaceId`, tomado del token y nunca del cliente.

## Mapa de módulos (`apps/api/src/modules`)

| Módulo | Responsabilidad |
|---|---|
| `auth` | Registro, login, JWT, cambio de workspace y usuario maestro de primer arranque (`BootstrapAdminService`). |
| `workspaces` | Secretos de la bóveda, API keys, métricas y ajustes del workspace (`allowPersonalAgents`). |
| `connectors` | Dominio de conectores, adaptadores REST/SOAP/GraphQL/MCP/DATABASE y catálogo de integraciones (`catalog/`). |
| `oauth` | OAuth2 de usuario para conectores: authorization code + PKCE, callback público, tokens cifrados y renovación. |
| `edge` | Nexo Edge: administración de agentes on-premise, gateway WebSocket y enrutamiento por Redis pub/sub. |
| `llm` | Puerto `LlmDriver`, `LlmGatewayService`, catálogo de modelos/tarifas y administración de conexiones LLM. |
| `governance` | Unidades corporativas, centros de costo, bolsas de presupuesto, alertas y reportes de consumo; además `estructura/` (grupo, empresas, líneas de negocio, sedes), `dimensiones/` (dimensiones organizativas configurables D8), `imputacion/` (servicios internos y reparto de costos compartidos) y el gobierno de acciones (`policy/`, `actions/`: políticas versionadas, bandeja de aprobaciones y suspensión). |
| `cargos` | Catálogo de `Cargo` (perfil reutilizable con propósito, funciones, entregables, indicadores, límites y nivel jerárquico) para el empleado digital. |
| `hierarchy` | Jerarquía de dirección digital: niveles, autoridad, delegación, supervisión, reemplazo y organigrama (reglas puras en `hierarchy.rules.ts`). |
| `results` | Trabajo por resultados: objetivos, tareas, `ContratoResultado`, validación/aceptación por un tercero, incumplimientos, `indicadores/` (KPIs de resultado) y `pasaporte.*` (Pasaporte de resultado verificable). |
| `messaging` | Protocolo de mensajes entre agentes, handoff (contrato de transferencia) y reglas de delegación (`delegacion.rules.ts`). |
| `collaboration` | Canales de coordinación transversal por misión/proceso/área. |
| `durability` | Durabilidad avanzada: idempotencia, clasificación temporal/permanente/incierto, conciliación y bandeja de excepciones. |
| `execution-params` | Parámetros de ejecución del agente: estación virtual y política de salida a internet (`egress-policy.rules.ts`). |
| `crews` | Cuadrillas: equipos de empleados digitales gobernados (validación de composición en `crews.validator.ts`). |
| `consolas` | Consolas gerenciales por negocio/área/sede (inicio gerencial de resultados, riesgos y decisiones). |
| `audit` | Auditoría inmutable encadenada por hash (`audit.hashing.ts`): decisiones, aprobaciones, políticas y accesos. |
| `data-protection` | Ajustes de privacidad y retención de conversaciones (primer incremento del ADR 0008). |
| `agents` | CRUD de agentes, composición del prompt, runtime (tools, respaldo de modelos), chat SSE y conversaciones. |
| `agent-access` | Permisos por agente (`AgentAccessService`), destinatarios de shares (`SharePrincipalsService`) y salud del agente. |
| `groups` | Grupos de usuarios transversales a las unidades, destino de shares `GROUP`. |
| `skills` | Skills reutilizables con divulgación progresiva (`load_skill`). |
| `knowledge` | Bases de conocimiento: ingesta (texto, URL, archivo), fragmentación y búsqueda full-text. |
| `routines` | Rutinas programadas por agente (cron con zona horaria en BullMQ) e historial de corridas. |
| `training` | Feedback, bandeja de supervisión, casos y corridas de evaluación (juez IA), versiones y sugerencias. |
| `copilot` | Nexo Copilot (sesiones, herramientas internas, propuestas, cupo) y consola de plataforma (`platform/`). |
| `workflows` | Motor DAG, ejecutores de nodos, cola BullMQ, webhooks, cron, versiones y retención de ejecuciones. |
| `mcp-server` | Nexo como servidor MCP en `/api/mcp`. |
| `health` | `GET /api/health` (base de datos) y `GET /api/health/version` (versión desplegada). |

Fuera de `modules/`: `common/` (crypto, guards, decoradores, plantillas, `HttpClientService`, filtros, `build-info`),
`config/` (configuración y validación de entorno) e `infrastructure/` (Prisma). `apps/edge` es una aplicación Node
independiente.

## Motor de flujos

- El grafo debe ser un DAG con un único disparador (`workflow.validator.ts`).
- Nodos: `trigger`, `connector`, `agent`, `condition`, `transform`, `delay`, `output`, `subworkflow` (profundidad
  máx. 5) y `loop` (sub-flujo por elemento con concurrencia 1–10).
- La ejecución avanza por oleadas: un nodo está listo cuando todos sus predecesores se resolvieron. Los nodos listos se ejecutan en paralelo.
- Una arista está activa si su origen terminó y, en nodos condición, si la rama (`sourceHandle`) coincide. Un nodo sin aristas entrantes activas se **omite** y la omisión se propaga, de modo que las ramas se unen sin lógica especial.
- Reintentos con backoff exponencial (máx. 5), `onError: continue` y cancelación cooperativa.
- La bitácora (`steps`) se persiste en cada transición, así la UI muestra el progreso en vivo.
- Prácticas de n8n (ADR 0003 D6): flujo de error (`errorWorkflowId`), historial de versiones (`WorkflowVersion`;
  restaurar crea una versión nueva), probar un nodo con datos fijados y retención (`EXECUTIONS_RETENTION_DAYS`, por
  defecto 30, limpieza diaria).
- Un nodo `agent` solo puede referenciar agentes que quien guarda el flujo puede USAR (ADR 0007 D5).

## Agentes

- `AgentRuntimeService` arma las tools desde las operaciones asignadas (`<conector>__<operación>`), las de sus skills y
  las internas (`load_skill`, `search_knowledge`), compone el prompt desde el perfil (`composeSystemPrompt`, vista
  previa en `GET /agents/:id/prompt-preview`) y delega el bucle al `LlmClient` resuelto por `LlmGatewayService`.
- Si el proveedor falla, recorre la cadena `fallbackModels`; cada intento pasa por el gobierno de costos.
- El cliente Anthropic ejecuta el bucle de tool use con streaming, thinking adaptativo, `effort` configurable, ejecución
  paralela de tools y fallback del lado del servidor ante rechazos por política.
- El historial se guarda **en formato nativo del proveedor y solo se agrega al final** (los bloques de razonamiento se devuelven sin modificar).
- La aprobación humana se resuelve en el runtime: si la tool la requiere y el usuario no la aprobó, el modelo recibe un resultado que le pide solicitar autorización.
- **Bucle de mejora supervisada** (ADR 0004, módulo `training`): 👍/👎 y correcciones → bandeja de supervisión →
  ejemplos y casos de evaluación → corridas en la cola `evals` con juez IA y revisión humana de la zona dudosa →
  sugerencias aprobadas por humanos → `AgentVersion` y publicación de la mejor.

## Visibilidad, permisos, grupos y lanzamiento (ADR 0006 D3/D4, ADR 0007)

- `Agent.visibility`: `PRIVATE` (por defecto, solo el dueño), `TEAM` (shares) o `WORKSPACE` (todos los miembros).
  `Agent.ownerId` + `AgentShare { principalType: USER|UNIT|GROUP, permission: USE|EDIT }`.
- Todo acceso a agentes, entrenamiento, rutinas y conversaciones pasa por `AgentAccessService` (permiso efectivo
  `OWNER`/`EDIT`/`USE`/`ADMIN_VIEW`). ADMIN/OWNER ven configuración, costo y salud de todos los agentes, pero no
  conversaciones ajenas; cada usuario solo lee sus conversaciones. Un agente no visible responde 404.
- `SharePrincipalsService` valida y nombra los destinatarios de un share con un resolutor por tipo (usuario del
  workspace, unidad corporativa con sus subunidades, grupo). Los **grupos de usuarios** (`UserGroup`, módulo `groups`)
  los administra ADMIN+ (`/admin/groups`); `GET /groups` (EDITOR+) alimenta el diálogo de compartir. La membresía
  aplica de inmediato; un share a un grupo permite USE incluso a miembros VIEWER.
- **Salud** (`GET /agents/:id/health`, `GET /agents/health`): puntaje determinista 0–100 sin costo de IA
  (`agent-health.rules.ts`).
- **Lanzamiento**: `POST /agents/:id/launch` exige salud ≥ 70 y última evaluación ≥ `targetScore` (o override de ADMIN
  con motivo). Pasar a `WORKSPACE` exige `LAUNCHED`. Las rutinas solo se ejecutan si el agente está `LAUNCHED` o es
  `PRIVATE` con dueño.

## Integraciones (ADR 0005)

- **Catálogo** versionado en código (`connectors/catalog/catalog.index.ts`, un archivo por integración en
  `integrations/`): `GET /connector-catalog` y `POST /connector-catalog/:id/install` crean secretos `<SLUG>_<CAMPO>`,
  el conector (`catalogId`) y sus operaciones prediseñadas; incluye skills comerciales.
- **OAuth2 de usuario** (`oauth`): `state` JWT firmado de 10 min con el `code_verifier` cifrado, PKCE S256 (desactivable
  por proveedor, p. ej. LinkedIn), callback público `GET /api/oauth/callback` que redirige a `WEB_URL`, tokens en
  `OAuthCredential` cifrados y renovación serializada por conector. App OAuth de la plataforma
  (`OAUTH_<PROVEEDOR>_CLIENT_ID/SECRET`) o propia del cliente (secretos del workspace).
- **Base de datos** (`DatabaseAdapter`, `ConnectorType.DATABASE`): PostgreSQL, MySQL y SQL Server; operaciones =
  consultas declaradas con parámetros enlazados (nunca SQL libre), modo `read` restringido a `SELECT`/`WITH`,
  escrituras solo con `allowWrites`, descubrimiento de esquema y pool por conector con cierre por inactividad.
  Modo `direct` (host validado contra SSRF) o modo `edge`.
- **Nexo Edge** (`apps/edge` + módulo `edge`): conexión saliente WSS a `/api/edge/ws` con token `nexoedge_...`;
  credenciales y políticas locales en `edge.yaml`, que el Edge re-valida. La instancia que tiene el socket escucha
  `edge:req:<edgeId>` en Redis y responde por `edge:res:<requestId>`, así workers y otras réplicas lo alcanzan.
  Protocolo en [edge-protocol.md](edge-protocol.md).

## MCP

- **Cliente**: `McpAdapter` mantiene un pool de sesiones por conector (cierre por inactividad, reconexión automática) y convierte las tools remotas en operaciones.
- **Servidor**: `/api/mcp` (Streamable HTTP sin estado, solo `POST`), autenticado con API key del workspace. Por cada
  solicitud se construye un `McpServer` con los agentes `WORKSPACE` + `LAUNCHED` (tools `agent_*`) y los flujos con
  `active = true` (tools `workflow_*`, esperan hasta 60 s el resultado).

## Gobierno de IA (ADR 0002)

- `LlmGatewayService` resuelve `Agent.provider` (conexión de sistema `anthropic`/`mock` o `LlmConnection`) y `Agent.model`
  a un cliente (`LlmDriver` por tipo: Anthropic, OpenAI-compatible, Mock) con su tarifa.
- `AgentRuntimeService` aplica, en orden: centro de costo (`OrgService.resolveCostCenter`), decisión previa
  (`BudgetsService.plan`: modelos permitidos, bloqueo o degradación), control antes de cada turno (`assertCanSpend`)
  y registro por turno (`record`: `UsageRecord` + incremento atómico del libro mayor en toda la cadena + alertas).
- La lógica de decisión vive en funciones puras (`governance/budget-policy.ts`) con pruebas unitarias.
- Las alertas por umbral se registran en `BudgetAlert` y se ven en la consola; no se notifican por correo ni Slack.

## Organización de empleados digitales (ADR 0011–0014)

Programa que convierte a Nexo en una organización de empleados digitales. Migraciones aditivas; el runtime, los flujos y
el gobierno de costos existentes siguen igual.

- **Modelo organizacional (ADR 0011, `governance/estructura`):** grupo, empresas, líneas de negocio, sedes y centros de
  costo sobre `OrgUnit` tipado; asignaciones matriciales (empleado↔área/línea/sede) con alcance y vigencia.
- **Dimensiones configurables D8 (ADR 0011, `governance/dimensiones`):** ejes organizativos definibles por workspace para
  clasificar e imputar sin cambiar el esquema.
- **Empleado digital (`cargos` + campos de `Agent`):** catálogo de `Cargo`, expediente con responsable titular/suplente
  y nivel jerárquico; no se publica un agente sin responsable; estados de ciclo de vida completos.
- **Jerarquía de dirección digital (`hierarchy`):** niveles, autoridad, delegación, supervisión, reemplazo y organigrama,
  sin ciclos ni autoaprobación.
- **Trabajo por resultados (ADR 0012, `results`):** objetivos, tareas, `ContratoResultado`, validación por un tercero
  (el ejecutor no valida su propio resultado), incumplimientos con escalamiento e `indicadores/` de resultado.
- **Comunicación y handoff (ADR 0012, `messaging` + `collaboration`):** protocolo de mensajes entre agentes con
  idempotencia, handoff como contrato de transferencia que el receptor acepta o rechaza, y canales transversales.
- **Gobierno de acciones (ADR 0013, `governance/policy` + `governance/actions`):** motor de políticas server-side,
  bandeja de aprobaciones con hash del contenido e invalidación, doble aprobación y suspensión de emergencia.
- **Parámetros de ejecución (ADR 0013, `execution-params`):** estación virtual y candado de salida a internet con
  dominios permitidos, en el expediente y la versión inmutable del agente.
- **Durabilidad avanzada (`durability`):** idempotencia, clasificación temporal/permanente/incierto, conciliación y
  bandeja de excepciones.
- **Imputación de costos (`governance/imputacion`):** servicios internos con acuerdo y reparto de servicios compartidos
  (suma 100 %, sin doble conteo), sobre el libro mayor de presupuestos existente.
- **Auditoría inmutable (`audit`):** bitácora encadenada por hash de decisiones, aprobaciones, políticas y accesos.
- **Consolas gerenciales (`consolas`):** inicio gerencial por negocio/área/sede (resultados, riesgos, decisiones).
- **Cuadrillas y Pasaporte de resultado (ADR 0014, `crews` + `results/pasaporte.*`):** equipos de empleados digitales
  gobernados y un pasaporte verificable que acredita el resultado con su evidencia y cadena de validación.

## Nexo Copilot y consola de plataforma (ADR 0006)

- Agente de plataforma propiedad de Nexo (no es un agente del workspace): configuración versionada en
  `copilot/definition/`, modelo `COPILOT_PROVIDER`/`COPILOT_MODEL` (por defecto `anthropic`/`claude-opus-5-5`; `mock`
  sin clave). Reutiliza el runtime con herramientas internas de solo lectura y **nunca modifica nada**: genera
  `CopilotProposal` que el usuario revisa y aplica (EDITOR+).
- Consumo con `source: COPILOT`, fuera de los presupuestos del cliente, con cupo mensual por workspace
  (`COPILOT_MONTHLY_QUOTA_USD`, por defecto 2 USD).
- Consola de plataforma (`/api/platform/*`, web `/platform`) solo para `PLATFORM_ADMIN_EMAILS`: métricas de éxito de
  clientes y calidad del Copilot (calificaciones; conversación solo si el usuario la compartió). Conjunto de evaluación
  propio en `copilot/eval/`.

## API keys con alcance y expiración (auditoría B3)

- **Alta** (`POST /workspace/api-keys`, ADMIN+, solo con sesión de usuario: una API key no gestiona API keys):
  `scopes` obligatorio, `role` (`VIEWER`/`EDITOR`/`ADMIN`, por defecto `EDITOR`, nunca mayor que el de quien la crea;
  nunca `OWNER`) y `expiration` (`30d`/`90d`/`365d`, por defecto `90d`; `never` solo un OWNER). Se guarda el SHA-256,
  el prefijo y `createdById`; la llave completa se muestra una vez.
- **Alcances** (`common/guards/api-key-scopes.ts`, único lugar que los decide a partir del método y la ruta de Nest):
  `read` (GET/HEAD y `POST /knowledge-bases/:id/search`), `write` (cualquier otra escritura), `agents:run`
  (`POST /agents/:id/chat`, `POST /routines/:id/run`), `workflows:run` (`POST /workflows/:id/run`,
  `POST /executions/:id/cancel|retry`), `connectors:invoke` (`POST /connectors/:id/operations/:opId/invoke`) y `mcp`
  (`/mcp`). Una ruta nueva con un alcance propio se agrega a `ROUTE_SCOPES`.
- **Guard**: clave inexistente, revocada o vencida → 401; acción fuera del alcance → 403; luego aplica `@MinRole`
  con el rol efectivo = mínimo entre el de la clave y el rol **vigente** de quien la creó (si dejó el workspace, 401).
  `lastUsedAt` se escribe como mucho una vez por minuto y clave.
- **Revocar** (`DELETE /workspace/api-keys/:id`) marca `revokedAt` (`revokedReason: manual`); la clave sigue en la
  lista para auditoría.
- **Compatibilidad**: la migración `api_keys_con_alcance_y_recuperacion_de_contrasena` deja las claves existentes con
  alcance `*` (todo lo que permita su rol), rol `EDITOR` y sin expiración: siguen funcionando igual. La lista las
  marca `legacy` y `rotationSuggested` para que la web sugiera rotarlas.
- **Cuenta recuperada** (C1): al tomar el control de una cuenta sin verificar (invitación o recuperación de
  contraseña) se revocan (`revokedReason: account_takeover`), en la misma transacción que sube `tokenVersion`:
  1. todas las claves creadas por esa cuenta, en cualquier workspace;
  2. en los workspaces donde es OWNER y ningún otro miembro es OWNER ni ADMIN, también las claves sin creador conocido
     (anteriores a B3): crear claves exige ADMIN, así que allí solo esa cuenta pudo crearlas. Con otro administrador
     presente no se pueden atribuir y se conservan, igual que las claves creadas por otros miembros.

## Recuperación de contraseña

- `POST /auth/password/forgot` (público, 5 cada 15 min por IP): sin SMTP responde 503 (como la verificación de
  correo). Con SMTP responde 202 con el mismo cuerpo exista o no el correo y procesa en segundo plano (sin
  enumeración ni diferencia de tiempos). Como mucho 3 enlaces vigentes por cuenta (las demás solicitudes se ignoran).
- Token `pwr_…` aleatorio de 256 bits, de un solo uso y 30 minutos (`PasswordResetToken`, solo su SHA-256). Llega en el
  enlace `/restablecer/<token>` de la web, que lo envía en el cuerpo de `POST /auth/password/reset` (10/min por IP).
- Restablecer consume el enlace de forma atómica (y los demás vigentes de la cuenta), incrementa `tokenVersion`
  (cierra todas las sesiones), marca el correo como verificado y, si la cuenta no lo estaba, revoca las API keys como
  se describe arriba. No inicia sesión: la web lleva al login.
- Registros: `redact-url.ts` y el `log_format` de `apps/web/nginx.conf` ocultan el token de `/restablecer/` en la URL
  y en el `Referer` (las llamadas a `/api` desde esa página lo envían con `strict-origin-when-cross-origin`).

## Sesión de la web y CSRF (auditoría M6, B4)

- **Credenciales aceptadas** por el `AuthGuard` global, en este orden: `Authorization: Bearer <jwt|nexo_…>`,
  `x-api-key` y, sin cabecera, la cookie `nexo_session`. API keys, clientes MCP y scripts siguen con Bearer.
- **Cookie de sesión**: `nexo_session` = JWT de sesión, `HttpOnly`, `SameSite=Strict`, `Path=/api`, `Secure` con
  `SESSION_COOKIE_SECURE` (por defecto, solo en producción), misma vida que el JWT. La emiten o renuevan
  `POST /auth/login`, `POST /auth/invitations/:token/accept`, `POST /auth/change-password` y
  `POST /auth/switch-workspace` (este cierra la sesión anterior del navegador). El cuerpo sigue trayendo `accessToken`
  para clientes con Bearer. Strict no rompe los callbacks OAuth: son públicos y se validan con el `state` firmado y la
  cookie de ligadura (`SameSite=Lax`); al volver a la web, sus peticiones a `/api` ya son del mismo sitio.
- **CSRF**: doble envío firmado. `nexo_csrf` (legible, `Path=/`) = HMAC del JWT de sesión con un secreto derivado de
  `JWT_SECRET`; toda petición autenticada con la cookie que use POST/PUT/PATCH/DELETE debe repetirlo en
  `X-CSRF-Token` (si no, 403). El servidor lo recalcula desde la cookie de sesión, así que un valor plantado no sirve.
  Se prefirió a comparar `Origin` con `CORS_ORIGINS` porque no depende de la topología del despliegue.
- **Cierre de sesión**: `POST /auth/logout` revoca el `jti` del token en Redis (`nexo:session-revoked:`) hasta que
  vence y borra las cookies; sin sesión válida responde 200 y solo borra las cookies. `User.tokenVersion` sigue
  cerrando todas las sesiones (cambio de contraseña, cuenta recuperada). Una cookie inválida se borra en la respuesta.
- **Web**: no guarda el token (borra el `nexo.session` heredado de `localStorage` al arrancar); el estado sale de
  `GET /auth/me`, `HttpClient` usa `withCredentials` y añade `X-CSRF-Token` (`withXsrfConfiguration`), y los `fetch`
  de SSE (chat, Copilot) envían la cookie y la cabecera.
- **Enumeración de correos (B4)**: `POST /auth/register` responde siempre `201 { accepted, message }`, exista o no el
  correo, sin sesión (la web inicia sesión a continuación); si existía y hay SMTP, se avisa a su dueño. El login
  compara contra un hash bcrypt ficticio cuando el correo no existe. `GET /auth/invitations/:token` sí informa
  `accountExists`: solo lo ve quien posee el enlace de un solo uso enviado a ese correo, y la página lo necesita.

## Usuario maestro de primer arranque

`BootstrapAdminService` crea al arrancar, si `BOOTSTRAP_ADMIN_EMAIL` y `BOOTSTRAP_ADMIN_PASSWORD` (≥ 12 caracteres)
están definidos y el usuario no existe, un OWNER del workspace `BOOTSTRAP_WORKSPACE_NAME` (por defecto "Nexo"). Si ya
existe no hace nada (nunca cambia la contraseña), por lo que es seguro con varias réplicas. En AWS la contraseña viene
de Secrets Manager.

## Publicación de versiones (ADR 0009)

- Una versión semántica para el monorepo, calculada desde los commits convencionales por `scripts/release.mjs`
  (`npm run release`). Guía: [release.md](release.md).
- La etiqueta `vX.Y.Z` dispara `.github/workflows/release.yml`: verifica versiones, ejecuta el CI completo
  (`ci.yml` vía `workflow_call`), construye una vez `nexo-api`, `nexo-web` y `nexo-edge` en GHCR y crea el GitHub Release.
- `deploy-aws.yml` recibe una versión, copia sus imágenes a ECR conservando el digest, despliega `NexoPilot` con esa
  etiqueta y comprueba `GET /api/health/version` (público; `version`, `commit`, `builtAt` desde `APP_VERSION`,
  `GIT_SHA`, `BUILD_DATE`) y `/version.json` de la web. Revertir = desplegar la versión anterior; migraciones aditivas.

## Protección de datos (ADR 0008): aceptado, parcialmente implementado

El ADR 0008 (detector `DataGuard`, política `DataPolicy` con enmascarado reversible, clasificación de datos y
enrutamiento a modelos aprobados, auditoría, telemetría de producto, acceso de soporte excepcional y retención de
conversaciones) está **aceptado y solo en parte implementado**: el módulo `data-protection` cubre los ajustes de
privacidad y la retención de conversaciones, pero el enmascarado/clasificación hacia los modelos aún no existe, así que
hoy los mensajes y resultados de herramientas llegan al modelo sin enmascarar.

## Evolución sugerida

Priorizada por valor de negocio y riesgo:

1. **Cerrar el programa de organización de empleados digitales** (ADR 0011–0014, ya construido en su mayor parte): aplicar
   el candado de salida a internet en el runtime (E8-2) y completar la web de parámetros de ejecución (E8), los canales
   externos correo/WhatsApp/voz (E14, pendientes de decisión de proveedores) y la comunidad interna (E11, hoy cubierta en
   parte por el catálogo de cuadrillas). Detalle en `docs/backlog-organizacion-digital.md`.
2. **Implementar ADR 0008** (protección de datos hacia los modelos, auditoría y retención de conversaciones): el módulo
   `data-protection` ya cubre ajustes de privacidad y retención de conversaciones; falta el enmascarado/clasificación
   hacia los modelos.
3. **SSO (SAML/OIDC)** general de acciones administrativas (la auditoría inmutable ya existe en `audit`).
4. **Notificación de alertas de presupuesto** por correo/Slack (hoy solo se registran en la consola).
5. **Observabilidad con OpenTelemetry** (trazas API → cola → worker → proveedor) y métricas de costo por agente exportables.
6. **Despliegue de flujos por entornos** (dev/qa/prod) sobre el historial de versiones existente.
7. **Embeddings + pgvector** detrás de la misma interfaz `search()` de conocimiento (hoy full-text de PostgreSQL);
   ingesta de PDF/Office.
8. **Agentes como herramientas de otros agentes** (multi-agente).
9. **Driver Bedrock** y fase 2 de ADR 0005 (Oracle, actualizaciones automáticas del Edge) y de ADR 0007 (visibilidad `EXTERNAL`).
