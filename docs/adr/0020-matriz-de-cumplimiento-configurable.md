# 0020. Matriz de cumplimiento configurable y multisectorial

- **Estado:** Propuesto — **construcción autorizada conceptualmente por el patrocinador (2026-11-02)**. El MOTOR se
  construye ahora; los CAMPOS obligatorios concretos quedan **pendientes de aprobación definitiva del patrocinador**
  (ver `docs/matriz-cumplimiento-campos.md`). Las reglas **nacen inactivas** y la validación es **asesora, no
  bloqueante**.
- **Fecha:** 2026-11-03
- **Responsables:** nexo-architect, nexo-backend-platform
- **Relacionado:**
  - ADR 0014 (Pasaporte de resultado verificable — la matriz evalúa un resultado/pasaporte por referencias, no copia datos sensibles).
  - ADR 0008 (protección de datos: retención/DataGuard — el «control de protección» de cada regla se declara, no sustituye a `data-protection`).
  - ADR 0002/0006 (gobierno, roles y auditoría inmutable E13 — el CRUD de reglas es ADMIN+ y queda auditado).
  - Decisiones del patrocinador 2026-11-02 (§1.3 y §3 P1 3a/3b) y guardarraíl multisectorial (§4).
  - `docs/matriz-cumplimiento-campos.md` (propuesta de campos para aprobación — entregable 3b).

## Contexto

El patrocinador aprobó **conceptualmente** avanzar con una **matriz de cumplimiento configurable** por **jurisdicción,
sector económico, proceso y nivel de riesgo**, y pidió —antes de la aprobación definitiva— **presentar** los **campos
obligatorios, reglas de validación y controles de protección de datos**. NEXO es **multisectorial**: no puede atarse a
transporte/cobranza ni a ninguna empresa concreta (guardarraíl §4: nada de `if (sector === ...)`).

Hoy existe el **Pasaporte de resultado** (ADR 0014): la hoja de vida verificable de cada resultado aceptado. Falta un
mecanismo que, dado un **contexto** (jurisdicción/sector/proceso/riesgo), diga **qué campos/reglas son exigibles** y
evalúe un resultado/pasaporte contra ellos. Ese mecanismo debe ser **dato configurable**, no código.

Restricción rectora de gobierno: **no convertir esto en un bloqueo productivo todavía**. Mientras Cumplimiento y el
patrocinador no aprueben el conjunto definitivo, el motor **no debe exigir ningún campo**. Por eso las reglas **nacen
inactivas** y la evaluación es **asesora**.

## Alternativas consideradas

1. **Campos de cumplimiento fijos en código / por sector** (p. ej. una rama por "financiero", otra por "salud") —
   rápido de escribir pero **viola el guardarraíl multisectorial**, no escala a nuevas jurisdicciones/sectores y
   mezcla política con código. **Rechazada.**
2. **Ampliar el Pasaporte (ADR 0014) con columnas obligatorias nuevas** — rompería pasaportes existentes (dato de
   clientes), no es configurable por contexto y adelanta una exigencia no aprobada. **Rechazada.**
3. **Matriz de reglas configurable por workspace + motor puro de resolución/evaluación asesora** — las reglas son
   filas `ReglaCumplimiento` (alcance por jurisdicción/sector/proceso/riesgo + campo obligatorio + tipo + regla de
   validación + control de protección), resueltas por una lógica **pura** y evaluadas de forma **asesora**. **Elegida.**

## Decisión

Crear un módulo **`compliance`** con:

- **Entidad `ReglaCumplimiento`** (aditiva): `workspaceId`, alcance `jurisdiccion?`/`sector?`/`proceso?`/`nivelRiesgo?`
  (cualquiera en `null` = **comodín**, aplica a todos), `campoClave`, `tipoDato` (TEXTO/NUMERO/BOOLEANO/FECHA/LISTA/
  OBJETO), `reglaValidacion?` (JSON **declarativo**, sin código ejecutable), `controlProteccion?`, `descripcion?` y
  `activa` (**por defecto `false`**). `jurisdiccion`/`sector`/`proceso` son **texto libre** (sin taxonomía impuesta:
  multisectorial); `nivelRiesgo` reusa el enum genérico `NivelRiesgo`.
- **Resolución pura** (`cumplimiento.resolver.ts`, sin Nest/Prisma): dado un contexto, devuelve el **conjunto de reglas
  aplicables**. «La más específica **suma**»: unión por `campoClave`, y para un mismo `campoClave` gana la regla de
  **mayor especificidad** (jurisdicción > sector > proceso > riesgo; empate por antigüedad = determinista).
- **Evaluación asesora** (`evaluarCumplimiento`): dado el conjunto resuelto y un objeto de valores, devuelve
  `{ modo: 'ASESOR', cumple, totalReglas, faltantes, invalidos }` **sin lanzar** por motivos de negocio. Con el
  conjunto vacío → `cumple = true` (no exige nada).
- **Servicio y API gobernada:** CRUD de reglas bajo `@MinRole('ADMIN')` (`admin/compliance/rules`), auditado en E13
  (alta/cambio/eliminación, con `activa` anterior/nuevo: activar una regla la vuelve exigible). Lectura asesora bajo
  `@MinRole('VIEWER')` (`compliance/resolve`, `compliance/validate`). Todo filtra por `workspaceId` de `@CurrentAuth`.

**Garantías de inicio seguro (no bloqueante):** la validación solo considera reglas **activas**; las reglas nacen
inactivas; sin reglas activas aplicables no exige nada. La activación del conjunto definitivo la decide un ADMIN **tras
la aprobación del patrocinador**.

## Consecuencias

- **Datos:** migración **aditiva** `20261103010000_matriz_cumplimiento` (enum `TipoDatoCumplimiento` + tabla
  `ReglaCumplimiento` con índices por `workspaceId`, `(workspaceId, activa)` y `(workspaceId, alcance)`). No toca el
  Pasaporte ni ninguna tabla existente; no rompe flujos ni pasaportes emitidos. Saneado el SQL espurio de drift
  (`DROP INDEX`/`ALTER COLUMN "search"` sobre `KnowledgeChunk`).
- **Multisectorial:** no hay semántica de ningún sector en el código; sector/proceso/jurisdicción son datos de texto
  libre por workspace. Los ejemplos de la propuesta de campos son **ilustrativos**, no hardcodeados.
- **Gobierno/seguridad:** CRUD solo ADMIN+, auditado; lectura asesora VIEWER+; aislamiento multi-tenant. No afirma
  conformidad con ninguna norma: son controles técnicos configurables.
- **Rendimiento:** resolución/evaluación en memoria sobre las reglas del workspace (acotadas); sin trabajo pesado.
- **Frontend (posterior):** consola de administración de la matriz y vista asesora del resultado/pasaporte (fuera del
  alcance de este incremento de backend).

## Plan por incrementos

1. **Inc.1 (este ADR):** motor configurable + CRUD gobernado + resolución/validación **asesora** + propuesta de campos
   (3b). Reglas **inactivas**; sin bloqueo productivo.
2. **Inc.2 (tras aprobación del patrocinador):** activar el conjunto de campos aprobado por jurisdicción/sector/proceso
   y exponer la evaluación asesora en el Pasaporte (ADR 0014) y en la consola.
3. **Inc.3 (requiere autorización de activación productiva):** modo **bloqueante opcional por workspace/contexto**
   (p. ej. impedir emitir/aceptar un resultado si faltan campos obligatorios), con override gobernado y auditado.
   **No** se implementa hasta autorización expresa (distinción construir vs. activación productiva).
