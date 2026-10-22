# 0001. Arquitectura base de Nexo

- **Estado:** Aceptado
- **Fecha:** 2026-10-22
- **Responsables:** nexo-architect

## Contexto
Nexo necesita conectar agentes de IA con sistemas empresariales heterogéneos (REST, SOAP, GraphQL, MCP), orquestar flujos
de automatización y escalar con múltiples clientes, con un equipo que evoluciona el producto en paralelo.

## Alternativas consideradas
1. **Microservicios desde el inicio** — aislamiento fuerte, pero alto costo operativo y de coordinación prematuro.
2. **Monolito modular NestJS + workers BullMQ** — un solo despliegue con módulos por dominio y puertos/adaptadores; escala por réplicas de API y workers.
3. **Plataforma no-code existente embebida** — rápida, pero limita diferenciación y control de seguridad.

## Decisión
Opción 2: monolito modular (NestJS 11, PostgreSQL + Prisma, Redis + BullMQ) con frontend Angular 20. Puertos de extensión:
`ConnectorAdapter`, `LlmProvider` y `NodeExecutor`. Multi-tenant por `workspaceId`. Nexo actúa como cliente y como servidor MCP.

## Consecuencias
- Los módulos pueden extraerse a servicios si un dominio lo exige (por ejemplo, workers de flujos ya están separados por `WORKER_ENABLED`).
- Nuevos protocolos, proveedores de IA y tipos de nodo se agregan sin modificar el núcleo.
- Las definiciones de flujos son JSON versionado: cambios de forma requieren migración de datos.
