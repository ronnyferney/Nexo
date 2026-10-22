# Arquitectura de Nexo

## Vista general

```
             ┌──────────────┐         ┌───────────────────────────────────────────┐
 Usuarios ──▶│  Angular SPA │──/api──▶│ API NestJS (stateless, N réplicas)        │
             └──────────────┘         │  auth · connectors · agents · workflows   │
 Clientes MCP ───────── /api/mcp ────▶│  mcp-server · webhooks (/api/hooks/:token)│
 Sistemas externos ─── webhooks ─────▶└──────────┬───────────────┬────────────────┘
                                                 │ Prisma        │ BullMQ (Redis)
                                            ┌────▼────┐     ┌────▼─────────────┐
                                            │Postgres │◀────│ Workers (N)      │
                                            └─────────┘     │ motor de flujos  │
                                                            └────┬─────────────┘
                                         REST · SOAP · GraphQL · MCP · LLM (Claude)
```

## Principios

1. **Módulos por dominio** (`connectors`, `agents`, `workflows`…). Cada módulo expone servicios; los controladores solo traducen HTTP.
2. **Puertos y adaptadores** donde el sistema toca el exterior:
   - `ConnectorAdapter` → `RestAdapter`, `SoapAdapter`, `GraphqlAdapter`, `McpAdapter`. Un protocolo nuevo es una clase nueva registrada en `ConnectorsModule`.
   - `LlmProvider` → `AnthropicProvider`, `MockProvider`. Agregar OpenAI, Gemini u Ollama no toca agentes ni flujos.
   - `NodeExecutor` → un ejecutor por tipo de nodo. El `WorkflowEngine` es TypeScript puro, sin Nest ni base de datos, y se prueba de forma aislada.
3. **API sin estado + workers**: la API encola ejecuciones; los workers (BullMQ) las procesan. Ambos escalan horizontalmente. `WORKER_ENABLED=false` separa los roles.
4. **Seguridad por defecto**: secretos cifrados (AES-256-GCM), API keys guardadas como hash SHA-256, protección SSRF en todas las llamadas salientes, plantillas sin `eval` y con bloqueo de `__proto__`, validación estricta de DTO, rate limiting, helmet, logs con datos sensibles redactados.
5. **Multi-tenant**: toda consulta filtra por `workspaceId`, tomado del token y nunca del cliente.

## Motor de flujos

- El grafo debe ser un DAG con un único disparador (`workflow.validator.ts`).
- La ejecución avanza por oleadas: un nodo está listo cuando todos sus predecesores se resolvieron. Los nodos listos se ejecutan en paralelo.
- Una arista está activa si su origen terminó y, en nodos condición, si la rama (`sourceHandle`) coincide. Un nodo sin aristas entrantes activas se **omite** y la omisión se propaga, de modo que las ramas se unen sin lógica especial.
- Reintentos con backoff exponencial (máx. 5), `onError: continue` y cancelación cooperativa.
- La bitácora (`steps`) se persiste en cada transición, así la UI muestra el progreso en vivo.

## Agentes

- `AgentRuntimeService` arma las tools desde las operaciones asignadas (`<conector>__<operación>`) y delega el bucle al proveedor.
- `AnthropicProvider` ejecuta el bucle de tool use con streaming, thinking adaptativo, `effort` configurable, ejecución paralela de tools y fallback del lado del servidor ante rechazos por política.
- El historial se guarda **en formato nativo del proveedor y solo se agrega al final** (los bloques de razonamiento se devuelven sin modificar).
- La aprobación humana se resuelve en el runtime: si la tool la requiere y el usuario no la aprobó, el modelo recibe un resultado que le pide solicitar autorización.

## MCP

- **Cliente**: `McpAdapter` mantiene un pool de sesiones por conector (cierre por inactividad, reconexión automática) y convierte las tools remotas en operaciones.
- **Servidor**: `/api/mcp` (Streamable HTTP sin estado). Por cada solicitud se construye un `McpServer` con los agentes y flujos activos del workspace autenticado por API key.

## Gobierno de IA (ADR 0002)

- `LlmGatewayService` resuelve `Agent.provider` (conexión de sistema `anthropic`/`mock` o `LlmConnection`) y `Agent.model`
  a un cliente (`LlmDriver` por tipo: Anthropic, OpenAI-compatible, Mock) con su tarifa.
- `AgentRuntimeService` aplica, en orden: centro de costo (`OrgService.resolveCostCenter`), decisión previa
  (`BudgetsService.plan`: modelos permitidos, bloqueo o degradación), control antes de cada turno (`assertCanSpend`)
  y registro por turno (`record`: `UsageRecord` + incremento atómico del libro mayor en toda la cadena + alertas).
- La lógica de decisión vive en funciones puras (`governance/budget-policy.ts`) con pruebas unitarias.

## Evolución sugerida

- Proveedor Bedrock y notificaciones de alertas por correo/Slack.
- Nodos `loop`/`map` para iterar listas y sub-flujos.
- Agentes como herramientas de otros agentes (multi-agente).
- Versionado y despliegue por entornos (dev/qa/prod) de flujos.
- Base de conocimiento (RAG) con pgvector.
- Observabilidad con OpenTelemetry y métricas de costo por agente.
- SSO (SAML/OIDC) y auditoría.
