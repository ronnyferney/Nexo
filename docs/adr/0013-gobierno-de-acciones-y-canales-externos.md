# 0013. Gobierno de acciones y canales de comunicación externa

- **Estado:** Propuesto
- **Fecha:** 2026-10-25
- **Responsables:** nexo-architect
- **Épicas del backlog:** E6 (gobierno de acciones, RF11-RF13), E14 (canales externos, RF16/RF17/RF35), y las
  capacidades de conexión de E8 (internet y RPA, RF14-RF17). Backlog `docs/backlog-organizacion-digital.md`.
- **Relacionado:** ADR 0002 (gobierno multi-LLM y presupuestos), ADR 0005 (catálogo de conectores y datos
  empresariales), ADR 0007 (visibilidad y permisos de agentes), ADR 0008 (DataGuard, retención y observabilidad),
  ADR 0010 (orquestación multi-modelo; verificación cruzada exige revisión humana antes de una acción sensible).
  Requisitos: RF11, RF12, RF13, RF16, RF17, RF35; HU06, HU08, HU10; QA02, QA03, QA04, QA07, QA08, QA12.

## Contexto

Nexo debe convertirse en una organización de empleados digitales que **actúan sobre el exterior**: envían correos,
mensajes de WhatsApp, hacen llamadas de voz, consultan internet y operan sistemas heredados por RPA. El dueño del
producto (solicitud v3.0, §5-7 y §16-18) exige que **ninguna acción con efecto externo ocurra sin gobierno**: una
política evaluada en el servidor decide permitir/bloquear/pedir aprobación, un humano aprueba cuando el riesgo lo
exige, y existe un interruptor de emergencia. La conversación (voz/WhatsApp/correo) es una **representación** de
registros operativos (mensajes, tareas, evidencias), **no** un canal para ampliar atribuciones; el contenido entrante
siempre es **dato no confiable** (QA02).

Lo que **ya existe** y se reutiliza (verificado en el código):

- **Aprobación de herramientas por turno** en `apps/api/src/modules/agents/agent-runtime.service.ts`:
  `AgentTool.requiresApproval` marca una operación como sensible; el runtime, si el modelo la intenta sin estar en
  `opts.approvedTools`, **no la ejecuta** y devuelve `APROBACIÓN REQUERIDA` (señal `SensitivitySink.pending`). Es un
  gate **efímero, por turno y en memoria**: sirve para el chat interactivo, pero no persiste la decisión, no la liga a
  un hash de contenido, no hace doble aprobación ni caducidad, ni revalida al ejecutar. Es la semilla, no la solución.
- **Pasarela de modelos y presupuestos** (`governance/budgets.service.ts`): `plan()` (permisos de modelo, reserva),
  `assertCanSpend()` (control por turno) y `record()` (libro mayor con conciliación). Es el patrón de **reserva antes
  de despachar + conciliar después** que el motor de políticas reutiliza para el monto de negocio.
- **`@MinRole`** (`common/decorators/roles.decorator.ts`, `OWNER>ADMIN>EDITOR>VIEWER`) y el aislamiento multi-tenant por
  `workspaceId` desde `@CurrentAuth()`.
- **DataGuard** (`modules/llm/data-guard/`): clasificación/enmascarado de datos sensibles hacia los modelos; retención
  por tipo de dato (ADR 0008). Las grabaciones/transcripciones de voz y los cuerpos de WhatsApp/correo son datos
  sensibles bajo DataGuard.
- **`ConnectorAdapter`** (`modules/connectors/domain/connector-adapter.ts`): puerto hexagonal `{ type, invoke, test,
  discover? }` con adaptadores REST/SOAP/GraphQL/MCP/DATABASE. Regla de CLAUDE.md: protocolo nuevo = adaptador nuevo,
  nada de `if (type === ...)` disperso.
- **`HttpClientService.safeFetch()`** (`common/http/http-client.service.ts`): única salida HTTP, con anti-SSRF
  (bloqueo de direcciones privadas, pinned DNS lookup contra rebinding), `timeoutMs`, `maxBodyBytes` y `allowedHosts`.
- **Bóveda de secretos** (`{{ secrets.NOMBRE }}`) y **BullMQ** (procesadores de `workflows`, `routines`, `training`)
  para el trabajo durable fuera de la API sin estado.

Lo que **falta** (lo que este ADR diseña): un **motor de políticas** server-side transversal (no solo por agente,
también por usuario/org/empresa/recurso/destinatario/monto/tipo de dato/horario/presupuesto), una **bandeja de
aprobaciones persistente** con hash/invalidación/doble aprobación/caducidad/revalidación, una **suspensión de
emergencia** con conciliación, y los **canales externos** (correo como canal del empleado digital, WhatsApp, voz
conversacional) y **capacidades de conexión** (internet gobernado, RPA) como adaptadores/canales nuevos.

Restricciones que la solución debe respetar:
- Compatibilidad hacia atrás: el gate `requiresApproval`/`approvedTools` actual del chat **sigue funcionando** para
  acciones de bajo riesgo sin política explícita; el motor de políticas lo **envuelve**, no lo rompe.
- La API es sin estado; el trabajo pesado (voz en tiempo real, RPA) va a **workers propios**, no a la API.
- El motor de flujos (`modules/workflows/engine`) sigue siendo TypeScript puro, sin Nest ni BD.
- Toda salida sensible pasa por **una sola pasarela de acción** (RF17); ningún canal llama al exterior esquivándola.
- No introducir infraestructura nueva sin justificarla aquí (este ADR justifica: cola de voz y cola de RPA aisladas).

## Alternativas consideradas

### Gobierno de acciones (E6)

1. **Ampliar solo el gate `requiresApproval` del runtime.** Mínimo esfuerzo, pero el gate vive dentro del bucle del
   agente: no cubre acciones disparadas por flujos/rutinas/eventos ni por otros canales, no persiste, y mezcla la
   decisión de política con la ejecución del LLM. Rechazada como solución completa; se conserva como gate de último
   recurso para acciones de bajo riesgo en chat.

2. **Reglas de política embebidas en cada adaptador/canal.** Cada canal decide si pide aprobación. Reparte la lógica
   de seguridad (viola el principio de puertos/adaptadores de CLAUDE.md), es imposible de auditar de forma uniforme y
   casi garantiza fugas (un canal que "olvida" pedir aprobación). Rechazada.

3. **Motor de políticas server-side como punto único de decisión (`PolicyEngine`) + pasarela de acción
   (`ActionGateway`) por la que pasa toda acción con efecto externo, versionando cada política y registrando cada
   decisión; la aprobación como entidad persistente ligada a un hash del contenido.** Determinista, auditable,
   reutiliza presupuestos/`@MinRole`/DataGuard como insumos, independiente del origen (agente, flujo, canal). **Elegida.**

### Canales externos (E14)

1. **Un servicio monolítico de "mensajería" con ramas por canal.** Acoplado, difícil de escalar la voz (tiempo real)
   independientemente del correo. Rechazada.

2. **Cada canal como `ConnectorAdapter`/canal nuevo detrás de la misma pasarela de acción, y la voz conversacional
   aislada en su propio worker de tiempo real.** Respeta la extensibilidad de CLAUDE.md, permite escalar la voz por
   separado, y hace que correo/WhatsApp/voz compartan política, aprobación, presupuesto y evidencia. **Elegida.**

### Capacidades de conexión (E8)

1. **Dar a los agentes un cliente HTTP libre para "navegar".** Rompe anti-SSRF y aislamiento. Rechazada de plano.

2. **Herramienta de internet gobernada sobre `HttpClientService` (dominios permitidos por política, resultado = dato
   no confiable) y RPA como worker aislado bajo política/aprobación, prefiriendo siempre API/conector sobre RPA.**
   **Elegida.**

## Decisión

### D1 — Motor de políticas server-side (`PolicyEngine`) (RF11)

Se crea un módulo `modules/governance/policy` con un servicio `PolicyEngine.evaluate(ctx): PolicyDecision` que se
invoca **antes de cualquier acción con efecto externo**, sin importar su origen (agente en chat, nodo de flujo, rutina
programada, evento entrante, canal externo).

- **Contexto de evaluación** (`ActionContext`): `workspaceId`, `empresaId`/`orgUnitId`, `agentId`, `userId` solicitante,
  `cargo`/`nivel` jerárquico, **recurso/conector/operación**, **tipo de acción** (p. ej. `EMAIL_SEND`, `WHATSAPP_SEND`,
  `VOICE_CALL`, `PAYMENT`, `BANK_ACCOUNT_CHANGE`, `DATA_DELETE`, `PERMISSION_CHANGE`, `RPA_RUN`, `WEB_FETCH`),
  **destinatario(s)**, **monto** (y moneda), **clasificación del dato** (de DataGuard), **horario/zona** (de la sede) y
  **estado de presupuesto** (de `budgets.chainState`).
- **Reglas** (`Politica`): declarativas y versionadas, con selector (agente/usuario/org/empresa/recurso/tipo/
  destinatario/monto/dato/horario) y efecto `ALLOW | DENY | REQUIRE_APPROVAL` (con `requiredApprovals` 1 o 2 y
  `allowSelfApproval=false` por defecto). Se evalúan **todas** las que aplican y **gana el control más restrictivo**
  (`DENY` > `REQUIRE_APPROVAL(2)` > `REQUIRE_APPROVAL(1)` > `ALLOW`). Denegación por defecto para los tipos de acción
  configurados como sensibles por la empresa (pagos, cambio de cuentas, borrado, cambio de permisos, publicación
  externa — controles iniciales de RF13/§5).
- **Un texto del modelo nunca sustituye autorización:** el `PolicyEngine` solo recibe hechos estructurados del
  `ActionContext`; nada de lo que el LLM "diga" (que ya está aprobado, que es urgente) cambia la decisión.
- **Insumos reutilizados:** `budgets.plan`/`chainState` aporta el estado de presupuesto y la reserva; `@MinRole` y la
  pertenencia a la empresa acotan quién puede aprobar; DataGuard aporta la clasificación del dato del contenido.
- **Registro:** cada evaluación produce una `DecisionPolitica` inmutable con `policyVersion`, reglas que dispararon,
  efecto, y `actionContextHash`. Se persiste en `AuditLog` (inmutable, E13). La decisión referencia la **versión** de
  política vigente al evaluar.
- **Relación con el runtime actual:** el gate `requiresApproval`/`approvedTools` se conserva como atajo de bajo riesgo
  en chat, pero cuando la operación corresponde a un tipo de acción sensible el runtime delega en el `ActionGateway`
  (abajo), que consulta al `PolicyEngine`. La verificación cruzada del ADR 0010 (que ya puede exigir revisión humana
  antes de una acción sensible) se expresa como un insumo más que puede elevar el efecto a `REQUIRE_APPROVAL`.

### D2 — Pasarela de acción (`ActionGateway`) (RF17)

Punto **único** por el que pasa toda acción con efecto externo (análogo a `LlmGatewayService` para los modelos). Su
secuencia es: validar esquema/ámbito empresarial → `PolicyEngine.evaluate` → si `REQUIRE_APPROVAL`, crear/vincular
`Aprobacion` y **detener** (la tarea queda `Esperando aprobación`, sin bloquear cómputo, E7) → al existir aprobación
válida, **revalidar** permisos+presupuesto+suspensión → reservar presupuesto → despachar al adaptador/canal con
**clave de idempotencia** → registrar solicitud saneada, resultado, latencia y `correlationId` → conciliar. Ningún
canal (correo/WhatsApp/voz/RPA/web) llama al exterior sin pasar por aquí.

### D3 — Bandeja de aprobaciones (`Aprobacion`) (RF12)

Entidad persistente con: propósito, **acción exacta** (tipo + operación/plantilla + parámetros), **identidad de
ejecución** (qué agente/versión actuará), destinatarios, contenido y adjuntos, **`contentHash`** (hash estable del
contenido + destinatarios + monto + adjuntos + herramienta + versión de agente/plantilla), importe, **riesgo**,
evidencia/referencias, y **vigencia** (`expiresAt`).

- **Invalidación (caduca y exige nueva aprobación)** si cambia cualquier componente del `contentHash`
  (contenido/destinatario/monto/adjunto/herramienta/versión), si **vence** el plazo, o si el aprobador **pierde
  atribuciones**. La comparación es por hash recomputado en el momento de ejecutar: si no coincide con el aprobado, se
  rechaza y se audita (QA03).
- **Doble aprobación:** cuando la política pide `requiredApprovals=2`, se exigen **dos personas distintas**; el
  solicitante no puede autoaprobarse cuando la política lo prohíbe (`allowSelfApproval=false`, también aplica al
  superempleado — RF40/QA13). Cada decisión registra actor, hora y comentario.
- **Revalidación al ejecutar:** el `ActionGateway` vuelve a evaluar política, permisos (`@MinRole` y pertenencia),
  presupuesto y estado de suspensión **justo antes del efecto** (QA07: retirar el acceso antes del despacho impide
  ejecutar aunque exista una aprobación previa).
- Estados: `Pendiente → Aprobada | Rechazada | AjusteSolicitado → (Ejecutada | Caducada | Invalidada)`.

### D4 — Suspensión de emergencia (`Suspension`) (RF13)

Interruptor con alcance por **agente / proceso(flujo) / conector / organización(empresa)**. Mientras está activa:

- **Bloquea** en el `ActionGateway` toda acción nueva y toda solicitud externa pendiente de despachar cuyo alcance
  caiga bajo la suspensión (incluye aprobaciones ya otorgadas pero aún no despachadas).
- Las acciones **ya enviadas** al sistema destino pueden completarse: se **concilian** (reutilizando el mecanismo de
  conciliación de E7) y se muestran con estado **confirmado** o **incierto**; nunca se reintenta a ciegas una escritura
  incierta.
- **Reactivación** exige actor autorizado (`@MinRole('ADMIN')`) y **motivo**; todo queda en `AuditLog`.
- La evaluación de suspensión es parte del `PolicyEngine`/`ActionGateway`, no un chequeo disperso.

### D5 — Canales externos como adaptadores/canales (E14)

Cada canal es un adaptador nuevo detrás del `ActionGateway`; la salida sensible pasa por política+aprobación y el
contenido entrante es **dato no confiable** (se procesa con DataGuard y nunca modifica políticas ni habilita
herramientas — QA02). Entrega y respuesta se registran como **hechos distintos** (enviado/recibido/leído/respondido),
RF35.

- **Correo (reutiliza):** se formaliza el conector de correo existente (Microsoft 365 / Gmail) como **canal del
  empleado digital** con tipo de acción `EMAIL_SEND`, **plantillas**, **destinatarios permitidos** por política,
  aprobación de salientes y registro de recepción/respuesta. No requiere infraestructura nueva.
- **WhatsApp (construye):** adaptador **WhatsApp Business API** con plantillas aprobadas, respeto de la **ventana de
  sesión de 24 h**, **webhooks firmados** (verificación de firma del proveedor) de entrega/lectura/respuesta e
  **idempotencia** por `message_id` del proveedor. Saliente bajo política/aprobación; entrante como dato no confiable.
- **Llamadas telefónicas con voz conversacional 100 % (construye, mayor):** pipeline de tiempo real
  **aislado en su propio worker** (`voice-worker`), fuera de la API y del worker de flujos:
  telefonía (SIP/proveedor) → **STT** (voz→texto) → runtime conversacional del agente → **TTS** (texto→voz) con
  **barge-in** y baja latencia. **Grabación y transcripción como evidencia** (datos sensibles bajo DataGuard y
  retención RNF07), **consentimiento** registrado, y **límites de costo/duración** aplicados por el motor de
  presupuestos. Toda acción con efecto solicitada por el interlocutor se convierte en **tarea autorizada** (E4) y pasa
  por aprobación según riesgo; la llamada por sí sola no concede atribuciones.

### D6 — Capacidades de conexión (E8)

- **Internet gobernado (modifica):** se expone `HttpClientService.safeFetch` como **herramienta de agente**
  (`web_fetch`/`web_search`) tras el `ActionGateway`, con **dominios permitidos por política** (`allowedHosts`),
  límites de tamaño/tasa, y el resultado tratado como **dato no confiable** (nunca instrucciones ejecutables). No
  requiere nuevos servicios; reutiliza el cliente anti-SSRF existente.
- **RPA (construye):** adaptador/worker de automatización de interfaces (navegador headless y, si aplica, escritorio)
  para sistemas **sin API**, **aislado en su propio worker** (`rpa-worker`): sesiones con **credenciales de la bóveda**
  (nunca en el prompt), pasos auditables, **captura de evidencia** (capturas/trazas), **idempotencia** y conciliación
  (E7), **bajo política y aprobación**. Principio: **preferir API/conector sobre RPA** cuando el destino lo soporte; la
  RPA es el puente para sistemas heredados.

### D7 — Esquema propuesto (bloque de referencia, no es migración)

> Referencia de diseño. La migración y el `schema.prisma` definitivos los produce `backend-platform` siguiendo la regla
> de CLAUDE.md sobre migraciones aditivas; todo con `workspaceId`, identificador estable, vigencia e historial.

```prisma
// --- Gobierno (E6) ---
model Politica {
  id            String   @id @default(cuid())
  workspaceId   String
  empresaId     String?             // alcance de empresa (OrgUnit tipo EMPRESA)
  nombre        String
  tipoAccion    String              // EMAIL_SEND | WHATSAPP_SEND | VOICE_CALL | PAYMENT | ... | RPA_RUN | WEB_FETCH
  selector      Json                // agente/usuario/org/recurso/destinatario/monto/dato/horario
  efecto        PolicyEffect        // ALLOW | DENY | REQUIRE_APPROVAL
  requiredApprovals Int   @default(1)
  allowSelfApproval Boolean @default(false)
  version       Int                 // inmutable; un cambio crea una versión nueva, no reescribe
  vigenteDesde  DateTime
  vigenteHasta  DateTime?
  estado        PolicyStatus        // BORRADOR | ACTIVA | ARCHIVADA
}

model DecisionPolitica {           // inmutable (feeds AuditLog)
  id               String @id @default(cuid())
  workspaceId      String
  actionContextHash String
  efecto           PolicyEffect
  policyVersions   Json             // qué políticas/versiones dispararon
  motivo           String           // código auditable, nunca razonamiento del modelo
  createdAt        DateTime @default(now())
}

model Aprobacion {
  id             String @id @default(cuid())
  workspaceId    String
  empresaId      String?
  tarea Id       String?            // vínculo a Tarea (E4)
  tipoAccion     String
  operacion      Json               // operación/plantilla + parámetros exactos
  identidadEjec  Json               // agentId + agentVersionId que ejecutará
  destinatarios  Json
  contenido      Json
  adjuntos       Json?
  contentHash    String             // contenido + destinatarios + monto + adjuntos + herramienta + versión
  importe        Decimal?
  moneda         String?
  riesgo         ApprovalRisk       // BAJO | MEDIO | ALTO
  evidencia      Json?
  requiredApprovals Int @default(1)
  decisiones     Json               // [{actorUserId, decision, comentario, at}] (dos distintos si =2)
  estado         ApprovalStatus     // PENDIENTE | APROBADA | RECHAZADA | AJUSTE | EJECUTADA | CADUCADA | INVALIDADA
  expiresAt      DateTime
  createdAt      DateTime @default(now())
}

model Suspension {
  id          String @id @default(cuid())
  workspaceId String
  alcance     SuspensionScope        // AGENTE | PROCESO | CONECTOR | ORGANIZACION
  targetId    String                 // id del agente/flujo/conector/empresa
  activa      Boolean @default(true)
  motivo      String
  actorUserId String
  createdAt   DateTime @default(now())
  reactivadaPor String?
  reactivadaMotivo String?
  reactivadaAt  DateTime?
}

// --- Canales externos (E14): reutilizan Connector + ConnectorOperation ---
// Nuevos ConnectorType: WHATSAPP, VOICE. El correo reutiliza el conector existente con operaciones EMAIL_SEND/RECEIVE.
model CanalEvento {                  // hechos distintos de envío/recepción/lectura/respuesta (RF35)
  id            String @id @default(cuid())
  workspaceId   String
  canal         String               // EMAIL | WHATSAPP | VOICE
  direccion     ChannelDirection      // SALIENTE | ENTRANTE
  tipo          String                // ENVIADO | RECIBIDO | LEIDO | RESPONDIDO | ...
  providerMsgId String?               // idempotencia por id del proveedor
  correlationId String
  aprobacionId  String?
  payloadRef    Json                  // referencia saneada; evidencia sensible en almacenamiento de objetos
  createdAt     DateTime @default(now())
  @@unique([workspaceId, canal, providerMsgId])   // dedup de webhooks
}

model VoiceCall {                     // metadatos de la llamada; grabación/transcripción como evidencia
  id            String @id @default(cuid())
  workspaceId   String
  agentId       String
  direccion     ChannelDirection
  consentimiento Boolean @default(false)
  duracionSeg   Int?
  costoUsd      Decimal?
  grabacionRef  String?               // objeto, bajo DataGuard + retención
  transcripcionRef String?
  estado        String                // EN_CURSO | FINALIZADA | FALLIDA
}
```

## Consecuencias

- **Datos:** migraciones **aditivas** para `Politica`, `DecisionPolitica`, `Aprobacion`, `Suspension`, `CanalEvento`,
  `VoiceCall`; nuevos `ConnectorType` `WHATSAPP` y `VOICE` y nuevos tipos de acción. No se reescribe ningún ADR ni
  dato existente. El gate `requiresApproval` actual sigue válido (compatibilidad hacia atrás). Grabaciones/adjuntos van
  a almacenamiento de objetos con retención por tipo de dato (ADR 0008), nunca en columnas de texto.
- **API:** nuevos contratos versionados `POST /v1/approvals/{id}/decision`, `GET /v1/approvals`,
  `POST /v1/agents|processes|connectors|orgs/{id}/suspend` y `/reactivate`, CRUD de `Politica` (`@MinRole('ADMIN')`
  para políticas y suspensión; aprobar/rechazar según atribuciones del aprobador, nunca el solicitante). Webhooks
  entrantes (`POST /v1/channels/{canal}/webhook`) `@Public()` + verificación de firma + throttling + idempotencia.
  Toda mutación acepta clave de idempotencia (RF17).
- **Frontend:** pantalla **Aprobaciones** (comparar propuesta vs. estado, hash/vigencia, aprobar/rechazar/pedir
  ajuste, doble aprobación visible), **Suspensión de emergencia** (interruptor por alcance + estado de conciliación),
  configuración de **Políticas**, y catálogo de **canales** (correo/WhatsApp/voz) y capacidades (internet/RPA) como
  conectores. Diferenciar visualmente autor humano y digital.
- **Seguridad/escalabilidad:** un único punto de decisión (`PolicyEngine`) y un único punto de salida
  (`ActionGateway`); salida de internet solo por `HttpClientService`; secretos solo por bóveda; voz y RPA en workers
  aislados que escalan horizontalmente sin tocar la API sin estado; webhooks firmados e idempotentes.
- **Invariantes de seguridad (deben cubrirse con pruebas):**
  1. Ninguna acción con efecto externo se ejecuta sin una `DecisionPolitica` `ALLOW` o una `Aprobacion` válida.
  2. El contenido del modelo nunca cambia la decisión de política.
  3. El `contentHash` se recomputa al ejecutar; cualquier cambio invalida la aprobación (QA03).
  4. Doble aprobación = dos `userId` distintos; sin autoaprobación cuando la política lo prohíbe (QA13).
  5. Permisos, presupuesto y suspensión se **revalidan** inmediatamente antes del efecto (QA07, QA08).
  6. Toda consulta filtra por `workspaceId`/empresa; mencionar o recibir un mensaje no concede acceso (QA12).
  7. Contenido entrante (correo/WhatsApp/voz/web/RPA) es dato no confiable; no habilita herramientas ni revela
     secretos (QA02).
  8. Webhooks firmados + dedup por `providerMsgId`: una redelivery no duplica efecto ni crea otra tarea (QA04).
- **Plan de pruebas:** QA02 (inyección desde contenido externo en los cuatro canales), QA03 (invalidación por cambio de
  contenido/destino/monto/adjunto y aprobador sin permiso), QA04 (idempotencia de webhooks y de envíos), QA07
  (revocación antes del despacho), QA08 (suspensión bloquea y concilia), QA12 (aislamiento), QA13 (no autoaprobación).

## Decisiones de producto abiertas (requieren al negocio)

1. **Proveedor de WhatsApp Business API** (Meta Cloud API directa vs. BSP tipo Twilio/360dialog): afecta plantillas,
   firma de webhooks y costo.
2. **Proveedor de telefonía/voz** (SIP + STT/TTS propios vs. plataforma conversacional de voz gestionada): define
   latencia, barge-in, costo por minuto y región de alojamiento (RNF07/jurisdicción).
3. **Consentimiento y retención de grabaciones**: marco legal de grabación de llamadas por jurisdicción y plazos de
   retención de transcripciones (Ley 1581 Colombia y equivalentes; validar con asesoría legal).
4. **Catálogo inicial de tipos de acción sensibles y sus políticas por defecto** (pagos, cambio de cuentas, borrado,
   cambio de permisos, publicación externa): cuáles exigen doble aprobación y con qué umbrales de monto.
5. **Alcance de RPA en P0**: ¿solo navegador headless o también escritorio? Sistemas destino concretos y si existe API
   alternativa (preferida).
6. **Umbral de riesgo que dispara revisión humana** vinculado a la verificación cruzada del ADR 0010.

## Plan de implementación

Orden de dependencias: contrato de API (architect) → motor de políticas + pasarela de acción (backend) → canales y
capacidades → frontend → QA.

| Tarea | Dueño | Criterio de aceptación | Archivos afectados (orientativo) |
|---|---|---|---|
| Contrato OpenAPI de políticas, aprobaciones, suspensión, webhooks de canales e idempotencia | nexo-architect | DTOs y rutas versionadas acordadas; `docs/ARCHITECTURE.md` actualizado | `docs/**`, `apps/api/src/.../dto` |
| Esquema Prisma aditivo (D7) + migración | nexo-backend-platform | Migración aditiva aplica sin tocar índices generados; todo con `workspaceId` y vigencia | `apps/api/prisma/schema.prisma` |
| `PolicyEngine.evaluate` + `DecisionPolitica` + versión de política; control más restrictivo gana | nexo-backend-platform | Pruebas unitarias del álgebra de efectos; decisión registrada con versión; el texto del modelo no altera la decisión | `modules/governance/policy/**` |
| `ActionGateway` (punto único de salida) reutilizando `budgets.plan/record` y revalidación al ejecutar | nexo-backend-platform | Toda acción sensible pasa por el gateway; reserva→despacho→conciliación con idempotencia | `modules/governance/**`, `modules/connectors/**` |
| Bandeja `Aprobacion`: hash, invalidación, doble aprobación, caducidad, revalidación | nexo-backend-platform | QA03/QA07/QA13 cubiertos; endpoints con autorización correcta | `modules/governance/**` |
| `Suspension` por agente/proceso/conector/org + conciliación | nexo-backend-platform | QA08: bloquea nuevas, concilia enviadas (confirmado/incierto), reactivación con actor+motivo | `modules/governance/**`, `modules/workflows/**` |
| Integrar el gate del runtime con el `ActionGateway` (compatibilidad del `requiresApproval` actual) | nexo-backend-ai | El chat sigue funcionando; acciones sensibles delegan en política/aprobación sin romper el flujo | `modules/agents/agent-runtime.service.ts` |
| Canal correo como canal del empleado digital (plantillas, destinatarios, eventos envío/recepción) | nexo-backend-integrations | Saliente bajo política/aprobación; recepción/respuesta como hechos distintos | `modules/connectors/**` |
| Adaptador WhatsApp Business API (plantillas, ventana 24 h, webhooks firmados, idempotencia) | nexo-backend-integrations | Webhook verifica firma; dedup por `providerMsgId`; saliente gobernada (QA04) | `modules/connectors/adapters/whatsapp.adapter.ts` |
| `web_fetch`/`web_search` gobernado sobre `HttpClientService` con dominios permitidos | nexo-backend-integrations | Dominios por política; resultado como dato no confiable; anti-SSRF intacto | `common/http/**`, `modules/connectors/**` |
| Worker de voz aislado (SIP + STT + runtime + TTS con barge-in; grabación/transcripción; límites) | nexo-backend-ai + nexo-backend-platform | Llamada bajo consentimiento y límites de costo/duración; evidencia bajo DataGuard; aislado del API | nuevo `apps/api/src/.../voice-worker/**` |
| Worker de RPA aislado (navegador headless, credenciales de bóveda, evidencia, idempotencia, aprobación) | nexo-backend-platform | Bajo política/aprobación; sin credenciales en prompt; prefiere API cuando existe | nuevo `apps/api/src/.../rpa-worker/**` |
| Modelos/ApiService del frontend para aprobaciones, políticas, suspensión y canales | nexo-frontend-core | Tipos y servicios cubren los contratos; sin warnings NG8113 | `apps/web/src/app/core/**` |
| Pantallas Aprobaciones, Suspensión, Políticas y catálogo de canales/capacidades | nexo-frontend-ui | Comparación propuesta/estado, hash/vigencia, doble aprobación; autor humano vs. digital diferenciado | `apps/web/src/app/features/**` |
| Pruebas de integración API: QA02/QA03/QA04/QA07/QA08/QA12/QA13 | nexo-qa-api | Invariantes de seguridad D1-D8 verificadas; cada bug con prueba que lo reproduce | `apps/api/**/*.spec.ts`, `apps/api/test/**` |
| Recorridos e2e: aprobar una acción, invalidar por cambio, suspender y conciliar | nexo-qa-e2e | HU06/HU10 verificadas en UI | `apps/web/e2e/**` |
