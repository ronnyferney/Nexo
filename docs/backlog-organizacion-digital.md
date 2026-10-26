# Backlog del programa — NEXO como organización de empleados digitales

> Backlog por épicas de la **Solicitud de desarrollo de NEXO v1.1** (R. Garzón, 2026-10-25), que amplía la v1.0 con la
> gestión por resultados, la jerarquía de dirección digital, la comunicación entre agentes, la comunidad interna y la
> estructura empresarial matricial (secciones 16-23, RF29-RF47, HU15-HU24, QA09-QA16).
>
> Complementa `evaluacion-brechas-empleados-digitales.md` (análisis RF por RF) y `plan-de-mejora.md` (higiene/UX/
> seguridad). Clasificación: **Reutiliza** (ya existe) · **Modifica** (extiende lo existente) · **Construye** (nuevo).
> Prioridad del documento: **P0** primera versión operativa · **P1** amplía · **P2** avanzado.

## Cómo leer este backlog

Cada épica agrupa requisitos del documento, nombra las **entidades de datos** nuevas, el **esfuerzo** relativo, y las
**puertas QA** que debe pasar. El orden de épicas respeta dependencias: la estructura y la identidad del empleado digital
son la base del resto. Lo que NEXO **ya tiene** se marca para reutilizar y reducir costo.

## Mapa de épicas

> **Estado (2026-10-26):** ✅ construido · 🟡 parcial · ⏳ pendiente. Ver la «Nota de cierre» al final.

| Épica | Estado | Alcance | RF | Prio | Tipo dominante |
|---|---|---|---|---|---|
| **E1 · Estructura empresarial** | ✅ | Grupo/empresa, unidades y líneas de negocio, áreas, departamentos, equipos, sedes, centros de costo, matricial; dimensiones configurables (D8) | RF01, RF41, RF42, RF43, RF46 | P0 | Modifica + Construye |
| **E2 · Empleado digital** | ✅ | Catálogo de cargos, expediente, cargo+responsable humano titular/suplente, estados de ciclo de vida, versiones, publicación/retiro | RF02, RF03, RF04, RF05, RF06 | P0 | Construye |
| **E3 · Jerarquía de dirección digital** | ✅ | Niveles (empleado→líder→jefe→director→gerente→superempleado), autoridad, delegación, supervisión y reemplazo | RF32, RF33, RF34, RF39, RF40 | P0 | Construye |
| **E4 · Trabajo por resultados** | ✅ | Objetivos, tareas y entregables, contrato de resultado, verificación/aceptación, incumplimientos | RF07, RF08, RF29, RF30, RF31 | P0 | Construye |
| **E5 · Colaboración y comunicación** | ✅ | Flujos con contratos, **continuidad de tarea (handoff entre agentes/grupos)**, control de delegación, protocolo de mensajes entre agentes, coordinación transversal | RF09, RF10, RF35, RF36 | P0 | Modifica + Construye |
| **E14 · Canales de comunicación externa** | ⏳ | Correo, **llamadas telefónicas con agentes conversacionales al 100 %**, mensajería **WhatsApp** — como canales de los empleados digitales, bajo política y aprobación | RF16, RF17, RF35 (ext.) | P0 | Reutiliza (correo) + Construye (voz, WhatsApp) |
| **E6 · Gobierno de acciones** | ✅ | Motor de políticas, bandeja de aprobaciones (hash/invalidación/doble), suspensión de emergencia | RF11, RF12, RF13 | P0 | Construye |
| **E7 · Durabilidad avanzada** | ✅ | Idempotencia, deduplicación de eventos, reintentos/conciliación, bandeja de excepciones | RF17, RF18, RF20, RF21 | P0 | Modifica + Construye |
| **E8 · Conocimiento y herramientas** | 🟡 | Conocimiento empresarial, memoria controlada, conectores **REST/SOAP(web service)/GraphQL/MCP**, pasarela, **acceso a internet** y **RPA** como capacidades del agente | RF14, RF15, RF16, RF17 | P0 | Reutiliza + Modifica + Construye |
| **E9 · Costos e imputación** | ✅ | Control de costos, presupuestos con reserva/conciliación, imputación por empresa/línea/área/centro de costo, servicios compartidos | RF25, RF26, RF44, RF45 | P0 | Modifica |
| **E10 · Indicadores y evaluación** | ✅ | KPIs de resultado (cumplimiento, calidad, tiempo de ciclo, costo por resultado, beneficio validado), evaluaciones, mejora continua | RF27, RF28, RF30-métricas | P0/P1 | Reutiliza + Construye |
| **E11 · Comunidad interna** | 🟡 | Red social corporativa privada: perfiles, muro, grupos, publicaciones tipificadas, moderación, aprendizajes validados | RF37, RF38 | P0 | Construye |
| **E12 · Consolas y experiencia** | ✅ | Inicio gerencial, Mi trabajo, Aprobaciones, Organización/organigrama, consolas por negocio/área/sede, chat, accesibilidad | RF23, RF24, RF47 | P0 | Modifica + Construye |
| **E13 · Plataforma (RNF)** | ✅ | Disponibilidad, rendimiento, DR, observabilidad correlacionada, auditoría inmutable, exportación, retención | RNF01-09 | P0/P1 | Modifica + Construye |

## Entidades de datos nuevas (modelo de información)

Vincular al modelo existente (`OrgUnit`, `Agent`, `Workflow`, `Execution`, `Budget`, `UsageRecord`, `KnowledgeBase`,
`Connector`, `EvalCase`). Todas con `workspaceId`/tenant, identificador estable, **vigencia** e historial.

| Entidad | Épica | Para qué |
|---|---|---|
| `Empresa` (o extender `OrgUnit` tipo EMPRESA) | E1 | Empresa dentro del grupo; límites de datos y consolidación |
| `UnidadOrganizacional` (extender `OrgUnit`) | E1 | Unidad/área/departamento/equipo con tipo, responsable y vigencia |
| `LineaNegocio` | E1 | Oferta económica con clientes, procesos y metas |
| `Sede` | E1 | Ubicación con calendario, zona horaria y alcance territorial |
| `CentroCosto` | E1/E9 | Destino económico; imputación, no concede permisos |
| `AsignacionOrganizacional` | E1 | Relación empleado↔área/línea/sede/proyecto con alcance y vigencia (matricial) |
| `ServicioInterno` | E1/E9 | Proceso que un área presta a otras líneas con acuerdo de servicio |
| `ImputacionCosto` | E9 | Reparto de costo de servicios compartidos (suma 100 %, sin doble conteo) |
| `Cargo` | E2 | Perfil reutilizable: propósito, funciones, entregables, indicadores, límites, nivel jerárquico |
| `Agent.cargoId / responsableUserId / suplenteUserId / nivel / horario / autonomia` | E2/E3 | Identidad del empleado digital |
| `Objetivo` | E4 | Indicador, línea base, meta, plazo, dueño |
| `Tarea` | E4 | Trabajo con objetivo, criterio de aceptación, responsable, entregable, estado |
| `ContratoResultado` | E4 | Resultado esperado, regla de validación, evidencia exigida, estados Propuesto→Aceptado |
| `MensajeAgente` | E5 | Protocolo estructurado (message_id, correlation_id, tipo, prioridad, referencias, permisos) |
| `Politica` + `DecisionPolitica` | E6 | Reglas por monto/destinatario/tipo de dato/horario, versionadas |
| `Aprobacion` | E6 | Bandeja con hash del contenido, invalidación, doble aprobación, caducidad |
| `Suspension` | E6 | Interruptor por agente/proceso/conector/organización |
| `Excepcion` | E7 | Bandeja operativa (causa, impacto, dueño, siguiente acción) |
| `IdempotencyKey` | E7 | Clave por operación de negocio para no duplicar efectos |
| `Publicacion` + `Comentario` + `Grupo` | E11 | Comunidad interna |
| `AuditLog` (inmutable) | E13 | Decisiones, aprobaciones, políticas y accesos |

## Detalle por épica

### E1 · Estructura empresarial (P0) — Modifica + Construye — ✅ construido
RF01 (aislamiento), RF41 (modelo configurable), RF42 (funcional y matricial), RF43 (expediente de unidad), RF46
(permisos y cambios de estructura). **Reutiliza** `OrgUnit` y el aislamiento endurecido. **Construye** `LineaNegocio`,
`Sede`, `CentroCosto`, `AsignacionOrganizacional`, `ServicioInterno`; vistas organizacional/funcional/negocio/sede.
Regla de identidad: empresa≠línea, área≠centro de costo, cargo≠persona; sin duplicar empleados ni ejecuciones.
**QA:** QA01 (aislamiento), QA15 (matricial sin ciclos), QA16 (reorganización conserva historia). **HU:** HU01, HU21-23.

### E2 · Empleado digital (P0) — Construye — ✅ construido
RF02 (organigrama y responsables), RF03 (catálogo de cargos), RF04 (expediente), RF05 (versiones, **reutiliza**
`AgentVersion`), RF06 (publicación/retiro, **modifica** la puerta de salud+evaluación existente). Estados de ciclo de
vida completos: Borrador→En validación→Publicado→Suspendido→Retirado (hoy solo DRAFT/LAUNCHED). Bloquear activar sin
responsable; retiro reasigna y revoca. **QA:** HU02, HU03. **Primera entrega de esta noche** (ver abajo).
**Parámetros de ejecución del agente (requisito del dueño del producto, RF04):** al configurar un agente se definen
explícitamente sus parámetros de trabajo, entre ellos: (a) si se le asigna una **«estación virtual»** — una
máquina/entorno de trabajo aislado donde ejecuta RPA y tareas de escritorio/navegador (ver E8); (b) si tiene **salida a
internet** (habilitada/deshabilitada, con dominios permitidos por política); (c) horario, política de autonomía y
presupuesto. Quedan en el expediente y en la versión inmutable (RF05), y el motor de políticas (E6) los hace cumplir:
un agente sin internet no puede usar la herramienta web; uno sin estación virtual no puede lanzar RPA.

### E3 · Jerarquía de dirección digital (P0) — Construye — ✅ construido
RF32 (cargos jerárquicos), RF33 (autoridad y delegación), RF34 (supervisión y reemplazo), RF39 (superempleado),
RF40 (límites y continuidad). Una misión = una responsabilidad principal; evitar múltiples superiores finales y ciclos.
El superempleado no se autoaprueba ni amplía presupuesto. **QA:** QA10 (órdenes contradictorias/ciclos), QA13
(no autoaprobación), QA14 (suspender coordinador y recuperar). **HU:** HU16, HU20.

### E4 · Trabajo por resultados (P0) — Construye — ✅ construido
RF07 (objetivos), RF08 (tareas y entregables), RF29 (contrato de resultado), RF30 (verificación y aceptación: el
ejecutor no valida su propio resultado), RF31 (incumplimientos: alerta, recuperación, escalamiento, límite). Estados del
resultado: Propuesto→Comprometido→En producción→Pendiente de validación→Aceptado→Devuelto/Incumplido. Distinguir
producto intermedio de resultado de negocio (un correo enviado ≠ recaudo). **QA:** QA09 (no cerrar con evidencia
inválida). **HU:** HU04, HU14, HU15.

### E5 · Colaboración y comunicación (P0) — Modifica + Construye — ✅ construido
RF09 (flujos con contrato de transferencia, **modifica** el motor DAG), RF10 (control de delegación: profundidad,
ciclos, concurrencia, «un agente no crea agentes ni amplía su presupuesto»), RF35 (protocolo de mensajes persistente
con idempotencia), RF36 (coordinación transversal: canales por misión/proceso/área, hilos, menciones; una solicitud se
vuelve tarea autorizada). **QA:** QA11 (redelivery sin duplicar, escalamiento por falta de respuesta). **HU:** HU05,
HU17.
**Continuidad de tarea (handoff) — requisito del dueño del producto:** la comunicación entre agentes tiene como fin
**estructurar mejor tareas y procesos**. Un agente puede llevar una tarea hasta un **punto de corte definido** y
**otro agente o grupo de agentes continúa** desde ese estado, sin rehacer ni duplicar lo confirmado. Cada handoff es
un **contrato de transferencia** (estado alcanzado, entregable parcial, contexto autorizado, criterio del siguiente
paso, permisos y responsable entrante) sobre el estado persistido de la tarea (E4) y el motor durable (E7). El
receptor **acepta o rechaza** el encargo (RF33) y la cadena conserva trazabilidad de quién hizo qué.

### E6 · Gobierno de acciones (P0) — Construye — ✅ construido
RF11 (motor de políticas server-side por monto/destinatario/tipo de dato/horario, versionado; un texto del modelo no
sustituye autorización), RF12 (bandeja de aprobaciones con hash del contenido, invalidación al cambiar destino/monto/
adjunto, doble aprobación, caducidad), RF13 (suspensión de emergencia). **Reutiliza** `requiresApproval`/`approvedTools`
y `budgets.plan` como piezas. **QA:** QA03 (aprobación), QA07 (revocación antes de despacho), QA08 (suspensión). **HU:**
HU06, HU10.

### E7 · Durabilidad avanzada (P0) — Modifica + Construye — ✅ construido
RF17 (idempotencia en la pasarela), RF18 (deduplicación de eventos), RF20 (clasificación temporal/permanente/incierto,
conciliación de escrituras inciertas), RF21 (bandeja de excepciones). **Reutiliza** el motor durable, colas y la
reconciliación cron ya existentes. **QA:** QA04 (duplicación), QA06 (continuidad). **HU:** HU09, HU13.

### E8 · Conocimiento y herramientas (P0) — Reutiliza + Modifica — 🟡 parcial (backend de parámetros de ejecución construido; pendiente E8-2 y web)
RF14-RF17. **Reutiliza** RAG, DataGuard, conectores, bóveda y anti-SSRF. **Modifica** para propietario/clasificación/
vigencia por documento, separación memoria temporal/persistente/documental, credenciales por entorno y listas de
destinos permitidos. **QA:** QA02 (inyección), QA12 (aislamiento de búsqueda/menciones). **HU:** HU07, HU08.

**Capacidades de conexión del agente — requisito del dueño del producto:** los empleados digitales deben poder
conectarse a internet, hacer RPA y usar conectores por múltiples protocolos. Todo pasa por la **pasarela de
herramientas** (RF17), el **motor de políticas** (RF11), la **bandeja de aprobaciones** (RF12) para acciones con efecto,
y el **presupuesto** (RF26); el contenido traído del exterior es **dato no confiable** (QA02).

| Capacidad | Estado hoy | Qué se construye |
|---|---|---|
| **Conectores REST (API)** | ✅ Reutiliza | `ConnectorAdapter` REST con importación OpenAPI, auth (API key/Bearer/Basic/OAuth2), validación de esquema |
| **Web Service (SOAP)** | ✅ Reutiliza | Adaptador SOAP con importación WSDL |
| **GraphQL** | ✅ Reutiliza | Adaptador GraphQL |
| **MCP (cliente)** | ✅ Reutiliza | Cliente MCP hacia servidores externos + el servidor MCP propio de NEXO |
| **Acceso a internet** (navegar/consultar/buscar web) | 🟡 Modifica | Existe `HttpClientService` saliente con anti-SSRF/timeout/tamaño. **Construido:** el parámetro de salida a internet con dominios permitidos y su política viven en `execution-params` (`egress-policy.rules.ts`). **Pendiente (E8-2):** aplicar ese candado en el runtime del agente —hoy la política existe pero el runtime aún no la hace cumplir en la herramienta web— y la web del parámetro |
| **RPA** (automatización de interfaces web/escritorio) | 🔴 Construye | Nuevo adaptador/worker de automatización (navegador headless y, si aplica, escritorio) para sistemas sin API: sesiones con credenciales de la bóveda, pasos auditables, captura de evidencia, idempotencia y conciliación (E7), bajo política y aprobación. Es la pieza más grande; aislarla en su propio worker. Relación con el pendiente P4 de `plan-de-mejora.md` |

**Estación virtual (requisito del dueño del producto):** la RPA y las tareas de escritorio/navegador corren en una
**estación virtual** — un entorno de trabajo aislado que se **asigna al agente** en su configuración (parámetro del
expediente, E2/RF04). Modela `EstacionVirtual` (tipo navegador/escritorio, estado, sesión con credenciales de la bóveda,
alcance de red = con/sin internet y dominios permitidos, aislamiento por workspace/empresa). Un agente sin estación
asignada no puede lanzar RPA; la estación es efímera/auditable y su salida a internet la gobierna la política (E6).

**Principio:** preferir **API/conector** sobre **RPA** cuando el sistema destino lo soporte (más robusto y barato); la RPA
es el puente para sistemas heredados sin API. Toda capacidad de conexión respeta aislamiento multi-tenant y no recibe
credenciales en el prompt (van por la bóveda y la pasarela).

### E9 · Costos e imputación (P0) — Modifica — ✅ construido
RF25 (**reutiliza** `UsageRecord`), RF26 (reserva antes de despachar + conciliación; **modifica** `Budget`), RF44
(servicios compartidos con acuerdo de servicio), RF45 (imputación por empresa/línea/área/centro de costo; sin doble
conteo). **QA:** QA05 (presupuesto concurrente). **HU:** HU11, HU24 (consolidación económica).

### E10 · Indicadores y evaluación (P0/P1) — Reutiliza + Construye — ✅ construido
RF27 (**reutiliza** evaluaciones con puerta de publicación), RF28 (mejora continua), métricas de RF30/RF16: cumplimiento,
calidad, tiempo de ciclo (mediana y p95), costo por resultado, excepciones, horas liberadas (estimadas, separadas de
confirmadas), beneficio validado. **HU:** HU12.

### E11 · Comunidad interna (P0 base) — Construye — 🟡 parcial (cubierta en parte por el catálogo de cuadrillas; muro/publicaciones/moderación pendientes)
RF37 (perfiles enlazados al expediente, muro, grupos por área/proceso, publicaciones tipificadas, menciones, búsqueda,
notificaciones; compromisos enlazados a tarea/responsable/fecha), RF38 (distinguir opinión/pendiente/procedimiento
aprobado; moderación; aprendizaje al conocimiento oficial solo tras revisión). Permisos aplicados en consulta y entrega;
mencionar no concede acceso. **QA:** QA12. **HU:** HU18, HU19.

### E12 · Consolas y experiencia (P0) — Modifica + Construye — ✅ construido
RF23 (**reutiliza** el chat con estados), RF24 (accesibilidad, **continúa** RX-13), RF47 (consolas gerenciales por
negocio/área/sede). Pantallas: Inicio gerencial (resultados/riesgos/decisiones/beneficio), Mi trabajo, Aprobaciones,
Organización/organigrama, Procesos y ejecuciones, Comunidad. Diferenciar autor humano y digital. **HU:** HU12.

### E13 · Plataforma / RNF (P0/P1) — Modifica + Construye — ✅ auditoría inmutable construida
RNF01-09: disponibilidad 99,5 %, P95 ≤ 2 s, RPO/RTO, observabilidad correlacionada, **auditoría inmutable** (`AuditLog`),
retención por tipo de dato (**continúa** DataGuard D3-D6), exportación. **Reutiliza** el cifrado/rotación y el
endurecimiento ya hechos.

### E14 · Canales de comunicación externa (P0) — Reutiliza + Construye — ⏳ pendiente (decisión de proveedores)
Requisito del dueño del producto para esta versión: los empleados digitales se comunican con el exterior por **correo**,
**llamadas telefónicas con agentes conversacionales al 100 %** y **WhatsApp**. (Anula la exclusión de voz que tenía la
v1.0 en P0.) Todos los canales pasan por la **pasarela de herramientas** (RF17), el **motor de políticas** (RF11) y la
**bandeja de aprobaciones** (RF12): un mensaje o llamada saliente sensible requiere política/aprobación; el contenido
entrante es **dato no confiable** (RF17, QA02). Cada canal es un `ConnectorAdapter`/canal nuevo (regla de extensibilidad
de `CLAUDE.md`: protocolo nuevo = adaptador nuevo, nada de `if (type===…)` disperso).

| Canal | Estado hoy | Qué se construye |
|---|---|---|
| **Correo** | 🟡 Reutiliza | Ya hay base de conectores de correo (p. ej. Microsoft 365 / Gmail como apps conectadas). Falta formalizarlo como **canal del empleado digital** con plantillas, destinatarios permitidos, aprobación de salientes y registro de recepción/respuesta como hechos distintos (RF35) |
| **WhatsApp** | 🔴 Construye | Adaptador de **WhatsApp Business API** (plantillas aprobadas, ventana de sesión de 24 h, webhooks de entrega/lectura/respuesta firmados, idempotencia); saliente bajo política/aprobación |
| **Llamadas telefónicas (voz conversacional 100 %)** | 🔴 Construye (mayor) | **Pipeline de voz en tiempo real**: telefonía (SIP/proveedor), STT (voz→texto), el runtime conversacional del agente, TTS (texto→voz) con barge-in/latencia baja; grabación y transcripción como evidencia; consentimiento y retención por política; límites de costo/duración. Es la pieza más grande de E14 y conviene aislarla en su propio servicio/worker |

**Principios transversales de E14:** la conversación (voz/WhatsApp/correo) es una **representación** de registros operativos
(mensajes, tareas, evidencias), no un canal para ampliar atribuciones; toda acción con efecto solicitada por un
interlocutor externo se convierte en **tarea autorizada** y pasa por aprobación según riesgo; grabaciones y
transcripciones se tratan como datos sensibles (DataGuard, retención, RNF07). **QA:** QA02 (inyección desde contenido
externo), QA03 (aprobación de salientes), QA04 (idempotencia de entregas), QA12 (aislamiento). Depende de E4 (tareas),
E6 (gobierno) y E7 (durabilidad).

## Orden de construcción propuesto (noches/etapas)

Alineado a la sección 20 del documento (jerarquía + contratos de resultado en Fundaciones P0; comunicación en Ejecución
P0; comunidad + superempleado + consolidación en Operación P0).

1. **Fundaciones P0** → E1 (estructura) + E2 (empleado digital) + E3 (jerarquía) + E13 auditoría.
2. **Ejecución P0** → E4 (trabajo por resultados) + E5 (comunicación y **handoff** entre agentes) + E6 (gobierno) +
   E7 (durabilidad) + E8 (ajustes) + **E14 (canales externos)**: correo primero (reutiliza), luego WhatsApp, y la
   **voz conversacional** como pista propia por su tamaño (telefonía + STT/TTS en tiempo real).
3. **Operación P0** → E9 (imputación) + E10 (KPIs) + E11 (comunidad) + E12 (consolas).
4. **Expansión P1 / Optimización P2** → objetivos e indicadores avanzados, diseñador visual, planificación dinámica,
   superempleado ejecutor (reutiliza la orquestación multi-modelo del ADR 0010).

> Puertas transversales que **ninguna épica puede saltarse** para liberar P0: QA01-QA16. Cada funcionalidad cumple la
> «definición de terminado» de la sección 15: permisos, aislamiento, auditoría, consumo, estados de error/recuperación,
> documentación y validación en pruebas. Una demo con datos simulados no sustituye la aceptación de la integración.

## Lo que se construye esta noche (primer incremento de E2)

Fundación del empleado digital, con migración aditiva y sin romper lo existente (`routing=null` del ADR 0010 y todo lo
ya construido siguen igual):

1. **Catálogo de `Cargo`** (RF03): perfil reutilizable con propósito, funciones, entregables, indicadores, límites y
   **nivel jerárquico** (empleado/líder/jefe/director/gerente/superempleado — base de E3/RF32).
2. **Expediente del agente ampliado** (RF02/RF04): `Agent` gana `cargoId`, `responsableUserId` (titular),
   `suplenteUserId` y se **impide publicar/lanzar sin responsable**.
3. **Estados de ciclo de vida completos** (RF05/RF06): extender `LaunchStatus` a Borrador→En validación→Publicado→
   Suspendido→Retirado, con reglas de transición.

Cada pieza: migración aditiva (regla de CLAUDE.md sobre índices generados), DTO validado, API, mínimo de web
(expediente), y pruebas; validación completa antes de cada push. El resto de E1-E13 queda trazado arriba para las
siguientes noches.

## Nota de cierre (2026-10-26)

El programa avanzó muy por encima de aquel primer incremento. Con los ADR 0011 (modelo organizacional + dimensiones
configurables D8), 0012 (trabajo por resultados + comunicación/handoff), 0013 (gobierno + canales) y 0014 (Cuadrillas
gobernadas + Pasaporte de resultado verificable) quedan **construidos y validados en la rama**:

- **Completas (✅):** E1 (estructura + dimensiones D8), E2 (empleado digital/cargo), E3 (jerarquía/organigrama),
  E4 (trabajo por resultados), E5 (comunicación + handoff), E6 (gobierno: políticas, aprobaciones, suspensión),
  E7 (durabilidad: idempotencia/excepciones/conciliación), E9 (imputación de costos), E10 (indicadores de resultado),
  E12 (consola gerencial, backend + web) y E13 (auditoría inmutable encadenada por hash).
- **Incrementos del ADR 0014 (✅):** Pasaporte de resultado (backend + web), Cuadrillas (backend + web) y la consola
  gerencial (backend + web).
- Módulos backend nuevos: `governance/estructura`, `governance/dimensiones`, `governance/imputacion`,
  `governance/policy`, `governance/actions`, `cargos`, `hierarchy`, `results` (con `indicadores/` y `pasaporte.*`),
  `messaging`, `collaboration`, `durability`, `execution-params`, `crews`, `consolas`, `audit`. Web: expediente del
  empleado digital, estructura, dimensiones, Mi trabajo, mensajes/handoff, gobierno, excepciones, imputación, dashboard
  de resultados, consola gerencial, catálogo de cuadrillas, organigrama, visor de auditoría y panel de pasaporte.

**Pendiente:**

- **E8-2 (🟡):** aplicar el candado de salida a internet en el **runtime** del agente (la política y el parámetro ya
  existen en `execution-params`, pero el runtime aún no los hace cumplir en la herramienta web) y la **web** del
  parámetro de ejecución.
- **E14 (⏳):** canales externos correo/WhatsApp/voz — **pendiente de decisión de negocio sobre proveedores** (telefonía
  SIP/STT/TTS, WhatsApp Business API, correo como canal formal del empleado digital).
- **E11 (🟡):** comunidad interna — hoy cubierta en parte por el catálogo de cuadrillas; faltan muro, publicaciones
  tipificadas, moderación y aprendizajes validados hacia el conocimiento oficial.
