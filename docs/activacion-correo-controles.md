# Diseño de controles de activación/desactivación del correo corporativo

> **Estado:** DISEÑO listo para cuando se autorice. **NO autoriza activación, NO habilita gasto, NO carga
> credenciales, NO modifica el runtime para enviar correo productivo.** Todo permanece en **sandbox** (adaptador
> `simulado`). Las reglas aquí descritas se aplican **solo** cuando el patrocinador autorice **explícitamente** la
> activación productiva del canal (lineamiento 7 de `docs/decisiones-patrocinador-2026-11-02-plan-ejecucion.md`).
> Este documento **describe el mecanismo**; no lo ejecuta.

- **Fecha:** 2026-11-03
- **Responsable del entregable:** nexo-backend-integrations
- **Autorización vigente:** el patrocinador (Ing. Ronny Garzón) autorizó **solo el diseño de controles** del correo
  corporativo como **primer canal real** (lineamiento 7). La **activación productiva** de correo/WhatsApp/voz **NO
  está autorizada**. Rige la distinción de cuatro autorizaciones independientes —**construir / acceso a cuentas y
  datos / gasto / activación productiva**—; ninguna implica las demás.
- **No reinventa nada:** reutiliza y referencia lo ya construido. No introduce modelos, adaptadores ni ramas por tipo.

## 0. Lo que este documento NO hace (léalo primero)

- No activa ningún canal ni habilita envío real. El único proveedor que opera hoy es `simulado` (sin salida de red).
- No escribe credenciales ni secretos. Las credenciales van **siempre** por la bóveda (`{{ secrets.NOMBRE }}`),
  referenciadas por `CanalCuenta.secretRef`, **nunca** en `config`, en texto, por chat ni en este documento.
- No autoriza gasto. El costeo (p. ej. licencias M365/Gmail) se tramita por separado con Finanzas/patrocinador.
- No presume plazos legales ni valor probatorio; la retención/jurídica se gobierna aparte (ADR 0015 D3, ADR 0008).

## 1. Base reutilizada (no se duplica)

El correo corporativo ya está **construido en sandbox** como canal del empleado digital. Este diseño solo añade la
**capa de controles de activación/desactivación**; toda pieza existe y se referencia:

- **Contrato de canal** `ChannelAdapter` (`apps/api/src/modules/channels/domain/channel-adapter.ts`) y tipos
  (`domain/channel.types.ts`). Puerto hexagonal: un proveedor nuevo = un adaptador nuevo registrado en `ADAPTERS`
  de `channels.module.ts`, sin ramas `if (proveedor === ...)`.
- **Adaptadores de correo:** `adapters/m365-mail.adapter.ts` (proveedor `m365`, primero) y
  `adapters/gmail-mail.adapter.ts` (proveedor `gmail`, alternativa). Ambos quedan **INACTIVOS sin `secretRef`**: sin
  credenciales en bóveda no intentan ninguna llamada de red (condición de activación, ADR 0015 D5). Toda salida pasa
  por `HttpClientService.request()` (anti-SSRF, timeout, tamaño).
- **Adaptador `simulado`** (`adapters/simulado.adapter.ts`): determinista, no sale a la red, base de QA/CI. Es el
  estado por defecto hoy.
- **Servicio y controlador** (`channels.service.ts`, `channels.controller.ts`, ruta base `canales-externos`): CRUD de
  cuentas, envío idempotente, recepción por webhook firmado y entrante simulado. Multi-tenant estricto
  (`workspaceId` de `@CurrentAuth()`).
- **Gobierno de acciones E6** (ADR 0013): `PolicyEngine`, `ActionGatewayService`
  (`modules/governance/actions/action-gateway.service.ts`), bandeja de `Aprobacion`, modelo `Politica`. El envío de
  correo ya invoca `gateway.requestAction(...)` con `tipoAccion: EMAIL_SEND`, destinatarios, contenido y clave de
  idempotencia para todo proveedor distinto de `simulado`.
- **Suspensión / kill-switch E6** (`model Suspension`, `enum SuspensionScope`, endpoints `admin/suspensions` y
  `:id/reactivate` en `governance/actions/actions.controller.ts`).
- **Auditoría inmutable E13** (`modules/audit/audit.service.ts`, `append()` append-only y encadenado).
- **Registro de mensajes** `MensajeCanal` (envío/recepción/estado) idempotente por `(workspaceId, idempotencyKey)` y
  por `proveedorMensajeId` para webhooks.
- **ADRs rectores:** 0013 (gobierno de acciones y canales), 0015 (contratos de canal), 0008 (DataGuard/retención).

## 2. Lista blanca de destinatarios internos autorizados (primero) y permisos por rol

**Principio:** al activarse, el correo arranca con **denegación por defecto** y una **lista blanca** de destinatarios
internos autorizados; todo lo no listado se bloquea o exige aprobación. No se hardcodea: se configura por workspace y
empresa mediante el motor de políticas E6.

- **Mecanismo (reutiliza E6, no agrega rama nueva):** una `Politica` de `tipoAccion: EMAIL_SEND`, acotada por
  `empresaId`, con `selector.destinatario` como lista blanca:
  - `DENY` por defecto para cualquier destinatario (regla base de la empresa).
  - `ALLOW` para los dominios/direcciones internos autorizados (p. ej. `@miempresa.com` o una lista explícita).
  - `REQUIRE_APPROVAL` para destinatarios externos o fuera de la lista, mientras se amplía el alcance por etapas.
  - Gana el control **más restrictivo** (`DENY` > `REQUIRE_APPROVAL` > `ALLOW`), como ya define el `PolicyEngine`.
- **Refuerzo opcional en la cuenta:** `CanalCuenta.config` (sin secretos) puede llevar un `destinatariosPermitidos`
  (dominios/direcciones) como **segundo filtro** validado antes de invocar al `ActionGateway`; es defensa en
  profundidad, no sustituye a la política. Al entregarlo como diseño, la lista blanca canónica vive en `Politica`
  (auditable y versionada); el campo de `config` es un guardarraíl adicional.
- **Fases de apertura:** (1) solo internos de la lista blanca; (2) internos + externos con `REQUIRE_APPROVAL`; (3)
  externos permitidos por política explícita. Cada ampliación es una autorización aparte del patrocinador.
- **Permisos restringidos por rol** (ya vigentes en `channels.controller.ts`, principio de menor privilegio):
  - Leer cuentas/mensajes: `VIEWER`.
  - **Enviar** (`POST :cuentaId/enviar`): `EDITOR` — y además pasa por E6.
  - **Crear/editar/eliminar/`test`/activar** cuentas (gestionan `secretRef`): `ADMIN`.
  - **Políticas, suspensión y reactivación:** `ADMIN`; aprobar/rechazar en la bandeja según atribuciones del
    aprobador, **nunca** el solicitante (sin autoaprobación cuando la política lo prohíbe).

## 3. Límites operativos y aprobación de salientes sensibles

**Límites operativos** (configurables por workspace/empresa, nunca hardcodeados por empresa):

- **Volumen/tasa/tope de envíos:** máximo de correos por minuto/hora/día por `CanalCuenta`; tope total por período.
  Se expresan como selector de `Politica` (p. ej. `monto`/contadores de tasa) y, en ejecución, el `ActionGateway`
  revalida antes del despacho. Superar el tope ⇒ `DENY` o `REQUIRE_APPROVAL`.
- **Horario permitido:** ventana horaria por sede/zona (el `ActionContext` ya transporta horario/zona); fuera de
  ventana se bloquea o difiere.
- **Tamaño:** límite de tamaño de cuerpo/adjuntos; adjuntos **por referencia** (`AdjuntoMensaje`), nunca binarios en
  columnas de texto; el egress lo acota `HttpClientService` (`maxBodyBytes`).
- **Idempotencia:** todo envío lleva `idempotencyKey`; un reintento con la misma clave devuelve el mensaje existente
  sin duplicar el efecto (ya implementado en `channels.service.ts`).

**Aprobación de salientes sensibles** (motor de políticas E6 + bandeja de aprobaciones):

- El envío productivo (proveedor ≠ `simulado`) **siempre** pasa por `ActionGatewayService.requestAction` con
  `tipoAccion: EMAIL_SEND`. Resultados: `DENEGADA` ⇒ `MensajeCanal` queda `FALLIDO` **sin salir a la red**;
  `REQUIERE_APROBACION` ⇒ queda `PENDIENTE` con `aprobacionId`, **no se despacha** hasta aprobarse; `PERMITIDA` ⇒ se
  despacha por el adaptador.
- Disparadores de aprobación recomendados para correo: destinatario externo/fuera de lista blanca, superación de
  tope/tasa, envío masivo, adjuntos, o contenido clasificado como sensible por DataGuard. Casos de mayor riesgo:
  **doble aprobación** (`requiredApprovals=2`, dos personas distintas).
- El `contentHash` de la `Aprobacion` liga contenido + destinatarios + adjuntos; cualquier cambio **invalida** la
  aprobación y exige una nueva (QA03). Permisos, presupuesto y suspensión se **revalidan** justo antes del efecto.

## 4. Trazabilidad completa (auditoría inmutable E13; recepción y respuesta como hechos distintos — RF35)

- **Auditoría inmutable (E13):** cada decisión de política, aprobación, activación/desactivación de canal y rechazo
  de webhook por firma inválida se registra con `AuditService.append` (append-only, encadenado, a prueba de
  manipulación). Ya ocurre para `canal.webhook.firma_invalida`; al activarse se auditan además: alta/activación de
  `CanalCuenta`, cambios de estado, suspensión y reactivación (con actor + motivo).
- **Hechos distintos (RF35):** `MensajeCanal` distingue `direccion` (SALIENTE/ENTRANTE) y `estado`
  (PENDIENTE → ENVIADO → ENTREGADO → LEIDO / FALLIDO; SIMULADO en sandbox). La **recepción** de un entrante y la
  **respuesta** se registran como filas separadas, no como un único evento; los estados de entrega se concilian por
  `proveedorMensajeId` desde webhooks firmados.
- **Sin secretos en la traza:** ni `secretRef`, ni valores de bóveda, ni cabeceras de autenticación se registran ni
  se devuelven. El `payloadRef` guarda referencia saneada; el contenido sensible va a almacenamiento de objetos con
  retención por tipo de dato (ADR 0008).

## 5. Desactivación inmediata / kill-switch (reutiliza `Suspension` existente)

**No se construye un interruptor nuevo:** se reutiliza la `Suspension` de E6, con alcance configurable, aplicada en el
único punto de salida (`ActionGateway`).

- **Alcances (`SuspensionScope`):** `AGENTE` (un empleado digital), `PROCESO` (un flujo), `CONECTOR` (la cuenta de
  canal / proveedor de correo) y `ORGANIZACION` (empresa/workspace). Cubre el requisito de desactivación por
  **agente / empresa / canal**.
- **Efecto inmediato:** mientras una suspensión está activa, el `ActionGateway` **bloquea** todo envío nuevo y toda
  salida pendiente de despachar bajo ese alcance, **incluidas aprobaciones ya otorgadas pero no despachadas**. Un
  correo aún no enviado no sale.
- **En vuelo:** lo ya entregado al proveedor se **concilia** (confirmado/incierto); nunca se reintenta a ciegas una
  escritura incierta.
- **Desactivación de la cuenta:** adicionalmente, `CanalCuenta.estado` puede pasar a `SUSPENDIDA` (envío bloqueado) o
  `RETIRADA` (cuenta fuera de uso; el servicio ya rechaza enviar en `RETIRADA`). Para un corte total e inmediato se
  usa la `Suspension` (efecto en el gateway) por ser transversal a todos los orígenes de acción.
- **Operación:** suspender vía `POST admin/suspensions` y reactivar vía `POST admin/suspensions/:id/reactivate`,
  ambos `ADMIN`, **con motivo**, todo en `AuditLog`. La reactivación exige actor autorizado + motivo explícito.
- **Retirar credenciales** (vaciar `secretRef` o rotar en bóveda) deja el adaptador INACTIVO: sin credenciales no
  intenta red. Es el corte de último recurso, complementario al kill-switch.

## 6. Credenciales por bóveda y contenido entrante como dato no confiable (QA02)

- **Credenciales solo por bóveda:** `CanalCuenta.secretRef` apunta a `{{ secrets.NOMBRE }}`; el servicio resuelve el
  valor en `runtime()` y lo entrega al adaptador como `secretValue`, que **nunca** se registra ni se devuelve. El
  adaptador no lee la bóveda ni conoce el nombre del secreto. Nada de secretos en `config`, en plantillas ni por chat.
- **Entrante = dato no confiable (QA02):** el contenido de correos recibidos (webhook firmado o entrante simulado) se
  trata como dato no confiable: **no** habilita herramientas, **no** modifica políticas, **no** concede atribuciones
  ni revela secretos. Un webhook sin firma válida se descarta y se audita (401). El `workspaceId`/`empresaId` lo fija
  la cuenta del canal, **nunca** el cuerpo del mensaje.
- **Plantillas:** cuerpos/asuntos se expanden solo con `common/template/template.engine.ts` (`render`/`renderXml`);
  nunca `eval`/`new Function`. Los valores de plantilla nunca contienen secretos.

## 7. Matriz de precondiciones sandbox → producción (CHECKLIST — no ejecutar)

> Checklist de verificación. Diligenciarla **no** activa nada; se complementa con el formulario
> `docs/plantilla-solicitud-activacion-real.md`. La activación real requiere **autorización específica del
> patrocinador** y se ejecuta solo cuando TODO esté en «Sí».

**Qué debe autorizar el patrocinador (explícito, por separado):**

- [ ] **Acceso** a la cuenta/buzón de correo corporativo de la empresa.
- [ ] **Gasto**, si aplica (licencias/uso), con quién lo aprueba (Finanzas/patrocinador).
- [ ] **Activación productiva** del canal de correo para la empresa indicada.

**Parámetros a pedir (por empresa — configurables, nada hardcodeado):**

- [ ] **Empresa** (OrgUnit tipo EMPRESA) dueña de la cuenta.
- [ ] **Buzón/remitente** (dirección y, para M365, `tenantId`/`clientId`; para Gmail, su `config` equivalente).
- [ ] **Responsable humano (titular)** del buzón y de su uso.
- [ ] **Lista blanca de destinatarios internos** autorizados (dominios/direcciones) para la primera fase.
- [ ] **Permisos requeridos y rol mínimo** (menor privilegio).
- [ ] **Límites operativos:** tasa/volumen/tope por período, horario permitido, tamaño/adjuntos.
- [ ] **Política de aprobación** de salientes sensibles (cuándo `REQUIRE_APPROVAL`, cuándo doble aprobación).
- [ ] **Procedimiento de desactivación** (quién y cómo: `Suspension` por alcance + estado de cuenta).

**Controles técnicos verificados (deben estar listos antes de activar):**

- [ ] Credenciales cargadas **en bóveda**; `CanalCuenta.secretRef` referenciado (nunca el valor).
- [ ] `Politica` `EMAIL_SEND` con **DENY por defecto** + ALLOW para la lista blanca interna, por empresa.
- [ ] Límites operativos cargados y revalidados por el `ActionGateway`.
- [ ] Kill-switch probado: `Suspension` por AGENTE/CONECTOR/ORGANIZACION bloquea el envío de forma inmediata.
- [ ] Trazabilidad verificada: envío/recepción/respuesta como hechos distintos; auditoría inmutable registra
      activación, suspensión y reactivación.
- [ ] Prueba `test` de la cuenta OK (valida conectividad sin enviar a un destinatario real).
- [ ] Destinatarios de prueba acotados e internos.

Mientras cualquier casilla esté sin marcar, **la cuenta permanece en sandbox (`simulado`)** y no se activa.

## 8. Diagrama de estados del canal y guardarraíl multiempresa

**Estados (de sandbox a producción y de vuelta):**

```
  [SANDBOX]            [LISTO]                 [ACTIVADO]              [SUSPENDIDO]
  proveedor=simulado   proveedor m365/gmail    CanalCuenta.estado      Suspension activa
  sin salida de red    secretRef + config       = ACTIVA, políticas     (AGENTE/CONECTOR/
  (QA/CI)              completos, políticas      y límites en vigor;     ORGANIZACION) y/o
        │              y lista blanca cargadas;  envíos por E6           estado SUSPENDIDA
        │              AÚN sin autorización                              │
        ▼                        │                        │             │
  construir/probar ──► precondiciones §7 ──► AUTORIZACIÓN ──► operar ◄───┤ kill-switch
        ▲                        ▲          del patrocinador    │       │ inmediato
        │                        │                              │       ▼
        └──────────── reactivar (ADMIN + motivo) ◄──────────────┴── RETIRADA (fin de uso)
```

- **SANDBOX:** estado actual. `proveedor=simulado`; no sale a la red; no pasa por el `ActionGateway`.
- **LISTO:** cuenta productiva configurada (`m365`/`gmail`) con `secretRef` en bóveda, `config` completa, políticas y
  lista blanca cargadas, pero **sin** autorización de activación: el adaptador sigue sin operar hasta la autorización
  y el cumplimiento del checklist §7.
- **ACTIVADO:** `CanalCuenta.estado = ACTIVA`; cada envío pasa por E6 (política + aprobación) y respeta límites.
- **SUSPENDIDO:** `Suspension` activa (corte inmediato en el gateway) y/o `CanalCuenta.estado = SUSPENDIDA`.
  Reactivación solo por `ADMIN` con motivo, auditada.
- **RETIRADA:** cuenta fuera de uso; el servicio rechaza enviar.

> Nota de implementación: el `CanalCuentaEstado` del esquema es `ACTIVA | SUSPENDIDA | RETIRADA`. «SANDBOX» y «LISTO»
> no son estados del enum sino situaciones operativas (proveedor `simulado` vs. proveedor productivo sin autorización);
> el corte de emergencia lo da la `Suspension` transversal, no un campo por fila.

**Guardarraíl multiempresa / multisectorial (lineamiento estratégico):**

- Todo es **configurable por workspace y empresa**: cuentas, lista blanca, límites, políticas y suspensiones llevan
  `workspaceId`/`empresaId` y se resuelven desde `@CurrentAuth()`, **nunca** del cuerpo de la petición.
- **Nada hardcodeado por empresa ni por sector:** no hay dominios, topes ni destinatarios fijos en el código; se
  cargan como datos (`Politica`, `CanalCuenta.config`). Un canal nunca comparte identidad/credenciales entre empresas.
- La capa de controles es **transversal y reutilizable**: el mismo diseño sirve para cualquier empresa del grupo y
  para los demás canales (WhatsApp/voz) sin construir funcionalidades particulares que aten NEXO a una empresa.

## 9. Relación con otros equipos

- **No se tocó código de `apps/api`**: entregable de documento. Si al implementar se añade `destinatariosPermitidos`
  a `CanalCuenta.config` o nuevas políticas por defecto, se coordinará el contrato con **nexo-frontend-core** y el
  comportamiento observable con **nexo-qa-api**.
- Formulario operativo de solicitud: `docs/plantilla-solicitud-activacion-real.md`. Contexto de decisiones:
  `docs/decisiones-patrocinador-2026-11-02-plan-ejecucion.md` (lineamiento 7).

---

**Recordatorio final:** este diseño **no activa** el correo ni habilita gasto. Las reglas descritas rigen **solo**
cuando el patrocinador autorice explícitamente la activación productiva y se cumpla el checklist de la sección 7.
Hasta entonces, el canal permanece en **sandbox**.
