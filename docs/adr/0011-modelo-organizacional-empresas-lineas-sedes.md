# 0011. Modelo organizacional: grupo, empresas, líneas de negocio, sedes y centros de costo

- **Estado:** Aceptado (implementado y validado, 2026-10-26)
- **Fecha:** 2026-10-25
- **Responsables:** nexo-architect
- **Relacionado:** ADR 0002 (presupuestos), ADR 0007 (visibilidad y permisos), ADR 0010 (orquestación). Épica E1 (y E9)
  del backlog `docs/backlog-organizacion-digital.md`; RF01, RF41–RF47 de la Solicitud v3.0 (secciones 21–23).

## Contexto

NEXO hoy modela la organización con un único árbol `OrgUnit` (jerárquico, con `allowedModels`, `Budget`, `BudgetLedger`,
`BudgetAlert` y `UsageRecord` colgando de él) y la pertenencia de usuarios por `Membership.orgUnitId`. El consumo de un
agente sin usuario se imputa a `Agent.costCenterId`, que **hoy apunta al mismo `OrgUnit`**: centro de costo y unidad
organizacional son la misma entidad. La identidad del empleado digital (E2) ya añadió `Cargo`, `NivelJerarquico` y los
estados de ciclo de vida.

La Solicitud v3.0 (secciones 21–23, RF41–RF47) eleva a P0 representar la organización **como una compañía real** con
tres dimensiones que hoy están colapsadas en una sola:

1. **Jerárquica/funcional:** grupo → empresa → unidad de negocio → área funcional → departamento → equipo.
2. **De negocio:** líneas de negocio (oferta económica con clientes, procesos y metas) que **cruzan** áreas y empresas.
3. **Territorial:** sedes (ubicación, calendario, zona horaria).
4. **Económica:** centros de costo (destino del consumo e imputación), explícitamente distintos del área (RF42).

Y añade la **matricialidad** (RF42): un mismo empleado digital atiende varias líneas/sedes/proyectos con **alcance y
vigencia**, sin que eso signifique duplicarlo; los **servicios compartidos** (RF44) reparten su costo al 100 % entre las
líneas servidas (RF45); el organigrama **no concede acceso** (RF46); y la estructura histórica usada en cada ejecución
debe preservarse aunque la organización se reorganice (RF46, QA16).

Restricciones que condicionan el diseño:

- **Multi-tenant por `workspaceId`** (regla dura de `CLAUDE.md`): todo lo nuevo filtra por workspace.
- **Compatibilidad hacia atrás** de datos ya guardados: `OrgUnit`, `Budget`, `Membership.orgUnitId`, `Agent.costCenterId`
  y `UsageRecord` existentes deben seguir funcionando; migración **aditiva** (ADR 0009).
- **Simplicidad:** no introducir infraestructura nueva (este ADR es solo modelo de datos + reglas; no agrega colas,
  servicios ni bases).

## Alternativas consideradas

### A. ¿Empresa = Workspace, o empresa dentro del Workspace?

1. **Cada empresa es un `Workspace` y el grupo es una relación entre workspaces.**
   - Ventaja: aislamiento físico por empresa "gratis".
   - Desventaja: rompe el modelo de tenancy (toda consulta asume un `workspaceId`); el grupo pasa a ser cross-tenant,
     obligando a consolidación y permisos cross-workspace en todas partes; las líneas de negocio y servicios que cruzan
     empresas serían imposibles sin una capa nueva. Alto re-trabajo y riesgo de fuga. **Descartada.**
2. **El Workspace es la organización/grupo contratante; grupo y empresas viven dentro como `OrgUnit` tipados.** El
   aislamiento entre empresas se aplica por **ámbito de permiso** (empresaId efectivo), no por tenant. **Elegida (D1).**
   - Ventaja: conserva la tenancy actual y todo el endurecimiento; líneas, sedes y servicios pueden cruzar empresas
     dentro del grupo; la consolidación es una consulta, no una federación.
   - Desventaja: el aislamiento inter-empresa es lógico, no físico; hay que probarlo (QA01) en empresa como una
     dimensión más del permiso efectivo.

### B. ¿Extender `OrgUnit` con `tipo`, o una entidad por nivel?

1. **Una tabla por nivel** (`Grupo`, `Empresa`, `UnidadNegocio`, `Area`, …). Rígido: impide los niveles opcionales que
   pide RF41 ("no imponer todos los niveles"), multiplica joins y duplica la lógica de árbol ya probada. **Descartada.**
2. **Extender `OrgUnit` con un discriminador `tipo` + jerarquía de árbol existente.** Es la dimensión **jerárquica/
   funcional** completa en un único árbol auto-referido, con reglas de anidamiento por `tipo`. **Elegida (D2).**

### C. ¿Dónde viven línea de negocio, sede y centro de costo?

1. **Como nodos del mismo árbol `OrgUnit`.** Colapsa de nuevo las dimensiones (lo que RF42 prohíbe: área ≠ centro de
   costo; empresa ≠ línea). **Descartada.**
2. **Entidades propias, ortogonales al árbol, referenciadas por `AsignacionOrganizacional` e imputación.** **Elegida
   (D3).** Son dimensiones de etiquetado, no de jerarquía de mando.

### D. ¿Cómo representar la matriz sin duplicar empleados?

1. **Clonar el agente por cada línea/sede.** Viola RF42 (no duplicar empleados ni ejecuciones) y rompe costos. **Descartada.**
2. **`AsignacionOrganizacional`: una relación con identificador estable, alcance y vigencia** entre el agente (o usuario)
   y la dimensión destino (área, línea, sede, proyecto). **Elegida (D4).**

### E. ¿Tres dimensiones fijas, o un marco de dimensiones configurables (estilo NetSuite / SAP)?

1. **Tres dimensiones fijas en el esquema** (`LineaNegocio`, `Sede`, `CentroCosto` y nada más). Simple, pero cada vez que
   un cliente necesite una dimensión analítica propia (Proyecto, Cliente, Producto, Canal, Campaña…) exigiría cambio de
   esquema y migración — lo contrario a la flexibilidad que piden los ERP de referencia. **Insuficiente.**
2. **Un marco de dimensiones configurables por el administrador** (análogo a los *custom segments* de NetSuite y a las
   *características* de SAP CO-PA): el cliente define sus dimensiones y sus valores (jerárquicos opcionales) **sin tocar
   el esquema**, y cualquier ejecución/tarea/costo se etiqueta con ellas para reportar y consolidar por cualquier
   combinación (pivot). Las tres dimensiones de negocio se conservan como **integradas de ejemplo**. **Elegida (D8).**

## Decisiones

### D1. El Workspace es la organización (grupo contratante); las empresas son `OrgUnit` tipadas

- El `Workspace` sigue siendo el tenant. Dentro de él, **grupo** y **empresa** son `OrgUnit` con `tipo = GRUPO` / `EMPRESA`.
- **`empresaId` se vuelve una dimensión de permiso efectivo** (no solo de organigrama): el ámbito de un usuario/agente se
  acota por empresa, además de por rol y por share (ADR 0007). El aislamiento inter-empresa (RF01/QA01) se verifica como
  denegación por defecto cuando el `empresaId` del recurso no está en el alcance autorizado del solicitante.
- **Compartir datos entre empresas exige política expresa** (RF01): no hay acceso implícito entre empresas del mismo
  grupo. El mecanismo concreto (una `PoliticaCompartir` o un share con `scope: EMPRESA`) se detalla en la épica de
  gobierno (E6) y queda fuera de este ADR salvo la regla: *denegación por defecto entre empresas*.

> **Pregunta de negocio (abierta):** ¿habrá clientes que necesiten aislamiento **físico** por empresa (una empresa =
> un Workspace) por exigencia regulatoria? Si sí, se añade después un modo "grupo = federación de workspaces" sin tocar
> este diseño intra-workspace.

### D2. `OrgUnit` extendido con `tipo` + vigencia = dimensión jerárquica/funcional

- Nuevo enum `OrgUnitTipo { GRUPO, EMPRESA, UNIDAD_NEGOCIO, AREA_FUNCIONAL, DEPARTAMENTO, EQUIPO }`. `OrgUnit` gana:
  `tipo`, `empresaId` (el `OrgUnit` `EMPRESA` ancestro, desnormalizado para filtrar barato), `proposito`,
  `responsableUserId` (responsable humano), `responsableAgentId` (responsable digital, cuando aplique), `estado`
  (`ACTIVA` | `SUSPENDIDA` | `CERRADA`), `vigenciaDesde`, `vigenciaHasta` (RF43).
- **Reglas de anidamiento por `tipo`** (validadas en servicio, no solo en BD): `GRUPO` es raíz y opcional; `EMPRESA`
  cuelga de `GRUPO` o es raíz; `UNIDAD_NEGOCIO`/`AREA_FUNCIONAL` cuelgan de `EMPRESA`; `DEPARTAMENTO` de área/unidad;
  `EQUIPO` de departamento/área. **No se imponen todos los niveles** (RF41): un `EQUIPO` puede colgar directo de
  `EMPRESA` si la empresa es pequeña.
- **Prohibición de ciclos** (QA15): el árbol se valida con la lógica existente de `OrgTree` (la relación ya usa
  `onDelete: Restrict`); la validación de "sin ciclos" se refuerza en el servicio al mover unidades.
- **Compatibilidad:** las `OrgUnit` existentes migran con `tipo = AREA_FUNCIONAL` (valor por defecto neutro) y
  `empresaId = null`; siguen portando `Budget`/`ledger`/`usage` sin cambios. `allowedModels` se conserva.

### D3. Tres entidades ortogonales nuevas: `LineaNegocio`, `Sede`, `CentroCosto` (dimensiones integradas de ejemplo)

Ninguna es parte del árbol de mando; todas filtran por `workspaceId` y referencian su `empresa` (`OrgUnit` `EMPRESA`).
Son **dimensiones integradas de ejemplo**: modelan de forma de primera clase las tres dimensiones que la Solicitud nombra
explícitamente (negocio, territorial, económica), con sus campos propios (zona horaria, calendario, acuerdo de servicio,
etc.). El cliente puede añadir **las suyas** mediante el marco configurable de D8 sin cambios de esquema.

- **`LineaNegocio`** (dimensión de negocio, RF41/RF43): `empresaId`, `unidadNegocioId?` (un `OrgUnit` `UNIDAD_NEGOCIO`),
  `codigo`, `nombre`, `proposito`, `responsableUserId`, `responsableAgentId?`, catálogo de productos/servicios, metas,
  `estado`, `vigenciaDesde/Hasta`. Una línea **cruza** áreas; una área puede servir a varias líneas (RF42). La
  información comercial/financiera aquí **no reemplaza** al sistema de origen (RF43).
- **`Sede`** (dimensión territorial, RF41): `empresaId`, `codigo`, `nombre`, `zonaHoraria` (IANA), `calendario`
  (festivos/días hábiles), `alcanceTerritorial`, `estado`, `vigencia`. Las áreas **no se duplican por sede** salvo
  necesidad operativa (nota del ejemplo de la sección 23); la sede es una etiqueta, no un sub-árbol.
- **`CentroCosto`** (dimensión económica, RF41/RF45): `empresaId`, `codigo`, `nombre`, `estado`, `vigencia`, y
  opcionalmente `orgUnitId?`/`lineaNegociaId?` por defecto. **No concede permisos** (regla explícita, RF41). Separa
  formalmente "área" de "centro de costo" (RF42).

### D4. `AsignacionOrganizacional`: la matriz, con alcance, vigencia e historial — sin duplicar

- Una fila por relación entre un **sujeto** (`agentId` **o** `userId`, exactamente uno) y una **dimensión destino**
  (una de: `orgUnitId` área/equipo, `lineaNegociaId`, `sedeId`, `proyectoId` futuro), con:
  - `tipoAsignacion`: `FUNCIONAL_PRINCIPAL` (el área y superior funcional principales, único por sujeto vigente) |
    `LINEA` | `SEDE` | `PROYECTO` | `SERVICIO`.
  - `alcance` (`Json` o `String[]`): qué habilita operativamente la asignación (p. ej. procesos/tareas), **no** acceso a
    datos (ver D6).
  - `rol` en esa dimensión (colaborador, revisor, responsable de proceso) para resolver autoridad (RF33/RF42).
  - `vigenciaDesde`, `vigenciaHasta?`, `estado`, `creadaPorUserId`. **Identificador estable** (`id` cuid) que sobrevive
    a la reorganización (RF42, QA16).
- **No se duplica el agente ni sus ejecuciones:** la multiplicidad es de filas de asignación, no de agentes (RF42/D).
- **Una única autoridad final por misión** (RF42/RF34): a lo sumo una `AsignacionOrganizacional` con `tipoAsignacion =
  FUNCIONAL_PRINCIPAL` vigente por sujeto; las demás son transversales. El conflicto entre dos autoridades sobre una
  misma tarea se detiene y escala (E3/E5), fuera de este ADR.
- **Historial:** cerrar una asignación pone `vigenciaHasta`; nunca se borra. Mover un equipo (QA16) = cerrar la
  asignación/relación anterior y abrir otra; las ejecuciones pasadas ya guardaron su dimensión (D5), así que su
  atribución **no cambia**.

### D5. Imputación de costos: dimensiones en `UsageRecord`, servicios compartidos y una sola reserva (RF45/E9)

- **`UsageRecord` gana dimensiones de imputación opcionales**, capturadas **en el momento de la ejecución** (snapshot
  histórico, RF46/QA16): `empresaId`, `areaEjecutoraId` (`OrgUnit`), `lineaBeneficiariaId` (`LineaNegocio`),
  `centroCostoId` (`CentroCosto`), `sedeId`. Son *etiquetas* del gasto ya medido; **no** cambian cómo se calcula el costo
  (ADR 0002 sigue vigente).
- **El presupuesto y la reserva siguen viviendo en `OrgUnit`/`Budget`** (compatibilidad total con ADR 0002). La
  "unidad de reserva" de una acción es **una sola** (la del agente/ejecución), evitando dos reservas para la misma
  acción (RF45). La línea beneficiaria y el centro de costo son dimensiones de **reporte**, no un segundo libro mayor.
- **Servicios compartidos** (RF44): `ServicioInterno` describe un proceso que un área **provee** a otras líneas/áreas
  (área dueña, responsable humano/digital, acuerdo de servicio, entradas/salidas, clientes internos). Su costo se
  reparte con `ImputacionCosto`: filas `{ servicioInternoId, periodoKey, destino (lineaNegociaId|orgUnitId|centroCostoId),
  porcentaje }` cuya **suma por servicio y periodo = 100 %** (restricción de aplicación, verificada al guardar y en la
  consolidación). La consolidación reparte el costo agregado del servicio entre destinos **sin doble conteo** (QA24/HU24):
  el total imputado = total medido.

> **Pregunta de negocio (abierta):** ¿el reparto de servicios compartidos es por **porcentaje fijo** configurado, o por
> **driver** (nº de ejecuciones/tareas/horas atribuibles por línea)? El modelo soporta porcentajes en P0; un driver
> calculado es una extensión P1. También: ¿puede un `Budget`/tope duro colgar de una `LineaNegocio` o `CentroCosto`,
> además de `OrgUnit`? (Hoy no; requeriría decidir la unidad de reserva.)

### D6. El organigrama NO concede acceso; el permiso efectivo es explícito (RF46)

- Ni `OrgUnit`, ni `LineaNegocio`, ni `Sede`, ni `AsignacionOrganizacional`, ni `CentroCosto` otorgan por sí mismos
  acceso a datos o herramientas. El **permiso efectivo** se sigue resolviendo por el sistema existente (rol de
  `Membership` + visibilidad/shares de agente del ADR 0007), **acotado además por `empresaId`** (D1) y, cuando aplique,
  por la dimensión aprobada.
- Una **asignación transversal** (`LINEA`/`SEDE`/`PROYECTO`) habilita **solo el alcance aprobado** en su campo `alcance`
  y no traslada datos a otra empresa sin política expresa (RF01/RF46). Mencionar o asignar **no** concede acceso al
  documento ni al recurso (coherente con E11/RF37).
- **Cambios de estructura** (crear/mover/fusionar/suspender/cerrar) validan primero tareas, presupuestos y responsables
  pendientes (RF46): no se cierra una unidad con trabajo o reserva abiertos sin reasignar.

### D7. Consolas = proyecciones de lectura, sin denormalizar (RF47)

- Las vistas **organizacional / funcional / por negocio / por sede** son consultas sobre las mismas entidades (árbol
  `OrgUnit`, `LineaNegocio`, `Sede`, imputación en `UsageRecord`). No se crean tablas espejo: la vista por negocio
  agrupa por `lineaBeneficiariaId`, la de sede por `sedeId`, etc.
- El gerente de línea ve resultados y consumo de su línea **incluyendo los servicios compartidos recibidos** (RF47),
  resolviendo `ImputacionCosto`. El director de área ve el trabajo transversal autorizado. Todo acotado por el permiso
  efectivo (D6).
- Las consolas filtran y agrupan por **cualquier** dimensión configurada (D8), no solo por las tres integradas.

### D8. Marco de dimensiones configurables (estilo NetSuite / SAP CO-PA)

Requisito del dueño del producto: el sistema debe soportar **dimensiones definidas por el cliente**, no solo tres fijas,
para ser tan flexible como un ERP (NetSuite *custom segments*, SAP CO-PA *características*). Se añade un framework de
etiquetado analítico, ortogonal a todo lo anterior.

- **`Dimension` (definición, por empresa/organización):** el administrador define una dimensión con `codigo`, `nombre`,
  `tipoValor` (`LISTA` con valores propios | `REFERENCIA` a una entidad existente como `LineaNegocio`/`Sede`/`OrgUnit` |
  `TEXTO`/`NUMERO`), `jerarquica` (si sus valores forman árbol), `obligatoria` (y `obligatoriaParaEfectoEconomico`),
  `aplicaA` (conjunto de entidades/acciones etiquetables: ejecución, tarea, costo, agente, unidad, línea, servicio…),
  `estado` y vigencia. Es **metadato de configuración**, versionado por vigencia.
- **`DimensionValue` (valores, jerárquicos opcionales):** `dimensionId`, `codigo`, `nombre`, `padreId?` (jerarquía para
  roll-up tipo NetSuite), `estado` (`ACTIVA`/`INACTIVA`), vigencia. Un valor `INACTIVO` **no se asigna a trabajo nuevo**
  pero se conserva para el histórico.
- **`DimensionAssignment` (etiquetado):** vincula un `dimensionValueId` (o valor literal para `TEXTO`/`NUMERO`) a una
  entidad etiquetable (`targetType` + `targetId`: ejecución, tarea, costo, `OrgUnit`, `LineaNegocio`, `ServicioInterno`,
  agente…). Permite que una misma ejecución lleve N dimensiones. Filtra por `workspaceId`.
- **Las tres dimensiones integradas (D3) se exponen también como `Dimension` de sistema** (`esSistema = true`,
  `tipoValor = REFERENCIA`), para que las consolas las traten de forma uniforme junto a las del cliente. No se duplican
  los datos: la `Dimension` de sistema apunta a la entidad real (`LineaNegocio`/`Sede`/`CentroCosto`); las propias del
  cliente (Proyecto, Cliente, Producto, Canal, Campaña…) usan `DimensionValue`. **Añadir una dimensión no cambia el
  esquema.**
- **Snapshot histórico (RF46/QA16):** al despachar/registrar trabajo, las dimensiones vigentes aplicables se **congelan**
  junto al hecho económico. En `UsageRecord` (y en el estado persistido de la ejecución/tarea) se guarda un
  `dimensiones Json` = mapa `{ dimensionCodigo: valorCodigo|valor }` capturado en ese instante, además de las columnas
  integradas de D5. Reorganizar dimensiones o inactivar valores **no altera** los hechos pasados. Las consolas
  consolidan y pivotan por **cualquier combinación** de dimensiones leyendo ese snapshot; la regla de no doble conteo de
  D5 se mantiene (el costo medido es uno solo; las dimensiones son etiquetas, no libros mayores paralelos).
- **Integridad:** (a) una `Dimension` `obligatoria`/`obligatoriaParaEfectoEconomico` **se valida al despachar trabajo con
  efecto económico** (RF11/RF45): sin su valor, la acción no se despacha; (b) `DimensionValue` `INACTIVO` o fuera de
  vigencia no es asignable a trabajo nuevo, pero permanece en el histórico y en los reportes del periodo en que estuvo
  vigente; (c) `jerarquica` ⇒ sin ciclos en `padreId`; (d) `tipoValor = REFERENCIA` ⇒ el valor debe existir y pertenecer
  a la misma empresa/workspace; (e) unicidad de `codigo` por `(workspaceId, empresaId)`.
- **Los permisos NO se derivan de las dimensiones** (coherente con D6/RF46): etiquetar una ejecución con un `Proyecto` o
  `Cliente` no concede acceso a ese proyecto o cliente. El permiso efectivo sigue siendo rol + share + empresa.

## Esquema Prisma propuesto (referencia, NO es la migración)

> Bloque ilustrativo para alinear a `backend-platform`. El campo exacto, índices y `onDelete` se fijan en la migración
> aditiva. `OrgUnit` solo muestra los campos **nuevos**.

```prisma
enum OrgUnitTipo { GRUPO EMPRESA UNIDAD_NEGOCIO AREA_FUNCIONAL DEPARTAMENTO EQUIPO }
enum EstadoEstructura { ACTIVA SUSPENDIDA CERRADA }
enum TipoAsignacion { FUNCIONAL_PRINCIPAL LINEA SEDE PROYECTO SERVICIO }

model OrgUnit {
  // ...campos actuales (id, name, code, allowedModels, parentId, workspaceId, budget, ledger, usage, ...)
  tipo              OrgUnitTipo      @default(AREA_FUNCIONAL)
  empresaId         String?          // OrgUnit EMPRESA ancestro (desnormalizado para filtrar por empresa)
  proposito         String?
  responsableUserId String?
  responsableAgentId String?
  estado            EstadoEstructura @default(ACTIVA)
  vigenciaDesde     DateTime?
  vigenciaHasta     DateTime?
  // nuevas relaciones inversas: lineasNegocio, sedes, centrosCosto, asignaciones, serviciosDueno
  // @@index([workspaceId, tipo]); @@index([workspaceId, empresaId])
}

model LineaNegocio {
  id                String           @id @default(cuid())
  workspaceId       String
  empresaId         String           // OrgUnit EMPRESA
  unidadNegocioId   String?          // OrgUnit UNIDAD_NEGOCIO
  codigo            String
  nombre            String
  proposito         String?
  responsableUserId String?
  responsableAgentId String?
  catalogo          Json             @default("{}") // productos/servicios, clientes, metas (no reemplaza origen)
  estado            EstadoEstructura @default(ACTIVA)
  vigenciaDesde     DateTime?
  vigenciaHasta     DateTime?
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt
  @@unique([workspaceId, empresaId, codigo])
  @@index([workspaceId, empresaId])
}

model Sede {
  id            String           @id @default(cuid())
  workspaceId   String
  empresaId     String
  codigo        String
  nombre        String
  zonaHoraria   String           // IANA, p. ej. "America/Bogota"
  calendario    Json             @default("{}") // festivos, días hábiles
  alcanceTerritorial String?
  estado        EstadoEstructura @default(ACTIVA)
  vigenciaDesde DateTime?
  vigenciaHasta DateTime?
  @@unique([workspaceId, empresaId, codigo])
  @@index([workspaceId, empresaId])
}

model CentroCosto {
  id            String           @id @default(cuid())
  workspaceId   String
  empresaId     String
  codigo        String
  nombre        String
  orgUnitId     String?          // asociación por defecto (no concede permisos)
  lineaNegociaId String?
  estado        EstadoEstructura @default(ACTIVA)
  vigenciaDesde DateTime?
  vigenciaHasta DateTime?
  @@unique([workspaceId, empresaId, codigo])
  @@index([workspaceId, empresaId])
}

model AsignacionOrganizacional {
  id             String         @id @default(cuid())
  workspaceId    String
  // sujeto: exactamente uno de agentId/userId (validado en servicio)
  agentId        String?
  userId         String?
  tipoAsignacion TipoAsignacion
  // destino: según tipoAsignacion, uno de estos
  orgUnitId      String?
  lineaNegociaId String?
  sedeId         String?
  proyectoId     String?        // reservado (futuro)
  rol            String?        // colaborador | revisor | responsable_proceso ...
  alcance        Json           @default("{}") // qué habilita OPERATIVAMENTE; nunca acceso a datos
  estado         EstadoEstructura @default(ACTIVA)
  vigenciaDesde  DateTime       @default(now())
  vigenciaHasta  DateTime?
  creadaPorUserId String?
  createdAt      DateTime       @default(now())
  @@index([workspaceId, agentId])
  @@index([workspaceId, userId])
  @@index([workspaceId, lineaNegociaId])
  // índice parcial único (SQL manual): a lo sumo una FUNCIONAL_PRINCIPAL vigente por sujeto
}

model ServicioInterno {
  id                String           @id @default(cuid())
  workspaceId       String
  empresaId         String
  areaDuenoId       String           // OrgUnit que presta el servicio
  nombre            String
  responsableUserId String?
  responsableAgentId String?
  acuerdoServicio   Json             @default("{}") // entradas, salidas, cliente interno, criterios
  estado            EstadoEstructura @default(ACTIVA)
  imputaciones      ImputacionCosto[]
  @@index([workspaceId, empresaId])
}

model ImputacionCosto {
  id               String   @id @default(cuid())
  workspaceId      String
  servicioInternoId String
  periodoKey       String   // coherente con BudgetLedger.periodKey
  // destino: uno de
  lineaNegociaId   String?
  orgUnitId        String?
  centroCostoId    String?
  porcentaje       Decimal  @db.Decimal(5, 2) // suma por (servicio, periodo) = 100
  @@index([workspaceId, servicioInternoId, periodoKey])
}

model UsageRecord {
  // ...campos actuales (workspaceId, orgUnitId, agentId, costUsd, ...)
  empresaId           String? // snapshot histórico de las dimensiones al ejecutar (RF46/QA16)
  areaEjecutoraId     String? // = orgUnitId ejecutor; puede coincidir con orgUnitId actual
  lineaBeneficiariaId String?
  centroCostoId       String?
  sedeId              String?
  // Snapshot de dimensiones configurables (D8): { dimensionCodigo: valorCodigo|valor } al momento del hecho
  dimensiones         Json    @default("{}")
}

// --- Marco de dimensiones configurables (D8, estilo NetSuite / SAP CO-PA) ---
enum DimensionTipoValor { LISTA REFERENCIA TEXTO NUMERO }

model Dimension {
  id                          String             @id @default(cuid())
  workspaceId                 String
  empresaId                   String?            // null = aplica a toda la organización
  codigo                      String
  nombre                      String
  tipoValor                   DimensionTipoValor @default(LISTA)
  referenciaEntidad           String?            // si REFERENCIA: "LineaNegocio" | "Sede" | "OrgUnit" | ...
  jerarquica                  Boolean            @default(false)
  obligatoria                 Boolean            @default(false)
  obligatoriaParaEfectoEconomico Boolean         @default(false)
  aplicaA                     String[]           @default([]) // "ejecucion" | "tarea" | "costo" | "agente" | ...
  esSistema                   Boolean            @default(false) // las 3 integradas de D3
  estado                      EstadoEstructura   @default(ACTIVA)
  vigenciaDesde               DateTime?
  vigenciaHasta               DateTime?
  valores                     DimensionValue[]
  @@unique([workspaceId, empresaId, codigo])
  @@index([workspaceId, empresaId])
}

model DimensionValue {
  id            String           @id @default(cuid())
  workspaceId   String
  dimensionId   String
  dimension     Dimension        @relation(fields: [dimensionId], references: [id], onDelete: Cascade)
  codigo        String
  nombre        String
  padreId       String?          // jerarquía opcional (roll-up); sin ciclos
  estado        EstadoEstructura @default(ACTIVA)
  vigenciaDesde DateTime?
  vigenciaHasta DateTime?
  @@unique([dimensionId, codigo])
  @@index([workspaceId, dimensionId])
}

model DimensionAssignment {
  id               String   @id @default(cuid())
  workspaceId      String
  dimensionId      String
  dimensionValueId String?  // para LISTA/REFERENCIA; null si valor literal
  valorLiteral     String?  // para TEXTO/NUMERO
  targetType       String   // "ejecucion" | "tarea" | "costo" | "orgUnit" | "lineaNegocio" | ...
  targetId         String
  createdAt        DateTime @default(now())
  @@index([workspaceId, targetType, targetId])
  @@index([workspaceId, dimensionId, dimensionValueId])
}
```

## Consecuencias

- **Datos / migraciones:** migración **aditiva** (ADR 0009). Columnas nuevas de `OrgUnit` y `UsageRecord` nullable o con
  default neutro; tablas nuevas vacías. Las `OrgUnit` existentes quedan `tipo = AREA_FUNCIONAL`, `empresaId = null`; los
  `UsageRecord` históricos quedan con dimensiones `null` (se siguen imputando por `orgUnitId` como hoy). **No** se toca
  `Budget`/`BudgetLedger`/`BudgetAlert`. La restricción "a lo sumo una `FUNCIONAL_PRINCIPAL` vigente por sujeto" y la de
  "suma de porcentajes = 100" se implementan como índice parcial / verificación de aplicación: seguir la regla de
  `CLAUDE.md` para índices creados con SQL manual (`--create-only`, revisar el SQL, no tocar migraciones aplicadas).
  El marco de dimensiones (D8) añade `Dimension`/`DimensionValue`/`DimensionAssignment` (tablas nuevas vacías) y la
  columna `UsageRecord.dimensiones Json @default("{}")` (aditiva; históricos quedan `{}`). En el arranque se **siembran**
  las tres `Dimension` de sistema (`esSistema = true`) que apuntan a `LineaNegocio`/`Sede`/`CentroCosto`, sin duplicar
  datos. **`schema.prisma` lo edita `backend-platform`**, no este ADR.
- **Compatibilidad de flujos y agentes:** `Agent.costCenterId` → `OrgUnit` **se conserva** como unidad de reserva/
  imputación por defecto (ADR 0002); el nuevo `CentroCosto` es dimensión de reporte adicional, no lo reemplaza en P0.
  Nada de lo guardado cambia de forma; no hay versión de definición de flujo afectada.
- **Contratos de API / frontend:** CRUD nuevo (todo `@MinRole('EDITOR')` para mutar, filtrado por `workspaceId` y
  `empresaId`): `/empresas` y `/org-units?tipo=`, `/lineas-negocio`, `/sedes`, `/centros-costo`, `/asignaciones`,
  `/servicios-internos` y `/servicios-internos/:id/imputaciones`, más `/dimensiones` y `/dimensiones/:id/valores` (D8).
  Lectura para consolas (RF47): proyecciones `GET /consolas/{organizacional|funcional|negocio|sede}` y una consola de
  análisis que **pivota/agrupa por cualquier dimensión configurada** (`GET /consolas/analisis?groupBy=<dimensionCodigo>`),
  todas respetando el permiso efectivo y el alcance por empresa. La web añade el organigrama multi-dimensión, el
  administrador de dimensiones y selectores dinámicos (no cableados a línea/sede) en costos.
- **Seguridad:** `empresaId` entra como dimensión del permiso efectivo (riesgo principal: una consulta que filtre solo
  por `workspaceId` y "vea" todas las empresas → fuga inter-empresa). Denegación por defecto entre empresas; QA01 debe
  cubrir acceso cruzado por empresa en API, búsqueda, adjuntos, índices y consolas. El organigrama no concede acceso
  (D6): probar que una asignación transversal no abre datos fuera de su alcance (QA12/QA15).
- **Rendimiento / escalabilidad:** `empresaId` desnormalizado en `OrgUnit`/`UsageRecord` evita recorrer el árbol para
  filtrar por empresa. La consolidación económica es agregación por dimensión con índices por `(workspaceId, empresaId)`.
- **Plan de pruebas:**
  - **QA15 (matricial sin ciclos):** cambiar línea/sede de un agente no crea ciclos ni otorga permisos no autorizados.
  - **QA16 (reorganización):** mover un equipo conserva historial, transfiere pendientes y **no** altera la atribución de
    resultados/costos pasados (gracias al snapshot en `UsageRecord`).
  - **QA24/HU24 (consolidación):** una ejecución compartida reparte el 100 % y aparece **una sola vez** en el total
    empresarial (sin doble conteo), también al pivotar por dimensiones configurables.
  - **Dimensiones configurables (D8):** crear una dimensión propia (p. ej. Proyecto) y pivotar por ella sin cambio de
    esquema; una dimensión `obligatoriaParaEfectoEconomico` sin valor **bloquea el despacho**; un `DimensionValue`
    inactivo no es asignable a trabajo nuevo pero sigue en el histórico; etiquetar no concede acceso.
  - **QA01 (aislamiento):** acceso cruzado entre empresas del mismo grupo denegado por defecto.
  - **HU21–HU23:** crear empresa + 2 líneas + área compartida + departamento + equipo + sede **sin duplicar**; un agente
    atiende dos líneas con asignaciones vigentes conservando responsable/prioridad/permisos; el gerente de línea ve sus
    resultados y servicios recibidos y no accede fuera de su alcance.
  - Pruebas puras de las invariantes (sin Nest/BD): validador de anidamiento por `tipo`, no-ciclos, unicidad de
    `FUNCIONAL_PRINCIPAL` vigente y suma de `porcentaje` = 100.

## Plan de implementación

Orden de dependencias: contrato de API → backend → frontend → QA.

| # | Tarea | Dueño | Archivos afectados | Criterio de aceptación |
|---|---|---|---|---|
| 1 | Contrato OpenAPI de empresas/org-units tipados, líneas, sedes, centros de costo, asignaciones, servicios e imputación; DTOs con `class-validator` | nexo-architect → backend-platform | `apps/api/src/modules/governance/**` (DTO/controlador), Swagger | Rutas versionadas, `@MinRole('EDITOR')` en mutaciones, filtradas por `workspaceId`; revisadas por arquitecto |
| 2 | Migración aditiva: enums y campos nuevos de `OrgUnit`/`UsageRecord` (incl. `dimensiones Json`), tablas `LineaNegocio`/`Sede`/`CentroCosto`/`AsignacionOrganizacional`/`ServicioInterno`/`ImputacionCosto` y el marco de dimensiones `Dimension`/`DimensionValue`/`DimensionAssignment` (D8); índices parciales por SQL manual; siembra de las 3 dimensiones de sistema | backend-platform | `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/**` | `prisma migrate dev` aplica sin tocar migraciones previas; datos existentes intactos; `typecheck && lint && test && build` en verde |
| 3 | Servicios de dominio: validadores puros (anidamiento por `tipo`, no-ciclos, unicidad `FUNCIONAL_PRINCIPAL`, suma 100 %, no-ciclos en `DimensionValue`, obligatoriedad de dimensiones al despachar con efecto económico), resolución de `empresaId` ancestro, reglas de cambio de estructura (RF46) | backend-platform | `apps/api/src/modules/governance/**` | Invariantes en funciones puras con pruebas unitarias |
| 4 | Imputación en `UsageRecord`: snapshot de dimensiones integradas **y configurables** (D8) al registrar, y consolidación de servicios compartidos | backend-platform (coord. ADR 0002) | `modules/governance/**`, registro de consumo del runtime | Total imputado = total medido; sin doble conteo (prueba QA24); pivot por dimensión arbitraria |
| 4b | Administrador de dimensiones (CRUD de `Dimension`/`DimensionValue`) y etiquetado (`DimensionAssignment`); validación de obligatorias al despachar | backend-platform | `apps/api/src/modules/governance/**` | Dimensión propia creada y pivotable sin migración; obligatoria sin valor bloquea el despacho |
| 5 | Permiso efectivo acotado por `empresaId`; denegación por defecto inter-empresa; asignación transversal no concede datos | backend-platform (coord. ADR 0007) | `common/guards/**`, `agent-access`, governance | QA01/QA12 verdes para acceso cruzado por empresa |
| 6 | Modelos y `ApiService`; organigrama multi-dimensión, vistas organizacional/funcional/negocio/sede, administrador de dimensiones y consola de análisis con pivot por cualquier dimensión | frontend-core, frontend-ui | `apps/web/src/app/features/**`, `core/**` | Vistas RF47 respetan alcance; pivot por dimensión configurable; build web sin warnings NG8113 |
| 7 | Pruebas de integración de aislamiento por empresa, matricial sin ciclos (QA15), reorganización conserva historia (QA16), consolidación (QA24) | qa-api | `apps/api/test/**`, `*.spec.ts` | QA01/QA15/QA16/QA24 reproducibles y verdes |
| 8 | Recorridos E2E HU21–HU23 (configurar compañía, compartir capacidad, dirigir por negocio) | qa-e2e | `apps/web/e2e/**` | Historias aceptadas |
| 9 | Actualizar `docs/ARCHITECTURE.md` (módulo `governance` multi-dimensión) y "Evolución sugerida" | nexo-architect | `docs/ARCHITECTURE.md` | Documentación al día tras el merge |

## Preguntas abiertas de producto (requieren decisión del negocio)

1. **Aislamiento físico por empresa:** ¿algún cliente exige empresa = Workspace por regulación? (D1 asume intra-workspace.)
2. **Unidad de reserva de presupuesto:** ¿el tope duro puede colgar de `LineaNegocio`/`CentroCosto`, o se mantiene solo
   en `OrgUnit` (ADR 0002)? Afecta cómo se evita la doble reserva (RF45).
3. **Criterio de reparto de servicios compartidos:** ¿porcentaje fijo (P0) o driver calculado por consumo real (P1)?
4. **Mecanismo de compartir entre empresas:** forma concreta de la "política expresa" (RF01) — se resuelve con E6.
5. **Catálogo comercial de la línea de negocio:** ¿cuánto se modela en NEXO vs. qué queda como referencia al sistema
   comercial/financiero de origen (RF43)?
6. **Moneda y consolidación:** moneda base, fecha de conversión y fuente de tipo de cambio para consolidar entre empresas
   (RF45/sección 22) — depende de E9/E10.
7. **Alcance del marco de dimensiones (D8):** ¿qué dimensiones vienen **preconfiguradas** más allá de las tres integradas
   (Proyecto, Cliente, Producto, Canal, Campaña)? ¿Cuáles son **obligatorias para efecto económico** en el piloto?
   ¿Se permite el tipo `REFERENCIA` a entidades externas vía conector en P0, o solo `LISTA`/`REFERENCIA` interna?
8. **Límites de dimensiones:** ¿tope de nº de dimensiones/valores por empresa y profundidad de jerarquía, para acotar el
   costo de los pivots en las consolas?
