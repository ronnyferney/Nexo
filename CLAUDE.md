# Nexo — Guía para agentes de desarrollo

Plataforma de agentes de IA, conectores (REST, SOAP, GraphQL, MCP) y flujos de automatización.
Monorepo: `apps/api` (NestJS 11 + Prisma + BullMQ) y `apps/web` (Angular 20). Arquitectura en `docs/ARCHITECTURE.md`,
decisiones en `docs/adr/`, equipo y propiedad de código en `docs/AGENTS-TEAM.md`.

## Comandos

```bash
# Infraestructura local
docker compose up -d postgres redis          # o servicios locales equivalentes

# API (apps/api)
npm run typecheck && npm run lint && npm test && npm run build
npx prisma migrate dev --name <cambio>       # toda modificación de schema.prisma lleva migración
npm run start:dev                            # http://localhost:3000/api · Swagger /api/docs

# Web (apps/web)
npm run build                                # debe compilar sin errores ni warnings NG8113
npm start                                    # http://localhost:4200 (proxy /api -> :3000)
```

## Reglas comunes

- **Idioma:** textos de UI, mensajes de error, comentarios y documentación en español. Identificadores de código en inglés.
- **Multi-tenant:** toda consulta Prisma filtra por `workspaceId`, tomado de `@CurrentAuth()`, nunca del cuerpo de la petición.
- **Autorización:** endpoints que modifican datos llevan `@MinRole('EDITOR')` (o superior). Endpoints públicos solo con `@Public()` y throttling.
- **Seguridad:** credenciales solo en la bóveda (`{{ secrets.NOMBRE }}`); toda llamada saliente pasa por `HttpClientService` (SSRF, timeout, tamaño); nada de `eval`/`new Function`; plantillas solo con `common/template/template.engine.ts`.
- **Extensibilidad:** protocolos nuevos = nuevo `ConnectorAdapter`; proveedores LLM nuevos = nuevo `LlmProvider`; nodos nuevos = nuevo `NodeExecutor` + validador + catálogo en la web. No agregar `if (type === ...)` dispersos.
- **LLM:** modelo por defecto `claude-opus-5-5`; historial de conversación append-only en formato nativo del proveedor.
- **Estilo API:** Prettier (`printWidth: 120`, comillas simples), DTO con `class-validator`, `import type` para tipos.
- **Estilo Web:** componentes standalone, `ChangeDetectionStrategy.OnPush`, signals, `inject()`, control flow `@if/@for`, clases del design system de `src/styles.scss`. Llaves literales `{{ }}` en plantillas Angular con el pipe `tpl`.
- **Calidad:** ningún cambio se da por terminado sin ejecutar los comandos de validación de la app tocada. Cada bug corregido lleva una prueba que lo reproduce.
- **Migraciones Prisma:** la columna generada `KnowledgeChunk.search` (tsvector), su índice GIN `KnowledgeChunk_search_idx` y el índice parcial `OrgUnit_root_per_workspace` se crean con SQL manual que Prisma no modela. Tras `prisma migrate dev --create-only`, **elimina del SQL generado cualquier `DROP INDEX`/`ALTER COLUMN "search"` sobre ellos** antes de aplicar. Nunca edites una migración ya aplicada.
- **Git:** commits pequeños en español con prefijo convencional (`feat:`, `fix:`, `perf:`, `refactor:`, `test:`, `docs:`,
  `chore:`); `tipo!:` o `BREAKING CHANGE:` para cambios incompatibles. Los prefijos deciden la versión (`docs/release.md`).
- **Versiones:** no edites a mano las versiones de los `package.json` ni el CHANGELOG fuera de `scripts/release.mjs`; el
  despliegue solo usa versiones publicadas.

## Navegación de la web (modelo del menú, acordado con el patrocinador)

El «chrome» vive en `apps/web/src/app/layout/` (`shell`, `sidebar`, `topbar`, `layout.service`); la info del menú en
`sidebar.util.ts`. Convenciones a respetar (no reintroducir patrones anteriores):

- **Menú lateral = una sola columna con NOMBRES** (icono + nombre), azul oscuro corporativo. Por defecto **sin submenús**.
- **Submenú al pulsar**: al hacer clic en un menú con hijos, la columna se contrae a un riel de iconos y aparece su
  **submenú** a la derecha (mismo azul oscuro del menú) con botón «volver». Los menús de un solo destino solo navegan.
- **Utilidades al pie**: «Conecta tus apps», «Conecta tu IA» y «Ajustes» van ancladas al PIE del menú, separadas por una
  línea; el resto de la configuración vive en el hub `/ajustes`.
- **Ajustes** (`/ajustes`): espacio propio con su barra lateral (buscador + secciones) a ras y de altura completa; su
  barra va en **blanco** (excepción deliberada del patrocinador, no la unifiques a oscuro). Reusa las páginas existentes
  como rutas hijas.
- **Un solo botón de colapsar**, en la cabecera del menú lateral (no en el toolbar). El **menú de usuario** vive en el
  **toolbar** (arriba-derecha), no en el riel. El título del toolbar NO es `h1` (el `h1` lo pone el `PageHeader`).
- El estado de colapso se comparte vía `LayoutService`; en `/ajustes` el panel del menú se oculta (barra propia).
- Validar siempre con `npm run build` + `npm run test:ci` (Karma necesita `CHROME_BIN`). El dev server (`ng serve`) cachea
  errores viejos: el build de producción es la referencia; si hay overlay de Vite, limpiar `.angular/cache` y reiniciar.

## Preferencias del patrocinador (gobierno)

- Distinguir 4 tipos de autorización —**construir / acceso / gasto / activación productiva**—; una no implica las otras.
  No contratar, habilitar gasto, ampliar permisos ni activar producción por suposición. Credenciales solo por medio
  seguro (bóveda), nunca por chat. No registrar recomendaciones como aprobaciones.
- Trato: «usted»; reportar por punto (avance, evidencia, pendiente, siguiente acción) cuando se pida estado.
