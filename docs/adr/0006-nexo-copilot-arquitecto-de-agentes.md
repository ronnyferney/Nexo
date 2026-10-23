# 0006. Nexo Copilot: agente nativo que ayuda a construir agentes exitosos

- **Estado:** Aceptado
- **Fecha:** 2026-10-23
- **Responsables:** nexo-architect
- **Decisiones de negocio confirmadas:** el costo del Copilot lo asume **Nexo con un cupo mensual por workspace**;
  proactividad **completa**: panel lateral con alertas + botón "Ayúdame" + entrevista al crear un agente (omitible por expertos).

## Contexto
La principal causa de abandono en plataformas de agentes es que el usuario no sabe diseñar un buen agente, obtiene un
mal resultado y se va. Nexo ya tiene las piezas para agentes de calidad (perfil, skills, conocimiento, conectores,
evaluaciones, bucle de mejora); falta un **guía experto** que las combine por el usuario y vigile su salud.

## Decisiones

### D1. Nexo Copilot (agente de plataforma)
- Agente interno de Nexo con instrucciones de "arquitecto de agentes" (en español, con buenas prácticas de diseño de
  agentes: límites explícitos, herramientas mínimas, aprobación humana para acciones con efecto, conocimiento antes que
  instrucciones largas, casos de evaluación desde el día uno, modelo adecuado al costo).
- Modelo configurable por plataforma: `COPILOT_PROVIDER` / `COPILOT_MODEL` (por defecto `anthropic` / `claude-opus-5-5`;
  si no hay clave, `mock` para desarrollo).
- **Nunca modifica nada directamente**: produce **propuestas** (`CopilotProposal`) que el usuario revisa (diff) y aplica.
- Modos: `CREATE` (entrevista y borrador de agente nuevo), `IMPROVE` (mejorar un agente existente) y `DIAGNOSE`
  (explicar fallos: 👎, casos fallidos, rutinas con error, presupuesto).
- Herramientas internas (solo lectura del workspace + creación de propuestas):
  `get_agent`, `get_agent_health`, `list_connectors` (con operaciones), `list_catalog` (integraciones disponibles),
  `list_skills`, `list_knowledge_bases`, `get_recent_failures` (feedback negativo, resultados de evaluación fallidos,
  corridas de rutinas fallidas, errores de presupuesto), `propose_agent` y `propose_changes`.
- Una propuesta de agente incluye: nombre, descripción, perfil (ADR 0003), proveedor/modelo (del catálogo, ADR 0002),
  esfuerzo, operaciones de conectores existentes, integraciones del catálogo a instalar, skills (existentes o nuevas con
  instrucciones), bases de conocimiento sugeridas, ejemplos, **casos de evaluación** (mín. 5) y rutinas sugeridas.

### D2. Cupo del Copilot pagado por Nexo
- El consumo del Copilot se registra en `UsageRecord` con `source: COPILOT` y **no descuenta de los presupuestos del
  cliente** (no pasa por el libro mayor de presupuestos).
- Cupo mensual por workspace `COPILOT_MONTHLY_QUOTA_USD` (por defecto 2 USD). Al agotarse: mensaje claro y el panel
  ofrece las herramientas deterministas (puntaje de salud, plantillas). `GET /copilot/quota`.

### D3. Puntaje de salud del agente (determinista, sin costo de IA)
`GET /agents/:id/health` → `{ score: 0..100, level: 'CRITICAL'|'NEEDS_WORK'|'GOOD'|'EXCELLENT', checks: HealthCheck[] }`
con `HealthCheck = { id; category: 'PROFILE'|'TOOLS'|'KNOWLEDGE'|'QUALITY'|'COST'|'OPERATIONS'; severity: 'CRITICAL'|'WARNING'|'INFO'; passed: boolean; message; recommendation; action?: { type: 'OPEN_TAB'|'COPILOT'; tab?: string; prompt?: string } }`.
Reglas iniciales (pesos documentados en código): rol definido; ≥ 2 objetivos; ≥ 1 límite; tono/formato; herramientas con
efecto sin aprobación humana; agente con herramientas pero sin descripciones claras; conocimiento ausente cuando el rol
menciona políticas/procesos; ≥ 5 casos de evaluación; última evaluación vs. meta; feedback negativo pendiente;
modelo PREMIUM con esfuerzo bajo / tareas simples (sugerir ECONOMY); rutinas con fallos recientes; respaldo de modelo
configurado. `GET /agents/health` → resumen de todos los agentes del workspace (para alertas).

### D4. Lanzamiento con garantía de calidad
- `Agent.launchStatus`: `DRAFT` | `LAUNCHED`. `POST /agents/:id/launch` exige puntaje de salud ≥ 70 **y** última
  evaluación ≥ `targetScore`; un ADMIN puede forzarlo con `{ override: true, reason }` (queda registrado).
  `POST /agents/:id/unlaunch`. El servidor MCP y las rutinas solo publican/ejecutan agentes `LAUNCHED`
  (el chat de prueba y los flujos en borrador siguen funcionando).

### D5. Experiencia
- Al crear un agente se abre la **entrevista del Copilot** (omitible: "Soy experto, crear vacío").
- **Panel lateral del Copilot** en el estudio de agentes (conversación en streaming, propuestas con diff y botón Aplicar).
- Tarjeta de **salud** en el agente y en la lista de agentes; alertas en el inicio para agentes en nivel CRITICAL.
- **Primeros pasos** para workspaces nuevos: plantillas por industria (logística/TMS, comercial, soporte) que arrancan
  la entrevista con contexto.

### D6. El Copilot es propiedad de Nexo (no de los clientes)
- **No es un agente del workspace**: no aparece en la lista de agentes del cliente, no se puede editar, duplicar,
  exportar ni publicar por MCP, y su configuración interna (instrucciones, skills, criterios) **no se expone**
  (sin `prompt-preview`; las respuestas no revelan sus instrucciones). Es propiedad intelectual de Nexo.
- **Configuración versionada en el código** (`apps/api/src/modules/copilot/definition/`): perfil, instrucciones, skills
  internas y **base de conocimiento del producto** (guías de uso de Nexo, buenas prácticas de diseño de agentes, preguntas
  frecuentes) en Markdown, revisadas por pull request. Cada despliegue publica una versión identificable (`copilotVersion`).
- **Rol de plataforma**: administradores de Nexo definidos por `PLATFORM_ADMIN_EMAILS` (no son roles de workspace).
  Solo ellos acceden a la **consola de plataforma** del Copilot.
- **Calidad del Copilot gestionada por Nexo**: conjunto de evaluación propio (en código, ejecutable en CI con MockDriver y
  con el modelo real bajo demanda), calificación 👍/👎 de cada respuesta del Copilot por los usuarios, y métricas
  agregadas de éxito por workspace — sin contenido de conversaciones de los clientes salvo el que el usuario adjunte
  explícitamente a una calificación.
- **Métricas de éxito del cliente** (consola de plataforma): workspaces activos, tiempo hasta el primer agente lanzado,
  agentes lanzados vs. borradores, distribución del puntaje de salud, puntaje de evaluación promedio, satisfacción con el
  Copilot y consumo del cupo. Sirven para detectar clientes en riesgo y actuar antes de que abandonen.
- Las propuestas que aplica el usuario sí crean recursos **del cliente** (agentes, skills, casos): lo creado le pertenece.

## Contrato de API (rutas bajo `/api`)
- `POST /copilot/sessions` `{ mode: 'CREATE'|'IMPROVE'|'DIAGNOSE', agentId?, context?: string }` → `{ id, mode, agentId }`
- `POST /copilot/sessions/:id/messages` `{ message, stream?: boolean }` → SSE con los eventos del chat de agentes
  (`text`, `tool_call`, `tool_result`, `notice`, `done`, `error`) más `proposal` `{ id, kind, summary }`.
- `GET /copilot/sessions/:id` → `{ id, mode, agentId, messages: { role: 'user'|'assistant'; text }[], proposals: CopilotProposal[] }`
- `GET /copilot/proposals/:id` → `CopilotProposal = { id; kind: 'CREATE_AGENT'|'UPDATE_AGENT'; status: 'PENDING'|'APPLIED'|'DISCARDED'; summary; payload; agentId: string|null; createdAt }`
- `POST /copilot/proposals/:id/apply` (EDITOR+) → `{ agentId, created: { skills: number; examples: number; evalCases: number; routines: number }, pendingIntegrations: string[] }`
  · `POST /copilot/proposals/:id/discard`
- `GET /copilot/quota` → `{ limitUsd, usedUsd, remainingUsd, period }`
- `GET /agents/:id/health`, `GET /agents/health`, `POST /agents/:id/launch` `{ override?, reason? }`, `POST /agents/:id/unlaunch`
- `Agent` agrega `launchStatus`, `launchedAt`, `launchOverrideReason`.
- `POST /copilot/messages/:messageId/feedback` `{ rating: 'UP'|'DOWN', comment?, shareConversation?: boolean }`
- Consola de plataforma (solo `PLATFORM_ADMIN_EMAILS`): `GET /platform/copilot/metrics?from&to` →
  `{ workspaces; activeWorkspaces; agentsCreated; agentsLaunched; medianMinutesToFirstLaunch; healthDistribution: Record<level, number>; avgEvalScore; copilotSatisfaction: { up; down }; quotaUsageUsd; atRiskWorkspaces: { id; name; reason }[] }`
  · `GET /platform/copilot/feedback` (calificaciones y comentarios; conversación solo si el usuario la compartió)
  · `GET /platform/me` → `{ isPlatformAdmin }`.

## Consecuencias
- Migración: `CopilotSession`, `CopilotProposal`, `CopilotFeedback`, `Agent.launchStatus/launchedAt/launchOverrideReason`,
  `UsageSource.COPILOT`.
- Riesgo de costo para Nexo acotado por el cupo; el puntaje de salud no consume IA.
- El Copilot reutiliza el runtime de agentes (herramientas internas) en vez de un motor aparte.

## Plan
| Tarea | Dueño |
|---|---|
| Esquema y migración | orquestador |
| Copilot (sesiones, herramientas, propuestas, aplicar, cupo) | nexo-backend-ai |
| Salud del agente, lanzamiento y efectos en MCP/rutinas | nexo-backend-platform |
| Panel del Copilot, entrevista al crear, tarjeta de salud, lanzamiento, primeros pasos | nexo-frontend-ui |
| Consola de plataforma (métricas de éxito y calidad del Copilot) | nexo-frontend-core + nexo-backend-platform |
| Base de conocimiento del producto y conjunto de evaluación del Copilot | nexo-architect + nexo-backend-ai |
| E2E del ciclo con MockDriver | nexo-qa-api |
