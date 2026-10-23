# 0004. Bucle de mejora supervisada de agentes (feedback, evaluaciones, versiones y optimización)

- **Estado:** Aceptado
- **Fecha:** 2026-10-23
- **Responsables:** nexo-architect
- **Decisiones de negocio confirmadas:** bucle de mejora del agente; calificación con **juez IA + revisión humana**;
  sugerencias automáticas de mejora **con aprobación humana**.

## Contexto
"Entrenar" un agente basado en LLM no es ajustar pesos: es iterar su configuración (perfil, instrucciones, skills,
conocimiento, ejemplos) midiendo calidad de forma objetiva. Se necesita un ciclo repetible y supervisado:

```
 conversar ─▶ calificar/corregir ─▶ revisar (supervisor) ─▶ ejemplos y casos de prueba
     ▲                                                              │
     │                                                              ▼
 publicar la mejor versión ◀── comparar ◀── evaluar (juez IA + humano) ◀── sugerir mejoras (IA, aprobadas por humano)
```

## Decisiones

### D1. Retroalimentación en el chat
- 👍/👎 por respuesta, comentario opcional y **respuesta corregida** opcional (`MessageFeedback`).
- Todo 👎 o corrección entra a la **bandeja de supervisión** (`PENDING`). El supervisor puede:
  `APPROVE` (si hay corrección → crea `AgentExample` y opcionalmente un caso de evaluación), o `DISCARD`.

### D2. Casos y corridas de evaluación
- `EvalCase` por agente: `input`, `expected` (respuesta de referencia, opcional), `criteria` (rúbrica en texto), `tags`.
- `EvalRun`: ejecuta el agente (sin historial, sin herramientas con aprobación humana pendiente) sobre todos los casos
  en la cola `evals` (BullMQ, concurrencia 3) y califica cada salida.
- **Juez IA**: modelo elegido en la corrida (`judgeProviderId`, `judgeModel`, del catálogo). Recibe entrada, esperado,
  criterios y salida; responde JSON `{ score: 0..1, passed: boolean, reasoning }`. Umbral de aprobación por corrida
  (`passThreshold`, por defecto 0.7).
- **Revisión humana**: `needsReview = true` si el puntaje está en la zona dudosa (0.4–0.8) o el juez no devolvió JSON
  válido. El supervisor puede fijar `humanScore`/`humanNote`; el puntaje efectivo es el humano cuando existe.
- Costos: tanto el agente como el juez se miden con `source: EVAL` y se imputan al centro de costo del agente
  (gobierno de costos ADR 0002, incluido el bloqueo por presupuesto).

### D3. Versiones del agente
- `AgentVersion`: instantánea de la configuración (`provider`, `model`, `effort`, `maxTurns`, `systemPrompt`, `profile`,
  `fallbackModels`, `skillIds`, `knowledgeBaseIds`, ejemplos) con nota y autor.
- Se crea al pulsar "Guardar versión", al aplicar una sugerencia y antes de restaurar otra.
- Cada `EvalRun` registra la versión evaluada; "**Publicar**" una versión restaura su instantánea en el agente.

### D4. Sugerencias de mejora (optimización asistida)
- A partir de una corrida, la IA analiza los casos fallidos y propone cambios a `profile` y `systemPrompt`
  (`PromptSuggestion`: propuesta + justificación). Nunca se aplican solas: el supervisor revisa el diff y decide.
- Aplicar: crea versión previa, actualiza el agente y queda listo para re-evaluar. Meta configurable por agente
  (`Agent.targetScore`, por defecto 0.85) para indicar cuándo el ciclo alcanzó el objetivo.

## Contrato de API (rutas bajo `/api`; escritura EDITOR+, supervisión y aplicación de sugerencias ADMIN+ o EDITOR según se indique)
- `POST /agents/:id/feedback` `{ conversationId?, userMessage, agentResponse, rating: 'UP'|'DOWN', comment?, correction? }` (cualquier rol con acceso al chat)
- `GET /agents/:id/feedback?status=PENDING|APPROVED|DISCARDED` y `GET /feedback?status=` (bandeja del workspace)
  → `{ id; agentId; agentName; userMessage; agentResponse; rating; comment; correction; status; createdAt; reviewedAt }[]`
- `POST /feedback/:id/review` `{ action: 'APPROVE'|'DISCARD', correction?, addAsEvalCase?: boolean }` (EDITOR+)
- `GET|POST /agents/:id/eval-cases` `{ input, expected?, criteria?, tags? }` · `PATCH|DELETE /eval-cases/:id`
- `POST /agents/:id/eval-runs` `{ judgeProviderId, judgeModel, passThreshold?, versionNote? }` → `EvalRun` (encolada)
- `GET /agents/:id/eval-runs` → `{ id; status: 'QUEUED'|'RUNNING'|'SUCCEEDED'|'FAILED'; versionId; version: number|null; score: number|null; passed; total; costUsd; judgeModel; createdAt; finishedAt }[]`
- `GET /eval-runs/:id` → corrida + `results: { id; caseId; input; expected; output; score; passed; reasoning; needsReview; humanScore; humanNote; effectiveScore }[]`
- `PATCH /eval-results/:id` `{ humanScore, humanNote? }` (EDITOR+)
- `GET /agents/:id/versions` → `{ id; version; note; createdAt; createdByName; bestScore: number|null }[]`
- `POST /agents/:id/versions` `{ note? }` · `POST /agents/:id/versions/:versionId/publish`
- `POST /eval-runs/:id/suggestions` `{ providerId, model }` → `PromptSuggestion`
- `GET /agents/:id/suggestions` → `{ id; runId; status: 'PENDING'|'APPLIED'|'REJECTED'; rationale; proposal: { systemPrompt?: string; profile?: Profile }; createdAt }[]`
- `POST /suggestions/:id/apply` · `POST /suggestions/:id/reject` (EDITOR+)
- `GET /agents/:id/training-summary` → `{ targetScore; latestScore; bestScore; bestVersion; runs: { id; version; score; createdAt }[]; pendingFeedback; evalCases; examples }`
- `Agent` agrega `targetScore: number` (editable).

## Consecuencias
- Migración: `MessageFeedback`, `EvalCase`, `EvalRun`, `EvalResult`, `AgentVersion`, `PromptSuggestion`;
  `Agent.targetScore`; `UsageSource.EVAL`.
- Las evaluaciones consumen tokens (agente + juez): se informa el costo por corrida y se aplica el presupuesto.
- La calidad del juez depende del modelo elegido; se recomienda un modelo PREMIUM como juez y revisión humana de la zona dudosa.
- Futuro: evaluación automática en CI al cambiar un agente, comparación A/B en producción, muestreo de conversaciones reales.

## Plan
| Tarea | Dueño |
|---|---|
| Esquema y migración | orquestador |
| Feedback, evaluaciones, juez, versiones, sugerencias, cola `evals` | nexo-backend-ai |
| Pestaña "Entrenamiento" (ciclo, casos, corridas, comparación, sugerencias), bandeja de supervisión, 👍/👎 en el chat | nexo-frontend-ui |
| E2E del ciclo completo con MockDriver como agente y juez | nexo-qa-api |
