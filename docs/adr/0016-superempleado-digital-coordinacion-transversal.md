# 0016. Superempleado digital: coordinación transversal de resultados

- **Estado:** Propuesto
- **Fecha:** 2026-10-26
- **Responsables:** nexo-architect
- **Relacionado:**
  - ADR 0011 (modelo organizacional: `OrgUnit` tipado empresa/línea/área/sede; `Cargo` con `NivelJerarquico`
    `EMPLEADO→LIDER→JEFE→DIRECTOR→GERENTE→SUPEREMPLEADO`; `Agent.cargoId/responsableUserId`; asignaciones matriciales
    con alcance y vigencia).
  - ADR 0012 (trabajo por resultados E4: `Objetivo`/`Tarea`/`ContratoResultado`/`ValidacionResultado`/`Evidencia`;
    comunicación y handoff E5: `MensajeAgente`, `ContratoTransferencia`; coordinación transversal D5: `Canal`/`HiloCanal`,
    "una solicitud se vuelve tarea autorizada").
  - ADR 0013 (gobierno de acciones E6: `PolicyEngine`, `ActionGateway`, `Aprobacion`, doble aprobación, `Suspension`).
  - ADR 0007 (visibilidad y permisos de agentes: mencionar/compartir **no concede acceso**; permisos explícitos `USE|EDIT`).
  - ADR 0014 (Cuadrillas y Pasaporte de resultado; invariante de delegación por **subconjunto** de permisos).
  - Jerarquía de dirección digital (`modules/hierarchy`, `hierarchy.rules.ts`): niveles, autoridad, supervisión,
    reemplazo, sin ciclos ni autoaprobación.
  - Indicadores y consolas gerenciales E10/E12 (`results/indicadores`, `modules/consolas`).
  - Auditoría inmutable E13 (`modules/audit`).
- **Requisitos:** RF39 (superempleado), RF40 (límites y continuidad del coordinador superior), RF36 (coordinación
  transversal) · HU16, HU20 · QA10 (órdenes contradictorias/ciclos), QA13 (no autoaprobación), QA14 (suspensión y
  continuidad del coordinador).
- **Épica:** E3 (Jerarquía de dirección digital). Backlog `docs/backlog-organizacion-digital.md`; matriz de evidencia
  `docs/estado-nexo-decisiones-evidencia.md` (donde esta capacidad figura **PARCIAL / PENDIENTE**).

## Contexto

El patrocinador describe un **"superempleado digital que coordina resultados transversales"** de la organización de
empleados digitales: una figura de nivel superior que persigue un **resultado que cruza varias empresas, líneas de
negocio, áreas o sedes** (p. ej. "cerrar el ciclo de cobro del grupo este trimestre", que toca Comercial, Operaciones y
Tesorería de dos empresas) y lo **coordina de extremo a extremo**, en vez de limitarse a una cadena de mando vertical
dentro de una sola área.

Hoy Nexo tiene **las piezas, pero no la capacidad**:

- El **nivel `SUPEREMPLEADO`** existe en `NivelJerarquico` (ADR 0011, E3) y la jerarquía de dirección digital
  (`modules/hierarchy`) resuelve autoridad, supervisión, reemplazo y ausencia de ciclos. Pero un cargo de nivel superior
  **no es por sí mismo** una capacidad de coordinación transversal: hoy el nivel solo gradúa autoridad por la línea de
  mando.
- El **trabajo por resultados** (E4) da `Objetivo`/`Tarea`/`ContratoResultado` con verificación donde el **verificador ≠
  ejecutor**; la **comunicación y el handoff** (E5) dan `MensajeAgente` y `ContratoTransferencia`; la **coordinación
  transversal** (E5/D5) ya aporta `Canal`/`HiloCanal` por **misión**/proceso/área y la regla "una solicitud se vuelve
  tarea autorizada". Pero **no existe el objeto "misión transversal"**: un resultado que agrupa objetivos de varias
  empresas/áreas bajo un coordinador responsable, con seguimiento agregado y gobierno propio.
- Las **consolas gerenciales** (E12) y los **indicadores** (E10) consolidan por negocio/área/sede, pero **no por misión
  transversal**: no hay una vista que responda "¿cómo va el resultado que cruza tres áreas y quién lo está frenando?".

Por eso la matriz de evidencia (`docs/estado-nexo-decisiones-evidencia.md`, §C y §F.4) marca el **superempleado digital
como PARCIAL / PENDIENTE**: "el nivel `SUPEREMPLEADO` existe; la coordinación transversal automática como capacidad
distinta **no está construida**". Este ADR diseña esa capacidad para aprobación, **reutilizando lo ya construido** y sin
romper ninguna de las reglas duras de la plataforma.

Restricciones que la solución debe respetar (de `CLAUDE.md` y de los ADR citados):

- **`AGENTE_NO_CREA_AGENTES` (E5, ADR 0014).** El superempleado **no crea empleados digitales** ni se dota a sí mismo:
  la dotación la autoriza un humano o se instancia desde **Cuadrillas** (ADR 0014).
- **Mencionar/coordinar NO concede acceso (ADR 0007, E5/D5, QA12).** Coordinar no abre datos ajenos; los permisos siguen
  **explícitos** y la delegación solo transfiere un **subconjunto** de los permisos del delegante (ADR 0014/E5).
- **Un mensaje no autoriza efectos (E6/E5).** Toda acción sensible pasa por el motor de políticas, la bandeja de
  aprobaciones y el presupuesto; el coordinador **no se autoaprueba ni amplía presupuesto** (RF40/QA13).
- **Verificador ≠ ejecutor (E4).** El superempleado coordina y acepta resultados, pero no valida su propio trabajo.
- **No introducir infraestructura nueva** (otra cola, otra base, otro servicio): se reutilizan Postgres, BullMQ, el
  `schedule-reconciler`, `results/`, `messaging/`, `collaboration/`, `governance/`, `audit/`, `consolas/`.
- **Compatibilidad hacia atrás:** todo es **aditivo y opt-in**. Un workspace que no usa misiones transversales se
  comporta exactamente igual que hoy. El motor de flujos (`engine/*`) **no se toca**.
- **Multi-tenant estricto:** `workspaceId` de `@CurrentAuth()`; alcance por empresa validado en consulta y en entrega.

## Alternativas consideradas

1. **No construir una entidad nueva: usar solo objetivos jerárquicos existentes (E4).** Un "objetivo del grupo" se
   modela como un `Objetivo` de nivel alto cuyas `Tarea`s cuelgan de áreas distintas; el superempleado es el
   `Agent.responsableAgentId` de ese objetivo. **Ventaja:** cero esquema nuevo. **Desventaja / rechazada como solución
   completa:** `Objetivo` tiene **un único `orgUnitId`** (una empresa/área) y una estructura de mando **vertical**; no
   representa un resultado cuyo dueño es el *grupo* y cuyos participantes son **varias empresas/áreas con su propio dueño
   local**. Forzarlo produce (a) ambigüedad de a quién pertenece el objetivo y su presupuesto, (b) imposibilidad de
   consolidar "por misión" sin heurísticas frágiles, (c) choque con el invariante de ADR 0011 de **una sola autoridad
   `FUNCIONAL_PRINCIPAL`** por sujeto (¿quién manda sobre una tarea que es de Tesorería de la empresa B pero la coordina
   un superempleado del grupo?). El modelo transversal **no reemplaza** a los objetivos jerárquicos: los **compone**
   explícitamente con una capa de coordinación delgada.

2. **Un orquestador autónomo que ejecute por su cuenta.** El superempleado sería un agente con permisos amplios que
   dispara acciones en todas las áreas. **Rechazada:** viola `AGENTE_NO_CREA_AGENTES`, "un mensaje no autoriza efectos",
   "coordinar no concede acceso" y "no autoaprobación/no ampliar presupuesto" (RF40/QA13). Convierte al coordinador en un
   **punto único de poder y de fallo**, justo lo que QA13/QA14 exigen evitar.

3. **Reutilizar `Canal` de tipo `MISION` (E5/D5) como contenedor del resultado transversal.** El canal ya agrupa por
   misión. **Rechazada como suficiente:** `Canal` es un **espacio de comunicación** (hilos, menciones), no un **objeto de
   resultado** con estado, dueño humano, empresas participantes, objetivos vinculados e indicadores agregados. Se puede
   **enlazar** un `Canal` a la misión (reutilización), pero no sustituye a la entidad de coordinación.

4. **`MisionTransversal` como entidad delgada de coordinación que agrupa `Objetivo`/`Tarea` existentes de varias
   empresas/áreas, con un dueño humano, un coordinador digital (superempleado) **responsable pero no ejecutor**,
   participantes explícitos y seguimiento agregado, apoyada en E4/E5/E6/E13 y consolidada en las consolas (E12).**
   Añade lo mínimo, reutiliza todo lo construido y respeta cada invariante. **Elegida.**

## Decisión

### D1 — Qué es el superempleado digital (rol, no poder)

El **superempleado** es un **empleado digital de nivel `SUPEREMPLEADO`** (ADR 0011, E3) cuyo **cargo** tiene como
propósito **coordinar misiones transversales**: resultados que cruzan varias empresas/líneas/áreas/sedes. Es un
**coordinador responsable**, no un ejecutor ni un superusuario:

- **Coordina, no ejecuta el trabajo sensible.** Su función es descomponer la misión en objetivos/tareas, asignarlos a los
  empleados de cada área, hacer seguimiento del resultado agregado, detectar bloqueos/dependencias y **escalar a los
  humanos** cuando se agota su autoridad (HU20). Las acciones con efecto las ejecutan los agentes de cada área, cada uno
  con sus permisos explícitos y su gobierno.
- **No es un punto único de poder.** Su autoridad es la de su nivel en la jerarquía (E3), **acotada por empresa** (ADR
  0011/0007): coordinar una misión **no** le concede acceso a los datos de las empresas participantes. Está sujeto a
  suspensión (E6) y tiene **suplente** (E3) para no ser punto único de fallo (RF40/QA14).
- **No se autoaprueba ni amplía presupuesto** (RF40/QA13): toda acción sensible suya pasa por el `PolicyEngine`/
  `ActionGateway` (E6), la bandeja de aprobaciones y el presupuesto (ADR 0002), igual que cualquier otro agente.

El superempleado es, por tanto, **un `Agent` con un `Cargo` de nivel `SUPEREMPLEADO`** (ya posible hoy) **más** la
capacidad nueva de ser **coordinador de una `MisionTransversal`** (D2). No requiere permisos nuevos ni un tipo de agente
nuevo: es el mismo runtime gobernado, con un objeto de coordinación encima.

### D2 — Coordinación transversal modelada como `MisionTransversal` (entidad nueva, delgada)

Una **`MisionTransversal`** es el objeto de primera clase que representa un **resultado transversal** y su coordinación.
Se añade un módulo nuevo `modules/missions` (o se ubica en `results/` junto a `Objetivo`; decisión de la cédula, ver
preguntas abiertas). Contiene **solo** lo que no puede derivarse de lo existente; el trabajo real vive en `Objetivo`/
`Tarea`/`ContratoResultado` ya construidos:

- **Identidad y resultado:** `nombre`, `proposito`, `resultadoEsperado`, `indicador` de misión (meta/línea base/plazo),
  `estado` del ciclo de vida.
- **Dueño y coordinador:** `duenoUserId` (**humano** que patrocina y rinde cuentas de la misión) y `coordinadorAgentId`
  (el **superempleado**, responsable de coordinar, no de ejecutar). La misión la **crea y autoriza un humano**
  (`@MinRole` + nivel), nunca un agente.
- **Participantes explícitos:** `MisionParticipante` por cada **empresa/línea/área/sede** que participa (`orgUnitId`),
  con su **dueño local** (`duenoLocalUserId`/`agenteLiderId`) y el **alcance aprobado** de su participación. Declarar
  un participante **no concede acceso**: solo nombra quién colabora; los permisos siguen siendo explícitos (ADR 0007).
- **Vínculo a trabajo existente (reutilización, sin duplicar):** la misión **agrupa por referencia** `Objetivo`s y/o
  `Tarea`s ya existentes de cada área (`MisionVinculo` con `objetivoId?`/`tareaId?`). La misión **no** redefine el
  trabajo ni su presupuesto: cada objetivo/tarea conserva su `orgUnitId`, su dueño local y su autoridad
  `FUNCIONAL_PRINCIPAL` (ADR 0011). La misión añade **una capa de coordinación**, no una segunda cadena de mando.
- **Canal de coordinación (reutilización E5/D5):** opcionalmente se enlaza un `Canal` de tipo `MISION` (`canalId`) para la
  comunicación/menciones; sigue la regla "una solicitud se vuelve tarea autorizada" y "mencionar no concede acceso".

**Ciclo de vida de la misión (`EstadoMision`):** `PROPUESTA → AUTORIZADA → EN_CURSO → EN_VALIDACION → LOGRADA` con la rama
`DETENIDA` (bloqueo sin regla inequívoca o suspensión) y `CANCELADA`. Transiciones verificables, análogas a
`EstadoResultado` (E4):

| Estado | Condición verificable |
|---|---|
| `PROPUESTA` | Misión creada por un humano; participantes y objetivos aún no comprometidos. |
| `AUTORIZADA` | Un humano con nivel suficiente la autoriza; coordinador y participantes asignados. |
| `EN_CURSO` | Al menos un `Objetivo`/`Tarea` vinculado está en producción. |
| `EN_VALIDACION` | Todos los resultados vinculados presentados; pendiente de consolidación del resultado transversal. |
| `LOGRADA` | Los `ContratoResultado` de negocio vinculados están `ACEPTADO` (verificador ≠ ejecutor) y el indicador de misión cumple la meta. |
| `DETENIDA` | Bloqueo, contradicción sin regla (QA10) o suspensión del coordinador (QA14); requiere decisión humana. |
| `CANCELADA` | Un humano la cancela; deja historial y no rompe el trabajo ya aceptado. |

**Cómo coordina el superempleado, paso a paso, sin violar invariantes:**

1. **Descompone** la misión en `Objetivo`/`Tarea` (E4) por área, **proponiéndolos**; el **dueño local humano** de cada
   área los autoriza dentro de sus atribuciones, límites y presupuesto (ADR 0012 D1). El coordinador no impone objetivos
   fuera de su autoridad: los **propone** y **escala** si no hay acuerdo.
2. **Asigna** cada tarea a los empleados del área vía `MensajeAgente` de `ASIGNACION` (E5), con **handoff**
   (`ContratoTransferencia`) en los puntos de corte. Los `permisos` que viajan en el mensaje **se intersectan** con los
   del delegante y nunca amplían (ADR 0014/E5): asignar **no concede acceso**.
3. **Exige resultado verificable:** cada entrega se cierra con un `ContratoResultado` cuya `reglaValidacion` es
   determinista y cuyo **verificador ≠ ejecutor** (E4). El superempleado puede ser verificador de tareas que **no
   ejecutó**, nunca de las suyas.
4. **Hace seguimiento agregado** del resultado transversal (D3) y, ante un bloqueo, dependencia vencida o contradicción
   sin regla inequívoca, **detiene la parte afectada y escala al humano** (QA10/HU20), en vez de forzar.
5. **Toda acción sensible** suya (p. ej. reasignar presupuesto entre áreas, lanzar una acción externa) pasa por E6
   (políticas/aprobaciones) y queda en el `AuditLog` inmutable (E13). **No se autoaprueba** (QA13).

**Continuidad (RF40/QA14):** el coordinador tiene **suplente** (E3). Al suspenderlo (E6), su suplente asume la
coordinación, los `Objetivo`/`Tarea` autorizados **siguen** (su estado vive en Postgres, no en el coordinador) y los
humanos pueden intervenir/reasignar en cualquier nivel. La misión no es un punto único de fallo.

### D3 — Indicadores y seguimiento del resultado transversal (reutiliza E10/E12)

El resultado transversal se mide **componiendo indicadores ya existentes por misión**, sin cómputo paralelo:

- **Cumplimiento agregado por misión:** estado de los `ContratoResultado`/`Objetivo` vinculados (reutiliza
  `results/indicadores`, E10), consolidado a nivel de misión (p. ej. "% de resultados de negocio aceptados de la misión").
- **Costo por resultado transversal:** suma de la imputación (`UsageRecord` + `governance/imputacion`, E9/ADR 0002) de
  las tareas vinculadas, atribuida a la misión por referencia (no mueve presupuesto entre áreas sin aprobación E6).
- **Excepciones y bloqueos:** `Incumplimiento`/`Excepcion` (E4/E7) de las tareas vinculadas, agrupados por misión, con el
  escalamiento y los límites que ya existen.

Se expone como una **consola de misión** nueva dentro de `modules/consolas` (E12, que ya consolida por negocio/área/sede):
una vista "por misión transversal" que responde quién frena el resultado, cuánto cuesta y qué está pendiente de decisión
humana. **No se crea un sistema de indicadores nuevo**: es una **proyección/agrupación** de los existentes por
`misionId`.

### D4 — Qué NO hace el superempleado (límites explícitos)

- **No ejecuta por su cuenta acciones externas sin aprobación.** No es un orquestador autónomo; las acciones con efecto
  las realizan los agentes de área bajo su propio gobierno (E6).
- **No crea empleados digitales** (`AGENTE_NO_CREA_AGENTES`): la dotación la autoriza un humano o se instancia desde
  Cuadrillas (ADR 0014).
- **No concede ni se concede acceso a datos** por coordinar (ADR 0007): los permisos son explícitos; la delegación solo
  transfiere subconjuntos (ADR 0014/E5).
- **No amplía presupuesto ni se autoaprueba** (RF40/QA13): sujeto a E6 y a ADR 0002 como cualquier agente.
- **No elude políticas ni auditoría** (E6/E13): toda acción sensible pasa por el gobierno y queda encadenada por hash.
- **No es punto único de autoridad:** su mando está acotado por empresa (ADR 0011) y una `MisionTransversal` **no**
  sobrescribe la autoridad `FUNCIONAL_PRINCIPAL` local; las órdenes contradictorias se resuelven por autoridad vigente,
  prioridad y versión, y si no hay regla inequívoca se **detiene y pide decisión humana** (QA10).

### D5 — Invariantes

- **Tenant/empresa:** `workspaceId` obligatorio en toda entidad y consulta; cada `MisionParticipante`/`MisionVinculo`
  validado por empresa. Declarar participante o vincular objetivo **no concede acceso** (ADR 0007, QA12).
- **Humano en el origen:** solo una persona con nivel/rol suficiente crea, autoriza, detiene o cancela una misión; ningún
  agente lo hace. El coordinador **propone**; los dueños locales **autorizan** su parte.
- **No escalada de permisos:** coordinar/asignar no concede acceso; la delegación transfiere subconjuntos (ADR 0014/E5);
  nunca amplía presupuesto ni salta aprobaciones (E6/ADR 0002).
- **Verificador ≠ ejecutor:** el coordinador no valida los resultados que ejecutó (E4).
- **Coherencia de autoridad:** la misión no crea una segunda cadena de mando; respeta una sola `FUNCIONAL_PRINCIPAL` por
  sujeto (ADR 0011) y la ausencia de ciclos (`hierarchy.rules.ts`).
- **Continuidad:** el coordinador tiene suplente; su suspensión no detiene el trabajo autorizado ni pierde estado
  (RF40/QA14).
- **Todo auditado:** crear/autorizar/detener/cancelar misiones y las acciones sensibles del coordinador escriben al
  `AuditLog` inmutable (E13).
- **Aditivo y compatible:** sin misiones transversales, la plataforma se comporta igual; el motor de flujos no se toca.

## Consecuencias

### Esquema Prisma propuesto (bloque de referencia — lo aplica la cédula que edita `schema.prisma`)

> Este ADR **no** edita `schema.prisma`. Migración **aditiva**; no cambia ninguna columna existente ni la vuelve
> obligatoria; solo añade entidades nuevas y back-relations opcionales. Respeta la regla de `CLAUDE.md` sobre índices
> generados manualmente (`KnowledgeChunk.search`, `KnowledgeChunk_search_idx`, `OrgUnit_root_per_workspace`): no los
> afecta. Identificadores en inglés; textos y comentarios en español.

```prisma
enum EstadoMision {
  PROPUESTA
  AUTORIZADA
  EN_CURSO
  EN_VALIDACION
  LOGRADA
  DETENIDA
  CANCELADA
}

model MisionTransversal {
  id                 String              @id @default(cuid())
  workspaceId        String
  nombre             String
  proposito          String?
  resultadoEsperado  String
  // Indicador de misión (consolidado sobre E10; no reemplaza los indicadores de resultado)
  indicador          String?
  lineaBase          String?
  meta               String?
  plazo              DateTime?
  estado             EstadoMision        @default(PROPUESTA)
  duenoUserId        String              // humano que patrocina y rinde cuentas (la autoriza una persona)
  coordinadorAgentId String?             // el superempleado (Cargo nivel SUPEREMPLEADO); responsable, NO ejecutor
  canalId            String?             // Canal MISION existente (E5/D5), opcional
  autorizadaPorUserId String?
  autorizadaAt       DateTime?
  validFrom          DateTime            @default(now())
  validTo            DateTime?
  participantes      MisionParticipante[]
  vinculos           MisionVinculo[]
  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt
  @@index([workspaceId, estado])
}

model MisionParticipante {
  id               String  @id @default(cuid())
  workspaceId      String
  misionId         String
  orgUnitId        String                 // empresa / línea / área / sede participante
  duenoLocalUserId String?                // dueño humano de la participación local
  agenteLiderId    String?                // agente líder del área en la misión
  // Alcance aprobado de la participación. Declarar participante NO concede acceso (ADR 0007).
  alcance          Json    @default("{}")
  createdAt        DateTime @default(now())
  @@unique([workspaceId, misionId, orgUnitId])
  @@index([workspaceId, misionId])
}

model MisionVinculo {
  id          String   @id @default(cuid())
  workspaceId String
  misionId    String
  // Agrupa por REFERENCIA trabajo existente (E4); no redefine ni duplica objetivos/tareas.
  objetivoId  String?
  tareaId     String?
  createdAt   DateTime @default(now())
  @@index([workspaceId, misionId])
}
```

Back-relations aditivas y opcionales en entidades existentes (las aplica la cédula del schema): `Agent`
(`misionesCoordinadas MisionTransversal[]`), `Objetivo`/`Tarea` (`misionVinculos MisionVinculo[]`), `OrgUnit`, `User`,
`Canal` (`mision MisionTransversal?`). Ninguna columna existente cambia de tipo ni se vuelve obligatoria. No se añaden
enums ni campos a `Agent` para el superempleado: su nivel ya es `Cargo.nivel = SUPEREMPLEADO` (ADR 0011).

### Impacto en contratos de API (orden: contrato → backend → frontend → QA)

- **Misiones:** `POST /v1/missions` (crear, `@MinRole('ADMIN')` o el nivel que fije la política),
  `POST /v1/missions/:id/authorize`, `POST /v1/missions/:id/stop`, `POST /v1/missions/:id/cancel`,
  `GET /v1/missions` y `GET /v1/missions/:id` (filtrado por `workspaceId`/empresa y visibilidad ADR 0007).
- **Participantes y vínculos:** `POST /v1/missions/:id/participants`, `DELETE /v1/missions/:id/participants/:pid`,
  `POST /v1/missions/:id/links` (vincular `Objetivo`/`Tarea` existentes), `DELETE /v1/missions/:id/links/:lid`.
  Vincular/participar **no** concede acceso; la respuesta puede indicar qué permisos siguen pendientes de conceder.
- **Seguimiento:** `GET /v1/missions/:id/dashboard` (cumplimiento agregado, costo por resultado, excepciones/bloqueos),
  reutilizando `results/indicadores` (E10), `governance/imputacion` (E9) y los patrones de `consolas` (E12).
- `workspaceId`/empresa siempre de `@CurrentAuth()`, nunca del cuerpo. DTOs con `class-validator`; `import type` para
  tipos. Mutaciones con `@MinRole`; autorizar/detener según autoridad de E3. Lectura según la política de la empresa
  (por defecto `VIEWER`+ con alcance al recurso).

### Frontend (dueños frontend-ui/core)

- **Vista de coordinación transversal:** una pantalla "Misiones" que lista las misiones del workspace/empresa y, por
  misión, muestra: dueño humano vs coordinador digital (diferenciados), empresas/áreas participantes, objetivos/tareas
  vinculados con su estado, cumplimiento agregado, costo por resultado, bloqueos/excepciones y lo pendiente de **decisión
  humana** (botones Autorizar/Detener/Escalar según permiso). Deja claro que coordinar/vincular **no concede acceso**.
- Reutiliza el design system de `styles.scss`; componentes standalone + `ChangeDetectionStrategy.OnPush` + signals +
  `inject()`, control flow `@if/@for`; build web sin warnings NG8113; llaves literales con el pipe `tpl`.

### Seguridad, rendimiento y escalabilidad

- **Sin poder concentrado:** el coordinador no gana acceso ni presupuesto por coordinar; acciones sensibles por E6;
  autoridad acotada por empresa (ADR 0011/0007). Órdenes contradictorias sin regla → detiene y pide decisión humana.
- **Sin punto único de fallo:** suplente del coordinador (E3) y estado persistido en Postgres (RF40/QA14).
- **Reutilización pura:** el seguimiento es agregación de indicadores/imputación/excepciones existentes; las esperas y el
  trabajo pesado siguen en jobs BullMQ y en el `schedule-reconciler` existentes. **No se añade cola ni base nueva.** La
  API queda sin estado.
- **Verificabilidad:** cada resultado transversal se sustenta en `ContratoResultado` aceptados (verificador ≠ ejecutor) y,
  si la política lo exige, en su **Pasaporte de resultado** (ADR 0014), anclado a la cadena de auditoría (E13).

### Plan de pruebas

- **Unitarias:** transiciones de `EstadoMision` verificables (p. ej. `LOGRADA` exige contratos de negocio `ACEPTADO` +
  indicador cumplido); agregación de indicadores/costo por `misionId` reproducible; resolución de contradicciones reusa
  `hierarchy.rules.ts`/autoridad vigente.
- **Integración API (reusa patrones E3/E4/E5/E6):**
  - **QA13 (no autoaprobación):** el coordinador que intenta aprobar su propia excepción, ampliar su presupuesto,
    otorgarse permisos o eliminar auditoría → cada acción **bloqueada y auditada**.
  - **QA14 (continuidad):** suspender al coordinador → el suplente asume, los objetivos/tareas autorizados siguen, el
    estado persiste y los humanos pueden reasignar.
  - **QA10 (contradicciones/ciclos):** instrucciones contradictorias sin regla inequívoca → se detiene la parte afectada
    y se pide decisión humana; la coordinación no introduce ciclos de supervisión.
  - **QA12 (no concede acceso):** declarar participante o vincular un objetivo de otra empresa **no** abre sus datos; un
    agente recién asignado sin permisos concedidos → 403/404.
  - **Multi-tenant/empresa:** aislamiento en misiones, participantes, vínculos y dashboard.
  - **AGENTE_NO_CREA_AGENTES:** un agente no puede crear/autorizar misiones ni dotar empleados por coordinar.
- **E2e (HU20):** una misión transversal que cruza dos empresas y tres áreas; el coordinador detecta una **dependencia
  vencida**, propone recuperación, **escala fuera de su autoridad**; un dueño local autoriza su parte; los resultados de
  negocio se aceptan con verificador ≠ ejecutor; la consola de misión consolida cumplimiento, costo y excepciones; se
  suspende al coordinador y el suplente da continuidad sin perder estado.

## Decisiones de producto abiertas (requieren al negocio)

1. **Ubicación del módulo:** ¿`modules/missions` nuevo o dentro de `results/` junto a `Objetivo`? (propuesta: módulo
   propio `missions` que depende de `results`, para no sobrecargar `results`).
2. **Rol/nivel mínimo** para crear/autorizar misiones y para ser coordinador (propuesta: crear/autorizar `ADMIN` o
   `DIRECTOR`+; coordinador = `Agent` con `Cargo.nivel = SUPEREMPLEADO`). ¿Puede un `GERENTE` coordinar misiones de menor
   alcance?
3. **Alcance inter-empresa del coordinador:** ¿un superempleado del grupo puede coordinar misiones que tocan empresas
   donde no tiene asignación, solo con el consentimiento del dueño local de cada empresa? (afecta ADR 0011/0007).
4. **Presupuesto de misión:** ¿la misión tiene bolsa propia o solo agrega el de los objetivos/tareas de cada área?
   (propuesta inicial: solo agrega; mover presupuesto entre áreas exige aprobación E6).
5. **`LOGRADA` automática vs confirmación humana:** ¿el sistema marca la misión como lograda al cumplirse la condición
   verificable, o siempre requiere confirmación del dueño humano? (propuesta: propone `LOGRADA`, confirma el dueño).
6. **Pasaporte de misión:** ¿se exige un Pasaporte de resultado (ADR 0014) por cada resultado de negocio vinculado, o
   además un "pasaporte de misión" que encadene los de sus resultados? (depende del sector regulado objetivo).
7. **Versionado de la forma JSON** de `MisionParticipante.alcance` y migración si cambia (misma disciplina que las
   definiciones de flujo y de `CuadrillaVersion`).

## Plan de implementación

Por incrementos disjuntos, ordenados por valor y riesgo. **Primer incremento mínimo entregable: Incremento 1** —
`MisionTransversal` + participantes/vínculos + asignación/seguimiento básico (backend) y la **vista de coordinación**
(frontend), reutilizando E4/E5/E10/E12 ya construidos y verificados. El gobierno de la continuidad del coordinador
(QA13/QA14) se endurece en el Incremento 2, y el dashboard consolidado completo en el 3.

| Inc. | Alcance | Dueño | Modelo de datos aditivo · Endpoints · Criterios de prueba |
|---|---|---|---|
| 0 | Contrato de API (este ADR) + actualización de `docs/ARCHITECTURE.md` (sección de organización digital y "Evolución sugerida") + matriz de evidencia (pasa de PENDIENTE a "en construcción") | nexo-architect | DTOs y rutas acordadas; docs actualizadas |
| 1 (MVP) | **`MisionTransversal` + participantes + vínculos + asignación/seguimiento básico (backend).** Crear/autorizar/detener/cancelar; vincular `Objetivo`/`Tarea` existentes; el coordinador propone y asigna vía `MensajeAgente` (reusa E5); **vincular/participar no concede acceso** | nexo-backend-platform | `MisionTransversal`/`MisionParticipante`/`MisionVinculo` + migración aditiva. `POST /v1/missions`, `/authorize`, `/stop`, `/cancel`, `/participants`, `/links`. **Pruebas:** transiciones verificables; QA12 (no concede acceso); multi-tenant; un agente no crea/autoriza misiones. Archivos: `modules/missions/**` (nuevo), `prisma/schema.prisma` |
| 2 | **Vista de coordinación (frontend).** Lista de misiones y detalle: dueño vs coordinador, participantes, objetivos/tareas vinculados, acciones Autorizar/Detener/Escalar según permiso | nexo-frontend-ui + nexo-frontend-core | Modelos/ApiService; pantalla OnPush+signals; build sin warnings NG8113; autor humano vs digital diferenciado. Archivos: `apps/web/src/app/features/**`, `core/**` |
| 3 | **Gobierno de la continuidad del coordinador (backend).** Suplencia al suspender (E6/E3), escalamiento a humano al agotar autoridad, resolución de contradicciones sin regla (detener + pedir decisión) | nexo-backend-platform (+ coord. `modules/hierarchy`, `governance/actions`) | Reusa suspensión E6 y suplencia E3. **Pruebas:** QA13 (no autoaprobación/no ampliar presupuesto/no otorgarse permisos/no borrar auditoría); QA14 (suspender y continuar sin perder estado); QA10 (contradicción → detiene y escala). Archivos: `modules/missions/**`, `modules/hierarchy/**`, `modules/governance/actions/**` |
| 4 | **Consola de misión (seguimiento agregado).** Cumplimiento agregado, costo por resultado, excepciones/bloqueos por misión, reutilizando E10/E9/E12 | nexo-backend-platform + nexo-frontend-ui | `GET /v1/missions/:id/dashboard` como agregación de indicadores/imputación/excepciones existentes. **Pruebas:** agregación reproducible; aislamiento multi-tenant. Archivos: `modules/missions/**`, `modules/consolas/**`, `apps/web/src/app/features/**` |
| 5 | **QA integral.** Integración (QA10/QA12/QA13/QA14, aislamiento, agente-no-crea-misiones) y e2e del recorrido HU20 (misión que cruza dos empresas y tres áreas, dependencia vencida, escalamiento, suspensión y continuidad) | nexo-qa-api + nexo-qa-e2e | Suites en verde contra Postgres/Redis reales; cada bug con prueba que lo reproduce. Archivos: `apps/api/**/*.spec.ts`, `apps/web/e2e/**` |
