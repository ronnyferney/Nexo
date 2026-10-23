# 0003. Estudio de agentes (perfil, skills, conocimiento, rutinas) y prácticas de n8n en flujos

- **Estado:** Aceptado
- **Fecha:** 2026-10-23
- **Responsables:** nexo-architect

## Contexto
Los clientes necesitan diseñar agentes agnósticos al modelo, "entrenarlos" con el conocimiento de la empresa, darles
habilidades y funciones precisas, y programarles tareas recurrentes. Los flujos deben adoptar prácticas probadas de n8n.

## Decisiones

### D1. Agnosticismo de modelo con cadena de respaldo
- El agente ya elige cualquier conexión del catálogo (ADR 0002). Se agrega `Agent.fallbackModels: string[]`
  (`"<providerId>:<modelId>"`, máx. 3). Si el modelo principal falla por error de proveedor (no por presupuesto ni
  por permisos), se reintenta con el siguiente; cada intento pasa por el gobierno de costos. Se emite un `notice`.
- El historial nativo se conserva solo si el proveedor de respaldo es del mismo tipo; si no, ese turno arranca limpio.

### D2. Perfil estructurado del agente (rol y funciones claras)
`Agent.profile` (JSON):
```ts
{ role: string; goals: string[]; responsibilities: string[]; boundaries: string[];
  tone: string; outputFormat: string; language: string }
```
El system prompt se **compone** en una función pura `composeSystemPrompt()`, por secciones: Rol, Objetivos,
Responsabilidades, Límites (lo que NO debe hacer), Tono y formato, Instrucciones adicionales (`systemPrompt`),
Habilidades disponibles, Conocimiento y Ejemplos. Es transparente: `GET /agents/:id/prompt-preview`.

### D3. Skills reutilizables con divulgación progresiva
- `Skill`: nombre, `slug`, descripción (cuándo usarla), instrucciones (markdown) y operaciones de conector asociadas.
- Asignables a varios agentes. En el prompt va solo nombre y descripción; el agente carga las instrucciones completas
  con la herramienta interna `load_skill` cuando las necesita (ahorra tokens = costo). Las operaciones de la skill se
  suman a las herramientas del agente.

### D4. "Entrenamiento": bases de conocimiento y ejemplos
- `KnowledgeBase` → `KnowledgeDocument` → `KnowledgeChunk`. Ingesta de texto, URL (vía `HttpClientService`, HTML a texto)
  y archivos (`.txt .md .csv .json .html`, máx. 5 MB). Fragmentos de ~1.200 caracteres con solapamiento de 150.
- Búsqueda **agnóstica de modelo**: full-text de PostgreSQL (`to_tsvector('spanish')`, columna generada + índice GIN,
  ranking `ts_rank_cd`). Embeddings/pgvector quedan como mejora futura detrás de la misma interfaz `search()`.
- El agente recibe la herramienta interna `search_knowledge` si tiene bases asignadas.
- `AgentExample` (entrada → salida esperada): ejemplos few-shot incluidos en el prompt (máx. 20 por agente).

### D5. Rutinas programadas por agente
- `AgentRoutine`: nombre, instrucción (`prompt`), cron, zona horaria, habilitada, `notifyWebhookUrl` opcional.
- Programación con BullMQ (`upsertJobScheduler` con `tz`), ejecución en workers, `source: ROUTINE` para medición e
  imputación al centro de costo del agente. Historial en `RoutineRun` (estado, salida, error, costo, duración).
- Al terminar, si hay `notifyWebhookUrl`, se envía `POST` con `{ routineId, runId, status, output, error }`.

### D6. Prácticas de n8n en flujos
1. **Flujo de error** (`Workflow.errorWorkflowId`): si una ejecución falla, se dispara ese flujo con
   `{ workflow: {id,name}, execution: {id}, error, failedNode }` (sin recursión: un flujo de error no dispara otro).
2. **Sub-flujos** (nodo `subworkflow`): ejecuta otro flujo del workspace en línea con `input` mapeado; profundidad máx. 5.
3. **Bucle** (nodo `loop`): `items` (plantilla que resuelve a arreglo, máx. 1.000) → ejecuta un sub-flujo por elemento
   con concurrencia 1–10 (`{ item, index }` como entrada); salida `{ results: [...], count }`.
4. **Historial de versiones** (`WorkflowVersion`): cada cambio de definición guarda la versión anterior; restaurar crea
   una versión nueva (no se reescribe historia).
5. **Probar un nodo** con datos fijados (*pinned data*): ejecuta solo ese nodo con `input` y salidas simuladas de nodos previos.
6. **Retención de ejecuciones**: `EXECUTIONS_RETENTION_DAYS` (por defecto 30) con limpieza diaria.
7. **Plantillas** de flujos en el frontend (galería inicial).

## Contrato de API (rutas bajo `/api`; escritura con rol EDITOR o superior)

### Agentes (cambios)
- `Agent` incluye `profile` (D2, todos los campos opcionales, por defecto vacíos) y `fallbackModels: string[]`,
  editables en `POST/PATCH /agents`. `GET /agents/:id` añade `skills: {id,name,slug}[]`,
  `knowledgeBases: {id,name}[]`, `examplesCount: number`.
- `PUT /agents/:id/skills` `{ skillIds: string[] }` → agente
- `PUT /agents/:id/knowledge` `{ knowledgeBaseIds: string[] }` → agente
- `GET /agents/:id/examples` → `{ id; input; output; createdAt }[]` · `POST` `{ input, output }` · `DELETE /agents/:id/examples/:exampleId`
- `GET /agents/:id/prompt-preview` → `{ system: string; tools: { name: string; description: string }[] }`

### Skills
- `GET /skills` → `{ id; name; slug; description; instructions; operationIds: string[]; agentCount: number; updatedAt }[]`
- `POST /skills` `{ name, description, instructions, operationIds? }` · `GET|PATCH|DELETE /skills/:id`

### Conocimiento
- `GET /knowledge-bases` → `{ id; name; description; documentCount; chunkCount; agentCount; updatedAt }[]`
- `POST /knowledge-bases` `{ name, description? }` · `GET|PATCH|DELETE /knowledge-bases/:id`
- `GET /knowledge-bases/:id/documents` → `{ id; title; sourceType: 'TEXT'|'URL'|'FILE'; source: string|null; status: 'READY'|'FAILED'; error: string|null; chunkCount; charCount; createdAt }[]`
- `POST /knowledge-bases/:id/documents` `{ title, text }` o `{ title?, url }` → documento
- `POST /knowledge-bases/:id/documents/upload` (multipart, campo `file`, opcional `title`) → documento
- `DELETE /knowledge-bases/:id/documents/:docId`
- `POST /knowledge-bases/:id/search` `{ query, limit? }` → `{ documentId; title; content; score }[]`

### Rutinas
- `GET /routines` (todas del workspace) y `GET /agents/:id/routines` →
  `{ id; agentId; agentName; name; prompt; schedule; timezone; enabled; notifyWebhookUrl: string|null; lastRunAt: string|null; lastStatus: string|null; nextRunAt: string|null }[]`
- `POST /agents/:id/routines` `{ name, prompt, schedule, timezone?, enabled?, notifyWebhookUrl? }` · `PATCH|DELETE /routines/:id`
- `POST /routines/:id/run` → `RoutineRun` (ejecución inmediata, espera hasta 60 s)
- `GET /routines/:id/runs` → `{ id; status: 'RUNNING'|'SUCCEEDED'|'FAILED'; output: string|null; error: string|null; costUsd: number; startedAt; finishedAt: string|null }[]` (últimas 50)

### Flujos (cambios)
- `Workflow` incluye `errorWorkflowId: string | null` (editable en `PATCH`).
- Nodos nuevos: `subworkflow` `{ workflowId, input }` y `loop` `{ items, workflowId, concurrency }`.
- `GET /workflows/:id/versions` → `{ version; createdAt; nodeCount }[]` · `POST /workflows/:id/versions/:version/restore` → flujo
- `POST /workflows/:id/nodes/:nodeId/test` `{ input?, pinned?: Record<nodeId, unknown> }` → `{ ok; output; error: string|null; durationMs }`

## Consecuencias
- Nueva migración: `Skill`, `AgentSkill`, `KnowledgeBase`, `AgentKnowledge`, `KnowledgeDocument`, `KnowledgeChunk`
  (con `tsvector` generado), `AgentExample`, `AgentRoutine`, `RoutineRun`, `WorkflowVersion`; columnas
  `Agent.profile`, `Agent.fallbackModels`, `Workflow.errorWorkflowId`; `UsageSource.ROUTINE`.
- Agentes existentes: perfil vacío ⇒ el prompt compuesto equivale al `systemPrompt` actual.
- Futuro: embeddings + pgvector, ingesta de PDF/Office, evaluación automática de agentes con los ejemplos.

## Plan de implementación
| Tarea | Dueño | Criterio de aceptación |
|---|---|---|
| Esquema y migración (base común) | nexo-architect | Migración aplicada; módulos registrados |
| Perfil, skills, conocimiento, ejemplos, respaldo de modelos, herramientas internas | nexo-backend-ai | Contrato D1–D4; pruebas unitarias de composición y fragmentación |
| Rutinas y prácticas n8n en flujos | nexo-backend-platform | Contrato D5–D6; pruebas del motor (sub-flujo, bucle, error) |
| Estudio de agentes, Skills, Conocimiento, Rutinas | nexo-frontend-ui | Build sin warnings |
| Constructor de flujos: nodos nuevos, versiones, flujo de error, probar nodo, plantillas | nexo-frontend-core | Build sin warnings |
| Verificación integral | orquestador + QA | E2E contra API real |
