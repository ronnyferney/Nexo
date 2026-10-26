# 0014. Equipos de empleados digitales gobernados (Cuadrillas) y pasaporte de resultado verificable

- **Estado:** Propuesto
- **Fecha:** 2026-10-26
- **Responsables:** nexo-architect
- **Relacionado:**
  - ADR 0004 (bucle de mejora supervisada; versiones de agente).
  - ADR 0007 (visibilidad y permisos de agentes; shares `USER|UNIT|GROUP`, `USE|EDIT`).
  - ADR 0011 (modelo organizacional: `OrgUnit` tipado, `Cargo` con `NivelJerarquico`, `Agent.cargoId/responsableUserId`).
  - ADR 0012 (trabajo por resultados E4: `Objetivo`/`Tarea`/`ContratoResultado`/`ValidacionResultado`/`Evidencia`;
    comunicación y handoff E5: `MensajeAgente`, `ContratoTransferencia`).
  - ADR 0013 (gobierno de acciones E6: `PolicyEngine`, `ActionGateway`, `Aprobacion`, `Suspension`).
  - Auditoría inmutable E13 (`modules/audit`: `AuditService.append/list/get/verificarCadena`, cadena por
    `contentHash`+`prevHash`+`hash` y `seq` por workspace).
  - Imputación de costo E9 (`governance/imputacion`) y presupuestos/`UsageRecord` (ADR 0002).
  - Comunidad interna E11 (catálogo gobernado, base para el catálogo de Cuadrillas).
- **Épicas del backlog:** E10/E11 (plantillas de equipo y catálogo gobernado) y E13 (trazabilidad verificable y
  exportación). Backlog `docs/backlog-organizacion-digital.md`.

## Contexto

El ecosistema abierto de agentes (subagentes, *swarms*, *skills* "listos para usar", *marketplaces* de plantillas y
hooks) resuelve bien el problema de **arrancar rápido**: alguien descarga un equipo prefabricado, lo suelta en su
entorno y en minutos tiene varios agentes colaborando. Pero ese mismo atajo trae, para una empresa regulada, un
conjunto de problemas que hoy no tienen respuesta en esas plataformas:

- **Auto-generación sin control.** Los *swarms* se auto-expanden: un agente crea otros agentes, define sus permisos y
  se reparte trabajo. Nadie humano autorizó esa dotación ni sus accesos.
- **Código ejecutable de terceros.** Las plantillas del ecosistema suelen traer *hooks*, scripts de arranque o
  herramientas arbitrarias que se ejecutan al instalarlas. Instalar una plantilla equivale a ejecutar código ajeno con
  los permisos del que la instala.
- **Instalar concede acceso.** Soltar un equipo prefabricado suele venir con credenciales o alcances "de ejemplo" que
  terminan siendo permisos reales; la instalación concede acceso a datos de hecho.
- **Cero trazabilidad del resultado.** Cuando el equipo entrega algo, no hay forma de demostrar a un auditor externo
  **quién** lo produjo, con **qué** herramientas, **qué** aprobaciones hubo, **cuánto** costó y **quién** lo verificó.
  El resultado llega sin hoja de vida.

Nexo ya construyó, por separado, todas las piezas que faltan a ese ecosistema para ser gobernable:

- **E4 (`results/`)** da el resultado como objeto verificable: `ContratoResultado` con regla de validación determinista
  y `ValidacionResultado` donde el **verificador ≠ ejecutor** (garantizado en `validacion.service.ts`, no solo en BD).
- **E5 (`messaging/`)** da delegación PURA con límites (`delegacion.rules.ts`) y reglas duras —
  `AGENTE_NO_CREA_AGENTES`, `NO_AUTOAPROBACION`, `NO_AMPLIA_PRESUPUESTO` — y handoff a nivel de tarea
  (`handoff.service.ts`, `ContratoTransferencia`).
- **E6 (`governance/actions/`)** da `PolicyEngine` (la más restrictiva gana), `ActionGateway`, aprobaciones con
  `contentHash`/doble aprobación y suspensión.
- **E9 (`governance/imputacion/`)** da imputación de costo por dimensiones; **ADR 0002** da `UsageRecord` por turno.
- **E13 (`modules/audit/`)** da el **AuditLog inmutable encadenado por hash**, append-only y a prueba de manipulación,
  con verificación de la cadena por workspace.
- **E1/E2/E3 (ADR 0011)** dan `OrgUnit` tipado, `Cargo` con `NivelJerarquico`
  (`EMPLEADO→LIDER→JEFE→DIRECTOR→GERENTE→SUPEREMPLEADO`) y `Agent` con responsable humano y ciclo de vida.

**La tesis de este ADR:** Nexo no necesita adoptar el modelo abierto; necesita ofrecer la **versión gobernada** de sus
tres ideas más vendibles — *arrancar con un equipo prefabricado*, *delegar entre agentes* y *acumular skills* — porque
eso es exactamente lo que finanzas, salud y el sector público no pueden comprar hoy en ningún otro lado. Se introducen
**dos conceptos nuevos, ambos construidos sobre lo ya existente, sin infraestructura nueva**:

1. **Cuadrillas** — equipos de empleados digitales gobernados: una **plantilla de equipo** versionada y **puramente
   declarativa** que un humano instancia para dotar un proceso.
2. **Pasaporte de resultado** — la **cadena de custodia verificable** de cada `ContratoResultado` aceptado, anclada a
   la cadena de hash de auditoría y verificable por un tercero.

Restricciones que la solución respeta (de `CLAUDE.md` y de los ADR citados):

- **No introducir infraestructura nueva** (otra cola, otra base, otro servicio). Se reutilizan Postgres, BullMQ, el
  `AuditService`, el `PolicyEngine`/`ActionGateway` y `results/`.
- **Multi-tenant estricto:** toda consulta filtra por `workspaceId` (de `@CurrentAuth()`) y por empresa cuando el dato
  es de empresa. Mencionar, catalogar o instanciar **no concede acceso**.
- **Sin código ejecutable en datos declarativos:** nada de `eval`/`new Function`/hooks; plantillas solo con
  `common/template/template.engine.ts` y reglas declarativas (igual que `ContratoResultado.reglaValidacion`).
- **Compatibilidad hacia atrás:** todo es **aditivo y opt-in**. Un workspace que no usa Cuadrillas ni pasaportes se
  comporta igual que hoy.
- **El motor de flujos (`engine/*`) sigue siendo TypeScript puro.** Ninguno de los dos conceptos lo toca.

## Alternativas consideradas

### Sobre "no empezar de cero" (Cuadrillas)

1. **Adoptar subagentes/*swarms*/plantillas del ecosistema tal cual.** Máxima velocidad y familiaridad para quien ya
   los usa. **Rechazada:** viola los principios no negociables de Nexo. (a) Los *swarms* auto-generan agentes, lo que
   choca de frente con la regla dura `AGENTE_NO_CREA_AGENTES` de E5. (b) Las plantillas traen *hooks*/código ejecutable;
   instalarlas es ejecutar código de terceros con permisos del instalador (prohibido por `CLAUDE.md`: nada de
   `eval`/`new Function`, salida solo por `HttpClientService`, plantillas solo con `template.engine.ts`). (c) Instalar
   concede acceso a datos, cuando en Nexo los permisos son siempre explícitos (ADR 0007). (d) No hay trazabilidad,
   verificación cruzada ni control de costo. El ecosistema optimiza velocidad a costa del gobierno; Nexo no puede.

2. **Scripts internos de "sembrado" (seed) que creen agentes y permisos de golpe.** Rápido de construir, pero es un
   procedimiento imperativo opaco: no versiona, no audita, no separa "la plantilla" de "la instancia", y tiende a
   conceder accesos de ejemplo. **Rechazada.**

3. **`CuadrillaPlantilla` versionada y declarativa que un humano con rol suficiente instancia, sin conceder acceso por
   el mero acto de instanciar, y cuyos miembros son definiciones de `{cargo + skills + conectores + política +
   criterios de resultado}` — nunca código.** Reutiliza `Cargo`/`Agent`/shares/`Politica`/`ContratoResultado` ya
   existentes; versiones append-only como las de agentes y flujos; se cataloga sobre la base de la comunidad interna
   (E11) pero gobernada. **Elegida.**

### Sobre la trazabilidad del resultado (Pasaporte)

4. **Generar un PDF/resumen libre al cerrar una tarea.** Barato, pero es un documento no verificable: cualquiera puede
   editarlo y no hay forma de que un tercero compruebe que corresponde a lo que realmente pasó. **Rechazada.**

5. **Copiar al pasaporte todos los datos (mensajes, evidencias, costos).** Autocontenido, pero duplica datos sensibles,
   rompe DataGuard/retención (ADR 0008) y crea una segunda fuente de verdad que puede divergir. **Rechazada.**

6. **`PasaporteResultado` = documento de *referencias + hashes* que se compone desde `AuditLog` + `ContratoResultado` +
   `UsageRecord` sin copiar los datos, se **ancla** a la cadena de hash de auditoría (E13) y expone un endpoint de
   verificación que recomputa el ancla y comprueba la cadena.** A prueba de manipulación, verificable por un tercero,
   exportable, sin duplicar datos sensibles. **Elegida.**

## Decisión

### D1 — Cuadrillas: plantilla de equipo versionada y declarativa (concepto nuevo)

Una **Cuadrilla** es la respuesta gobernada a "no empezar de cero". Se modela en un módulo nuevo `modules/crews`
(identificadores en inglés; dominio "cuadrilla") con tres piezas y una instancia:

- **`CuadrillaPlantilla`** — la identidad estable de la plantilla (nombre, propósito, proceso objetivo, empresa/área de
  alcance, estado del ciclo de vida). No contiene la configuración: la configuración vive en sus versiones.
- **`CuadrillaVersion`** — una versión **inmutable** de la configuración declarativa (append-only, como `AgentVersion`
  de ADR 0004 y las versiones de flujo). Contiene **solo datos declarativos**: nunca código, nunca hooks, nunca una URL
  que se vaya a ejecutar al instanciar.
- **`CuadrillaMiembro`** — una fila por rol del equipo dentro de una versión: `{ cargoId (ADR 0011) + skills[] +
  conectores/operaciones sugeridos + política sugerida (referencia a `Politica` de E6 o su forma declarativa) +
  criterios de resultado (forma declarativa de `ContratoResultado`, incluida `reglaValidacion` y `evidenciaExigida`) +
  nivel jerárquico esperado + relaciones de delegación permitidas dentro del equipo }`.
- **`CuadrillaInstancia`** — el resultado de que **un humano** instancie una versión para un proceso concreto: crea o
  vincula los `Agent` (uno por `CuadrillaMiembro`), los `Objetivo`/`Tarea`/`ContratoResultado` iniciales y deja
  registrada la trazabilidad `plantilla@versión → agentes/objetivos creados`.

**Qué es declarativo y qué no (seguridad central de D1).** Una `CuadrillaVersion` es un documento de configuración:
referencias a `Cargo`, `Skill`, catálogo de conectores/operaciones, `Politica` y criterios de resultado, más plantillas
de texto que **solo** se expanden con `template.engine.ts`. Explícitamente **no** admite: bloques de código, `hooks`,
comandos de shell, URLs de arranque, ni ninguna cosa que se ejecute al instalar. Esto la hace el **opuesto exacto** de
una plantilla con hooks de terceros del ecosistema abierto: instalar una Cuadrilla no ejecuta nada.

**Ciclo de vida de la plantilla:** `BORRADOR → PUBLICADA → RETIRADA`.
- Las **versiones son append-only**: publicar no reescribe; crea una `CuadrillaVersion` nueva. Una versión publicada es
  inmutable (como un `ContratoResultado` comprometido en E5).
- Solo una plantilla `PUBLICADA` puede instanciarse. `RETIRADA` deja de ofrecerse pero no rompe las instancias ya
  creadas (igual que `Cargo.activo` en ADR 0011).

**Quién puede qué (reusa ADR 0007 y niveles de E3):**
- Definir/publicar/retirar plantillas: rol humano suficiente (`@MinRole('ADMIN')` por defecto, configurable a un nivel
  jerárquico `DIRECTOR`+). **Nunca un agente** (respeta `AGENTE_NO_CREA_AGENTES` de E5: la dotación de empleados
  digitales la autoriza una persona).
- Instanciar: un humano con rol suficiente (`@MinRole('EDITOR')` o el nivel que fije la política de la empresa).

**Instanciar NO concede acceso a datos (reusa ADR 0007).** Crear la instancia crea agentes y trabajo, pero los permisos
siguen siendo **explícitos**: los conectores/operaciones y las bases de conocimiento listados en un `CuadrillaMiembro`
son **sugerencias** que un humano debe **conceder** por el camino normal (shares `USE|EDIT`, instalación de conector
con sus secretos de bóveda). La plantilla **no trae credenciales**; a lo sumo nombra qué secreto de bóveda haría falta,
que el workspace debe poseer y conceder. Un agente recién instanciado sin permisos concedidos no puede tocar ningún
dato: el acceso efectivo lo sigue resolviendo `AgentAccessService`.

**Delegación dentro de la Cuadrilla = permiso de alcance mínimo (reusa E5).** Las relaciones de delegación de una
versión declaran qué miembro sénior puede delegar en qué subordinado. En ejecución, la delegación la sigue gobernando
`delegacion.rules.ts`: profundidad/concurrencia/ciclos y las reglas duras. Invariante añadido por este ADR: **un miembro
solo puede delegar un SUBCONJUNTO de sus permisos efectivos, nunca ampliarlos ni escalar** — los `permisos` que viajan
en el `MensajeAgente`/`ContratoTransferencia` se intersectan con los del delegante y se rechazan y auditan si intentan
exceder (coherente con `NO_AMPLIA_PRESUPUESTO` y "un mensaje no autoriza efectos" de E5/E6).

**Catálogo gobernado (reusa E11).** Las plantillas publicadas se catalogan sobre la comunidad interna (E11): buscables,
con autor humano, propósito y versiones, pero **dentro del workspace/empresa** y con las mismas reglas de visibilidad de
ADR 0007. No hay *marketplace* abierto que ejecute código ajeno; es un repositorio interno de configuración revisada.

Todo alta/publicación/retiro/instanciación escribe al `AuditLog` inmutable (E13) con actor humano, plantilla y versión.

### D2 — Pasaporte de resultado: cadena de custodia verificable (concepto nuevo)

Cada `ContratoResultado` que llega a `ACEPTADO` (transición que hoy ejecuta `validacion.service.ts` tras una
`ValidacionResultado` con veredicto `ACEPTA` y verificador ≠ ejecutor) **puede emitir un `PasaporteResultado`**: el
resumen verificable de extremo a extremo de cómo se produjo ese resultado.

**Qué contiene (todo por referencia + hash, nunca copia de datos sensibles):**
- **Quién:** el empleado digital responsable (`Agent` + su versión), los subordinados que intervinieron (cadena de
  `ContratoTransferencia`/`MensajeAgente` de E5) y los responsables humanos (`Agent.responsableUserId`).
- **Con qué:** las herramientas/conectores/operaciones usadas (referencias a `ConnectorOperation` y a las `Execution`
  que las invocaron) y las bases de conocimiento consultadas.
- **Qué aprobaciones:** las `Aprobacion` de E6 vinculadas (con su `contentHash` y decisores), si las hubo.
- **Cuánto costó:** la imputación agregada desde `UsageRecord` (ADR 0002) y E9, por las dimensiones imputadas.
- **Quién lo verificó:** la(s) `ValidacionResultado` (modo, verificador ≠ ejecutor, regla aplicada, veredicto, motivo
  auditable), más la evidencia evaluada (`Evidencia`, por referencia a la fuente: id externo, hash, conector/ejecución).

**Cómo se compone sin duplicar (reusa E13/E4/E9).** El pasaporte **no** copia mensajes ni contenidos: guarda
**referencias** (ids de `Tarea`, `ContratoResultado`, `ValidacionResultado`, `Execution`, `Aprobacion`, `UsageRecord`,
entradas de `AuditLog`) y, por cada referencia, el **hash** de su contenido relevante en el momento de emitir. El
cuerpo canónico del pasaporte (JSON de referencias + hashes + totales) se serializa de forma determinista y se registra
como un hecho en el `AuditLog` mediante `AuditService.append` (p. ej. `action: 'PASAPORTE_EMITIDO'`, `targetType:
'PasaporteResultado'`, `resumen` + `metadata` con el `documentHash`). Así el pasaporte **hereda el anclaje** de la
cadena de hash de E13: su entrada de auditoría tiene su `seq`, `contentHash`, `prevHash` y `hash`, encadenada con el
resto del workspace.

**Anclaje a la cadena (reusa `audit.hashing`).** El `PasaporteResultado` persiste:
- `documentHash` = hash determinista del cuerpo canónico (mismo algoritmo que `contentHashOf`).
- `auditSeq` y `auditEntryId` = la entrada de `AuditLog` que lo ancló (su `seq` y su `hash` de cadena).

Un pasaporte es **inmutable**. Si el resultado se reabre o corrige (nueva `ValidacionResultado`, nueva versión del
contrato), se emite un **pasaporte nuevo** que referencia al anterior (`reemplazaAId`), nunca se reescribe — misma
disciplina append-only que el resto de la plataforma.

**Verificación por un tercero (endpoint).** `GET /v1/passports/:id/verify` (y su export) recomputa:
1. el `documentHash` a partir de las referencias **vigentes** y lo compara con el almacenado (detecta que alguien alteró
   lo referenciado desde la emisión);
2. que la entrada de `AuditLog` ancla (`auditSeq`/`hash`) existe y su `contentHash`/`hash` cuadran;
3. que la **cadena de auditoría del workspace está intacta hasta ese `seq`** (reutiliza `AuditService.verificarCadena`,
   que ya detecta `CONTENIDO_ALTERADO`/`ENLACE_ROTO`/`SECUENCIA_ROTA`).

Devuelve un veredicto `{ ok, motivo?, emitidoEl, ancla }`. El **export** produce el cuerpo canónico + el ancla +
instrucciones de verificación, de modo que un auditor externo pueda recomputar el `documentHash` y confirmar el anclaje
sin acceso a los datos sensibles subyacentes (solo ve referencias y hashes). Para sectores regulados: **cada resultado
trae su hoja de vida verificable**.

**Emisión.** La emisión es un paso **posterior y opcional** a la aceptación, idealmente un job discreto (no bloquea la
API ni la aceptación). Un `ContratoResultado` aceptado sin pasaporte sigue siendo válido (compatibilidad hacia atrás);
la política de empresa puede **exigir** pasaporte para ciertos `tipoResultado`/`nivelRiesgo`.

### D3 — Invariantes

- **Tenant/empresa:** `workspaceId` obligatorio en toda entidad y consulta; empresa cuando aplique. Catalogar o
  instanciar una Cuadrilla, o emitir/leer un pasaporte, **no concede acceso** a datos ajenos.
- **Sin código en datos declarativos:** `CuadrillaVersion` y sus miembros son 100 % declarativos; expansión solo con
  `template.engine.ts`; sin `eval`/`new Function`/hooks/URLs de arranque.
- **Humano en el origen:** solo una persona con rol/nivel suficiente define, publica, retira e instancia Cuadrillas;
  ningún agente lo hace (`AGENTE_NO_CREA_AGENTES`).
- **No escalada de permisos:** instanciar no concede acceso; la delegación intra-cuadrilla solo transfiere subconjuntos
  de permisos del delegante; nunca amplía presupuesto ni salta aprobaciones (E5/E6).
- **Inmutabilidad y versiones:** `CuadrillaVersion` y `PasaporteResultado` son append-only; cambios crean versión nueva.
- **Verificabilidad:** el pasaporte se ancla a la cadena de E13 y es verificable por un tercero sin exponer datos
  sensibles (solo referencias + hashes).
- **Todo auditado:** alta/publicación/retiro/instanciación de Cuadrillas y emisión de pasaportes escriben al `AuditLog`.

## Consecuencias

### Esquema Prisma propuesto (bloque de referencia — lo aplica la cédula que edita `schema.prisma`)

> Este ADR **no** edita `schema.prisma`. Migración **aditiva**; no toca entidades existentes salvo back-relations
> opcionales. Respeta la regla de `CLAUDE.md` sobre índices generados manualmente (`KnowledgeChunk.search`,
> `OrgUnit_root_per_workspace`): no los afecta. Identificadores en inglés; textos y comentarios en español.

```prisma
enum CuadrillaEstado {
  BORRADOR
  PUBLICADA
  RETIRADA
}

model CuadrillaPlantilla {
  id          String            @id @default(cuid())
  workspaceId String
  orgUnitId   String?           // empresa/área de alcance
  nombre      String
  proposito   String?
  procesoObjetivo String?
  estado      CuadrillaEstado   @default(BORRADOR)
  creadaPorUserId String
  versiones   CuadrillaVersion[]
  instancias  CuadrillaInstancia[]
  validFrom   DateTime          @default(now())
  validTo     DateTime?
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt
  @@index([workspaceId, estado])
}

model CuadrillaVersion {
  id            String   @id @default(cuid())
  workspaceId   String
  plantillaId   String
  version       Int                       // append-only; publicar crea una nueva
  // Configuración 100% DECLARATIVA. Nunca código, hooks ni URLs de arranque.
  definicion    Json     @default("{}")   // metadatos de la versión (notas, criterios globales)
  publicadaPorUserId String?
  publicadaAt   DateTime?
  miembros      CuadrillaMiembro[]
  createdAt     DateTime @default(now())
  @@unique([workspaceId, plantillaId, version])
}

model CuadrillaMiembro {
  id                 String  @id @default(cuid())
  workspaceId        String
  versionId          String
  rol                String                 // nombre del rol dentro del equipo
  cargoId            String?                // ADR 0011
  nivelEsperado      String?                // NivelJerarquico esperado
  skills             String[] @default([])  // ids de Skill sugeridos
  conectoresSugeridos Json    @default("[]") // referencias a conector/operación; SUGERENCIA, no concesión
  politicaSugerida   Json     @default("{}") // referencia a Politica (E6) o su forma declarativa
  criteriosResultado Json     @default("{}") // forma declarativa de ContratoResultado (reglaValidacion, evidencia)
  delegaA            String[] @default([])  // ids de otros CuadrillaMiembro a los que puede delegar (subconjunto)
  createdAt          DateTime @default(now())
  @@index([workspaceId, versionId])
}

model CuadrillaInstancia {
  id            String   @id @default(cuid())
  workspaceId   String
  plantillaId   String
  versionId     String                      // versión exacta instanciada (trazabilidad plantilla@versión)
  instanciadaPorUserId String
  orgUnitId     String?
  // Trazabilidad de qué se creó, por referencia (agentes, objetivos). No concede permisos por sí misma.
  agentesCreados String[] @default([])      // ids de Agent
  objetivosCreados String[] @default([])    // ids de Objetivo
  createdAt     DateTime @default(now())
  @@index([workspaceId, plantillaId])
}

model PasaporteResultado {
  id                  String   @id @default(cuid())
  workspaceId         String
  contratoResultadoId String                // ContratoResultado ACEPTADO (E4)
  tareaId             String?
  // Cuerpo canónico por REFERENCIA + HASH; nunca copia de datos sensibles.
  documentoRef        Json     @default("{}") // { agentes[], transferencias[], ejecuciones[], conectores[],
                                              //   aprobaciones[], validaciones[], usageRecords[], auditSeqs[] }
  documentHash        String                 // hash determinista del cuerpo canónico (algoritmo de audit.hashing)
  // Anclaje a la cadena de auditoría inmutable (E13)
  auditSeq            Int
  auditEntryId        String
  reemplazaAId        String?                // pasaporte anterior si el resultado se reabrió (append-only)
  emitidoPorUserId    String?
  createdAt           DateTime @default(now())
  @@unique([workspaceId, contratoResultadoId, documentHash])
  @@index([workspaceId, contratoResultadoId])
}
```

Back-relations aditivas y opcionales en entidades existentes (las aplica la cédula del schema): `Agent`
(`cuadrillaInstancias`), `OrgUnit`, `User`, `ContratoResultado` (`pasaportes PasaporteResultado[]`). Ninguna columna
existente cambia de tipo ni se vuelve obligatoria.

### Impacto en contratos de API (orden: contrato → backend → frontend → QA)

- **Cuadrillas:** `POST /v1/crews` (crear plantilla, `@MinRole('ADMIN')`), `POST /v1/crews/:id/versions` (nueva versión,
  append-only), `POST /v1/crews/:id/publish`, `POST /v1/crews/:id/retire`, `GET /v1/crews` y `GET /v1/crews/:id`
  (catálogo gobernado, filtrado por `workspaceId`/empresa y visibilidad ADR 0007), `POST /v1/crews/:id/instantiate`
  (`@MinRole('EDITOR')`; crea instancia + agentes/objetivos, **sin** conceder accesos; devuelve qué permisos quedan
  pendientes de conceder).
- **Pasaportes:** `POST /v1/contracts/:id/passport` (emitir para un `ContratoResultado` aceptado; idealmente encola un
  job), `GET /v1/passports/:id`, `GET /v1/passports/:id/verify` (recomputa `documentHash` + ancla + `verificarCadena`),
  `GET /v1/passports/:id/export` (cuerpo canónico + ancla + instrucciones de verificación para un tercero).
- `workspaceId`/empresa siempre de `@CurrentAuth()`, nunca del cuerpo. DTOs con `class-validator`. Mutaciones con
  `@MinRole`. `verify`/`export` legibles por el rol que fije la política (por defecto `VIEWER`+ con alcance al recurso).

### Frontend (dueños frontend-ui/core)

- **Catálogo de Cuadrillas:** buscar plantillas publicadas, ver versiones, miembros, cargos, skills y política sugerida;
  autor humano visible; botón "Instanciar" que muestra **qué permisos habrá que conceder** (deja claro que instanciar no
  concede acceso). Editor de plantilla/versión que **solo** acepta configuración declarativa (sin campos de código).
- **Pasaporte de resultado:** en el detalle de tarea/resultado (ADR 0012), un panel "Pasaporte" con quién/con qué/
  aprobaciones/costo/verificación, botón "Verificar" (muestra el veredicto de la cadena) y "Exportar". Diferenciar autor
  humano y digital. Design system de `styles.scss`, standalone + OnPush + signals; build sin warnings NG8113.

### Seguridad, rendimiento y escalabilidad

- **Plantillas sin ejecución:** una `CuadrillaVersion` nunca ejecuta nada; el instanciador valida que la definición sea
  declarativa (sin claves de código/hook/URL de arranque) antes de aceptarla. Contrasta explícitamente con los hooks de
  terceros del ecosistema abierto.
- **Sin escalada:** instanciar no concede acceso (ADR 0007); delegación intra-cuadrilla solo transfiere subconjuntos de
  permisos (E5); presupuesto y aprobaciones intactos (E6/ADR 0002).
- **Verificabilidad a prueba de manipulación:** el pasaporte se ancla a la cadena de hash de E13; alterar lo referenciado
  o la cadena lo delata en `verify`. El export no expone datos sensibles (solo referencias + hashes).
- **Escala:** emisión de pasaporte y, si se desea, instanciación pesada van a **jobs BullMQ** existentes; la API queda
  sin estado. No se añade cola ni base nueva.

### Plan de pruebas

- **Unitarias:** validador de "definición declarativa" rechaza cualquier clave de código/hook/URL de arranque;
  intersección de permisos en delegación intra-cuadrilla nunca amplía (reusa `delegacion.rules.ts`); hash determinista
  del cuerpo del pasaporte reproducible.
- **Integración API:** instanciar una Cuadrilla **no** concede acceso (un agente recién creado responde 403/404 a datos
  no concedidos); publicar crea versión nueva sin reescribir; `verify` detecta (a) alteración de una referencia, (b)
  manipulación de la entrada de ancla, (c) rotura de la cadena de auditoría; aislamiento multi-tenant en catálogo,
  instancias y pasaportes; un agente no puede crear/publicar/instanciar Cuadrillas.
- **E2e:** publicar una plantilla → instanciarla → conceder permisos → ejecutar un `ContratoResultado` → verificarlo
  (verificador ≠ ejecutor) → emitir el pasaporte → verificarlo y exportarlo como un tercero.

## Decisiones de producto abiertas (requieren al negocio)

1. **Rol/nivel mínimo** para definir, publicar e instanciar Cuadrillas (propuesta: definir/publicar `ADMIN` o `DIRECTOR`+;
   instanciar `EDITOR`). ¿Difiere por empresa?
2. **¿Pasaporte obligatorio** para qué `tipoResultado`/`nivelRiesgo`? (propuesta: obligatorio para `RESULTADO_NEGOCIO`
   de riesgo alto; opcional para intermedios).
3. **Alcance del export de terceros:** ¿qué nivel de detalle de las referencias puede ver un auditor externo sin
   comprometer DataGuard/retención (ADR 0008)? ¿Firma criptográfica adicional del export (p. ej. clave del workspace)?
4. **Catálogo de Cuadrillas entre empresas del grupo:** ¿se comparten plantillas publicadas entre empresas o cada empresa
   tiene el suyo? (afecta visibilidad y `orgUnitId`).
5. **Contenido mínimo del pasaporte** exigido por el regulador del sector objetivo (finanzas/salud): validar la lista de
   referencias con asesoría de cumplimiento.
6. **Versionado de la forma JSON de `CuadrillaVersion.definicion`** y migración de plantillas guardadas cuando cambie su
   forma (misma disciplina que las definiciones de flujo).

## Plan de implementación

Por incrementos disjuntos, ordenados por valor y riesgo. **Primer incremento mínimo entregable: Incremento 1
(Pasaporte de resultado, backend)** — reúsa E13 (`AuditService`) y E4 (`results/`) ya construidos y verificados, no
necesita UI para aportar valor (el `verify`/`export` es consumible por API), y es el diferenciador **más vendible** para
sectores regulados. Las Cuadrillas vienen después porque tocan más dominios (agentes, permisos, catálogo).

| Inc. | Alcance | Dueño | Modelo de datos aditivo · Endpoints · Criterios de prueba |
|---|---|---|---|
| 0 | Contrato de API (este ADR) + actualización de `docs/ARCHITECTURE.md` | nexo-architect | DTOs y rutas acordadas; evolución sugerida actualizada |
| 1 (MVP) | **Pasaporte de resultado — backend.** Emisión al aceptar un `ContratoResultado`, anclaje al `AuditLog`, endpoints `verify`/`export` | nexo-backend-platform (+ nexo-backend-ai para agregación de `UsageRecord`) | `PasaporteResultado` + migración aditiva. `POST /v1/contracts/:id/passport`, `GET /v1/passports/:id`, `.../verify`, `.../export`. **Pruebas:** emisión append-only; `documentHash` determinista; `verify` detecta alteración de referencia, de ancla y rotura de cadena (reusa `verificarCadena`); multi-tenant. Archivos: `modules/results/pasaporte*.ts` (nuevo), `modules/audit/*` (integración), `prisma/schema.prisma` |
| 2 | **Pasaporte — frontend.** Panel en detalle de tarea/resultado: quién/con qué/aprobaciones/costo/verificación; botones Verificar y Exportar | nexo-frontend-ui + nexo-frontend-core | Modelos/ApiService; pantalla OnPush+signals; build sin warnings NG8113; autor humano vs digital diferenciado. Archivos: `apps/web/src/app/features/**`, `core/**` |
| 3 | **Cuadrillas — plantilla y versiones (backend).** `CuadrillaPlantilla`/`Version`/`Miembro`; ciclo `BORRADOR→PUBLICADA→RETIRADA`; versiones append-only; validador "solo declarativo" | nexo-backend-platform | Modelos + migración aditiva. `POST /v1/crews`, `/versions`, `/publish`, `/retire`, `GET /v1/crews`. **Pruebas:** publicar crea versión nueva sin reescribir; validador rechaza código/hook/URL; un agente no puede crear/publicar (reusa reglas E5); multi-tenant. Archivos: `modules/crews/**` (nuevo), `prisma/schema.prisma` |
| 4 | **Cuadrillas — instanciación gobernada (backend).** `CuadrillaInstancia`; crea agentes/objetivos; **no concede acceso**; devuelve permisos pendientes; delegación intra-cuadrilla por subconjunto | nexo-backend-platform (+ nexo-backend-ai para alta de agentes) | `POST /v1/crews/:id/instantiate`. **Pruebas:** instanciar no concede acceso (agente nuevo sin permisos → 403/404 a datos); delegación no amplía permisos (reusa `delegacion.rules.ts`); todo auditado. Archivos: `modules/crews/**`, `modules/agents/**`, `modules/agent-access/**` |
| 5 | **Cuadrillas — catálogo y editor (frontend).** Catálogo gobernado (base E11), editor solo-declarativo, flujo "Instanciar" que muestra permisos a conceder | nexo-frontend-ui + nexo-frontend-core | Pantallas OnPush+signals; sin campos de código; build sin warnings. Archivos: `apps/web/src/app/features/**` |
| 6 | **QA integral.** Integración (no-concesión de acceso, verify/export, aislamiento, agente-no-crea-cuadrillas) y e2e del recorrido completo | nexo-qa-api + nexo-qa-e2e | Suites en verde contra Postgres/Redis reales; cada bug con prueba que lo reproduce. Archivos: `apps/api/**/*.spec.ts`, `apps/web/e2e/**` |
