# 0016. Superempleado digital: coordinación transversal de resultados

- **Estado:** Propuesto · **Incremento 1 ratificado por el patrocinador (2026-11-02)**; **Incrementos 2–5 autorizados
  para avanzar en diseño funcional, arquitectura y pruebas aisladas**, con **implementación operativa sujeta a revisión
  por etapas**.
- **Fecha:** 2026-10-26 (actualizado 2026-11-02)
- **Responsables:** nexo-architect

> **Decisión del patrocinador (2026-11-02).** Se **ratifica** la autorización del **Incremento 1**. Los **Incrementos
> 2–5** pueden avanzar en **diseño funcional, arquitectura y pruebas aisladas**; su **implementación operativa** se
> somete a **revisión por etapas**. El superempleado debe tener coordinación transversal, seguimiento de compromisos,
> detección de bloqueos, escalamiento y **supervisión de otros agentes**, **respetando siempre la jerarquía y los
> permisos**; las **acciones de alto impacto e irreversibles requieren autorización humana**. Sigue siendo autorización
> de **construir/diseñar**: no implica gasto, contratación ni activación productiva.

> **Autorización del patrocinador (2026-10-27).** Se autoriza **construir el Incremento 1 de coordinación transversal**,
> **limitado a**: seguimiento de compromisos, detección de bloqueos, coordinación entre áreas y **escalamiento** a
> humanos. Debe **conservar responsables humanos, permisos, presupuestos y trazabilidad**. El coordinador **no ejecuta
> acciones sensibles por su cuenta, no se autoaprueba, no amplía presupuesto y no crea empleados digitales**
> (`AGENTE_NO_CREA_AGENTES`). La **aprobación integral** de este ADR (y los incrementos 2-5) queda **pendiente** de que
> el patrocinador revise su contenido. Esta autorización es de **construir**; no implica acceso a cuentas/datos, gasto
> ni activación productiva.
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

---

## Diseño Inc.2–5 (autorizado por el patrocinador 2026-11-02)

> **Marco de autorización.** Esta sección desarrolla el **diseño funcional, la arquitectura y el plan de pruebas
> aisladas** de los Incrementos 2 a 5, conforme a la decisión del patrocinador del 2026-11-02 (§1.5 y §3 P1 ítem 5a de
> `docs/decisiones-patrocinador-2026-11-02-plan-ejecucion.md`). Es autorización de **construir/diseñar**: **no** implica
> gasto, contratación, acceso a cuentas/datos reales ni **activación productiva**. La **implementación operativa** de
> cada incremento queda sujeta a **revisión por etapas** (compuertas más abajo). El Incremento 1 (MVP backend:
> `MisionTransversal` + participantes + vínculos + asignación/seguimiento básico) está **ratificado y construido**; estos
> incrementos lo **extienden**, de forma **aditiva y opt-in**, sin tocar el motor de flujos (`engine/*`).

### Principios transversales que gobiernan Inc.2–5

Todos los incrementos preservan los invariantes del cuerpo del ADR (D4/D5) y añaden estas reglas de diseño comunes:

- **El coordinador propone y observa; el humano decide lo irreversible.** Seguimiento de compromisos, detección de
  bloqueos, escalamiento y **supervisión de otros agentes** son capacidades de **lectura, correlación y notificación**.
  Toda **acción de alto impacto o irreversible** (suspender/reasignar un agente o una tarea ya autorizada, mover
  presupuesto entre áreas, lanzar una acción externa, marcar `LOGRADA`, detener/cancelar la misión) **exige autorización
  humana** y pasa por el gobierno de acciones (E6: `Politica`/`DecisionPolitica`/`Aprobacion`/`Suspension` del ADR 0013).
- **Supervisar no concede acceso (ADR 0007).** La supervisión del coordinador se limita al **alcance de la misión** y a
  **metadatos de estado** (compromisos, vencimientos, excepciones, indicadores), nunca al contenido/datos de otras
  empresas. Observar a un agente **no** abre sus datos ni sus credenciales.
- **No se sobrescribe la jerarquía local.** La supervisión transversal **no** reemplaza la autoridad
  `FUNCIONAL_PRINCIPAL` (ADR 0011): el coordinador señala y escala; el **dueño local humano** o el superior funcional
  autoriza la corrección. Contradicción sin regla inequívoca → **detener y pedir decisión humana** (QA10,
  `hierarchy.rules.ts`).
- **Continuidad sin punto único de fallo.** El estado vive en Postgres (no en el coordinador). La suplencia/reemplazo de
  E3 (`modules/hierarchy`) y la suspensión de E6 garantizan que suspender al coordinador **no detiene** el trabajo ya
  autorizado (RF40/QA14).
- **Trazabilidad total.** Crear/autorizar/detener/cancelar misiones, cada escalamiento, cada observación de supervisión
  y cada solicitud de decisión humana escriben al `AuditLog` inmutable (E13), encadenados por hash.
- **Sin infraestructura nueva.** Se reutilizan Postgres, BullMQ, el `schedule-reconciler`, `results/`, `messaging/`,
  `governance/`, `audit/`, `consolas/`, `hierarchy/`. La detección periódica de bloqueos reusa el reconciliador
  existente; no se crea cola ni servicio nuevo. La API permanece sin estado.
- **Aislamiento de pruebas (US$ 0, sin producción).** Todo el plan de pruebas de esta sección corre en entornos
  controlados: proveedores LLM/externos **mock**, datos **sintéticos**, sin canales reales ni gasto. Las pruebas de
  motor/transiciones son TypeScript puro, sin Nest ni base; las de integración usan Postgres/Redis locales.

---

### Incremento 2 — Vista de coordinación transversal (frontend)

**Objetivo.** Dar a los humanos (dueño de misión, dueños locales, dirección) una pantalla para **ver y gobernar** las
misiones transversales ya soportadas por el backend del Inc.1, dejando explícito **quién es responsable humano** frente a
**quién coordina digitalmente**, y canalizando toda acción sensible hacia los controles humanos existentes.

**Alcance funcional.**
- **Lista de misiones** del workspace/empresa (filtrada por `workspaceId`/empresa y visibilidad ADR 0007), con estado
  (`EstadoMision`), dueño humano, coordinador digital, nº de participantes y semáforo de avance.
- **Detalle de misión:** identidad/propósito/resultado esperado e indicador; **dueño humano vs. coordinador digital**
  claramente diferenciados (etiqueta "humano" / "empleado digital"); empresas/áreas participantes con su dueño local;
  objetivos/tareas vinculados con su estado; compromisos y vencimientos; bloqueos/excepciones; y el bloque **"pendiente
  de decisión humana"**.
- **Acciones humanas gatilladas desde la UI**, visibles solo según permiso/nivel del usuario: **Autorizar**, **Detener**,
  **Cancelar**, **Escalar**, **Vincular/Desvincular** objetivo/tarea, **Añadir/Quitar participante**. Cada botón mapea a
  un endpoint del Inc.1 que ya es humano-gated; la UI **no** permite que un agente dispare estas acciones.
- **Aviso permanente en la UI:** coordinar/vincular/participar **no concede acceso** a datos (ADR 0007); si falta
  conceder un permiso, se muestra el pendiente sin exponer el dato.

**Entidades/contratos de datos (sin migrar).** Incremento **solo de frontend**: no añade entidades. Consume los contratos
del Inc.1 vía `core/`:
- `MissionSummaryDto` (lista): `id`, `nombre`, `estado`, `duenoUserId`, `coordinadorAgentId`, `participantesCount`,
  `avance` (0–100 derivado del backend).
- `MissionDetailDto`: identidad + `participantes[]` (`orgUnitId`, `duenoLocalUserId`, `agenteLiderId`, `alcance`,
  `accesoPendiente: boolean`), `vinculos[]` (`objetivoId?`/`tareaId?` + estado resuelto), `accionesPermitidas[]`
  (capacidades que el usuario actual puede ejecutar, resueltas en backend por rol/nivel; la UI nunca decide permisos).
- Modelos Angular en `apps/web/src/app/core/**`; `ApiService` tipado; **ningún secreto ni `workspaceId` en el cliente**
  (siempre de `@CurrentAuth()` en backend).

**Interacción con jerarquía/permisos/gobierno.** La UI **refleja**, no decide: `accionesPermitidas` las calcula el
backend según nivel (E3) y permisos (ADR 0007). Botones de alto impacto (Detener/Cancelar/Autorizar) solo aparecen para
quien tiene autoridad; el resto los ve deshabilitados con el motivo. Escalar abre el flujo humano, no ejecuta efectos.

**Puntos que exigen autorización humana.** Todos los botones mutadores de la vista **son acciones humanas**; no hay
automatismo. El diseño exige que cada uno exista como endpoint humano-gated (ya del Inc.1) y que la UI falle de forma
segura (oculta/deshabilita) si el usuario no tiene el permiso.

**Criterios de aceptación.**
- La lista y el detalle distinguen visualmente **responsable humano** de **coordinador digital** (prueba de etiqueta).
- Los controles de alto impacto solo se renderizan/activan cuando `accionesPermitidas` los incluye; un `VIEWER` no ve
  Autorizar/Detener/Cancelar.
- La vista muestra el estado "no concede acceso / permiso pendiente" cuando aplica, sin filtrar datos ajenos.
- Componentes **standalone + `OnPush` + signals + `inject()` + `@if/@for`**; clases del design system; llaves literales
  con el pipe `tpl`; **build web sin warnings NG8113**.

**Plan de pruebas aisladas.**
- **Unitarias de componente (Karma, `CHROME_BIN`):** render condicional de acciones según `accionesPermitidas`;
  diferenciación humano/digital; estado "permiso pendiente"; signals/`OnPush` sin fugas de cambio.
- **De contrato (frontend↔API con backend mock):** el `ApiService` nunca envía `workspaceId` en el cuerpo; mapea los DTO
  del Inc.1 sin pérdida.
- **Validación:** `npm run build` (sin warnings) + `npm run test:ci`. Sin datos reales ni canales.

---

### Incremento 3 — Gobierno de la continuidad, supervisión y escalamiento (backend)

**Objetivo.** Endurecer el gobierno del coordinador: **seguimiento de compromisos**, **detección de bloqueos**,
**escalamiento al humano** al agotar autoridad, **supervisión de otros agentes** dentro de la misión y **continuidad**
(suplencia/suspensión) sin perder estado — todo **respetando jerarquía y permisos** y enviando lo irreversible a
autorización humana.

**Alcance funcional.**
- **Seguimiento de compromisos.** Un "compromiso" es la obligación de entregar un resultado vinculado a la misión en una
  fecha (se deriva de `Tarea`/`ContratoResultado` vinculados, con su `plazo`). El coordinador consolida el estado de los
  compromisos por misión y marca los **vencidos/en riesgo**.
- **Detección de bloqueos.** Correlaciona `Incumplimiento`/`Excepcion` (E4/E7), dependencias vencidas y contradicciones de
  autoridad; genera un **evento de bloqueo** por misión. La detección periódica reusa el `schedule-reconciler` (sin cola
  nueva).
- **Escalamiento.** Al agotarse la autoridad del coordinador (p. ej. una decisión fuera de su nivel/empresa) o ante un
  bloqueo sin regla inequívoca, **crea una solicitud de decisión humana** dirigida al responsable según E3/E6 y **detiene
  la parte afectada** (no fuerza). El escalamiento **no** ejecuta efectos.
- **Supervisión de otros agentes (nuevo, acotado).** Dentro del alcance de la misión, el coordinador observa
  **metadatos de desempeño** de los agentes participantes (compromisos cumplidos/vencidos, excepciones, latencia,
  consumo imputado) y puede **recomendar** una corrección (reasignar, pausar, reentrenar). La **recomendación no es
  ejecución**: aplicarla es una acción de alto impacto que **requiere autorización humana** (E6). Supervisar **no**
  concede acceso a datos del agente (ADR 0007).
- **Continuidad.** Al **suspender** al coordinador (E6, `Suspension` alcance `AGENTE`), su **suplente** (E3) asume la
  coordinación; los `Objetivo`/`Tarea` autorizados **siguen**; el estado persiste; los humanos pueden reasignar en
  cualquier nivel. La misión no es punto único de fallo (RF40/QA14).
- **Resolución de contradicciones (QA10).** Órdenes contradictorias se resuelven por **autoridad vigente, prioridad y
  versión** reusando `hierarchy.rules.ts`; sin regla inequívoca → **detiene + pide decisión humana**; nunca introduce
  ciclos de supervisión.

**Entidades/contratos de datos (sin migrar; migración aditiva diferida a la etapa operativa).**
- **`MisionEvento`** (línea de tiempo auditable de la coordinación; entidad nueva **delgada y opcional**):
  `id`, `workspaceId`, `misionId`, `tipo` (`SEGUIMIENTO | BLOQUEO_DETECTADO | ESCALAMIENTO | SUPERVISION |
  DECISION_HUMANA_SOLICITADA | CONTINUIDAD`), `actorTipo` (`HUMANO | AGENTE`), `actorId`, `payload Json` (metadatos
  saneados, **sin datos sensibles**; referencias a `Incumplimiento`/`Excepcion`/`Aprobacion` por id), `requiereDecision
  Boolean`, `resueltoPor String?`, `resueltoAt DateTime?`, `createdAt`. Índice `@@index([workspaceId, misionId, tipo])`.
  Es **append-only** y alimenta el `AuditLog` (E13). Reemplaza heurísticas por un hecho explícito y trazable.
- **Compromisos y bloqueos como read-model derivado** (sin tabla nueva): `CompromisoMisionView`
  (`vinculoId`, `responsableAgentId`, `duenoLocalUserId`, `plazo`, `estado: EN_CURSO|EN_RIESGO|VENCIDO|CUMPLIDO`) y
  `BloqueoMisionView` (origen `Incumplimiento`/`Excepcion`/dependencia/contradicción + severidad), **calculados** sobre
  los vínculos del Inc.1 y E4/E7. No se duplica el trabajo ni su presupuesto.
- **Reutilización E6/E3 sin entidades nuevas:** escalamiento y supervisión-acción usan `Aprobacion`/`DecisionPolitica`;
  continuidad usa `Suspension` (alcance `AGENTE`) + suplencia de `modules/hierarchy`.
- Back-relation aditiva y opcional: `MisionTransversal.eventos MisionEvento[]`. Ninguna columna existente cambia.

**Interacción con jerarquía/permisos/gobierno.**
- **Jerarquía (E3/ADR 0011):** la autoridad del coordinador es la de su nivel, **acotada por empresa**; agotarla dispara
  escalamiento, no una orden. La suplencia la resuelve `modules/hierarchy` (sin ciclos, una sola `FUNCIONAL_PRINCIPAL`).
- **Permisos (ADR 0007/0014):** supervisar/escalar **no** concede acceso; cualquier reasignación solo transfiere
  **subconjuntos** de permisos del delegante.
- **Gobierno de acciones (E6/ADR 0013):** suspender/reasignar un agente o tarea, mover presupuesto o lanzar efectos pasa
  por `PolicyEngine`→`ActionGateway`→`Aprobacion`; el coordinador **no se autoaprueba** (`allowSelfApproval=false` para
  sus acciones; QA13) ni amplía presupuesto (ADR 0002).

**Puntos que exigen autorización humana.**
1. **Aplicar una recomendación de supervisión** (reasignar/pausar/reentrenar un agente) → `Aprobacion` humana (E6).
2. **Suspender/reactivar** al coordinador o a un agente supervisado → acción humana (E6, `Suspension`).
3. **Resolver un escalamiento o una contradicción sin regla** → **decisión humana** del responsable (E3); el sistema solo
   detiene y solicita.
4. **Mover presupuesto entre áreas** o lanzar cualquier efecto externo → `Aprobacion` humana; nunca automático.
5. **Reasignar la coordinación** fuera de la suplencia definida → acción humana.

**Criterios de aceptación.**
- El coordinador **no puede** aprobar su propia excepción, ampliar su presupuesto, otorgarse permisos ni borrar auditoría:
  cada intento queda **bloqueado y auditado** (QA13).
- Suspender al coordinador activa al suplente; los objetivos/tareas autorizados **siguen**; el estado persiste y los
  humanos pueden reasignar (QA14).
- Contradicción sin regla inequívoca → se **detiene** la parte afectada y se registra `DECISION_HUMANA_SOLICITADA`; no se
  crean ciclos de supervisión (QA10).
- Toda recomendación de supervisión que implique efecto genera una `Aprobacion` **pendiente**; ninguna se ejecuta sin
  decisión humana.
- Supervisar/escalar sobre otra empresa **no** abre sus datos (QA12).
- `MisionEvento` es append-only y cada hecho queda encadenado en el `AuditLog`.

**Plan de pruebas aisladas.**
- **Unitarias (TS puro, sin Nest/BD):** cálculo de `CompromisoMisionView` (EN_RIESGO/VENCIDO según `plazo`); clasificación
  de bloqueos; resolución de contradicciones reusando `hierarchy.rules.ts` (autoridad vigente/prioridad/versión);
  invariante "sin ciclos de supervisión".
  - **Ya construidas (diseño, no operativo):** la lógica de gobierno del coordinador está codificada como **módulo puro
    de especificación viva** en `apps/api/src/modules/missions/mission.governance.ts` (NO cableado al runtime: no lo
    importan el servicio, el controlador ni el `MissionsModule`) y cubierta por `mission.governance.spec.ts`. Codifica y
    prueba de forma aislada: clasificación de acciones que **requieren aprobación humana** (`requiereAprobacionHumana`,
    con conservadurismo "lo desconocido es alto impacto"); **no autoaprobación** y "solo un humano aprueba lo de alto
    impacto" (`validarAprobacion`, QA13); **delegación por subconjunto** sin ampliar (`delegacionPermitida`, ADR 0014/E5);
    **no ampliar/mover presupuesto** por el coordinador (`evaluarCambioPresupuesto`, RF40/QA13); **seguimiento de
    compromisos** (`clasificarCompromiso` EN_RIESGO/VENCIDO/EN_CURSO/CUMPLIDO); **detección y severidad de bloqueos**
    (`clasificarBloqueo`); **supervisar no concede acceso** (`proyectarSupervision` filtra a metadatos, ADR 0007);
    **resolución de contradicciones** (`resolverContradiccion`: autoridad→prioridad→versión o DETENER+escalar, QA10) y
    **sin ciclos de supervisión** (`supervisionTransversalValida`, reusa `creariaCiclo`). El **cableado operativo** de
    estas reglas al `PolicyEngine`/`ActionGateway`/`Aprobacion`/`Suspension` (E6) y a la suplencia de `hierarchy` (E3)
    queda **pendiente de la compuerta E-B** (ver "Pendiente de autorización operativa").
- **Integración API (Postgres/Redis locales, LLM mock):** QA13 (no autoaprobación / no ampliar presupuesto / no otorgarse
  permisos / no borrar auditoría); QA14 (suspender → suplente asume, estado persiste); QA10 (contradicción → detiene +
  escala); supervisión→recomendación produce `Aprobacion` pendiente, nunca efecto; multi-tenant/empresa en
  `MisionEvento` y en las vistas derivadas; un **agente no** crea/autoriza misiones ni se dota (`AGENTE_NO_CREA_AGENTES`).
- **Sin** canales reales, sin datos reales, sin gasto.

---

### Incremento 4 — Consola de misión: seguimiento agregado (backend + frontend)

**Objetivo.** Responder, por **misión transversal**, "¿cómo va el resultado que cruza varias áreas, cuánto cuesta y quién
lo está frenando?", **componiendo indicadores ya existentes** (E10), imputación (E9/ADR 0002) y excepciones (E4/E7), sin
cómputo paralelo ni sistema de métricas nuevo.

**Alcance funcional.**
- **Cumplimiento agregado:** % de resultados de negocio vinculados `ACEPTADO` (verificador ≠ ejecutor) y avance del
  indicador de misión vs. meta/línea base/plazo.
- **Costo por resultado transversal:** suma de `UsageRecord`/imputación (E9) de las tareas vinculadas, atribuida a la
  misión **por referencia** (no mueve presupuesto entre áreas).
- **Bloqueos y excepciones** por misión (desde el read-model del Inc.3), con quién frena y qué espera decisión humana.
- **Supervisión consolidada:** tablero del desempeño de los agentes participantes (compromisos, vencidos, excepciones,
  consumo), en **modo lectura**; las acciones siguen gatilladas por humanos (Inc.3).
- Expuesto como **consola de misión** en `modules/consolas` (que ya consolida por negocio/área/sede) + su pantalla web.

**Entidades/contratos de datos (sin migrar).** **No añade entidades**: es **proyección/agrupación por `misionId`** de lo
existente.
- `MissionDashboardDto`: `cumplimiento` (`aceptados`, `total`, `indicadorActual`, `meta`, `enPlazo`), `costo`
  (`imputadoPorArea[]`, `totalMision`, moneda), `bloqueos[]`, `excepciones[]`, `pendientesDecisionHumana[]`,
  `supervisionAgentes[]`. Todo **derivado**; endpoint `GET /v1/missions/:id/dashboard` (ya previsto en D3).
- Reusa `results/indicadores`, `governance/imputacion`, patrones de `consolas`.

**Interacción con jerarquía/permisos/gobierno.** Lectura filtrada por `workspaceId`/empresa y visibilidad ADR 0007: cada
usuario ve solo las métricas de las empresas/áreas a las que tiene alcance; la consola **no** abre datos ajenos por
agregar. El costo se **atribuye** por referencia; **no** reasigna presupuesto (eso es E6/humano).

**Puntos que exigen autorización humana.**
- La consola es **de solo lectura**; no ejecuta efectos.
- **Marcar la misión `LOGRADA`** (si la política lo propone automáticamente) requiere **confirmación del dueño humano**
  (decisión de producto abierta nº 5; propuesta: el sistema **propone** `LOGRADA`, el humano confirma).
- Cualquier acción originada desde la consola (reasignar costo, lanzar recuperación) redirige al gobierno humano (E6).

**Criterios de aceptación.**
- La agregación por `misionId` es **reproducible y determinista** a partir de los mismos datos; coincide con la suma de
  los indicadores/imputación/excepciones de los vínculos.
- Aislamiento multi-tenant/empresa: un usuario sin alcance a una empresa participante **no** ve su detalle de costo ni sus
  datos.
- La consola no ofrece acciones que ejecuten efectos; `LOGRADA` exige confirmación humana.
- Pantalla web `OnPush` + signals; **build sin warnings NG8113**.

**Plan de pruebas aisladas.**
- **Unitarias:** funciones de agregación (cumplimiento, costo, excepciones) con fixtures deterministas; propuesta de
  `LOGRADA` solo cuando contratos `ACEPTADO` + indicador cumplido.
- **Integración API:** `GET /v1/missions/:id/dashboard` con datos sintéticos; aislamiento multi-tenant/empresa;
  concordancia entre el dashboard y la suma de las fuentes.
- **Frontend:** render de la consola, sin acciones de efecto; `npm run build` + `npm run test:ci`.
- Sin datos reales, sin gasto.

---

### Incremento 5 — QA integral (API + e2e)

**Objetivo.** Verificar de extremo a extremo que la capacidad transversal **no rompe ningún invariante** antes de
proponer cualquier activación operativa, con el recorrido HU20 completo en entorno aislado.

**Alcance funcional.** Suites de integración (QA10/QA12/QA13/QA14, aislamiento multi-tenant/empresa, agente-no-crea/
autoriza-misiones) y **e2e** del recorrido: misión que cruza **dos empresas y tres áreas**, el coordinador detecta una
**dependencia vencida**, **propone recuperación**, **escala fuera de su autoridad**; un dueño local autoriza su parte;
los resultados de negocio se aceptan con **verificador ≠ ejecutor**; la consola de misión consolida cumplimiento/costo/
excepciones; se **suspende** al coordinador y el **suplente** da continuidad sin perder estado.

**Entidades/contratos de datos.** Ninguna nueva; solo fixtures/seed **sintéticos** y utilidades de prueba.

**Interacción con jerarquía/permisos/gobierno.** Las pruebas ejercitan precisamente los puntos de gobierno: aprobaciones
humanas, suspensión/suplencia, resolución de contradicciones y no-escalada de permisos.

**Puntos que exigen autorización humana.** La corrida de QA **no** autoriza producción: es evidencia para el **informe de
etapa**. La activación operativa la decide el patrocinador (ver "Pendiente de autorización operativa").

**Criterios de aceptación.**
- Suites en **verde** contra Postgres/Redis **locales**, con proveedores **mock** y datos **sintéticos** (US$ 0).
- Cobertura explícita de QA10/QA12/QA13/QA14 y de `AGENTE_NO_CREA_AGENTES`.
- Cada bug encontrado se acompaña de **la prueba que lo reproduce** (regla de `CLAUDE.md`).
- El e2e HU20 pasa completo, incluida la **continuidad tras suspensión**.

**Plan de pruebas aisladas.** Es, en sí, el incremento de pruebas: integración en `apps/api/**/*.spec.ts` y e2e en
`apps/web/e2e/**`, todo en sandbox, sin canales reales, sin datos reales y sin gasto.

---

### Orden de construcción por etapas y compuertas de revisión

Cada etapa produce evidencia y **se detiene en su compuerta** hasta que el patrocinador/arquitecto la revise; ninguna
habilita activación productiva por sí misma.

| Etapa | Incremento(s) | Entregable de la etapa | Compuerta de revisión (qué se verifica para avanzar) |
|---|---|---|---|
| E-A | Inc.2 (frontend) | Vista de coordinación sobre el backend del Inc.1 | Build web sin warnings NG8113; diferenciación humano/digital; acciones solo humano-gated; "no concede acceso" visible. Revisión UX del patrocinador. |
| E-B | Inc.3 (gobierno/continuidad/supervisión) | Seguimiento de compromisos, detección de bloqueos, escalamiento, supervisión acotada, suplencia | QA13/QA14/QA10 en verde en aislado; `MisionEvento` append-only auditado; recomendación de supervisión nunca ejecuta efecto. **Requiere migración aditiva de `MisionEvento` revisada.** |
| E-C | Inc.4 (consola) | `GET /v1/missions/:id/dashboard` + pantalla, como agregación pura | Agregación reproducible; aislamiento multi-tenant/empresa; consola de solo lectura; `LOGRADA` propuesta, no automática. |
| E-D | Inc.5 (QA integral) | Suites de integración + e2e HU20 en sandbox | Todo en verde con mocks/datos sintéticos; evidencia para el informe de etapa. |

**Dependencias:** E-A depende del Inc.1 (ya construido). E-C depende del read-model del Inc.3 (E-B) para bloqueos/
supervisión. E-D cierra sobre A–C. Dentro de cada etapa se respeta el orden del repo: **contrato de API → backend →
frontend → QA**.

**Dueños (matriz `docs/AGENTS-TEAM.md`):** Inc.2 → `nexo-frontend-ui` + `nexo-frontend-core`; Inc.3 →
`nexo-backend-platform` (+ coordinación con `modules/hierarchy` y `governance/actions`, dueño `nexo-backend-platform`);
Inc.4 → `nexo-backend-platform` + `nexo-frontend-ui`; Inc.5 → `nexo-qa-api` + `nexo-qa-e2e`. Diseño y revisión
transversal: `nexo-architect`.

### Pendiente de autorización operativa (no se ejecuta sin decisión del patrocinador)

- **Cableado operativo del gobierno del coordinador (Inc.3).** El módulo puro `mission.governance.ts` y sus pruebas
  aisladas están construidos (diseño verificado), pero **no están conectados** al runtime: conectarlos al
  `PolicyEngine`/`ActionGateway`/`Aprobacion`/`Suspension` (E6), a la suplencia de `hierarchy` (E3) y al
  `schedule-reconciler` (detección periódica de bloqueos) es implementación operativa sujeta a la **compuerta E-B**. El
  coordinador **no ejecuta ninguna acción con efecto** hasta esa etapa.
- **Migración de `MisionEvento`** y de las back-relations aditivas: diseñada aquí; su **aplicación** (`prisma migrate
  dev`) es parte de la implementación operativa del Inc.3, sujeta a la compuerta E-B.
- **Activación productiva** de cualquier incremento: fuera de alcance; esta autorización es de construir/diseñar/probar en
  aislado (§P2 del plan del patrocinador, "ADR 0016 Inc.2–5 operativo → revisión por etapas").
- **Decisiones de producto abiertas** (sección correspondiente del ADR), con impacto en el diseño operativo y que
  requieren decisión del negocio:
  1. Ubicación del módulo (`modules/missions` propio vs. dentro de `results/`).
  2. Rol/nivel mínimo para crear/autorizar misiones y para coordinar (¿`GERENTE` para misiones de menor alcance?).
  3. Alcance inter-empresa del coordinador sin asignación directa (afecta ADR 0011/0007).
  4. Presupuesto de misión: bolsa propia vs. solo agregación (propuesta: solo agrega; mover presupuesto → E6).
  5. `LOGRADA` automática vs. confirmación humana (propuesta: propone el sistema, confirma el dueño).
  6. Pasaporte de misión además del pasaporte por resultado (ADR 0014), según sector regulado.
  7. Versionado de la forma JSON de `MisionParticipante.alcance` y de `MisionEvento.payload` (misma disciplina que las
     definiciones de flujo).
- **Guardarraíl multisectorial:** todo lo anterior es **transversal, configurable por workspace y tipado por
  catálogo/política**; nada atado a una empresa, sector o proceso concreto (§4 del plan del patrocinador).
