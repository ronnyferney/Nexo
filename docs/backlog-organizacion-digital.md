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

| Épica | Alcance | RF | Prio | Tipo dominante |
|---|---|---|---|---|
| **E1 · Estructura empresarial** | Grupo/empresa, unidades y líneas de negocio, áreas, departamentos, equipos, sedes, centros de costo, matricial | RF01, RF41, RF42, RF43, RF46 | P0 | Modifica + Construye |
| **E2 · Empleado digital** | Catálogo de cargos, expediente, cargo+responsable humano titular/suplente, estados de ciclo de vida, versiones, publicación/retiro | RF02, RF03, RF04, RF05, RF06 | P0 | Construye |
| **E3 · Jerarquía de dirección digital** | Niveles (empleado→líder→jefe→director→gerente→superempleado), autoridad, delegación, supervisión y reemplazo | RF32, RF33, RF34, RF39, RF40 | P0 | Construye |
| **E4 · Trabajo por resultados** | Objetivos, tareas y entregables, contrato de resultado, verificación/aceptación, incumplimientos | RF07, RF08, RF29, RF30, RF31 | P0 | Construye |
| **E5 · Colaboración y comunicación** | Flujos con contratos, control de delegación, protocolo de mensajes entre agentes, coordinación transversal | RF09, RF10, RF35, RF36 | P0 | Modifica + Construye |
| **E6 · Gobierno de acciones** | Motor de políticas, bandeja de aprobaciones (hash/invalidación/doble), suspensión de emergencia | RF11, RF12, RF13 | P0 | Construye |
| **E7 · Durabilidad avanzada** | Idempotencia, deduplicación de eventos, reintentos/conciliación, bandeja de excepciones | RF17, RF18, RF20, RF21 | P0 | Modifica + Construye |
| **E8 · Conocimiento y herramientas** | Conocimiento empresarial, memoria controlada, conectores, pasarela | RF14, RF15, RF16, RF17 | P0 | Reutiliza + Modifica |
| **E9 · Costos e imputación** | Control de costos, presupuestos con reserva/conciliación, imputación por empresa/línea/área/centro de costo, servicios compartidos | RF25, RF26, RF44, RF45 | P0 | Modifica |
| **E10 · Indicadores y evaluación** | KPIs de resultado (cumplimiento, calidad, tiempo de ciclo, costo por resultado, beneficio validado), evaluaciones, mejora continua | RF27, RF28, RF30-métricas | P0/P1 | Reutiliza + Construye |
| **E11 · Comunidad interna** | Red social corporativa privada: perfiles, muro, grupos, publicaciones tipificadas, moderación, aprendizajes validados | RF37, RF38 | P0 | Construye |
| **E12 · Consolas y experiencia** | Inicio gerencial, Mi trabajo, Aprobaciones, Organización/organigrama, consolas por negocio/área/sede, chat, accesibilidad | RF23, RF24, RF47 | P0 | Modifica + Construye |
| **E13 · Plataforma (RNF)** | Disponibilidad, rendimiento, DR, observabilidad correlacionada, auditoría inmutable, exportación, retención | RNF01-09 | P0/P1 | Modifica + Construye |

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

### E1 · Estructura empresarial (P0) — Modifica + Construye
RF01 (aislamiento), RF41 (modelo configurable), RF42 (funcional y matricial), RF43 (expediente de unidad), RF46
(permisos y cambios de estructura). **Reutiliza** `OrgUnit` y el aislamiento endurecido. **Construye** `LineaNegocio`,
`Sede`, `CentroCosto`, `AsignacionOrganizacional`, `ServicioInterno`; vistas organizacional/funcional/negocio/sede.
Regla de identidad: empresa≠línea, área≠centro de costo, cargo≠persona; sin duplicar empleados ni ejecuciones.
**QA:** QA01 (aislamiento), QA15 (matricial sin ciclos), QA16 (reorganización conserva historia). **HU:** HU01, HU21-23.

### E2 · Empleado digital (P0) — Construye
RF02 (organigrama y responsables), RF03 (catálogo de cargos), RF04 (expediente), RF05 (versiones, **reutiliza**
`AgentVersion`), RF06 (publicación/retiro, **modifica** la puerta de salud+evaluación existente). Estados de ciclo de
vida completos: Borrador→En validación→Publicado→Suspendido→Retirado (hoy solo DRAFT/LAUNCHED). Bloquear activar sin
responsable; retiro reasigna y revoca. **QA:** HU02, HU03. **Primera entrega de esta noche** (ver abajo).

### E3 · Jerarquía de dirección digital (P0) — Construye
RF32 (cargos jerárquicos), RF33 (autoridad y delegación), RF34 (supervisión y reemplazo), RF39 (superempleado),
RF40 (límites y continuidad). Una misión = una responsabilidad principal; evitar múltiples superiores finales y ciclos.
El superempleado no se autoaprueba ni amplía presupuesto. **QA:** QA10 (órdenes contradictorias/ciclos), QA13
(no autoaprobación), QA14 (suspender coordinador y recuperar). **HU:** HU16, HU20.

### E4 · Trabajo por resultados (P0) — Construye
RF07 (objetivos), RF08 (tareas y entregables), RF29 (contrato de resultado), RF30 (verificación y aceptación: el
ejecutor no valida su propio resultado), RF31 (incumplimientos: alerta, recuperación, escalamiento, límite). Estados del
resultado: Propuesto→Comprometido→En producción→Pendiente de validación→Aceptado→Devuelto/Incumplido. Distinguir
producto intermedio de resultado de negocio (un correo enviado ≠ recaudo). **QA:** QA09 (no cerrar con evidencia
inválida). **HU:** HU04, HU14, HU15.

### E5 · Colaboración y comunicación (P0) — Modifica + Construye
RF09 (flujos con contrato de transferencia, **modifica** el motor DAG), RF10 (control de delegación: profundidad,
ciclos, concurrencia, «un agente no crea agentes ni amplía su presupuesto»), RF35 (protocolo de mensajes persistente
con idempotencia), RF36 (coordinación transversal: canales por misión/proceso/área, hilos, menciones; una solicitud se
vuelve tarea autorizada). **QA:** QA11 (redelivery sin duplicar, escalamiento por falta de respuesta). **HU:** HU05,
HU17.

### E6 · Gobierno de acciones (P0) — Construye
RF11 (motor de políticas server-side por monto/destinatario/tipo de dato/horario, versionado; un texto del modelo no
sustituye autorización), RF12 (bandeja de aprobaciones con hash del contenido, invalidación al cambiar destino/monto/
adjunto, doble aprobación, caducidad), RF13 (suspensión de emergencia). **Reutiliza** `requiresApproval`/`approvedTools`
y `budgets.plan` como piezas. **QA:** QA03 (aprobación), QA07 (revocación antes de despacho), QA08 (suspensión). **HU:**
HU06, HU10.

### E7 · Durabilidad avanzada (P0) — Modifica + Construye
RF17 (idempotencia en la pasarela), RF18 (deduplicación de eventos), RF20 (clasificación temporal/permanente/incierto,
conciliación de escrituras inciertas), RF21 (bandeja de excepciones). **Reutiliza** el motor durable, colas y la
reconciliación cron ya existentes. **QA:** QA04 (duplicación), QA06 (continuidad). **HU:** HU09, HU13.

### E8 · Conocimiento y herramientas (P0) — Reutiliza + Modifica
RF14-RF17. **Reutiliza** RAG, DataGuard, conectores, bóveda y anti-SSRF. **Modifica** para propietario/clasificación/
vigencia por documento, separación memoria temporal/persistente/documental, credenciales por entorno y listas de
destinos permitidos. **QA:** QA02 (inyección), QA12 (aislamiento de búsqueda/menciones). **HU:** HU07, HU08.

### E9 · Costos e imputación (P0) — Modifica
RF25 (**reutiliza** `UsageRecord`), RF26 (reserva antes de despachar + conciliación; **modifica** `Budget`), RF44
(servicios compartidos con acuerdo de servicio), RF45 (imputación por empresa/línea/área/centro de costo; sin doble
conteo). **QA:** QA05 (presupuesto concurrente), QA24 (consolidación). **HU:** HU11, HU24.

### E10 · Indicadores y evaluación (P0/P1) — Reutiliza + Construye
RF27 (**reutiliza** evaluaciones con puerta de publicación), RF28 (mejora continua), métricas de RF30/RF16: cumplimiento,
calidad, tiempo de ciclo (mediana y p95), costo por resultado, excepciones, horas liberadas (estimadas, separadas de
confirmadas), beneficio validado. **HU:** HU12.

### E11 · Comunidad interna (P0 base) — Construye
RF37 (perfiles enlazados al expediente, muro, grupos por área/proceso, publicaciones tipificadas, menciones, búsqueda,
notificaciones; compromisos enlazados a tarea/responsable/fecha), RF38 (distinguir opinión/pendiente/procedimiento
aprobado; moderación; aprendizaje al conocimiento oficial solo tras revisión). Permisos aplicados en consulta y entrega;
mencionar no concede acceso. **QA:** QA12. **HU:** HU18, HU19.

### E12 · Consolas y experiencia (P0) — Modifica + Construye
RF23 (**reutiliza** el chat con estados), RF24 (accesibilidad, **continúa** RX-13), RF47 (consolas gerenciales por
negocio/área/sede). Pantallas: Inicio gerencial (resultados/riesgos/decisiones/beneficio), Mi trabajo, Aprobaciones,
Organización/organigrama, Procesos y ejecuciones, Comunidad. Diferenciar autor humano y digital. **HU:** HU12.

### E13 · Plataforma / RNF (P0/P1) — Modifica + Construye
RNF01-09: disponibilidad 99,5 %, P95 ≤ 2 s, RPO/RTO, observabilidad correlacionada, **auditoría inmutable** (`AuditLog`),
retención por tipo de dato (**continúa** DataGuard D3-D6), exportación. **Reutiliza** el cifrado/rotación y el
endurecimiento ya hechos.

## Orden de construcción propuesto (noches/etapas)

Alineado a la sección 20 del documento (jerarquía + contratos de resultado en Fundaciones P0; comunicación en Ejecución
P0; comunidad + superempleado + consolidación en Operación P0).

1. **Fundaciones P0** → E1 (estructura) + E2 (empleado digital) + E3 (jerarquía) + E13 auditoría.
2. **Ejecución P0** → E4 (trabajo por resultados) + E5 (comunicación) + E6 (gobierno) + E7 (durabilidad) + E8 (ajustes).
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
