# Nexo — Plataforma de Agentes de IA y Automatización

Nexo permite **crear agentes de IA conectados a cualquier sistema** de la empresa y **orquestar flujos de automatización** entre ellos. Integra APIs **REST**, web services **SOAP**, **GraphQL**, servidores **MCP** (Model Context Protocol) y **bases de datos** (directas o en redes privadas vía **Nexo Edge**), y a la vez **expone sus agentes lanzados y flujos activos como servidor MCP** para Claude, IDEs y otros agentes.

| Capa | Tecnología |
|---|---|
| Frontend | Angular 20 (standalone, signals, control flow, lazy loading) |
| Backend | NestJS 11 · arquitectura modular / hexagonal (puertos y adaptadores) |
| Datos | PostgreSQL 16 + Prisma ORM |
| Colas | Redis 7 + BullMQ (workers escalables horizontalmente, cron) |
| IA | Claude (Anthropic SDK) con tool use, streaming y thinking adaptativo; proveedores enchufables |
| Protocolos | REST/OpenAPI · SOAP 1.1/1.2/WSDL · GraphQL · MCP (cliente y servidor) · SQL (PostgreSQL, MySQL, SQL Server) |

## Capacidades

**Conectores**
- REST con importación automática desde **OpenAPI 3**; SOAP con importación desde **WSDL**; GraphQL; **MCP** (Streamable HTTP / SSE) con descubrimiento de tools.
- Autenticación declarativa: API key, Bearer, Basic, **OAuth2 client credentials** (con caché de token) y **OAuth2 de
  usuario** (authorization code + PKCE, tokens cifrados con renovación automática; app OAuth de la plataforma o propia).
- **Catálogo de integraciones** instalables con un clic (credenciales a la bóveda, operaciones prediseñadas para agentes):
  Lusha (MCP y API REST), HubSpot CRM, LinkedIn, Salesforce, Pipedrive, Google Sheets, Gmail (envío), Gmail (bandeja y
  respuestas), Google Calendar, Google Meet, Microsoft 365 Outlook, Microsoft 365 Correo (bandeja), Calendario
  corporativo (Microsoft 365), Microsoft To Do, Microsoft Planner, Microsoft Teams, WhatsApp Business (Cloud API) y Slack;
  con skills comerciales de apoyo.
- **Bases de datos** PostgreSQL, MySQL y SQL Server con consultas declaradas y parámetros enlazados (sin SQL libre),
  solo lectura por defecto y descubrimiento de esquema. En la nube del cliente en modo directo; en red privada con
  **Nexo Edge** (`apps/edge`), que se conecta hacia afuera por WSS y guarda las credenciales en la red del cliente.
- **Bóveda de secretos** cifrada (AES-256-GCM) referenciable como `{{ secrets.NOMBRE }}`.
- Validación de entrada con JSON Schema (Ajv), timeouts, límite de tamaño y **protección SSRF**.
- Playground para probar cada operación.

**Agentes de IA**
- Instrucciones, modelo, nivel de esfuerzo y máximo de turnos por agente.
- Cada operación de conector se convierte en una **herramienta** del agente; ejecución en paralelo.
- **Aprobación humana** (human-in-the-loop) por herramienta.
- Chat con **streaming SSE**, trazas en vivo de cada herramienta y conversaciones persistidas.
- Proveedor `mock` para desarrollo y pruebas sin credenciales.
- **Visibilidad**: Personal (por defecto), Equipo (compartido con personas, unidades o **grupos de usuarios** con permiso
  de uso o edición) o Empresa; conversaciones privadas por usuario; transferir, duplicar y **Explorar agentes**.
- **Salud del agente** (puntaje 0–100 sin costo de IA) y **lanzamiento** con garantía de calidad: salud ≥ 70 y
  evaluación ≥ meta (o excepción de un ADMIN). Solo los agentes lanzados pasan a Empresa y se publican por MCP.

**Nexo Copilot**
- Arquitecto de agentes integrado: entrevista al crear un agente, panel lateral para mejorar y diagnosticar, y
  **propuestas con diff** que el usuario aplica (nunca modifica nada por sí solo).
- Costo a cargo de Nexo con cupo mensual por workspace (`COPILOT_MONTHLY_QUOTA_USD`, por defecto 2 USD).

**Flujos de automatización**
- Constructor visual (drag & drop, zoom, conexiones) con nodos: disparador, conector, agente IA, condición, transformación, espera y respuesta.
- Motor DAG con **ramas condicionales, paralelismo, reintentos con backoff** y `onError: continue`.
- Plantillas seguras (sin `eval`): `{{ nodes.crm.output.data.name | upper }}`.
- Disparadores: **manual, webhook** (con respuesta síncrona `?wait=true`), **cron** y **MCP**.
- Historial de ejecuciones con bitácora por nodo (entrada, salida, error, intentos), cancelación y re-ejecución.
- Prácticas de n8n: **flujo de error**, **sub-flujos**, **bucles** sobre listas, **historial de versiones**, **probar un nodo** con datos fijados, plantillas y retención de ejecuciones.

**Estudio de agentes y entrenamiento supervisado**
- Agentes **agnósticos al modelo** con cadena de **modelos de respaldo**.
- **Perfil estructurado**: rol, objetivos, responsabilidades, límites, tono, formato e idioma; vista previa del prompt exacto.
- **Skills** reutilizables cargadas bajo demanda y **bases de conocimiento** (texto, URL, archivos) con búsqueda full-text.
- **Rutinas** programadas por agente (cron, zona horaria, historial con costo, aviso por webhook).
- **Bucle de mejora supervisada**: 👍/👎 y correcciones en el chat → bandeja de supervisión → ejemplos y casos de prueba →
  evaluaciones con **juez IA + revisión humana** → sugerencias de mejora aprobadas por humanos → **versiones** comparadas
  por puntaje y publicación de la mejor, hasta alcanzar la meta de calidad.

**Gobierno de IA y costos** (consola de administración)
- **Múltiples LLM**: conexiones Anthropic, OpenAI-compatibles (OpenAI, Azure, Ollama, vLLM, Gemini compatible, gateways) y simuladas, con catálogo de modelos y tarifas configurables.
- **Unidades corporativas** en árbol, miembros asignados a unidades y centro de costo por agente.
- **Bolsas de presupuesto en USD** por unidad (mensual, trimestral, anual), jerárquicas: el consumo descuenta de la unidad y de todos sus ancestros.
- Políticas al agotarse: **bloquear** (HTTP 402), **degradar** a un modelo económico o **solo alertar**; alertas por umbral (50/80/100 %).
- Control **antes de cada llamada** al modelo y medición exacta por turno (tokens de entrada, salida y caché).
- Modelos permitidos por unidad, caché automática de prompts y reportes por unidad, modelo, agente, usuario y día.
- Portal de usuarios con **Mi consumo**: presupuesto disponible y gasto propio.

**Plataforma**
- Multi-tenant por workspace, roles (OWNER, ADMIN, EDITOR, VIEWER), JWT + API keys; grupos de usuarios administrados en
  la consola.
- **Servidor MCP** en `/api/mcp`: cada agente de Empresa lanzado y cada flujo activo se publica como tool.
- **Usuario maestro** de primer arranque: con `BOOTSTRAP_ADMIN_EMAIL` y `BOOTSTRAP_ADMIN_PASSWORD` (≥ 12 caracteres) se
  crea un OWNER del workspace inicial si aún no existe.
- **Consola de plataforma** (administradores de Nexo en `PLATFORM_ADMIN_EMAILS`): éxito de clientes y calidad del Copilot.
- OpenAPI/Swagger en `/api/docs`, health checks (`/api/health`, versión en `/api/health/version`), logs estructurados
  (pino), rate limiting, helmet.
- La protección de datos sensibles hacia los modelos (ADR 0008) está decidida pero **aún no implementada**.

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

## Publicación y despliegue

Versiones semánticas con CHANGELOG generado desde los commits; la etiqueta `vX.Y.Z` ejecuta `release.yml` (CI completo,
imágenes inmutables `nexo-api`, `nexo-web` y `nexo-edge` en GHCR y GitHub Release) y `deploy-aws.yml` despliega en AWS
una versión publicada (sin reconstruir) y la verifica con `/api/health/version`. Guía: [docs/release.md](docs/release.md) · AWS: [docs/deploy-aws.md](docs/deploy-aws.md).

```bash
npm run release:dry      # versión y notas calculadas
npm run release && git push --follow-tags origin HEAD
```

## Conectar un cliente MCP a Nexo

Cree una API key en **Administración → Seguridad** y agregue a su cliente MCP. Se publican como tools los agentes con
visibilidad Empresa y lanzados (`agent_*`) y los flujos activos (`workflow_*`):

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
        auth/             registro, login, JWT, cambio de workspace, usuario maestro
        workspaces/       secretos, API keys, métricas, ajustes del workspace
        connectors/       dominio + adaptadores REST, SOAP, GraphQL, MCP, DATABASE + catálogo de integraciones
        oauth/            OAuth2 de usuario (authorization code + PKCE) para conectores
        edge/             Nexo Edge: administración, gateway WebSocket, enrutamiento por Redis
        llm/              puerto LlmDriver (Anthropic, OpenAI-compatible, Mock) + LlmGatewayService
        governance/       unidades, presupuestos, alertas y consumo
        agents/           runtime de agentes, prompt compuesto, chat SSE, conversaciones
        agent-access/     permisos y shares de agentes, salud del agente
        groups/           grupos de usuarios
        skills/           skills reutilizables
        knowledge/        bases de conocimiento y búsqueda full-text
        routines/         rutinas programadas por agente
        training/         feedback, evaluaciones, versiones y sugerencias
        copilot/          Nexo Copilot y consola de plataforma
        workflows/        motor DAG, ejecutores de nodos, cola BullMQ, webhooks, cron
        mcp-server/       Nexo como servidor MCP
        health/           salud y versión desplegada
  edge/                   Nexo Edge (agente on-premise para bases de datos privadas)
  web/                    Angular
    src/app/
      core/               API tipada, autenticación, interceptores, guards
      layout/             shell con navegación (portal, administración, plataforma)
      shared/             componentes reutilizables
      features/           dashboard, agents, copilot, skills, knowledge, routines, supervision, workflows,
                          executions, integrations, connectors, usage, account, admin, platform, auth
infra/                    AWS CDK (registro ECR, piloto, rol OIDC)
docs/ARCHITECTURE.md      arquitectura actual · docs/adr/ decisiones
```

## Calidad

```bash
cd apps/api && npm run typecheck && npm run lint && npm test
cd apps/web && npm run build
```

Más detalle en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).



## Equipo de agentes de desarrollo

El repositorio incluye 8 subagentes de Claude Code en `.claude/agents/` (1 arquitecto, 2 frontend, 3 backend y 2 QA) con ámbitos, convenciones y criterios de terminado. Ver [docs/AGENTS-TEAM.md](docs/AGENTS-TEAM.md).
