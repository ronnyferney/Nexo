# 0007. Visibilidad y permisos de agentes (personal, equipo, empresa)

- **Estado:** Aceptado
- **Fecha:** 2026-10-23
- **Responsables:** nexo-architect

## Contexto
Hoy cualquier EDITOR ve y modifica todos los agentes del workspace y las conversaciones de un agente son visibles para
quien abra el agente. Los usuarios quieren agentes **personales** y agentes **compartidos**. Se requiere un modelo de
visibilidad y permisos que proteja la privacidad y mantenga el gobierno de la empresa.

## Decisiones

### D1. Niveles de visibilidad (`Agent.visibility`)
- `PRIVATE` (Personal): solo el dueño.
- `TEAM` (Equipo): unidades corporativas (incluye sus subunidades) y/o personas compartidas explícitamente.
- `WORKSPACE` (Empresa): todos los miembros del workspace.
- Fase 2 (fuera de alcance): `EXTERNAL` (enlace público / widget), con su propio análisis de abuso y costos.
- Nuevos agentes: `PRIVATE` por defecto. Agentes existentes: migran a `WORKSPACE` con dueño = primer OWNER del workspace.

### D2. Permisos por agente
- `Agent.ownerId` (dueño) + `AgentShare { agentId, principalType: USER|UNIT, principalId, permission: USE|EDIT }`.
- Permiso efectivo de un usuario sobre un agente:
  - **EDIT**: dueño; ADMIN/OWNER del workspace (gobierno); usuarios/unidades con share EDIT.
  - **USE** (conversar, usar en flujos, ver configuración no sensible): lo anterior + share USE + visibilidad WORKSPACE
    para cualquier miembro + visibilidad TEAM para miembros de las unidades compartidas.
  - ADMIN/OWNER **siempre** ven la configuración, el costo y la salud de todos los agentes (gobierno), pero **no** el
    contenido de conversaciones ajenas.
- Las escrituras sobre el agente (perfil, herramientas, skills, conocimiento, ejemplos, rutinas, entrenamiento,
  versiones) requieren EDIT; el rol de workspace sigue aplicando como tope (un VIEWER solo puede editar sus agentes PRIVATE).
- Se elimina el acceso por rol de workspace "EDITOR edita todo": ahora EDITOR significa "puede crear y compartir".

### D3. Creación y alcance
- Cualquier miembro (incluido VIEWER) puede crear agentes `PRIVATE` si `Workspace.allowPersonalAgents` (por defecto `true`;
  editable por ADMIN). Crear o pasar a `TEAM`/`WORKSPACE` requiere rol EDITOR+.
- Pasar a `WORKSPACE` exige `launchStatus = LAUNCHED` (ADR 0006: salud ≥ 70 y evaluación ≥ meta, o override de ADMIN).
- `POST /agents/:id/transfer` `{ userId }` transfiere la propiedad (dueño o ADMIN). Al retirar un miembro, sus agentes
  pasan al ADMIN que lo retira (sin cambiar su visibilidad) y se registra en la respuesta.
- `POST /agents/:id/duplicate` `{ name? }` crea una copia `PRIVATE` del usuario (perfil, modelo, herramientas, skills,
  conocimiento y ejemplos; sin conversaciones, evaluaciones ni rutinas) — requiere USE.

### D4. Conversaciones privadas
- `Conversation.userId`. Cada usuario lista y lee solo sus conversaciones. Las conversaciones heredadas (sin usuario)
  solo son visibles para ADMIN/OWNER.
- El feedback (ADR 0004) de un agente lo revisan quienes tienen EDIT sobre él.

### D5. Efectos en integraciones y costos
- **MCP del workspace:** publica solo agentes `WORKSPACE` + `LAUNCHED`.
- **Flujos:** un nodo agente solo puede referenciar agentes que el editor del flujo puede USAR (validado al guardar); en
  ejecución se usa el centro de costo del agente o la raíz.
- **Rutinas:** las ejecuta el agente con el centro de costo del dueño cuando el agente es `PRIVATE`; requieren EDIT para gestionarlas.
- **Costos:** el chat se imputa a la unidad de quien conversa (sin cambios, ADR 0002).

## Contrato de API
- `Agent` agrega: `visibility`, `ownerId`, `owner: { id; name }`, `myPermission: 'OWNER'|'EDIT'|'USE'|'ADMIN_VIEW'`,
  `shares: { id; principalType; principalId; principalName; permission }[]` (solo para quien tiene EDIT).
- `GET /agents?scope=mine|shared|workspace|all` (por defecto: todos los que el usuario puede usar; `all` solo ADMIN).
- `PATCH /agents/:id/visibility` `{ visibility }` (EDIT; reglas D3) → agente.
- `PUT /agents/:id/shares` `{ shares: { principalType, principalId, permission }[] }` (EDIT) → agente.
- `POST /agents/:id/transfer` `{ userId }` · `POST /agents/:id/duplicate` `{ name? }` → agente nuevo.
- `GET /agents/explore` → agentes TEAM/WORKSPACE que el usuario puede usar y que no son suyos, con `description`, `owner`,
  `launchStatus`, `healthScore` (si existe) y `myPermission`.
- `GET /workspace/settings` → `{ allowPersonalAgents }` · `PATCH /workspace/settings` (ADMIN) `{ allowPersonalAgents }`.
- Errores: 403 "No tiene permiso sobre este agente"; 404 si el agente no es visible (no se revela su existencia).

## Consecuencias
- Migración: `AgentVisibility`, `SharePrincipal`, `SharePermission`, `Agent.visibility/ownerId`, `AgentShare`,
  `Conversation.userId`, `Workspace.allowPersonalAgents`, más datos (existentes → WORKSPACE con dueño).
- Cambio de comportamiento: un EDITOR ya no edita agentes ajenos sin share EDIT. Se documenta en las notas de versión.
- Todas las rutas de agentes, entrenamiento, rutinas y conversaciones pasan por un único `AgentAccessService`.

## Plan
| Tarea | Dueño |
|---|---|
| Esquema y migración | orquestador |
| `AgentAccessService`, visibilidad, shares, transferencia, duplicado, conversaciones privadas, efectos en MCP/flujos/rutinas; salud y lanzamiento (ADR 0006 D3/D4) | nexo-backend-platform |
| Nexo Copilot (ADR 0006 D1, D2, D6) | nexo-backend-ai |
| Estudio: selector de visibilidad, diálogo de compartir, panel del Copilot, entrevista, salud, lanzamiento | nexo-frontend-ui |
| Lista de agentes por ámbito, Explorar agentes, duplicar, consola de plataforma, ajustes del workspace | nexo-frontend-core |
| E2E de permisos y privacidad | nexo-qa-api |
