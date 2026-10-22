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
