# Nexo — Plataforma de Agentes de IA y Automatización

Nexo permite **crear agentes de IA conectados a cualquier sistema** de la empresa y **orquestar flujos de automatización** entre ellos. Integra APIs **REST**, web services **SOAP**, **GraphQL** y servidores **MCP** (Model Context Protocol), y a la vez **expone sus propios agentes y flujos como servidor MCP** para Claude, IDEs y otros agentes.

| Capa | Tecnología |
|---|---|
| Frontend | Angular 20 (standalone, signals, control flow, lazy loading) |
| Backend | NestJS 11 · arquitectura modular / hexagonal (puertos y adaptadores) |
| Datos | PostgreSQL 16 + Prisma ORM |
| Colas | Redis 7 + BullMQ (workers escalables horizontalmente, cron) |
| IA | Claude (Anthropic SDK) con tool use, streaming y thinking adaptativo; proveedores enchufables |
| Protocolos | REST/OpenAPI · SOAP 1.1/1.2/WSDL · GraphQL · MCP (cliente y servidor) |

## Capacidades

**Conectores**
- REST con importación automática desde **OpenAPI 3**; SOAP con importación desde **WSDL**; GraphQL; **MCP** (Streamable HTTP / SSE) con descubrimiento de tools.
- Autenticación declarativa: API key, Bearer, Basic, **OAuth2 client credentials** (con caché de token).
- **Bóveda de secretos** cifrada (AES-256-GCM) referenciable como `{{ secrets.NOMBRE }}`.
- Validación de entrada con JSON Schema (Ajv), timeouts, límite de tamaño y **protección SSRF**.
- Playground para probar cada operación.

**Agentes de IA**
- Instrucciones, modelo, nivel de esfuerzo y máximo de turnos por agente.
- Cada operación de conector se convierte en una **herramienta** del agente; ejecución en paralelo.
- **Aprobación humana** (human-in-the-loop) por herramienta.
- Chat con **streaming SSE**, trazas en vivo de cada herramienta y conversaciones persistidas.
- Proveedor `mock` para desarrollo y pruebas sin credenciales.

**Flujos de automatización**
- Constructor visual (drag & drop, zoom, conexiones) con nodos: disparador, conector, agente IA, condición, transformación, espera y respuesta.
- Motor DAG con **ramas condicionales, paralelismo, reintentos con backoff** y `onError: continue`.
- Plantillas seguras (sin `eval`): `{{ nodes.crm.output.data.name | upper }}`.
- Disparadores: **manual, webhook** (con respuesta síncrona `?wait=true`), **cron** y **MCP**.
- Historial de ejecuciones con bitácora por nodo (entrada, salida, error, intentos), cancelación y re-ejecución.

**Gobierno de IA y costos** (consola de administración)
- **Múltiples LLM**: conexiones Anthropic, OpenAI-compatibles (OpenAI, Azure, Ollama, vLLM, Gemini compatible, gateways) y simuladas, con catálogo de modelos y tarifas configurables.
- **Unidades corporativas** en árbol, miembros asignados a unidades y centro de costo por agente.
- **Bolsas de presupuesto en USD** por unidad (mensual, trimestral, anual), jerárquicas: el consumo descuenta de la unidad y de todos sus ancestros.
- Políticas al agotarse: **bloquear** (HTTP 402), **degradar** a un modelo económico o **solo alertar**; alertas por umbral (50/80/100 %).
- Control **antes de cada llamada** al modelo y medición exacta por turno (tokens de entrada, salida y caché).
- Modelos permitidos por unidad, caché automática de prompts y reportes por unidad, modelo, agente, usuario y día.
- Portal de usuarios con **Mi consumo**: presupuesto disponible y gasto propio.

**Plataforma**
- Multi-tenant por workspace, roles (OWNER, ADMIN, EDITOR, VIEWER), JWT + API keys.
- **Servidor MCP** en `/api/mcp`: cada agente y flujo activo se publica como tool.
- OpenAPI/Swagger en `/api/docs`, health checks, logs estructurados (pino), rate limiting, helmet.

## Inicio rápido (desarrollo)

Requisitos: Node 22+, PostgreSQL 16, Redis 7 (o Docker).

```bash
# 1. Infraestructura
docker compose up -d postgres redis

# 2. API
cd apps/api
cp .env.example .env            # complete JWT_SECRET, ENCRYPTION_KEY (openssl rand -hex 32) y ANTHROPIC_API_KEY
npm install
npx prisma migrate dev
npm run start:dev               # http://localhost:3000/api  ·  Swagger: /api/docs

# 3. Web (otra terminal)
cd apps/web
npm install
npm start                       # http://localhost:4200 (proxy /api -> :3000)
```

## Despliegue con Docker

```bash
cp .env.example .env    # defina JWT_SECRET, ENCRYPTION_KEY, ANTHROPIC_API_KEY
docker compose up -d --build
docker compose up -d --scale worker=3   # más capacidad de ejecución de flujos
```

Web en `http://localhost:8080`. La API y los workers comparten imagen; `WORKER_ENABLED` decide el rol.

## Conectar un cliente MCP a Nexo

Cree una API key en **Configuración** y agregue a su cliente MCP:

```json
{
  "mcpServers": {
    "nexo": {
      "type": "http",
      "url": "https://su-dominio/api/mcp",
      "headers": { "Authorization": "Bearer nexo_..." }
    }
  }
}
```

## Disparar un flujo por webhook

```bash
curl -X POST "https://su-dominio/api/hooks/<token>?wait=true" \
  -H "content-type: application/json" -d '{"customerId":"42"}'
```

## Estructura

```
apps/
  api/                    NestJS
    prisma/               esquema y migraciones
    src/
      common/             crypto, guards, plantillas, cliente HTTP seguro, filtros
      config/             configuración y validación de entorno
      infrastructure/     Prisma
      modules/
        auth/             registro, login, JWT, cambio de workspace
        workspaces/       secretos, API keys, métricas
        connectors/       dominio + adaptadores REST, SOAP, GraphQL, MCP
        llm/              puerto LlmProvider + Anthropic + Mock
        agents/           runtime de agentes, chat SSE, conversaciones
        workflows/        motor DAG, ejecutores de nodos, cola BullMQ, webhooks, cron
        mcp-server/       Nexo como servidor MCP
  web/                    Angular
    src/app/
      core/               API tipada, autenticación, interceptores, guards
      layout/             shell con navegación
      shared/             componentes reutilizables
      features/           dashboard, agents, connectors, workflows, executions, settings
docs/ARCHITECTURE.md      decisiones de arquitectura
```

## Calidad

```bash
cd apps/api && npm run typecheck && npm run lint && npm test
cd apps/web && npm run build
```

Más detalle en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).



## Equipo de agentes de desarrollo

El repositorio incluye 8 subagentes de Claude Code en `.claude/agents/` (1 arquitecto, 2 frontend, 3 backend y 2 QA) con ámbitos, convenciones y criterios de terminado. Ver [docs/AGENTS-TEAM.md](docs/AGENTS-TEAM.md).
