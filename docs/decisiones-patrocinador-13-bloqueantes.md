# Decisiones del patrocinador — 13 bloqueantes (respuesta ejecutiva)

> Preparado por Arquitectura / Líder técnico / Responsable de producto de NEXO para el patrocinador
> **Ronny Ferney Garzón Silva**. Fecha: 2026-10-26.
>
> Estados usados: **REQUISITO CONFIRMADO** · **PROPUESTO** · **APROBADO** · **PENDIENTE DE VALIDACIÓN** (técnica,
> jurídica, financiera o de cumplimiento) · **IMPLEMENTADO** (código verificable) · **VALIDADO** (pasó criterios).
>
> Regla aplicada: una solicitud de *analizar o proponer* no aprueba las recomendaciones. Donde no hay aprobación
> explícita, el estado permanece **PROPUESTO** o **PENDIENTE**. ADMIN/DIRECTOR/GERENTE no otorgan autoridad por sí
> solos: la autoridad la da el permiso y el alcance verificados.

## 1. Respuesta ejecutiva a los 13 puntos

| # | Decisión propuesta | Estado | Justificación | Impacto técnico | Aprueba | Criterio de aceptación | Puede avanzar ahora |
|---|---|---|---|---|---|---|---|
| 1 Correo | M365 como primera implementación; Gmail como alternativa por adaptador. Separar buzón empresarial de envío transaccional/masivo (SMTP/ESP). Credenciales y configuración por empresa; registro de envíos e idempotencia. | PROPUESTO | Reutiliza conectores M365/Gmail ya existentes; separa dominios con riesgos distintos. | Contrato `ChannelAdapter` (correo) + adaptadores; config y secretos por empresa en bóveda; dedupe por messageId. | Patrocinador | Enviar/recibir en sandbox por empresa; cero duplicados; sin credenciales en claro. | Contrato + adaptador M365 + simulador + pruebas. **No contratar/activar.** |
| 2 WhatsApp | Twilio para el primer piloto; integración directa Meta prevista por adaptador independiente. | PROPUESTO · PENDIENTE DE VALIDACIÓN (costos/onboarding/propiedad de número) | Twilio acelera plantillas/webhooks; piloto ≠ SaaS multiempresa. | `ChannelAdapter` (WhatsApp) + firma de webhooks; propiedad de cuenta/número **por empresa** (no cuenta única compartida). | Patrocinador + Finanzas (costos) | Piloto end-to-end en sandbox con 1 empresa; plantillas aprobadas; webhooks firmados. | Contrato + adaptador Twilio (sandbox) + simulador de webhooks. **No elegir definitivo ni asumir cuenta única.** |
| 3 Voz/telefonía | **Mantener abierta** la integración con **Amazon Connect y Google Cloud**; arquitectura de contrato común + adaptadores, sin cerrar a Twilio/Vonage/Vapi/Retell. Separar 4 capas: telefonía/números · STT-TTS · motor conversacional · procesos/herramientas/autorizaciones NEXO. | **REQUISITO CONFIRMADO** (apertura Connect+GCP). Proveedor productivo: **PENDIENTE DE VALIDACIÓN** (prueba técnica + económica). | Evita lock-in; declara capacidades por adaptador y bloquea configuraciones incompatibles. | Contrato `VoiceProvider` por capa; capabilities declaradas; cambio de proveedor conserva reglas de negocio (recursos pueden requerir migración). | Patrocinador (apertura) · Arquitectura + Finanzas (selección) | Contrato con capabilities; un adaptador stub valida el modelo; no se promete migración de llamadas activas ni "100 % perfecto". | Diseño del contrato de 4 capas + 1 adaptador stub. **No construir todos los adaptadores ni activar voz.** |
| 4 Grabaciones/retención | Controles configurables: autorización (cuando corresponda), finalidad, acceso, conservación y eliminación. Distinguir audio/transcripción/resumen/evidencia. | PROPUESTO · **PENDIENTE DE VALIDACIÓN (Jurídica)** | No se inventan plazos ni se declara cumplimiento. Aprobación del patrocinador ≠ revisión jurídica. | Política de retención por tipo de dato; grabación **off** por defecto; borrado verificable. | Jurídica + Patrocinador | Operar con datos sintéticos y grabación desactivada; política de retención aplicable y auditable. | Controles configurables + datos sintéticos. **Producción supeditada a política jurídica.** |
| 5 Candado de internet | Corregir la ruta que permite eludir la política (agente sin estación). Renombrar el control a su alcance real; **distinguir** navegación web, conexión a sistemas autorizados y comunicación con proveedores de IA. Aplicar en servidor y en las rutas efectivas. Migración explícita antes de cambiar valores existentes. | PROPUESTO. Parcial **IMPLEMENTADO**: gate en runtime (E8-2) sobre conectores de red. | Hoy el nombre `salidaInternet` sobredeclara (no cubre llamadas al LLM) y "sin estación" elude el control: ambos deben corregirse. | Renombrar/segmentar la bandera; enforcement server-side; **migración de datos** de agentes existentes (riesgo de romper egress actual → requiere aprobación). | Patrocinador (semántica) · Arquitectura (técnico) | Ningún egress de conector evita la política por falta de estación; el control refleja su alcance; migración documentada y reversible. | Renombrado + segmentación + enforcement en rutas efectivas + plan de migración. **Cambiar valores de agentes existentes: requiere su aprobación explícita.** |
| 6 RPA | Navegador headless en P0; escritorio en etapa posterior. API preferida cuando exista. Mismas políticas/aprobaciones que cualquier herramienta. | PROPUESTO | RPA es el puente para sistemas sin API, no el camino por defecto. | Herramienta RPA como conector gobernado (E6/E8); evidencias, límites y recuperación ante fallo. | Patrocinador | RPA headless sobre un sistema destino con API alternativa evaluada; pasa por aprobación y queda auditado. | Contrato de herramienta RPA headless + reuse de E6/E8. **Escritorio y sistemas destino concretos: pendientes.** |
| 7 Acciones sensibles | Política inicial del piloto: pagos/transferencias y cambio de cuentas → **doble aprobador humano** + verificación independiente; elevación de privilegios y borrado crítico → doble aprobación; publicación oficial → aprobación humana (doble si la política lo fija). Umbrales monetarios **los define Finanzas** (por empresa, moneda y operación; con límites acumulados y detección de fraccionamiento). | Política base PROPUESTO. Doble aprobación e invalidación por cambio: **IMPLEMENTADO** (E6). Umbrales y fraccionamiento: **PENDIENTE DE VALIDACIÓN (Finanzas)** / PROPUESTO. | El motor de políticas y la doble aprobación ya existen; faltan umbrales reales y límites acumulados. | Catálogo de tipos de acción + plantillas de política; aprobación ligada a acción exacta/destinatarios/contenido/parámetros/vigencia (ya con contentHash + invalidación). Nuevo: límites acumulados + detección de fraccionamiento. | Patrocinador + **Finanzas** (umbrales) | Una acción sensible exige los aprobadores definidos; cambiar la acción invalida la aprobación; umbrales configurables por empresa. | Catálogo + plantillas de política; motor de límites acumulados. **Umbrales monetarios: los fija Finanzas.** |
| 8 Riesgo/revisión humana | Bajo → automatizable si cumple reglas; Medio → revisión humana en piloto; Alto/crítico → revisión humana obligatoria; Desconocido/contradictorio/sin evidencia → **detener y escalar**. Coincidencia entre modelos ≠ autorización. | PROPUESTO | Alinea con la verificación cruzada (verificador ≠ ejecutor) ya existente; evita falsa confianza por consenso de modelos. | Clasificación de riesgo por acción/misión; enganche con el gateway de acciones y el escalamiento. Puntaje: requiere variables, cálculo, pruebas y calibración. | Patrocinador + Arquitectura | Cada nivel dispara el control correcto; "desconocido" detiene; no se usa un % arbitrario como umbral. | Niveles de riesgo + escalamiento + enganche al gateway. **Puntaje numérico: solo tras calibración; hoy no se presenta % validado.** |
| 9 Roles Cuadrillas | EDITOR prepara borradores e instancia plantillas autorizadas; **publicar** exige permiso específico + **aprobación del dueño del proceso**; configurable por empresa. | PROPUESTO. Actual: crear/publicar=ADMIN, instanciar=EDITOR (**IMPLEMENTADO**). | La dotación de empleados digitales la autoriza una persona; publicar impacta a toda la empresa. | Permiso específico de publicación + paso de aprobación del dueño del proceso; config por empresa. | Patrocinador + Dueño del proceso | Un EDITOR no publica sin aprobación del dueño; instanciar no concede acceso (ya garantizado). | Permiso de publicación + aprobación del dueño del proceso + config por empresa. |
| 10 Pasaporte obligatorio | Pasaporte **básico para todo resultado de negocio**; **reforzado** para alto riesgo; los intermedios conservan trazabilidad hacia el expediente principal. | PROPUESTO. Actual: emisión opcional (**IMPLEMENTADO**). | Hace verificable todo resultado de negocio sin sobrecargar los intermedios. | Política de obligatoriedad por `tipoResultado`/`nivelRiesgo`; enganche en la aceptación (E4). | Patrocinador + Cumplimiento (reforzado) | Un resultado de negocio no se cierra sin pasaporte básico; alto riesgo exige el reforzado. | Política de obligatoriedad + perfil básico/reforzado. |
| 11 Export auditoría | Autorización de exportación, minimización de datos, enmascarado de sensibles y **registro del exportador**. Para evidencia formal: **manifiesto + hashes + firma criptográfica verificable**, con gestión de claves y procedimiento de validación. | PROPUESTO. Actual: export con referencias+hashes+ancla (**IMPLEMENTADO**), **sin** firma criptográfica, sin minimización ni registro del exportador. | Un hash ≠ una firma; el valor probatorio no es automático. | Capa de autorización/minimización/enmascarado; registro del exportador; firma con gestión de claves del workspace. | Patrocinador + Jurídica + Cumplimiento | Export autorizado, minimizado, firmado y verificable por un tercero con procedimiento documentado. | Autorización + minimización + registro del exportador. **Firma criptográfica: pendiente de gestión de claves.** |
| 12 Catálogo entre empresas | Compartir plantillas **publicadas** dentro del grupo con **habilitación local** por empresa; excluir credenciales, datos, conversaciones y memorias; cada empresa valida permisos/conectores/versiones antes de activar. | PROPUESTO. Actual: catálogo por workspace (**IMPLEMENTADO**). | Reutilización sin fuga de datos ni permisos implícitos. | Visibilidad de plantillas a nivel grupo + activación local; `orgUnitId`; exclusión explícita de datos/secretos. | Patrocinador | Una plantilla del grupo se activa localmente sin traer datos/credenciales; cada empresa valida antes. | Compartición de publicadas + habilitación local + exclusión de datos/secretos. |
| 13 Requisitos regulatorios | Pasaporte **base extensible por sector**. Cumplimiento identifica jurisdicción, actividad, regulador y caso de uso; no hay estándar único para finanzas y salud. | PROPUESTO · **PENDIENTE DE VALIDACIÓN (Cumplimiento)** | El expediente base ya cubre objetivo, responsables, agentes/versiones, fuentes, acciones, autorizaciones, entregable, validación, fechas y costos; no requiere razonamiento interno del modelo. | Perfil base + extensiones por sector; mapeo jurisdicción→campos obligatorios. | Cumplimiento + Patrocinador | El pasaporte base es aceptado por el regulador del sector objetivo tras validación de Cumplimiento. | Perfil base extensible. **Extensiones por sector: dependen de Cumplimiento.** |

## 2. Cambios propuestos por módulo

### E14 — Canales externos (correo, WhatsApp, voz)
- **Contrato común `ChannelAdapter`** (mensajería saliente/entrante, estado, idempotencia) + adaptadores por proveedor,
  siguiendo el patrón `ConnectorAdapter` (sin `if (type === ...)` dispersos).
- **Correo**: adaptador M365 (reusa conector), adaptador Gmail (alternativa), y ruta transaccional/masiva separada
  (SMTP/ESP) con su propia configuración por empresa.
- **WhatsApp**: adaptador Twilio (piloto) + adaptador Meta (previsto); propiedad de cuenta/número **por empresa**.
- **Voz**: contrato `VoiceProvider` partido en 4 capas (telefonía/números · STT-TTS · motor conversacional ·
  procesos/autorizaciones NEXO), con **capabilities declaradas por adaptador** y bloqueo de configuraciones
  incompatibles; adaptadores previstos para **Amazon Connect** y **Google Cloud** además de los gestionados.
- **Grabaciones**: política configurable (autorización/finalidad/acceso/retención/eliminación), **off por defecto**,
  distinguiendo audio/transcripción/resumen/evidencia.
- Toda comunicación operativa conserva su vínculo con **misión y tarea** (coherente con E5) y es idempotente.

### E8 — Ejecución, internet y RPA
- **Renombrar y segmentar** el control actual `salidaInternet` en categorías de alcance real: navegación web,
  conexión a sistemas autorizados, comunicación con proveedores de IA.
- **Cerrar la ruta de elusión**: hoy un agente sin estación virtual no queda gateado; aplicar la política en el
  servidor y en las rutas efectivas de ejecución, con **migración explícita** antes de cambiar valores existentes.
- **RPA** como herramienta gobernada (headless P0), sujeta a E6/E8, con evidencias, límites y recuperación.

### E6 — Gobierno de acciones
- **Catálogo de tipos de acción sensible** + plantillas de política por defecto (pagos, cuentas, privilegios, borrado,
  publicación). La doble aprobación y la invalidación por cambio **ya están implementadas**.
- **Nuevo**: límites acumulados y detección de fraccionamiento (requiere umbrales de Finanzas).
- **Clasificación de riesgo** (bajo/medio/alto/desconocido) enganchada al gateway y al escalamiento.

### ADR 0014 — Pasaporte y Cuadrillas
- **Cuadrillas**: permiso específico de publicación + aprobación del dueño del proceso; compartición de publicadas en
  el grupo con habilitación local.
- **Pasaporte**: obligatoriedad básica/reforzada por tipo/riesgo; export con autorización, minimización, enmascarado,
  registro del exportador y, para evidencia formal, manifiesto + hashes + **firma** (pendiente de gestión de claves).

## 3. Ajustes a datos, API, interfaz, permisos y migraciones (resumen)
- **Datos**: tablas/relaciones para canales (cuenta por empresa, mensajes, estados), política de retención, catálogo de
  acciones sensibles, clasificación de riesgo; segmentación del control de internet. Todas **aditivas** y por empresa.
- **API**: endpoints de canales (envío/estado/webhooks firmados), política de retención, catálogo de acciones y riesgo,
  publicación de cuadrillas con aprobación, export firmado. `workspaceId` siempre de `@CurrentAuth()`.
- **Interfaz**: bandeja de canales por empresa, configuración de retención, editor de políticas de acción/umbral,
  flujo de publicación con aprobación del dueño del proceso, export de pasaporte con autorización.
- **Permisos**: permiso específico de publicación; aprobadores por tipo de acción; alcance verificado (no por nombre de rol).
- **Migraciones**: aditivas; la de segmentación/valores del control de internet requiere **aprobación y plan reversible**.

## 4. Backlog priorizado (sin estimaciones; dependencias reales)
1. **E8 – corrección del control de internet** (renombrar/segmentar + cerrar elusión + enforcement server-side).
   *Dependencia*: aprobación del patrocinador para la migración de valores existentes.
2. **E6 – catálogo de acciones sensibles + clasificación de riesgo + plantillas de política**.
   *Dependencia*: umbrales de Finanzas (para activar montos; el motor avanza sin ellos).
3. **E14 – contrato `ChannelAdapter` + adaptador de correo M365 + simulador** (sin activar envío productivo).
   *Dependencia*: credenciales/configuración por empresa (para producción).
4. **E14 – contrato `VoiceProvider` (4 capas) + adaptador stub**; previstos Amazon Connect y Google Cloud.
   *Dependencia*: selección de proveedor por prueba técnica + económica.
5. **E14 – adaptador WhatsApp Twilio (sandbox) + webhooks firmados**.
   *Dependencia*: validación de costos/onboarding/propiedad de número.
6. **ADR 0014 – publicación de cuadrillas con aprobación del dueño del proceso + obligatoriedad de pasaporte**.
7. **ADR 0014 – export de pasaporte con autorización/minimización/registro**; **firma** cuando exista gestión de claves.
8. **E6 – retención/grabaciones configurable** (off por defecto). *Dependencia*: política jurídica para producción.
9. **RPA headless** gobernado. *Dependencia*: sistemas destino concretos.

## 5. Decisiones que requieren respuesta del patrocinador (no avanzan sin usted)
- **Punto 3**: confirmar la **apertura a Amazon Connect + Google Cloud** como requisito (lo registramos como tal) y
  autorizar la **prueba técnica/económica** para elegir el primer proveedor productivo de voz.
- **Punto 5**: autorizar (o no) la **migración de valores de internet** de los agentes existentes, y aprobar el nuevo
  nombre/segmentación del control.
- **Punto 1/2**: confirmar M365 como primer correo y Twilio como primer WhatsApp **para piloto** (sin contratar).
- **Punto 9**: confirmar que publicar cuadrillas exige aprobación del **dueño del proceso**.
- **Punto 10**: confirmar pasaporte **básico obligatorio** para resultados de negocio.

## 6. Validaciones específicas por función
- **Jurídica**: grabación/retención de voz y transcripciones (autorización, finalidad, plazos, eliminación); valor
  probatorio del export firmado. *Sin su validación, voz y export formal no pasan a producción.*
- **Finanzas**: umbrales monetarios por empresa/moneda/operación; límites acumulados y fraccionamiento; costos de
  Twilio/Meta y de los proveedores de voz. *Sin umbrales, el motor queda listo pero inactivo para montos.*
- **Cumplimiento**: jurisdicción, regulador y caso de uso por sector; contenido mínimo del pasaporte por sector. *No se
  declara un estándar único finanzas/salud.*

## 7. Qué se puede construir, probar y qué falta para producción
- **Se puede construir ahora** (dentro del alcance autorizado, sin activar nada externo): contratos `ChannelAdapter` y
  `VoiceProvider`, adaptador M365 y adaptador WhatsApp sandbox, simuladores de webhooks, corrección/segmentación del
  control de internet, catálogo de acciones y clasificación de riesgo, publicación de cuadrillas con aprobación,
  export con autorización/minimización.
- **Se puede probar ahora**: todo lo anterior con **datos sintéticos**, grabación **desactivada** y envío externo en
  **sandbox**; verificación cruzada y pasaporte ya validados.
- **Falta para activar en producción cada capacidad**:
  - *Correo/WhatsApp*: credenciales y configuración **por empresa** + (WhatsApp) validación de costos/propiedad de número.
  - *Voz*: selección de proveedor por prueba técnica/económica + validación jurídica de grabación.
  - *Montos sensibles*: umbrales de Finanzas.
  - *Export formal/firmado*: gestión de claves + valor probatorio validado por Jurídica.
  - *Regulatorio por sector*: validación de Cumplimiento.
  - *Migración del control de internet*: aprobación explícita del patrocinador.

> Nota de método: ningún proveedor se da por contratado ni configurado; ninguna acción productiva, contratación o envío
> externo se habilita con base únicamente en estas recomendaciones. Los módulos no se detienen por una decisión que solo
> afecta la *activación* de una integración: se avanza con contratos, simuladores, configuración y pruebas.
