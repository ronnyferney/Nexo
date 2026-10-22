# Equipo de agentes de desarrollo de Nexo

Nexo se evoluciona con un equipo de 8 subagentes de Claude Code definidos en `.claude/agents/`.
Todos comparten las reglas de `CLAUDE.md`.

| Agente | Rol | Dueño de |
|---|---|---|
| `nexo-architect` | Arquitecto: diseño, ADRs, plan de trabajo, revisión transversal | `docs/**` (ADRs, arquitectura, roadmap) |
| `nexo-frontend-ui` | Frontend UI/UX | `apps/web/src/app/features/**`, `shared/**`, `styles.scss` |
| `nexo-frontend-core` | Frontend plataforma | `apps/web/src/app/core/**`, rutas, layout, canvas de flujos, build web |
| `nexo-backend-integrations` | Backend integraciones | `modules/connectors/**`, secretos, `common/http`, `common/template` |
| `nexo-backend-ai` | Backend IA | `modules/llm/**`, `modules/agents/**`, `modules/mcp-server/**` |
| `nexo-backend-platform` | Backend plataforma | `modules/workflows/**`, auth, workspaces, Prisma, config, Docker, CI |
| `nexo-qa-api` | QA backend | `*.spec.ts` de la API, `apps/api/test/**` |
| `nexo-qa-e2e` | QA end-to-end | `apps/web/e2e/**` |

Los archivos compartidos (`schema.prisma`, `models.ts`, `template.engine.ts`, CI) se modifican coordinando con su dueño.

## Flujo de trabajo para una capacidad nueva

```
1. nexo-architect        → ADR + contrato de API + plan de tareas con dueños y criterios de aceptación
2. backend-* (paralelo)  → implementación + pruebas unitarias + validación local
3. frontend-* (paralelo) → modelos/ApiService → pantallas → verificación visual
4. qa-api + qa-e2e       → pruebas de integración y recorridos; bugs reportados al dueño
5. dueños                → corrigen; QA re-verifica
6. nexo-architect        → revisión final del diff y actualización de docs/ARCHITECTURE.md
```

Reglas:
- Ningún agente trabaja fuera de su ámbito sin coordinarlo; si lo necesita, lo indica en su resumen.
- Los agentes de QA no modifican código de producción: escriben la prueba que falla y reportan.
- Todo cambio termina con los comandos de validación de su app en verde.
- Bugs: severidad (crítica/alta/media/baja), pasos de reproducción, esperado vs. obtenido, dueño.

## Cómo invocarlos

En Claude Code, dentro del repositorio:

```text
> Usa nexo-architect para diseñar el nodo "loop" que itera sobre listas en los flujos
> Usa nexo-backend-ai para agregar un proveedor OpenAI que implemente LlmProvider
> Usa nexo-qa-api para cubrir el aislamiento multi-tenant de conectores y flujos
```

También pueden lanzarse en paralelo para tareas independientes, por ejemplo: `nexo-backend-platform` implementa el ejecutor
del nodo mientras `nexo-frontend-core` agrega el nodo al catálogo visual, sobre el contrato definido por el arquitecto.

## Backlog inicial sugerido

| Prioridad | Iniciativa | Dueños |
|---|---|---|
| 1 | Suites de QA base: integración API (multi-tenant, roles, SSRF) y Playwright de recorridos críticos | qa-api, qa-e2e |
| 2 | Nodos `loop`/`map` y sub-flujos | architect → backend-platform, frontend-core, frontend-ui |
| 3 | Proveedores LLM adicionales (OpenAI, Gemini, Ollama on-premise) | architect → backend-ai |
| 4 | Multi-agente: agentes como herramientas de otros agentes | architect → backend-ai, frontend-ui |
| 5 | Base de conocimiento (RAG) con pgvector | architect → backend-ai, backend-platform, frontend-ui |
| 6 | Versionado y entornos (dev/qa/prod) de flujos | architect → backend-platform, frontend-core |
| 7 | Observabilidad (OpenTelemetry) y costo por agente | backend-platform, backend-ai, frontend-ui |
| 8 | SSO (OIDC/SAML), invitación de miembros y auditoría | backend-platform, frontend-ui |
