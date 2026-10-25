# 0012. Trabajo por resultados y comunicación/handoff entre empleados digitales

- **Estado:** Propuesto
- **Fecha:** 2026-10-25
- **Responsables:** nexo-architect
- **Épicas:** E4 (Trabajo por resultados) y E5 (Colaboración y comunicación) de `docs/backlog-organizacion-digital.md`.
- **Requisitos:** RF07, RF08, RF29, RF30, RF31 (E4) · RF09, RF10, RF35, RF36 (E5) · HU04, HU05, HU14, HU15, HU16,
  HU17 · QA09, QA10, QA11.
- **Relacionado:** ADR 0010 (orquestación multi-modelo: verificación cruzada D4, trazabilidad D5) — se reutiliza para
  la verificación asistida de resultados. ADR de jerarquía de dirección digital (E3, en elaboración por otra cédula):
  provee niveles, autoridad y suplencia que este ADR consume para delegación, aceptación y escalamiento. ADR 0002
  (presupuestos jerárquicos). ADR 0008 (DataGuard, auditoría). Épica E7 (durabilidad: idempotencia, excepciones) —
  mecanismos que este ADR extiende. Motor de flujos en `apps/api/src/modules/workflows`.

## Contexto

NEXO ya ejecuta trabajo de forma durable: un `Workflow` (DAG) corre como `Execution` encolada en BullMQ
(`WorkflowProcessor`), con la bitácora por paso persistida en `Execution.steps`, reintentos con backoff por nodo
(`WorkflowEngine.runNode`), reconciliación de programaciones (`schedule-reconciler`) y un motor **TypeScript puro y
testeable sin Nest ni BD** (`engine/*`). Los agentes tienen expediente (ADR 0006), cargo y responsable humano
(`Agent.cargoId/responsableUserId/suplenteUserId`), nivel jerárquico (`Cargo.nivel`, `NivelJerarquico`) y ciclo de
vida completo (`LaunchStatus`). Cada ejecución registra consumo e imputación (`UsageRecord`, ADR 0002/0010).

Lo que **falta** para la gestión obligatoria por resultados (secciones 16 y 18 de la solicitud v3.0):

- **No existe el objeto "resultado".** Un flujo que termina con `status = SUCCEEDED` significa "el DAG corrió", no
  "el resultado de negocio fue verificado y aceptado". Hoy no se distingue un **producto intermedio** (un correo
  redactado) de un **resultado de negocio** (un recaudo confirmado por Tesorería). RF29/RF30 exigen un contrato con
  regla de validación determinista y evidencia exigida, y que **el ejecutor no sea la única fuente de validación**.
- **No hay gestión de incumplimientos (RF31).** Cuando un plazo está en riesgo o la evidencia es insuficiente, nada
  abre alerta, plan de recuperación, escalamiento ni límite de reintentos/gasto; un proceso podría quedar "activo"
  indefinidamente ocultando que no logró su resultado.
- **No hay comunicación estructurada entre agentes (RF35).** Los agentes no se asignan trabajo, aceptan, piden
  información, entregan, devuelven, bloquean, escalan ni cierran mediante mensajes persistentes, idempotentes y
  auditables. La "conversación" no es hoy una representación de registros operativos.
- **No hay continuidad de tarea / handoff (RF09, requisito del dueño).** Un agente no puede llevar una tarea hasta un
  **punto de corte** y que **otro agente o grupo** continúe desde el estado persistido, sin rehacer ni duplicar lo
  confirmado, bajo un **contrato de transferencia** que el receptor acepta o rechaza (RF33).
- **No hay coordinación transversal (RF36):** canales por misión/proceso/área, hilos, menciones, y la regla de que
  **toda solicitud de acción se convierte en tarea autorizada** — con prevención de ciclos y ruido.

Restricciones que la solución debe respetar (de `CLAUDE.md` y principios de la plataforma):

- El motor de flujos (`engine/*`) **sigue siendo TypeScript puro**: nada de Prisma, Nest ni colas dentro de él. Las
  dependencias externas entran por inyección (como `SubworkflowRunner`).
- **Multi-tenant estricto:** toda consulta filtra por `workspaceId` (de `@CurrentAuth()`), y además por **empresa**
  (`OrgUnit` tipo EMPRESA) cuando el dato es de empresa. Mencionar/referenciar no concede acceso (RF36, QA12).
- **Trabajo pesado y esperas van a workers/colas**, no a la API. Las esperas humanas y de handoff **no mantienen un
  worker ocupado** (RF19): se persiste el estado y se reanuda por evento.
- **Idempotencia por operación de negocio** (RF35, RF17, QA11): una redelivery no crea otra tarea ni otro efecto.
- **Compatibilidad hacia atrás:** los `Workflow`/`Execution` y las definiciones JSON existentes siguen válidos sin
  cambios; lo nuevo es **aditivo y opt-in** (un flujo sin contrato de resultado se comporta como hoy).
- **No introducir infraestructura nueva** (otra cola, otra base) sin justificarla: se reutiliza BullMQ, Postgres y la
  reconciliación cron existentes.
- La autoridad, delegación y suplencia las define el ADR de jerarquía (E3); este ADR las **consume**, no las redefine.

## Alternativas consideradas

### Sobre la representación del "resultado" (E4)

1. **Reutilizar `Execution.status` como estado del resultado.** Cero entidades nuevas, pero mezcla dos conceptos
   incompatibles: "el DAG corrió" ≠ "el resultado de negocio se verificó y aceptó". No permite distinguir producto
   intermedio de resultado de negocio, ni separar ejecución de verificación (RF30), ni sobrevivir a reorganizaciones
   (QA16). **Rechazada.**
2. **Un `ContratoResultado` como blob JSON dentro de `Tarea`.** Menos tablas, pero la regla de validación, la
   evidencia y el ciclo de estados del resultado necesitan ser consultables, auditables e inmutables una vez
   comprometidos; un JSON opaco impide índices, invariantes y trazabilidad por verificador. **Rechazada.**
3. **Entidades de primera clase `Objetivo`, `Tarea`, `ContratoResultado` + registros de validación, todas con
   `workspaceId`, empresa, vigencia e historial, enlazadas a `Execution`/`Agent` existentes.** Consultable,
   auditable, versionable, soporta separación ejecución/verificación e imputación por dimensión. **Elegida.**

### Sobre la continuidad/handoff (E5)

4. **Un solo `Execution` largo que cambia de agente en mitad del DAG, con el motor suspendiendo y reanudando dentro de
   la misma corrida.** Obliga a hacer el motor con estado y reanudable (persistir el runtime del DAG), rompe la pureza
   del `engine/*` y mantiene un contexto grande vivo durante esperas humanas. **Rechazada.**
5. **Handoff como orquestación a nivel de `Tarea`, por encima del motor puro: una `Tarea` se compone de uno o más
   `Execution` (segmentos), cada punto de corte cierra un segmento con estado HANDOFF y persiste un
   `ContratoTransferencia`; la aceptación del receptor encola el siguiente segmento con el estado transferido como
   entrada.** El motor sigue puro y síncrono por segmento; las esperas no ocupan worker porque cada segmento es un job
   discreto; reutiliza la cola, la bitácora y la reconciliación. **Elegida.**

### Sobre la comunicación (E5)

6. **Cola/evento efímero entre agentes (fire-and-forget).** No cumple RF35 (mensajes persistentes, hechos de
   entrega/recepción/aceptación/resolución distintos, idempotencia, auditoría). **Rechazada.**
7. **`MensajeAgente` persistente con `message_id` como clave de idempotencia, hechos de ciclo de vida separados, y
   despacho por la cola existente; la conversación visible es una proyección de estos registros.** Cumple RF35/RF36 y
   QA11. **Elegida.**

## Decisión

### D1. Modelo de trabajo por resultados (E4)

Tres entidades de dominio nuevas, más registros de evidencia, validación e incumplimiento. Todas con `workspaceId`,
empresa (`orgUnitId` de la empresa/área), **identificador estable**, **vigencia** (`validFrom`/`validTo`) e historial.

- **`Objetivo` (RF07).** Indicador, línea base, meta, plazo, dueño humano (`userId`) y responsable digital (`agentId`),
  área/línea de negocio a la que pertenece. Agrupa `Tarea`s. El sistema puede **proponer** planes, pero el objetivo y
  sus metas los autoriza un humano (dentro de atribuciones, límites y presupuesto, RF07).
- **`Tarea` (RF08).** Unidad de trabajo con `objetivoId?`, criterio de aceptación, entradas (Json), **responsable**
  (agente o equipo), dueño humano, prioridad, fecha límite, y **estado operativo** (`EstadoTarea`:
  `PENDIENTE | EN_EJECUCION | ESPERANDO_APROBACION | BLOQUEADA | EN_REVISION | COMPLETADA | FALLIDA_CANCELADA`, los de
  la sección 4 de la solicitud). Enlaza sus `Execution`(es), costos, decisiones y evidencia. Lleva `parentTareaId`,
  `profundidadDelegacion` y `correlationId` para delegación y control de ciclos (RF10). Distingue
  `tipoResultado: INTERMEDIO | NEGOCIO`.
- **`ContratoResultado` (RF29).** El resultado esperado como objeto verificable: resultado esperado, alcance, entradas,
  responsable digital, dueño humano, fecha, presupuesto, indicador, **`reglaValidacion` determinista** (Json:
  expresiones evaluadas con `common/template/template.engine.ts` o un validador declarativo; **nunca `eval`/`new
  Function`**), **`evidenciaExigida`** (tipos/fuentes de evidencia obligatorios), `tipoResultado`
  (`PRODUCTO_INTERMEDIO | RESULTADO_NEGOCIO`), `nivelRiesgo` y el **`estado del resultado`** (`EstadoResultado`, abajo).
  Una descripción libre **no** reemplaza el contrato (RF29). Un `ContratoResultado` **comprometido es inmutable**: un
  cambio crea una versión nueva (como las versiones publicadas, sección 10 de la solicitud).

**Ciclo del estado del resultado (`EstadoResultado`, RF31):**

`PROPUESTO → COMPROMETIDO → EN_PRODUCCION → PENDIENTE_VALIDACION → ACEPTADO` y la rama `DEVUELTO_INCUMPLIDO` desde
`PENDIENTE_VALIDACION` (devuelto para corrección) o por incumplimiento. Transiciones verificables:

| Estado | Condición verificable |
|---|---|
| `PROPUESTO` | Contrato creado, pendiente de validación/autorización. |
| `COMPROMETIDO` | Responsable, plazo y recursos aceptados (vía `MensajeAgente` de aceptación, D3). |
| `EN_PRODUCCION` | Trabajo en curso con evidencia parcial (segmentos de `Execution`). |
| `PENDIENTE_VALIDACION` | Entregable presentado; **aún no aceptado**. Dispara la verificación (D2). |
| `ACEPTADO` | El **verificador** (no el ejecutor) y la evidencia cumplen el contrato. |
| `DEVUELTO_INCUMPLIDO` | Requiere corrección o no se alcanzó el resultado; causa visible, abre recuperación (D2 bis). |

El estado operativo (`EstadoTarea`) y el estado del resultado (`EstadoResultado`) son **ortogonales**: una tarea puede
estar `COMPLETADA` como DAG y su resultado seguir `PENDIENTE_VALIDACION`. **Marcar `ACEPTADO` exige verificación
superada**, no que el ejecutor afirme haber terminado (HU15, QA09).

### D2. Verificación y aceptación: el ejecutor no valida su propio resultado (RF30)

Cuando una tarea alcanza `PENDIENTE_VALIDACION` se abre una **`ValidacionResultado`** cuyo **verificador es distinto
del ejecutor**. Invariante de aplicación: `ValidacionResultado.verificadorAgentId != Tarea.responsableAgentId` y, para
verificación humana, `validadorUserId != dueño ejecutor`. Modos de verificación según `nivelRiesgo` y el contrato:

1. **Determinista (preferida, RF30):** la `reglaValidacion` se evalúa contra la evidencia y los sistemas fuente
   (registro confirmado en el sistema destino, campos completos, conciliación, cálculo reproducible, regla de
   negocio). Es la vía por defecto cuando el contrato la admite; produce un veredicto reproducible y auditable.
2. **Humana (revisión):** un rol humano con alcance acepta/devuelve en la bandeja (reutiliza el patrón de aprobaciones
   de E6). Obligatoria para resultados de negocio sensibles según política.
3. **Asistida (verificación cruzada, reutiliza ADR 0010 D4):** un **modelo/agente distinto del ejecutor** (idealmente
   de otro fabricante) contrasta el entregable **con las fuentes** (conocimiento y entradas autorizadas, respetando
   DataGuard). Siguiendo la política por defecto de ADR 0010 D4/decisión 6: en tareas **informativas** un problema
   detectado **advierte**; antes de una **acción sensible** o de aceptar un **resultado de negocio**, un problema
   detectado **exige revisión humana** antes de aceptar. El consumo del verificador se mide e imputa como cualquier
   turno (ADR 0010 D5) y la traza registra `role = verify` y el motivo como **código auditable**, nunca razonamiento
   interno del modelo.

La `ValidacionResultado` persiste: verificador, modo, regla aplicada, veredicto (`ACEPTA | DEVUELVE`), evidencia
evaluada, fecha y actor. Una **devolución conserva versión y motivo** (HU14). El veredicto escribe el `AuditLog`
inmutable (E13).

**Evidencia y producto intermedio vs resultado de negocio.** La **`Evidencia`** referencia (no copia) el registro
fuente (id externo, hash, conector/ejecución de origen), respetando que el contenido externo es dato no confiable y
que compartir evidencia se hace por **referencia autorizada** (RF35). Un `ContratoResultado.tipoResultado =
PRODUCTO_INTERMEDIO` **no puede** satisfacer un objetivo cuyo resultado es de negocio: un correo de cobro enviado no
cierra el recaudo; el recaudo exige confirmación de Tesorería o del sistema financiero (sección 16).

### D2 bis. Gestión de incumplimientos (RF31)

Al **prever un vencimiento** (plazo en riesgo) o **detectar evidencia insuficiente** (verificación devuelta) se abre
un **`Incumplimiento`** con un **`PlanRecuperacion`**: responsable, plazo, y **límites explícitos** de reintentos,
gasto (presupuesto, ADR 0002) y ciclos de corrección. El escalamiento sube **al siguiente nivel digital** (jerarquía
E3) **y al humano** correspondiente según política. Al **agotar el límite** se declara `DEVUELTO_INCUMPLIDO` o
`BLOQUEADA`: **nunca se mantiene un proceso activo indefinidamente** para ocultar un resultado no logrado (RF31). La
detección de plazos en riesgo la ejecuta el **cron de reconciliación existente** (`schedule-reconciler`), extendido a
barrer fechas límite de tareas/contratos (no una cola nueva).

### D3. Protocolo de comunicación entre agentes (RF35)

Entidad **`MensajeAgente`** persistente con los campos mínimos de RF35: `messageId` (clave de idempotencia provista
por el emisor), `correlationId` (hilo de negocio), `workspaceId`, `empresaId`, `emisorAgentId`, destinatario
(`destinatarioAgentId` o canal/grupo), `misionId` (objetivo), `tareaId`, `tipo`, `prioridad`, `version`, `fechaLimite`,
`referencias` (Json: referencias **autorizadas** a evidencia/recursos, sin copiar datos sensibles), `permisos` (Json:
alcance que acompaña, **nunca amplía** atribuciones).

**Tipos (`TipoMensaje`):** `ASIGNACION | ACEPTACION | SOLICITUD_INFO | ENTREGA | DEVOLUCION | BLOQUEO | ESCALAMIENTO |
CIERRE | HANDOFF`.

**Hechos de ciclo de vida como registros distintos (RF35):** `enviadoAt`, `recibidoAt`, `aceptadoAt`, `resueltoAt`,
cada uno con actor y, para aceptación/rechazo, motivo. Se definen **tiempo máximo para confirmar recepción** y **tiempo
de respuesta por tipo**; vencidos, se enruta al **suplente** (`Agent.suplenteUserId`/suplente digital de E3) o se
**escala** (RF35, HU17). La detección de vencimientos reutiliza el cron de reconciliación.

**Idempotencia y deduplicación (RF35, QA11).** `@@unique([workspaceId, messageId])`: una redelivery del mismo
`messageId` **devuelve el mensaje existente** y **no crea otra tarea ni otro efecto** (reutiliza el concepto de
`IdempotencyKey` de E7). La acción de negocio derivada de un mensaje (p. ej. "crear la tarea asignada") se ejecuta
**una sola vez** protegida por la misma clave. El despacho usa la **cola BullMQ existente** (job por mensaje); la
conversación visible es una **proyección de solo lectura** de estos registros, no una fuente de verdad paralela.

**Seguridad (RF35, QA02, sección 2 de la solicitud):** un mensaje de otro agente que pida **saltarse una aprobación**,
ampliar permisos o trasladar datos a otra empresa se **rechaza y audita**. Un mensaje **no es autorización** para
ejecutar una herramienta (RF09): toda acción con efecto pasa igualmente por el motor de políticas (E6), la bandeja de
aprobaciones y el presupuesto. Las `referencias` entregan punteros autorizados; el receptor solo accede si sus
permisos efectivos lo habilitan (mencionar/referenciar no concede acceso).

### D4. Continuidad de tarea / handoff entre agentes o grupos (RF09, requisito del dueño)

El handoff es **orquestación a nivel de `Tarea`**, no un mecanismo interno del DAG (alternativa 5):

- Una **`Tarea` se compone de uno o más `Execution` (segmentos)**. Cada segmento lo ejecuta un agente/grupo y corre en
  el motor puro como hoy.
- Un **punto de corte** es un nodo/estado del flujo que cierra el segmento con resultado **HANDOFF** en vez de
  finalizar la tarea. Se persiste un **`ContratoTransferencia`** con: `tareaId`, `fromAgentId`, destino
  (`toAgentId`/grupo), **estado alcanzado** (referencia al snapshot persistido de la tarea y a la bitácora del
  segmento), **entregable parcial**, **contexto autorizado** (referencias, no copia de datos sensibles), **criterio
  del siguiente paso**, **permisos** del tramo entrante y **responsable entrante**. El contrato de transferencia es un
  `MensajeAgente` de `tipo = HANDOFF` más el registro estructurado.
- El **receptor acepta o rechaza** (RF33): la aceptación (un `MensajeAgente` de `ACEPTACION`) **encola el siguiente
  segmento** con el estado transferido como entrada; el rechazo (con motivo) devuelve al emisor o escala. **No se
  rehace ni se duplica** lo confirmado: el nuevo segmento parte del estado persistido (idempotencia por `tareaId` +
  `secuenciaSegmento`).
- **Trazabilidad de quién hizo qué:** la cadena de `ContratoTransferencia` + `Execution` + `ValidacionResultado`
  permite a la dirección consultar **quién encargó cada acción, quién la aceptó y qué resultado entregó** (sección 18,
  criterio de aceptación; QA06/QA11). Todo al `AuditLog` inmutable.

**Contratos de entrada/salida por paso (RF09, "modifica el motor DAG").** El motor puro se extiende de forma **aditiva
y compatible**: `WorkflowNode.config` admite `contratoEntrada?`/`contratoSalida?` (esquemas declarativos opcionales);
el `workflow.validator` los valida y el `engine` comprueba el contrato **antes** de activar la arista siguiente. Un
contrato incumplido **bloquea el paso siguiente y genera una `Excepcion`** (E7), sin `if (type === ...)` dispersos:
es una capacidad transversal del motor, no de un tipo de nodo. Las definiciones sin estos campos siguen válidas.

**Control de delegación (RF10).** `Tarea.profundidadDelegacion` y la cadena `parentTareaId` imponen **profundidad y
concurrencia máximas por proceso**; la detección de **ciclos** (un agente no puede, directa o transitivamente,
delegarse a sí mismo) se valida al crear la tarea/handoff. Reglas duras: **un agente no crea agentes productivos, no
aprueba su propia excepción ni amplía su presupuesto por instrucción generada** (RF10; alineado con ADR 0010 D7 y la
jerarquía E3). Al alcanzar un límite, el trabajo se **detiene** y se escala (QA10).

### D5. Coordinación transversal (RF36)

- **`Canal`** por **misión**, **proceso** o **área** (tipado `MISION | PROCESO | AREA`), con `orgUnitId`/`misionId` de
  alcance; **`HiloCanal`** (hilos) y publicaciones/menciones dentro del canal. Un canal entre empresas requiere
  **permiso explícito** (RF36/RF01).
- **Toda solicitud de acción se convierte en tarea autorizada:** una publicación/mención que pide una acción **no**
  ejecuta nada; genera una `Tarea` **solo tras validación de autoridad y aceptación** (D1/D3). Mencionar **no** asigna
  trabajo ni concede acceso (RF36, QA12). Esta regla la comparte con la Comunidad interna (E11), que reutilizará estas
  entidades.
- **Instrucciones contradictorias** se resuelven por **autoridad vigente, prioridad y versión del compromiso**
  (`MensajeAgente.version`, autoridad de E3). Si **no hay regla inequívoca**, se **detiene la parte afectada** y se
  pide decisión humana (RF36, QA10).
- **Prevención de ciclos y ruido:** límites de **intercambios por misión**, **profundidad de delegación** y **costo de
  coordinación** (presupuesto); **agrupación de novedades**; un agente **no responde automáticamente a cada
  publicación**; se detectan **conversaciones sin avance** y se **escalan** al superar el umbral acordado. La memoria
  compartida conserva fuente, propietario y permisos; **no es canal para ampliar atribuciones**.

### D6. Apoyo en el motor durable existente y qué se extiende

- **Se reutiliza tal cual:** la cola BullMQ (`WORKFLOW_QUEUE`, `WorkflowProcessor`), la bitácora por paso en
  `Execution.steps`, los reintentos con backoff por nodo, la cancelación por `AbortSignal`, la reconciliación cron
  (`schedule-reconciler`) y la pureza del motor (`engine/*`). El despacho de `MensajeAgente` y de segmentos de handoff
  son **jobs nuevos en la cola existente** (p. ej. `JOB_MESSAGE`, `JOB_SEGMENT`), no una cola nueva.
- **Se extiende de forma aditiva:**
  - El motor puro: `contratoEntrada/salida` en `WorkflowNode.config` + validación (D4); **no** se le añade BD ni
    estado persistente. El handoff vive en la capa de aplicación (como `SubworkflowRunner`, se inyecta un despachador).
  - `Execution` se vincula a `Tarea` (`tareaId?`) y a su número de segmento (`secuenciaSegmento?`), de forma opcional.
  - La reconciliación cron barre además fechas límite de `Tarea`/`ContratoResultado`/`MensajeAgente` para disparar
    alertas, suplencia y escalamiento (D2 bis/D3), sin proceso de cómputo mantenido durante la espera.
- **Esperas sin ocupar worker (RF19):** cada segmento de handoff y cada verificación/aprobación es un **job discreto**;
  entre ellos el estado vive en Postgres, no en memoria de un worker.

### D7. Invariantes

- **Tenant/empresa:** `workspaceId` obligatorio en toda entidad y toda consulta; el alcance de empresa/área se valida
  en consulta y en entrega (no por visibilidad de UI). Compartir entre empresas exige política expresa.
- **Idempotencia:** `@@unique([workspaceId, messageId])` en `MensajeAgente`; clave de idempotencia por operación de
  negocio derivada; `(tareaId, secuenciaSegmento)` único para segmentos. Una redelivery no duplica tarea ni efecto.
- **Separación ejecución/verificación:** verificador ≠ ejecutor (D2).
- **Vigencia e historia:** `validFrom`/`validTo` en objetivos, tareas, contratos, asignaciones y canales; **la
  estructura/compromiso histórico usado en cada ejecución se conserva** y una reorganización no altera resultados
  pasados (QA16).
- **No ciclos / límites de delegación:** profundidad, concurrencia y costo acotados; ciclos detectados y detenidos.
- **Inmutabilidad:** contrato de resultado comprometido y veredictos de validación son inmutables (nueva versión para
  cambios); todo al `AuditLog`.
- **Un mensaje no autoriza efectos:** las acciones con efecto pasan por políticas, aprobaciones y presupuesto.

## Consecuencias

### Esquema Prisma propuesto (bloque de referencia — lo aplica la cédula que edita `schema.prisma`)

> Este ADR **no** edita `schema.prisma`. Lo siguiente es el contrato de datos de referencia; la migración es
> **aditiva** y no toca `Workflow`/`Execution` salvo dos columnas opcionales. Respeta la regla de `CLAUDE.md` sobre
> índices generados manualmente (no afecta a `KnowledgeChunk.search` ni a `OrgUnit_root_per_workspace`).

```prisma
enum EstadoTarea {
  PENDIENTE
  EN_EJECUCION
  ESPERANDO_APROBACION
  BLOQUEADA
  EN_REVISION
  COMPLETADA
  FALLIDA_CANCELADA
}

enum EstadoResultado {
  PROPUESTO
  COMPROMETIDO
  EN_PRODUCCION
  PENDIENTE_VALIDACION
  ACEPTADO
  DEVUELTO_INCUMPLIDO
}

enum TipoResultado {
  PRODUCTO_INTERMEDIO
  RESULTADO_NEGOCIO
}

enum ModoValidacion {
  DETERMINISTA
  HUMANA
  ASISTIDA
}

enum VeredictoValidacion {
  ACEPTA
  DEVUELVE
}

enum TipoMensaje {
  ASIGNACION
  ACEPTACION
  SOLICITUD_INFO
  ENTREGA
  DEVOLUCION
  BLOQUEO
  ESCALAMIENTO
  CIERRE
  HANDOFF
}

enum EstadoTransferencia {
  PROPUESTO
  ACEPTADO
  RECHAZADO
}

enum TipoCanal {
  MISION
  PROCESO
  AREA
}

model Objetivo {
  id                 String    @id @default(cuid())
  workspaceId        String
  orgUnitId          String?   // empresa / área / línea de negocio
  codigo             String
  nombre             String
  indicador          String?
  lineaBase          String?
  meta               String?
  plazo              DateTime? // fecha de negocio
  duenoUserId        String?   // dueño humano
  responsableAgentId String?   // responsable digital
  validFrom          DateTime  @default(now())
  validTo            DateTime?
  tareas             Tarea[]
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  @@unique([workspaceId, codigo])
  @@index([workspaceId, orgUnitId])
}

model Tarea {
  id                   String           @id @default(cuid())
  workspaceId          String
  orgUnitId            String?
  objetivoId           String?
  titulo               String
  criterioAceptacion   String?
  entradas             Json             @default("{}")
  responsableAgentId   String?          // agente o equipo
  equipoId             String?
  duenoUserId          String?
  prioridad            Int              @default(3)
  fechaLimite          DateTime?
  estado               EstadoTarea      @default(PENDIENTE)
  tipoResultado        TipoResultado    @default(PRODUCTO_INTERMEDIO)
  contratoResultadoId  String?          @unique
  // Delegación y control de ciclos (RF10)
  parentTareaId        String?
  profundidadDelegacion Int             @default(0)
  correlationId        String?
  validFrom            DateTime         @default(now())
  validTo              DateTime?
  executions           Execution[]      // segmentos (relación aditiva en Execution)
  mensajes             MensajeAgente[]
  transferencias       ContratoTransferencia[]
  incumplimientos      Incumplimiento[]
  createdAt            DateTime         @default(now())
  updatedAt            DateTime         @updatedAt
  @@index([workspaceId, estado])
  @@index([workspaceId, objetivoId])
  @@index([parentTareaId])
}

model ContratoResultado {
  id                  String          @id @default(cuid())
  workspaceId         String
  tareaId             String?         @unique
  resultadoEsperado   String
  alcance             String?
  entradas            Json            @default("{}")
  responsableAgentId  String?
  duenoUserId         String?
  fecha               DateTime?
  presupuestoUsd      Decimal?        @db.Decimal(18, 8)
  indicador           String?
  reglaValidacion     Json            @default("{}") // declarativa; NUNCA eval
  evidenciaExigida    Json            @default("[]")
  tipoResultado       TipoResultado   @default(RESULTADO_NEGOCIO)
  nivelRiesgo         Int             @default(1)
  estado              EstadoResultado @default(PROPUESTO)
  version             Int             @default(1)
  comprometidoAt      DateTime?       // tras comprometer, inmutable (nueva versión para cambios)
  validaciones        ValidacionResultado[]
  evidencias          Evidencia[]
  createdAt           DateTime        @default(now())
  updatedAt           DateTime        @updatedAt
  @@index([workspaceId, estado])
}

model ValidacionResultado {
  id                  String              @id @default(cuid())
  workspaceId         String
  contratoResultadoId String
  modo                ModoValidacion
  // Invariante de aplicación: verificador != ejecutor (RF30)
  verificadorAgentId  String?
  validadorUserId     String?
  reglaAplicada       Json?
  veredicto           VeredictoValidacion
  motivo              String?             // código/razón auditable; para devolución conserva motivo
  evidenciaIds        String[]            @default([])
  createdAt           DateTime            @default(now())
  @@index([workspaceId, contratoResultadoId])
}

model Evidencia {
  id                  String   @id @default(cuid())
  workspaceId         String
  contratoResultadoId String?
  tareaId             String?
  tipo                String
  // Referencia autorizada a la fuente, NO copia de datos sensibles (RF35)
  referencia          Json     @default("{}") // { connectorOpId?, externalId?, executionId? }
  hash                String?
  createdAt           DateTime @default(now())
  @@index([workspaceId, contratoResultadoId])
}

model Incumplimiento {
  id                  String    @id @default(cuid())
  workspaceId         String
  tareaId             String
  causa               String
  responsableUserId   String?
  escalaAgentId       String?   // siguiente nivel digital
  planRecuperacion    String?
  plazo               DateTime?
  maxReintentos       Int       @default(0)
  maxCostoUsd         Decimal?  @db.Decimal(18, 8)
  intentos            Int       @default(0)
  resuelto            Boolean   @default(false)
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  @@index([workspaceId, tareaId])
}

model MensajeAgente {
  id                 String       @id @default(cuid())
  workspaceId        String
  empresaId          String?
  messageId          String       // idempotencia provista por el emisor
  correlationId      String?
  emisorAgentId      String?
  destinatarioAgentId String?
  canalId            String?
  misionId           String?      // objetivo
  tareaId            String?
  tipo               TipoMensaje
  prioridad          Int          @default(3)
  version            Int          @default(1)
  fechaLimite        DateTime?
  referencias        Json         @default("[]") // referencias autorizadas
  permisos           Json         @default("{}") // alcance que acompaña; nunca amplía
  // Hechos de ciclo de vida como registros distintos (RF35)
  enviadoAt          DateTime     @default(now())
  recibidoAt         DateTime?
  aceptadoAt         DateTime?
  resueltoAt         DateTime?
  motivo             String?      // para rechazo/devolución
  createdAt          DateTime     @default(now())
  @@unique([workspaceId, messageId]) // redelivery no duplica
  @@index([workspaceId, correlationId])
  @@index([workspaceId, tareaId])
}

model ContratoTransferencia {
  id                  String              @id @default(cuid())
  workspaceId         String
  tareaId             String
  secuenciaSegmento   Int                 // (tareaId, secuencia) único: no rehacer
  fromAgentId         String?
  toAgentId           String?
  toEquipoId          String?
  estadoAlcanzado     Json                @default("{}") // snapshot/referencias persistidas
  entregableParcial   Json?
  contextoAutorizado  Json                @default("[]")
  criterioSiguiente   String?
  permisos            Json                @default("{}")
  responsableEntranteUserId String?
  estado              EstadoTransferencia @default(PROPUESTO)
  motivoRechazo       String?
  mensajeId           String?             // MensajeAgente HANDOFF
  createdAt           DateTime            @default(now())
  decididoAt          DateTime?
  @@unique([workspaceId, tareaId, secuenciaSegmento])
  @@index([workspaceId, tareaId])
}

model Canal {
  id          String      @id @default(cuid())
  workspaceId String
  orgUnitId   String?
  tipo        TipoCanal
  misionId    String?
  nombre      String
  validFrom   DateTime    @default(now())
  validTo     DateTime?
  hilos       HiloCanal[]
  createdAt   DateTime    @default(now())
  @@index([workspaceId, tipo])
}

model HiloCanal {
  id          String   @id @default(cuid())
  workspaceId String
  canalId     String
  asunto      String
  tareaId     String?  // una solicitud puede volverse tarea autorizada
  createdAt   DateTime @default(now())
  @@index([workspaceId, canalId])
}
```

Relaciones aditivas en entidades existentes (las aplica la cédula del schema): `Execution.tareaId String?`,
`Execution.secuenciaSegmento Int?`; back-relations en `Agent` (`responsableDe Tarea[]`, etc.), `User` y `OrgUnit`.
`WorkflowNode.config.contratoEntrada/contratoSalida` son campos **de la forma JSON del flujo** (no del schema SQL): no
requieren migración, pero **sí** documentación de versión de la definición (son opcionales y retrocompatibles).

### Impacto en contratos de API (contrato → backend → frontend → QA)

- **Objetivos/Tareas:** `POST /v1/objetivos`, `POST /v1/tareas` (acepta `Idempotency-Key`), `GET /v1/tareas/:id`
  (estado operativo + estado de resultado + evidencia + costo), `POST /v1/tareas/:id/contrato`.
- **Resultados:** `POST /v1/contratos/:id/validar` (verificador ≠ ejecutor; soporta modo determinista/humano/asistido),
  `POST /v1/tareas/:id/devolver`, `POST /v1/tareas/:id/aceptar`.
- **Mensajes/handoff:** `POST /v1/mensajes` (idempotente por `messageId`), `POST /v1/mensajes/:id/recibir|aceptar|
  resolver`, `POST /v1/tareas/:id/handoff`, `POST /v1/transferencias/:id/aceptar|rechazar`.
- **Coordinación:** `POST /v1/canales`, `POST /v1/canales/:id/hilos`, `POST /v1/hilos/:id/convertir-en-tarea`.
- Todos los `@MinRole('EDITOR')` o superior en mutaciones; aceptación/validación según autoridad de E3; `workspaceId`
  y empresa de `@CurrentAuth()`, nunca del cuerpo. Errores consistentes, paginación y filtrado autorizado.

### Frontend (dueños frontend-ui/core)

- **Mi trabajo:** tareas, revisiones, aprobaciones, bloqueos con fechas, prioridad y siguiente acción.
- **Detalle de tarea/resultado:** estado operativo vs estado de resultado, contrato, evidencia, validación (quién
  verificó), cadena de handoff (quién encargó/aceptó/entregó), costos.
- **Canales/hilos:** diferenciar autor humano y digital; "convertir solicitud en tarea"; permisos en consulta y
  entrega. Reutiliza el design system (`styles.scss`), standalone + OnPush + signals; el build web sin warnings.

### Seguridad, rendimiento y escalabilidad

- Aislamiento multi-tenant y por empresa en consulta y entrega; mencionar/referenciar no concede acceso (QA12).
- Mensajes no autorizan efectos; acciones con efecto pasan por E6 (políticas/aprobaciones) y presupuesto (ADR 0002).
- `reglaValidacion`/contratos son JSON validado con `template.engine.ts`; **sin `eval`/`new Function`**.
- Idempotencia y deduplicación evitan efectos duplicados ante redelivery/caídas (QA04/QA11).
- Escala horizontal: todo el trabajo pesado y las esperas son jobs en BullMQ; la API queda sin estado; nada bloqueante
  nuevo en la API.

### Plan de pruebas

- **Unitarias (motor puro):** validación de `contratoEntrada/salida` por paso bloquea la arista y genera excepción;
  compatibilidad de definiciones sin contrato. (qa-api, engine spec)
- **Integración API:** verificador ≠ ejecutor (RF30, QA09: no cerrar con evidencia inválida); redelivery de mensaje no
  crea segunda tarea (QA11); handoff aceptado reanuda sin duplicar; límites de delegación/ciclos detienen y escalan
  (QA10); incumplimiento abre plan/escalamiento y respeta límites; aislamiento multi-tenant/empresa en
  mensajes/canales (QA12).
- **E2e:** proceso con tres niveles digitales, una dependencia entre áreas, un bloqueo, una devolución y una
  intervención humana (sección 20): meta desciende por niveles y consolida resultados sin duplicar indicadores (HU16);
  cada asignación tiene confirmación y plazo, la falta de respuesta activa suplencia/escalamiento (HU17).

## Preguntas abiertas para el dueño del producto

1. **Umbrales por defecto de comunicación y coordinación:** tiempo máximo de confirmación de recepción y de respuesta
   por tipo de mensaje; límites de intercambios por misión, profundidad de delegación y "costo de coordinación" antes
   de escalar (RF35/RF36). Propuesta: valores conservadores configurables por empresa.
2. **Equipos como responsables:** ¿`Tarea.responsable` puede ser un **equipo/grupo** además de un agente, y cómo se
   reparte dentro del equipo (líder asigna)? Afecta `equipoId` y el handoff a grupo.
3. **Modos de verificación obligatorios por riesgo:** qué niveles de `nivelRiesgo`/qué tipos de resultado de negocio
   **exigen** revisión humana vs admiten verificación asistida (ADR 0010 D4). Propuesta: acción sensible y resultado de
   negocio sensible → humana; informativo → asistida/advierte.
4. **Política ante ejecuciones omitidas de tareas programadas** y recálculo de fechas de negocio por zona horaria de la
   sede (RF18) cuando una tarea nace de una programación.
5. **Alcance de `reglaValidacion` determinista en P0:** ¿qué catálogo de validadores deterministas se soporta primero
   (campos completos, conciliación contra conector, cálculo reproducible) y cuáles quedan para P1?
6. **Relación con E6/E7 (gobierno y durabilidad):** estas épicas aportan `Aprobacion`, `Excepcion` e `IdempotencyKey`.
   Este ADR **asume** su existencia; si se construyen después, definir el orden para no duplicar la clave de
   idempotencia ni la bandeja de excepciones.

## Plan de implementación

Orden de dependencias: contrato de API (este ADR) → backend → frontend → QA. E4 antes que el handoff de E5 (el handoff
opera sobre el estado persistido de la tarea), y la comunicación antes que la coordinación transversal.

| Fase | Tarea | Dueño | Criterio de aceptación · Archivos afectados |
|---|---|---|---|
| 0 | Esquema aditivo (`Objetivo`, `Tarea`, `ContratoResultado`, `ValidacionResultado`, `Evidencia`, `Incumplimiento`, `MensajeAgente`, `ContratoTransferencia`, `Canal`, `HiloCanal` + enums; `Execution.tareaId/secuenciaSegmento`) y migración aditiva | nexo-backend-platform | Migración aplica sin tocar índices generados; `Workflow`/`Execution`/flujos existentes intactos. `apps/api/prisma/schema.prisma`, `prisma/migrations/**` |
| 1 | Dominio E4: objetivos, tareas, contrato de resultado, estados operativo y de resultado (ortogonales), tipo intermedio/negocio | nexo-backend-platform | Estados y transiciones verificables; contrato comprometido inmutable (nueva versión). `modules/results/**` (nuevo) |
| 2 | Verificación/aceptación (RF30): `ValidacionResultado` con verificador ≠ ejecutor; modo determinista + humano; integración de verificación asistida reutilizando ADR 0010 D4 | nexo-backend-platform (+ nexo-backend-ai para asistida) | No se acepta sin verificación superada (QA09); devolución conserva motivo/versión. `modules/results/**`, `modules/llm/**` |
| 3 | Incumplimientos (RF31): detección de plazos en el `schedule-reconciler`, plan de recuperación, escalamiento y límites de reintentos/gasto | nexo-backend-platform | Plazo en riesgo abre alerta/plan; al agotar límite declara incumplido/bloqueado; nunca activo indefinido. `modules/workflows/schedule-reconciler*.ts`, `modules/results/**` |
| 4 | Protocolo `MensajeAgente` (RF35): hechos de ciclo distintos, idempotencia `@@unique([workspaceId, messageId])`, despacho por `JOB_MESSAGE`, suplencia/escalamiento por vencimiento | nexo-backend-platform | Redelivery no crea segunda tarea (QA11); mensaje no autoriza efectos (QA02). `modules/messaging/**` (nuevo), `modules/workflows/queue/**` |
| 5 | Handoff (RF09/RF33): segmentos `Execution` por tarea, `ContratoTransferencia`, aceptar/rechazar, reanudar sin duplicar; contratos de entrada/salida por paso en el motor puro + validador | nexo-backend-platform | Handoff reanuda desde estado persistido sin rehacer (QA06/QA11); contrato incumplido bloquea y genera excepción. `modules/workflows/engine/workflow.types.ts`, `workflow.validator.ts`, `workflow-engine.ts`, `modules/messaging/**` |
| 6 | Control de delegación y ciclos (RF10): profundidad/concurrencia/costo, detección de ciclos, reglas duras (no crear agentes, no autoaprobar, no ampliar presupuesto) | nexo-backend-platform | Límite detiene y escala; ciclo detectado y rechazado (QA10). `modules/results/**`, `modules/messaging/**` |
| 7 | Coordinación transversal (RF36): `Canal`/`HiloCanal`, mención sin acceso, "solicitud → tarea autorizada", resolución de contradicciones y prevención de ruido | nexo-backend-platform (+ reutilizable por E11) | Mencionar no concede acceso ni asigna (QA12); contradicción sin regla detiene y pide decisión humana. `modules/collaboration/**` (nuevo) |
| 8 | API REST versionada de objetivos/tareas/resultados/mensajes/handoff/canales con `@MinRole`, idempotencia y DTOs `class-validator` | nexo-backend-platform | Swagger actualizado; `workspaceId`/empresa de `@CurrentAuth()`; errores consistentes. `modules/*/dto/**`, `*.controller.ts` |
| 9 | Frontend: Mi trabajo, detalle tarea/resultado, cadena de handoff, canales/hilos; diferenciar autor humano/digital | nexo-frontend-ui + nexo-frontend-core | Build sin warnings NG8113; OnPush + signals; permisos en UI coinciden con servidor. `apps/web/src/app/features/**` |
| 10 | QA: integración (RF30, QA09/10/11/12, idempotencia) y e2e del proceso de tres niveles con bloqueo, devolución e intervención humana | nexo-qa-api + nexo-qa-e2e | Suites en verde contra Postgres/Redis reales; recorridos HU04/05/14/15/16/17. `*.spec.ts`, `apps/web/e2e/**` |
