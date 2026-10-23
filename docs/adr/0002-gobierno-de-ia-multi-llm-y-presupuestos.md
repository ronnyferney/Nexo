# 0002. Gobierno de IA: consola de administración, múltiples LLM y bolsas de presupuesto por unidad corporativa

- **Estado:** Aceptado
- **Fecha:** 2026-10-22
- **Responsables:** nexo-architect

## Contexto
Los clientes necesitan usar varios proveedores de IA y controlar el gasto por áreas de la empresa. El riesgo número uno
que perciben es el costo descontrolado. Se requieren dos experiencias: una **consola de administración** (gobierno,
costos, proveedores, organización) y un **portal de usuarios** (agentes, flujos, ejecuciones, consumo propio).

## Decisiones

### D1. Una sola SPA con dos zonas por rol
- Portal (`/`): Inicio, Agentes, Flujos, Ejecuciones, Conectores, **Mi consumo**. Todos los roles.
- Administración (`/admin/*`): Costos, Proveedores IA, Organización (unidades y miembros), Presupuestos, Alertas,
  Seguridad (secretos, API keys, MCP). Solo **ADMIN** y **OWNER** (guard en frontend + `@MinRole('ADMIN')` en API).

### D2. Conexiones LLM dinámicas por workspace
- `LlmConnection` (tipo `ANTHROPIC` | `OPENAI_COMPATIBLE` | `MOCK`) con API key cifrada (AES-256-GCM) y `baseUrl` opcional.
  `OPENAI_COMPATIBLE` cubre OpenAI, Azure OpenAI, Ollama/vLLM on-premise, Gemini (endpoint compatible) y gateways.
- `LlmModel`: catálogo por conexión con precio por millón de tokens (entrada, salida, lectura de caché) y nivel
  (`PREMIUM`, `STANDARD`, `ECONOMY`). **Los precios son datos configurables**, no constantes de código.
- Conexiones de sistema (sin fila en BD): `anthropic` (si existe `ANTHROPIC_API_KEY`) y `mock`. Conservan los ids
  actuales, por lo que los agentes existentes siguen funcionando sin migración de datos.
- `Agent.provider` = id de conexión (`anthropic`, `mock` o cuid de `LlmConnection`); `Agent.model` = id del modelo.

### D3. Jerarquía organizacional y centro de costo
- `OrgUnit` en árbol (profundidad libre) por workspace, con una **raíz creada automáticamente** que actúa como tope global.
- `Membership.orgUnitId` asigna cada usuario a una unidad (por defecto la raíz).
- `Agent.costCenterId` (opcional) define a quién se cobra cuando el agente corre sin usuario (flujos, webhooks, MCP).
- Regla de imputación: chat de un usuario → su unidad; ejecución sin usuario → `costCenterId` del agente; si no hay → raíz.

### D4. Bolsas de presupuesto en dinero (USD)
- `Budget` (uno por unidad): `period` (`MONTHLY`|`QUARTERLY`|`YEARLY`), `limitUsd`, `policy`, `alertThresholds`
  (por defecto `[50, 80, 100]`), modelo de degradación opcional.
- Se presupuesta en **dinero** porque los modelos tienen precios distintos; los tokens se registran igualmente.
- **Jerárquico:** un consumo descuenta de su unidad **y de todos sus ancestros**; debe haber saldo en toda la cadena.
- Políticas al agotarse: `BLOCK` (rechaza con HTTP 402), `DOWNGRADE` (cambia al modelo económico configurado;
  si no hay, bloquea), `ALERT_ONLY` (solo alerta).
- **Libro mayor** `BudgetLedger(orgUnitId, periodKey, spentUsd)` con incrementos atómicos por cada ancestro:
  la verificación cuesta O(profundidad) y no requiere agregaciones sobre el histórico.
- Claves de periodo en UTC: `2026-10`, `2026-Q4`, `2026`.

### D5. Medición y control en cada llamada al modelo
- El puerto `LlmProvider` expone `beforeTurn()` (se invoca **antes** de cada llamada; puede abortar) y `onUsage()`
  (después de cada respuesta, con tokens reales). El sobregiro máximo queda acotado a un turno.
- La degradación de modelo se decide **al inicio** de la ejecución (no a mitad del bucle de herramientas).
- `UsageRecord` guarda workspace, unidad, usuario, agente, flujo/ejecución, conversación, conexión, modelo, tokens
  (entrada, salida, caché) y costo. **Nunca** guarda contenido de prompts ni respuestas.
- Al cruzar un umbral se crea un `BudgetAlert` único por (unidad, periodo, umbral).

### D6. Políticas de modelos por unidad
- `OrgUnit.allowedModels`: lista `"<providerId>:<modelId>"`. Vacía = hereda. Si una unidad de la cadena restringe y el
  modelo no está permitido, la ejecución se rechaza con un mensaje claro (HTTP 403).

### D7. Optimización
- Caché automática de prompts en Anthropic (`cache_control` de nivel superior) y precio de lectura de caché en el catálogo.
- Recomendación operativa: modelos `ECONOMY` como degradación para áreas de alto volumen.

### D8. Catálogo de proveedores (addendum, 2026-10-23)
**Decisión de negocio (no negociable):** Nexo **no conecta suscripciones personales** (Claude Pro/Max vía claude.ai,
ChatGPT Plus, GitHub Copilot u otras): sus términos no permiten que una plataforma de terceros las use y su consumo no
se puede medir para los presupuestos de D4/D5. Solo se admiten conexiones oficiales:
- **Clave de API de pago por uso** del proveedor (Anthropic, OpenAI, Gemini, Mistral, xAI, DeepSeek, Moonshot, Groq,
  Cerebras, Fireworks, Together, NVIDIA, Hugging Face).
- **Nube empresarial** (Azure OpenAI v1 con cabecera `api-key`; Amazon Bedrock por su endpoint compatible con OpenAI
  `bedrock-mantle` con clave de API de Bedrock).
- **Modelos locales** (Ollama, LM Studio): desde la nube requieren Nexo Edge o una red alcanzable; la protección SSRF
  bloquea redes privadas salvo `CONNECTOR_ALLOW_PRIVATE_NETWORKS=true` (solo on-premise).
- **OpenRouter** para modelos de terceros, con su **OAuth PKCE oficial** (o clave de API).

Diseño:
- El catálogo vive en código (`apps/api/src/modules/llm/providers/*.providers.ts`, un archivo por familia). Cada entrada
  define categoría, facturación, driver (`ANTHROPIC` nativo u `OPENAI_COMPATIBLE`), plantilla de URL base renderizada
  con el motor de plantillas de Nexo, campos del formulario (solo `apiKey` es secreto), pasos verificados para obtener
  la clave (`keySteps`), prefijo documentado (`keyPrefix`, solo advertencia), modelos sugeridos y
  `pendingVerification` (lo que no se pudo verificar en la fuente oficial).
- **Precios:** solo los verificados en la fuente oficial (hoy, Anthropic). El resto se importa con precio 0 y
  `LlmModel.needsPricing = true`; la consola pide completarlo (fijar una tarifa lo apaga). Los modelos locales no lo
  necesitan. Mientras un modelo tenga precio 0 su consumo no descuenta presupuesto: se recomienda completar la tarifa
  antes de habilitarlo para áreas con presupuesto.
- **Conectar = probar antes de guardar:** se validan campos y URL, se llama a un endpoint sin costo (`/models`, o `/key`
  en OpenRouter) y solo si pasa se crea la `LlmConnection` con la clave cifrada (AES-256-GCM) y `providerId`.
- Por conexión se guardan `providerFields` (valores no secretos), `headers` (cabeceras fijas no secretas, p. ej.
  `X-OpenRouter-Title`) y `driverOptions` (`authHeader`: `bearer` | `api-key` | `none`; `verifyPath`;
  `replayReasoning`). Las conexiones anteriores (`providerId` null) conservan el comportamiento heredado (clave en
  `Authorization` y `api-key`).
- El historial del driver compatible con OpenAI guarda el mensaje completo del proveedor (append-only, incluido
  `reasoning_content`) y al reenviarlo proyecta solo `role`, `content`, `tool_calls`, `tool_call_id`, `name`, más
  `reasoning_content` si la conexión lo exige (Kimi K3).
- `LLM_PROVIDER_URL_OVERRIDES` (JSON `{ "<providerId>": "<url>" }`) sustituye la URL base de un proveedor (gateways
  corporativos de salida y pruebas); `OPENROUTER_AUTH_URL` sustituye la pantalla de consentimiento.
- **OAuth de OpenRouter:** `state` firmado de un solo uso con el `code_verifier` cifrado (reutiliza `OAuthStateService`
  del ADR 0005 con `connectorId = 'llm-provider:openrouter'`). Como OpenRouter no tiene parámetro `state`, viaja en la
  query del `callback_url`. El callback canjea el código en `POST https://openrouter.ai/api/v1/auth/keys`
  (`{ code, code_verifier, code_challenge_method: 'S256' }` → `{ key }`), exige que quien inició siga siendo ADMIN+ y
  redirige siempre a `${WEB_URL}/admin/providers`.

## Contrato de API

Todas las cantidades monetarias son `number` en USD. Rutas bajo `/api`.

### Catálogo (cualquier rol)
`GET /llm/catalog` y su alias `GET /agents/providers` →
```ts
{ id: string; label: string; kind: 'ANTHROPIC'|'OPENAI_COMPATIBLE'|'MOCK'; system: boolean; configured: boolean;
  models: { id: string; label: string; description: string; tier: 'PREMIUM'|'STANDARD'|'ECONOMY';
            inputUsdPerMTok: number; outputUsdPerMTok: number }[] }[]
```
Solo incluye conexiones y modelos habilitados.

### Unidades para selectores (cualquier rol)
`GET /org/units` → `{ id: string; name: string; parentId: string | null }[]`

### Mi consumo (cualquier rol)
`GET /me/usage` →
```ts
{ orgUnit: { id: string; name: string };
  budgets: { orgUnitId: string; orgUnitName: string; period: string; periodKey: string; limitUsd: number;
             spentUsd: number; pct: number; policy: 'BLOCK'|'DOWNGRADE'|'ALERT_ONLY' }[];   // unidad del usuario → raíz
  me: { costUsd: number; calls: number; inputTokens: number; outputTokens: number; since: string } }  // mes en curso
```

### Administración (ADMIN/OWNER)
**Conexiones y modelos**
- `GET /admin/llm/connections` → `LlmConnection[]` donde
  `LlmConnection = { id; name; kind; baseUrl: string|null; hasApiKey: boolean; enabled: boolean; createdAt; updatedAt; models: LlmModel[] }`
  y `LlmModel = { id; connectionId; modelId; label; tier; inputUsdPerMTok; outputUsdPerMTok; cacheReadUsdPerMTok: number|null; enabled }`
- `POST /admin/llm/connections` `{ name, kind, baseUrl?, apiKey?, enabled? }` → `LlmConnection`
- `PATCH /admin/llm/connections/:id` (parcial; `apiKey` solo si se envía) → `LlmConnection`
- `DELETE /admin/llm/connections/:id` (409 si hay agentes usándola)
- `POST /admin/llm/connections/:id/test` → `{ ok: boolean; message: string }`
- `POST /admin/llm/connections/:id/models` `{ modelId, label, tier, inputUsdPerMTok, outputUsdPerMTok, cacheReadUsdPerMTok?, enabled? }` → `LlmModel`
- `PATCH /admin/llm/models/:id` (parcial) → `LlmModel` · `DELETE /admin/llm/models/:id`

**Organización**
- `GET /admin/org/units` → `{ id; name; code: string|null; parentId: string|null; allowedModels: string[]; memberCount: number; isRoot: boolean }[]`
- `POST /admin/org/units` `{ name, code?, parentId }` · `PATCH /admin/org/units/:id` `{ name?, code?, parentId?, allowedModels? }`
- `DELETE /admin/org/units/:id` (no la raíz; hijos y miembros pasan al padre)
- `GET /admin/org/members` → `{ membershipId; userId; name; email; role; orgUnitId: string; createdAt }[]`
- `POST /admin/org/members` `{ email, name, role, orgUnitId?, password? }` (password obligatorio si el usuario no existe)
- `PATCH /admin/org/members/:membershipId` `{ role?, orgUnitId? }` · `DELETE /admin/org/members/:membershipId`
  (no se puede dejar el workspace sin OWNER)

**Presupuestos**
- `GET /admin/budgets` → por cada unidad:
  `{ orgUnitId; orgUnitName; parentId; budget: null | { period; limitUsd; policy; alertThresholds: number[]; downgradeProviderId: string|null; downgradeModel: string|null }; periodKey: string|null; spentUsd: number; pct: number|null }[]`
- `PUT /admin/budgets/:orgUnitId` `{ period, limitUsd, policy, alertThresholds?, downgradeProviderId?, downgradeModel? }`
- `DELETE /admin/budgets/:orgUnitId`

**Consumo y alertas**
- `GET /admin/usage/summary?from&to&groupBy=orgUnit|model|agent|user|day` →
  `{ from; to; totalCostUsd; inputTokens; outputTokens; calls; groups: { key; label; costUsd; inputTokens; outputTokens; calls }[] }`
  (`from`/`to` ISO; por defecto el mes en curso; `groups` ordenado por costo desc., salvo `day` que va cronológico)
- `GET /admin/usage/records?take&cursor` → `{ items: { id; createdAt; source; model; providerId; orgUnitName; userName; agentName; inputTokens; outputTokens; costUsd }[]; nextCursor }`
- `GET /admin/alerts` → `{ id; orgUnitId; orgUnitName; periodKey; threshold; spentUsd; limitUsd; createdAt }[]` (últimas 100)

### Catálogo de proveedores (ADMIN/OWNER, D8)
- `GET /admin/llm/providers` → `{ providers: ProviderView[] }`, con
  `ProviderView = { id; name; description; logo; category: 'FRONTIER'|'OPEN_MODELS'|'ENTERPRISE_CLOUD'|'LOCAL'|'ROUTER';
  billing: 'PAY_AS_YOU_GO'|'FREE_TIER'|'ENTERPRISE'|'LOCAL'; kind: 'ANTHROPIC'|'OPENAI_COMPATIBLE'; baseUrl;
  auth: 'API_KEY'|'OAUTH'|'NONE'; fields: { key; label; secret; required; placeholder?; help?; pattern?; default? }[];
  docsUrl; keyUrl?; keySteps: string[]; keyPrefix?; suggestedModels: { id; label; tier; inputUsdPerMTok?;
  outputUsdPerMTok?; cacheReadUsdPerMTok?; contextTokens? }[]; notes?; pendingVerification: string[];
  connected: { connectionId; name; modelCount; enabled }[]; modelCount: number;
  platform: { configured: boolean; models: number } | null }` (`platform` solo en `anthropic`).
- `POST /admin/llm/providers/:id/connect` `{ name?, fields: Record<string,string>, models?: string[] }` → 201
  `{ connection: LlmConnection; models: LlmModel[]; discoveredModels: string[] }`; 400 con mensaje claro si los campos
  no son válidos o la prueba falla (clave rechazada, URL 404, inalcanzable, SSRF); 404 si el proveedor no existe.
  Sin `models` se importan los sugeridos que el proveedor expone (Azure agrega su `deployment`).
- `GET /admin/llm/providers/:id/discover?connectionId=` → `{ connectionId; models: string[]; discoveredModels: string[]; importedModels: string[] }` (`models` = `discoveredModels`).
- `POST /admin/llm/providers/openrouter/oauth/start` `{ limit? }` → `{ authorizeUrl }`.
- `GET /llm/oauth/openrouter/callback?code&state` (público, 30/min) → 302 a
  `${WEB_URL}/admin/providers?llm=connected&provider=openrouter&connectionId=…` o
  `?llm=error&provider=openrouter&reason=invalid_state|access_denied|missing_code|forbidden|exchange_failed`.
- `LlmConnection` agrega `providerId: string|null` y `providerFields: Record<string,string>`; `LlmModel` agrega
  `needsPricing: boolean`.

### Cambios en contratos existentes
- `Agent` incluye `costCenterId: string | null` (crear/actualizar).
- Chat SSE `done` agrega `usage: { inputTokens; outputTokens; costUsd }`, `model` y `providerId`; puede emitirse
  `notice` con la degradación aplicada. Presupuesto agotado → evento `error` (o HTTP 402 sin streaming).

## Consecuencias
- Nueva migración Prisma (tablas `LlmConnection`, `LlmModel`, `OrgUnit`, `Budget`, `BudgetLedger`, `BudgetAlert`,
  `UsageRecord`; columnas `Membership.orgUnitId`, `Agent.costCenterId`).
- Los agentes y conversaciones existentes siguen funcionando (`anthropic`/`mock` son conexiones de sistema).
- El costo es una estimación según los precios configurados; la factura del proveedor manda. Se documenta en la consola.
- Pendiente (fase siguiente): proveedor Bedrock, notificaciones por correo/Slack de alertas, presupuestos por usuario,
  streaming en el proveedor OpenAI-compatible, contador en Redis para muy alto volumen.

## Plan de implementación
| Tarea | Dueño | Criterio de aceptación |
|---|---|---|
| Esquema, migración, módulos `llm-admin`, `org`, `budgets`, `usage` | backend-platform | Endpoints del contrato con roles y aislamiento por workspace |
| Proveedores dinámicos, OpenAI-compatible, medición y control por turno | backend-ai | Uso registrado por turno; 402 al agotar; degradación funcional |
| Zonas portal/admin, páginas de administración y Mi consumo | frontend-core + frontend-ui | Build sin warnings; navegación por rol |
| Pruebas de presupuesto jerárquico, políticas y aislamiento | qa-api | Suite en verde contra Postgres/Redis reales |
