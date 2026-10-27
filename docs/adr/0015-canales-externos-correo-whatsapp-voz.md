# 0015. Canales externos: correo, WhatsApp y voz (contratos y adaptadores)

- **Estado:** Propuesto
- **Fecha:** 2026-10-26
- **Responsables:** nexo-architect
- **Épicas del backlog:** E14 (canales externos, RF16/RF17/RF35), con dependencias de E5 (toda comunicación operativa
  ligada a misión/tarea e idempotente), E6 (gobierno de acciones y aprobaciones), E13 (auditoría) y E8 (egress
  gobernado). Patrocinador: Ronny Ferney Garzón Silva, `docs/decisiones-patrocinador-13-bloqueantes.md` (Bloque A,
  puntos 1-4).
- **Relacionado:** ADR 0005 (catálogo de conectores y patrón `ConnectorAdapter`), ADR 0008 (DataGuard, retención y
  observabilidad), ADR 0012 (trabajo por resultados y comunicación de agentes), ADR 0013 (gobierno de acciones y
  canales externos: motor de políticas, `ActionGateway`, bandeja de aprobaciones, suspensión). **Este ADR detalla los
  contratos de canal y voz esbozados en ADR 0013 §D5; no lo reemplaza, lo precisa.**

## Actualización del patrocinador (2026-10-27)

El patrocinador (Ronny Ferney Garzón Silva) confirmó estas definiciones. Distingue cuatro autorizaciones independientes
—**construir / acceso a cuentas y datos / gasto / activación productiva**— y ninguna implica las demás.

- **Correo (pto 1):** Microsoft 365 como primera vía; **Gmail** como alternativa por adaptador. Cuentas/credenciales
  **por empresa**. *Construido en sandbox* (adaptadores `m365` y `gmail`); activación real **pendiente** (pto 8).
- **WhatsApp (pto 4):** **Meta WhatsApp Business Platform Cloud API como primera vía del piloto**; **Twilio** alternativo
  por adaptador independiente. Cuenta/número/credenciales **por empresa**. *Construido en sandbox*; **no** autoriza
  activación productiva ni gasto.
- **Voz (pto 9):** evaluación acotada de **Amazon Connect** y **Google Cloud** **sin gasto** (diseño + simuladores ya
  construidos; stubs inactivos). Servicios pagos **requieren aprobación previa**. Ver `docs/propuesta-presupuesto-voz.md`.
- **Grabación/retención (pto 6, Jurídica):** controles configurables por empresa (`GrabacionConfig`), desactivados por
  defecto, `retencionDias` en NULL = pendiente de política. Consultas a Jurídica en
  `docs/consultas-juridica-grabaciones-evidencia.md`. No se asumen plazos legales ni valor probatorio automático.
- **Activación real de correo/WhatsApp (pto 8):** **pendiente de autorización específica**. Antes de solicitarla se
  diligencia `docs/plantilla-solicitud-activacion-real.md` (empresa, buzón/número, responsable, permisos, destinatarios
  de prueba, costos, desactivación). Credenciales por la bóveda, nunca por chat.

El cuerpo original de este ADR se conserva como propuesta; esta sección fija las decisiones vigentes del patrocinador.

## Contexto

ADR 0013 estableció el gobierno transversal (`PolicyEngine`, `ActionGateway`, `Aprobacion`, `Suspension`) y declaró que
los canales externos son adaptadores detrás de la pasarela de acción. Falta **el contrato concreto de esos canales** y
las decisiones de primer proveedor que el patrocinador fijó en el Bloque A de
`docs/decisiones-patrocinador-13-bloqueantes.md`:

- **Correo (punto 1, PROPUESTO):** Microsoft 365 como primera implementación; Gmail como alternativa por adaptador.
  Separar el **buzón empresarial** (recibir/leer/responder como empleado digital) del **envío transaccional/masivo**
  (SMTP/ESP). Credenciales y configuración **por empresa**; registro de envíos e **idempotencia**.
- **WhatsApp (punto 2, DECISIÓN DEL PATROCINADOR 2026-10-27):** **Meta directo (WhatsApp Business Platform Cloud API)
  como primera vía del piloto**; **Twilio** se mantiene como **adaptador alternativo** independiente. Propiedad de
  **cuenta/número/credenciales por empresa** (no una cuenta única compartida). Piloto ≠ SaaS multiempresa. Esta
  decisión **no** autoriza activación productiva ni gasto (ver §Actualización del patrocinador).
- **Voz/telefonía (punto 3, REQUISITO CONFIRMADO de apertura; proveedor productivo PENDIENTE):** mantener abierta la
  integración con **Amazon Connect** y **Google Cloud**, sin cerrar a Twilio/Vonage/Vapi/Retell. Separar **4 capas**:
  (a) telefonía/números/gestión de llamadas, (b) STT/TTS, (c) motor conversacional, (d) procesos/herramientas/
  autorizaciones de NEXO. Contrato común + adaptadores con **capabilities declaradas**; bloquear configuraciones
  incompatibles. Primer proveedor productivo pendiente de prueba técnica + evaluación económica. No prometer migración
  transparente de llamadas activas ni "100 % perfecto".
- **Grabaciones/retención (punto 4, PROPUESTO · pendiente validación Jurídica):** controles configurables
  (autorización, finalidad, acceso, conservación, eliminación); distinguir audio/transcripción/resumen/evidencia;
  **off por defecto**; sin declarar cumplimiento sin validación jurídica.

Se **reutiliza** lo construido: `HttpClientService.safeFetch()` (único egress, anti-SSRF, timeout, tamaño) para toda
llamada saliente; la **bóveda de secretos** (`{{ secrets.NOMBRE }}`, nunca el secreto en claro ni en plantilla); el
patrón `ConnectorAdapter` (sin `if (type === ...)` dispersos); el `ActionGateway`/`PolicyEngine`/`Aprobacion` de E6; el
vínculo misión/tarea e idempotencia de E5; `AuditLog` inmutable de E13; DataGuard/retención de ADR 0008.

Restricciones:
- API sin estado; trabajo pesado (pipeline de voz en tiempo real) en **workers** propios, no en la API.
- Multi-tenant estricto: toda consulta filtra por `workspaceId`/`empresaId` desde `@CurrentAuth()`, nunca del cuerpo.
- Compatibilidad hacia atrás de definiciones de flujo almacenadas: las referencias a canal son **aditivas**.
- **Nada se activa en producción** por este ADR: se diseñan contratos y adaptadores (incluido uno simulado) para
  construir y probar sin envíos reales. La activación productiva queda **gated** por credenciales por empresa,
  selección de proveedor de voz y validación jurídica de grabación.

## Alternativas consideradas

### Estructura de los canales de mensajería

1. **Un servicio de mensajería con ramas `if (canal === ...)`.** Rechazada: concentra y dispersa a la vez la lógica por
   proveedor, viola el principio de puertos/adaptadores de CLAUDE.md, y hace que un canal "olvide" idempotencia o
   verificación de firma.
2. **Cada canal como `ChannelAdapter` detrás del `ActionGateway`, con identidad por empresa y capabilities
   declaradas.** Correo (M365/Gmail/SMTP-ESP) y WhatsApp (Twilio/Meta) comparten contrato; los nuevos proveedores son
   adaptadores nuevos. **Elegida.**

### Acoplamiento buzón empresarial vs. envío masivo (correo)

1. **Un solo adaptador de correo para todo.** Rechazada: el buzón conversacional (OAuth delegado, lectura de hilos) y el
   envío transaccional/masivo (SMTP/ESP, reputación de dominio, rebotes, listas de supresión) tienen riesgos, cuotas y
   credenciales distintos; mezclarlos complica el gobierno y la idempotencia.
2. **Dos capabilities separadas sobre el mismo contrato `ChannelAdapter`:** `MAILBOX` (recibir/leer/responder) y
   `BULK_SEND`/`TRANSACTIONAL` (envío), cada una con su configuración y secreto por empresa. **Elegida.**

### Voz/telefonía

1. **Cerrar a un solo proveedor gestionado (p. ej. Twilio o un Vapi/Retell) y construir sobre su SDK.** Ventaja:
   velocidad inicial. **Rechazada** por decisión expresa del patrocinador: crea lock-in, impide la apertura confirmada a
   Amazon Connect y Google Cloud, y ata el motor conversacional y las autorizaciones de NEXO a la hoja de ruta de un
   tercero. El requisito es mantener la arquitectura **abierta**.
2. **Contrato común `VoiceProvider` partido en 4 capas con capabilities declaradas por adaptador**, donde la capa (d)
   —procesos/herramientas/autorizaciones de NEXO— **nunca** se delega al proveedor y siempre pasa por el
   `ActionGateway`. Combinaciones incompatibles se bloquean en configuración. **Elegida.**

### Pruebas sin envíos reales

1. **Probar contra sandboxes de cada proveedor.** Útil pero insuficiente: requiere credenciales, es no determinista y
   no cubre CI. Se mantiene como escalón previo a producción, no como base de QA.
2. **Adaptador `simulado` determinista por canal** (espejo del proveedor LLM mock ya existente), que registra lo que
   "enviaría" y permite inyectar webhooks/entrantes sintéticos. **Elegida** como base de QA; los sandboxes de proveedor
   son el paso siguiente antes de activar.

## Decisión

### D1 — Contrato `ChannelAdapter` (correo y WhatsApp como mensajería)

Puerto hexagonal análogo a `ConnectorAdapter`, detrás del `ActionGateway`. Un adaptador declara su `type`, sus
`capabilities` y expone operaciones uniformes; la selección de adaptador es por configuración de la cuenta de canal de
la empresa, nunca por ramas dispersas.

- **Operaciones:**
  - `send(message, idempotencyKey)` — envío saliente; **siempre** pasa por `ActionGateway` (política + aprobación E6
    según el proceso). Devuelve `providerMessageId`.
  - `receiveWebhook(rawRequest)` — recepción entrante y eventos de estado; **verifica la firma** del proveedor antes de
    procesar; traduce el payload del proveedor a un `CanalEvento` normalizado. Idempotente por `providerMessageId`.
  - `getDeliveryStatus(providerMessageId)` — consulta/normaliza el estado de entrega cuando el proveedor lo ofrece por
    pull además de por webhook.
  - `test(config)` — valida credenciales/conectividad sin enviar a un destinatario real.
  - Opcional `listTemplates()` / `resolveTemplate(name, params)` para canales con plantillas aprobadas (WhatsApp).
- **Identidad por empresa:** cada adaptador se instancia con la `CanalCuenta` de la empresa (tipo, proveedor, referencia
  a secreto de bóveda). Nunca hay una cuenta/número único compartido entre empresas; el `workspaceId`/`empresaId`
  proviene de `@CurrentAuth()`.
- **Idempotencia:** toda operación `send` lleva una **clave de idempotencia** (derivada de la tarea/misión de E5); el
  registro de `MensajeCanal` tiene índice único por `(workspaceId, proveedor, providerMessageId)` y por clave de
  idempotencia, de modo que un reintento o una redelivery de webhook **no duplica** el efecto ni crea otra tarea.
- **Firma/verificación de webhooks:** los endpoints entrantes son `@Public()` + throttling + **verificación de firma
  obligatoria** (secreto de firma del proveedor en bóveda). Un webhook sin firma válida se descarta y se audita.
- **Plantillas (WhatsApp):** envío iniciado por la empresa usa **plantillas aprobadas**; se respeta la **ventana de
  sesión de 24 h** (fuera de ella solo plantilla). Las plantillas se referencian por nombre; los parámetros nunca
  contienen secretos.
- **Gobierno (E6):** todo mensaje externo saliente es una acción con efecto; el `ActionGateway` evalúa la política del
  proceso y, si corresponde, exige aprobación antes de despachar. El contenido **entrante** es **dato no confiable**
  (DataGuard): no habilita herramientas, no modifica políticas, no concede atribuciones.
- **Separación correo (capabilities):** `MAILBOX` (recibir/leer/responder, p. ej. M365/Gmail por OAuth delegado por
  empresa) y `TRANSACTIONAL`/`BULK` (SMTP/ESP), con configuración y secreto propios por empresa. Adaptadores previstos:
  **M365 (primero)**, **Gmail (alternativa)**, **SMTP/ESP** para transaccional/masivo.
- **WhatsApp:** adaptador **Twilio (piloto)** y adaptador **Meta directo (previsto)**, independientes; propiedad de
  cuenta/número por empresa.

### D2 — Contrato `VoiceProvider` en 4 capas con capabilities declaradas

La voz no es un único adaptador monolítico: es un **contrato partido en 4 capas** que pueden provenir de proveedores
distintos, cada capa con sus `capabilities` declaradas. El pipeline en tiempo real vive en un **worker aislado**
(`voice-worker`), fuera de la API sin estado.

- **Capa (a) Telefonía / números / gestión de llamadas (`VoiceTelephony`):** aprovisionamiento de números, originar y
  recibir llamadas, control de la sesión (contestar, transferir, colgar), eventos de llamada. Capabilities p. ej.
  `inbound`, `outbound`, `numberProvisioning`, `transfer`, `dtmf`, `sipTrunk`.
- **Capa (b) STT/TTS (`VoiceSpeech`):** transcripción voz→texto y síntesis texto→voz. Capabilities p. ej.
  `streamingStt`, `bargeIn`, `languages`, `voices`, `wordTimestamps`.
- **Capa (c) Motor conversacional (`VoiceDialog`):** puede ser el **runtime de agentes de NEXO** (preferido) o un motor
  de diálogo del proveedor. Capabilities p. ej. `externalDialog` (NEXO controla el turno) vs. `providerDialog`.
- **Capa (d) Procesos / herramientas / autorizaciones de NEXO:** **nunca** se delega al proveedor. Toda acción con
  efecto que surja de una llamada se convierte en **tarea autorizada** (E5) y pasa por el `ActionGateway`/aprobaciones
  (E6). El proveedor transporta audio; **no** ejecuta acciones de negocio.
- **Capabilities y bloqueo de incompatibles:** cada adaptador publica sus capabilities; la configuración valida la
  combinación y **bloquea** las incompatibles (p. ej. exigir `bargeIn` a un STT que no lo soporta, o pretender diálogo
  externo con un proveedor que solo ofrece diálogo propio). La validación es explícita y auditable, no un fallo en
  tiempo de llamada.
- **Adaptadores previstos:** **Amazon Connect** y **Google Cloud** (apertura confirmada), más opciones **gestionadas**
  (Twilio/Vonage/Vapi/Retell) como candidatos; un adaptador **stub/simulado** valida el modelo. El primer proveedor
  productivo queda **pendiente** de prueba técnica + evaluación económica (no se elige en este ADR).
- **"Cambiar de proveedor conserva las reglas de negocio" significa:** las capas (c)-diálogo-NEXO y (d)-procesos/
  autorizaciones, las políticas de E6, las plantillas de proceso, los pasaportes y la auditoría **no dependen** del
  proveedor y se conservan al cambiar de telefonía/STT/TTS. **No** significa migración transparente: **requieren
  reconfiguración/migración** los números telefónicos, el aprovisionamiento, los webhooks/credenciales, las voces/
  modelos de STT-TTS y, posiblemente, el formato de grabaciones. **No se promete** continuidad de llamadas activas
  durante un cambio ni un "100 % perfecto".

### D3 — Grabaciones y retención (off por defecto)

Controles **configurables por empresa**, **desactivados por defecto**, distinguiendo cuatro tipos de dato con políticas
independientes: **audio**, **transcripción**, **resumen** y **evidencia**. Cada tipo tiene autorización (cuando
corresponda), finalidad declarada, control de acceso, plazo de conservación y procedimiento de eliminación verificable
(reutiliza DataGuard/retención de ADR 0008; los binarios van a almacenamiento de objetos con referencia, nunca en
columnas de texto). **No se declara cumplimiento** de ningún marco sin validación jurídica; la activación de grabación
en producción queda **gated** por esa validación.

### D4 — Modelo de datos propuesto (bloque de referencia, NO es migración)

> Referencia de diseño. El `schema.prisma` y la migración **aditiva** los produce `backend-platform`. Todo con
> `workspaceId`/`empresaId`, multi-tenant, y **sin el secreto** (solo una referencia a la bóveda).

```prisma
model CanalCuenta {              // cuenta de canal por empresa
  id            String   @id @default(cuid())
  workspaceId   String
  empresaId     String             // OrgUnit tipo EMPRESA; propiedad por empresa
  canal         String             // EMAIL | WHATSAPP | VOICE
  proveedor     String             // M365 | GMAIL | SMTP | TWILIO | META | AMAZON_CONNECT | GOOGLE_CLOUD | SIMULADO | ...
  capability    String             // MAILBOX | TRANSACTIONAL | BULK | VOICE_TELEPHONY | VOICE_SPEECH | VOICE_DIALOG
  estado        String             // BORRADOR | SANDBOX | ACTIVA | SUSPENDIDA
  config        Json               // identidad del canal (nº/remitente/dominio/región/capabilities), SIN secretos
  secretRef     String             // referencia a la bóveda; NUNCA el secreto en claro
  createdAt     DateTime @default(now())
  @@unique([workspaceId, empresaId, canal, proveedor, capability])
}

model MensajeCanal {             // envío/recepción/estado, vinculado a misión/tarea (E5)
  id              String   @id @default(cuid())
  workspaceId     String
  empresaId       String
  canalCuentaId   String
  misionId        String?           // vínculo a misión (E5)
  tareaId         String?           // vínculo a tarea (E5)
  direccion       String            // SALIENTE | ENTRANTE
  tipo            String            // ENVIADO | RECIBIDO | LEIDO | RESPONDIDO | ENTREGADO | FALLIDO
  idempotencyKey  String            // clave de idempotencia del envío (derivada de la tarea)
  providerMessageId String?         // id del proveedor (dedup de webhooks)
  aprobacionId    String?           // Aprobacion de E6 si el envío la requirió
  estadoEntrega   String?           // QUEUED | SENT | DELIVERED | READ | FAILED | ...
  payloadRef      Json              // referencia saneada; contenido/adjuntos sensibles en almacenamiento de objetos
  createdAt       DateTime @default(now())
  @@unique([workspaceId, canalCuentaId, providerMessageId])   // dedup de webhooks
  @@unique([workspaceId, canalCuentaId, idempotencyKey])      // dedup de envíos
}

model GrabacionConfig {          // política de grabación/retención por empresa, OFF por defecto
  id            String   @id @default(cuid())
  workspaceId   String
  empresaId     String
  tipoDato      String             // AUDIO | TRANSCRIPCION | RESUMEN | EVIDENCIA
  habilitado    Boolean  @default(false)   // off por defecto
  requiereAutorizacion Boolean @default(true)
  finalidad     String?
  accesoRoles   Json?              // quién puede acceder
  retencionDias Int?               // plazo de conservación; null = no definido (no activa producción)
  @@unique([workspaceId, empresaId, tipoDato])
}

model VoiceCall {                 // metadatos de llamada; grabación/transcripción como evidencia bajo D3
  id              String   @id @default(cuid())
  workspaceId     String
  empresaId       String
  canalCuentaId   String
  misionId        String?
  tareaId         String?
  direccion       String            // SALIENTE | ENTRANTE
  proveedores     Json              // qué adaptador cubrió cada capa (a/b/c)
  consentimiento  Boolean  @default(false)
  duracionSeg     Int?
  costo           Decimal?
  grabacionRef    String?           // solo si GrabacionConfig lo habilita; referencia a objeto
  transcripcionRef String?
  estado          String            // EN_CURSO | FINALIZADA | FALLIDA
  createdAt       DateTime @default(now())
}
```

### D5 — Estrategia de sandbox / simuladores

- **Adaptador `SIMULADO` por canal** (correo, WhatsApp, voz), espejo del proveedor LLM mock: **determinista**, no
  realiza ninguna llamada externa, registra el `MensajeCanal`/`VoiceCall` que "enviaría" y permite **inyectar
  entrantes y webhooks sintéticos** (incluida firma simulada) para ejercer recepción, estados de entrega e
  idempotencia. Es la base de QA en CI, sin credenciales.
- **Sandbox de proveedor** (M365 test tenant, Twilio sandbox, Connect/GCP de prueba) como escalón previo a producción,
  no como base de QA automatizada.
- **Condición de activación productiva por canal:**
  - *Correo:* credenciales y configuración **por empresa** cargadas en bóveda; `CanalCuenta` en estado `ACTIVA`.
  - *WhatsApp:* además, validación de **costos/onboarding** y **propiedad de número por empresa**.
  - *Voz:* además, **proveedor productivo elegido** por prueba técnica + evaluación económica.
  - *Grabación:* además, **validación jurídica** y `GrabacionConfig.habilitado=true` con retención definida.

### D6 — Plan de implementación por incrementos (cédulas disjuntas)

- **Incremento 1 (mínimo, construible y probable ahora):** contrato `ChannelAdapter` + adaptador **correo M365** +
  adaptador **simulado** + **registro idempotente** (`MensajeCanal`), **sin activar envíos productivos**. Cubre
  enviar/recibir/estado en sandbox, idempotencia y gobierno por `ActionGateway`.
- **Incremento 2:** adaptador correo **Gmail** (alternativa) y ruta **transaccional/masiva** (SMTP/ESP) con su
  configuración por empresa.
- **Incremento 3:** adaptador **WhatsApp Twilio (sandbox)** + webhooks firmados + plantillas + ventana 24 h; adaptador
  **Meta** previsto.
- **Incremento 4:** contrato `VoiceProvider` (4 capas) + adaptador **stub/simulado** que valida capabilities y bloqueo
  de incompatibles; worker `voice-worker` aislado.
- **Incremento 5 (gated):** adaptadores de voz **Amazon Connect** y **Google Cloud**; selección de proveedor
  productivo.

**Queda gated (no se activa por este ADR):** activación productiva de correo/WhatsApp (credenciales por empresa), voz
productiva (proveedor elegido), y grabación (validación jurídica). El motor avanza con contratos y simuladores.

## Consecuencias

- **Datos:** migraciones **aditivas** para `CanalCuenta`, `MensajeCanal`, `GrabacionConfig`, `VoiceCall` (y nuevos
  valores de proveedor/capability); no reescribe ADR 0013 ni datos existentes. Definiciones de flujo almacenadas: las
  referencias a canal son aditivas (compatibilidad hacia atrás). Binarios de grabación/adjuntos en almacenamiento de
  objetos con retención por tipo de dato (ADR 0008), nunca en columnas de texto.
- **API:** contratos versionados de cuentas de canal (`@MinRole('ADMIN')` para crear/activar), envío (vía
  `ActionGateway`, `@MinRole('EDITOR')` + idempotencia), estado de entrega, y webhooks entrantes
  (`POST /v1/channels/{canal}/webhook`, `@Public()` + firma + throttling + dedup). `workspaceId`/`empresaId` siempre de
  `@CurrentAuth()`.
- **Frontend:** catálogo/configuración de **cuentas de canal por empresa** (sin exponer secretos), bandeja de mensajes
  por empresa con estado de entrega, configuración de **grabación/retención** (off por defecto, por tipo de dato), y
  configuración de voz con validación de capabilities compatibles.
- **Seguridad/escalabilidad:** credenciales **solo en bóveda** (`secretRef`, nunca en `config` ni en plantillas);
  egress **solo por `HttpClientService`** (anti-SSRF, timeout, tamaño); webhooks **firmados e idempotentes**; mensajes
  externos **gobernados por E6**; entrante como **dato no confiable**; voz en **worker aislado** que escala sin tocar la
  API; **multi-tenant estricto** (toda consulta por `workspaceId`/`empresaId`).
- **Invariantes (deben cubrirse con pruebas):**
  1. Ningún mensaje saliente se despacha sin pasar por el `ActionGateway` (política + aprobación cuando aplica).
  2. Idempotencia: un reintento de envío o una redelivery de webhook no duplica efecto ni crea otra tarea.
  3. Webhook sin firma válida se descarta y se audita.
  4. El contenido entrante no habilita herramientas, no cambia políticas ni concede atribuciones.
  5. Combinaciones de capabilities de voz incompatibles se bloquean en configuración, no en tiempo de llamada.
  6. Grabación off por defecto; no se persiste audio/transcripción sin `GrabacionConfig.habilitado`.
  7. Ninguna `CanalCuenta` comparte identidad/número entre empresas; toda consulta filtra por `workspaceId`/`empresaId`.
  8. El `secretRef` nunca expone el secreto; no hay secretos en `config` ni en plantillas.
- **Plan de pruebas:** envío/recepción/estado con adaptador simulado (determinista, en CI); idempotencia de envíos y de
  webhooks (dedup por `providerMessageId` y por `idempotencyKey`); verificación/rechazo de firma de webhook; inyección
  desde contenido entrante (no confiable); validación de capabilities de voz y bloqueo de incompatibles; grabación off
  por defecto y retención/eliminación verificable; aislamiento multi-tenant.

## Preguntas que requieren decisión del negocio

1. **WhatsApp:** confirmar Twilio como primer piloto y validar **costos/onboarding/propiedad de número por empresa**
   (Patrocinador + Finanzas). No se asume cuenta única compartida.
2. **Voz:** autorizar la **prueba técnica + evaluación económica** para elegir el primer proveedor productivo
   (apertura a Amazon Connect + Google Cloud ya confirmada). Región de alojamiento y su efecto jurisdiccional.
3. **Grabaciones/retención:** **validación jurídica** de autorización, finalidad, plazos y eliminación por tipo de dato
   y jurisdicción, antes de habilitar grabación en producción.
4. **Correo transaccional/masivo:** proveedor ESP/SMTP por empresa, reputación de dominio y manejo de rebotes/supresión.

## Plan de implementación

Orden de dependencias: contrato de API (architect) → esquema aditivo + adaptadores backend → canales → frontend → QA.

| Tarea | Dueño | Criterio de aceptación | Archivos afectados (orientativo) |
|---|---|---|---|
| Contrato OpenAPI de cuentas de canal, envío/estado, webhooks firmados e idempotencia | nexo-architect | DTOs y rutas versionadas acordadas; `docs/ARCHITECTURE.md` actualizado | `docs/**`, `apps/api/src/.../dto` |
| Esquema Prisma aditivo (D4) + migración | nexo-backend-platform | Migración aditiva aplica sin tocar índices generados; todo con `workspaceId`/`empresaId`; `secretRef` sin secreto | `apps/api/prisma/schema.prisma` |
| Puerto `ChannelAdapter` + registro `MensajeCanal` idempotente tras `ActionGateway` | nexo-backend-integrations | Envío pasa por gateway; dedup por `providerMessageId` y `idempotencyKey`; entrante como dato no confiable | `modules/connectors/**`, `modules/channels/**` |
| Adaptador correo **M365** (capability MAILBOX; identidad por empresa, egress por `HttpClientService`) | nexo-backend-integrations | Enviar/recibir/estado en sandbox por empresa; credenciales solo en bóveda | `modules/channels/adapters/m365.adapter.ts` |
| Adaptador **SIMULADO** por canal (determinista, inyección de webhooks/entrantes sintéticos) | nexo-backend-integrations | QA cubre recorridos sin envíos reales ni credenciales | `modules/channels/adapters/simulado.adapter.ts` |
| Adaptador correo **Gmail** + ruta **SMTP/ESP** transaccional/masiva por empresa | nexo-backend-integrations | Configuración y secreto propios por empresa; idempotencia de envíos | `modules/channels/adapters/**` |
| Adaptador **WhatsApp Twilio** (plantillas, ventana 24 h, webhooks firmados, idempotencia) | nexo-backend-integrations | Webhook verifica firma; dedup por `providerMessageId`; saliente gobernada | `modules/channels/adapters/whatsapp-twilio.adapter.ts` |
| Contrato `VoiceProvider` (4 capas) + adaptador **stub/simulado** + validación de capabilities | nexo-backend-ai + nexo-backend-platform | Capabilities declaradas; combinaciones incompatibles bloqueadas en config; capa (d) siempre por `ActionGateway` | nuevo `modules/channels/voice/**` |
| Worker de voz aislado (`voice-worker`) con STT/TTS/diálogo; grabación bajo `GrabacionConfig` | nexo-backend-ai + nexo-backend-platform | Aislado de la API; grabación off por defecto; límites de costo/duración | nuevo `apps/api/src/.../voice-worker/**` |
| Modelos/ApiService del frontend para cuentas de canal, mensajes, grabación, voz | nexo-frontend-core | Tipos y servicios cubren los contratos; sin secretos; sin warnings NG8113 | `apps/web/src/app/core/**` |
| Pantallas de cuentas de canal por empresa, bandeja, config de grabación y de voz | nexo-frontend-ui | Config por empresa sin exponer secretos; grabación off por defecto; capabilities compatibles | `apps/web/src/app/features/**` |
| Pruebas de integración API: idempotencia, firma de webhooks, entrante no confiable, multi-tenant, grabación off | nexo-qa-api | Invariantes D1-D5 verificadas; cada bug con prueba que lo reproduce | `apps/api/**/*.spec.ts`, `apps/api/test/**` |
| Recorridos e2e: enviar correo simulado y conciliar estado; recibir webhook; configurar canal por empresa | nexo-qa-e2e | Recorridos verdes con adaptador simulado, sin envíos reales | `apps/web/e2e/**` |
