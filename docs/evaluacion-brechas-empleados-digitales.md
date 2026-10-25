# Evaluación de brechas — NEXO actual vs. «Organización de empleados digitales»

> Respuesta a la **Solicitud de desarrollo de NEXO v1.0** (R. Garzón, 2026-10-25). Evalúa, requisito por requisito,
> qué del alcance solicitado **ya existe** en NEXO, qué está **parcial** y qué **falta**, con la clasificación
> reutiliza / modifica / construye que pide la sección 15 del documento.
>
> Método: verificado contra el código (`apps/api/prisma/schema.prisma`, módulos de `apps/api/src`, `apps/web`) el
> 2026-10-25, no de memoria. Leyenda: ✅ existe · 🟡 parcial · 🔴 falta.

## Veredicto ejecutivo

NEXO tiene una **base técnica fuerte y poco común** para este alcance: aislamiento multi-tenant endurecido, pasarela
de conectores con bóveda y anti-SSRF, **motor de ejecución durable** (colas, workers, cron, webhooks, reconciliación),
conocimiento con RAG y DataGuard, **presupuestos y costos medidos**, **evaluaciones con puerta de publicación**,
versiones inmutables de agente, un chat con máquina de estados, y **orquestación multi-modelo con verificación
cruzada**. Eso cubre buena parte de las capas 6, 7, 9 y 11 del documento.

La brecha **no es de plomería técnica, es del modelo de «empleado digital» como unidad organizacional**. Hoy NEXO
gestiona *agentes* y *ejecuciones*; el documento pide gestionar *cargos con responsable humano*, *tareas con aceptación
de entregable*, *objetivos*, *políticas de acción con bandeja de aprobaciones* y *controles de delegación y
suspensión*. Esa capa de **gobierno y organización del trabajo** es la que está mayormente por construir.

**En una frase:** el motor existe; falta la *organización* (cargos, responsables, organigrama), el *trabajo* (tareas,
objetivos, entregables aceptados) y el *gobierno de acciones* (motor de políticas, bandeja de aprobaciones con
invalidación, suspensión de emergencia, conciliación de excepciones).

## Lo que YA es base sólida (reutilizar)

| Capa | En NEXO hoy |
|---|---|
| Aislamiento y seguridad | Multi-tenant por `workspaceId`; `OrgUnit` jerárquico; auditoría de seguridad cerrada (C1, serie A/M/B); cifrado AES-GCM v2 con rotación; RBAC leído por petición |
| Conectores y herramientas | `Connector` (REST/SOAP/GraphQL/MCP), `allowedSecrets`, bóveda, `HttpClientService` con anti-SSRF/timeout/tamaño, clasificación lectura/escritura |
| Ejecución durable | `Workflow`/`Execution`, colas BullMQ + workers, cron con reconciliación desde BD (P9), recuperación de nodos colgados (P10), webhooks firmados |
| Conocimiento | `KnowledgeBase`/`KnowledgeChunk`, indexación tsvector, `search_knowledge`/`save_knowledge`, DataGuard D1-D2 + retención D7 |
| Costos y presupuesto | `UsageRecord` (costo por ejecución/agente/área/org), `Budget` jerárquico con degradación y tope duro, traza de rol/motivo (ADR 0010 D5) |
| Calidad | `EvalCase`/`EvalRun` con juez, umbral que **bloquea publicación**, puntajes humanos versionados |
| Versiones | `AgentVersion` inmutable, comparación y reversión |
| Experiencia | Chat con máquina de estados, Actividad/Diagnóstico, errores empresariales, panel de salud, Design System, accesibilidad WCAG 2.2 AA iniciada |
| Multi-modelo | Enrutamiento por capacidad/costo + verificación cruzada (otro fabricante) + editor de política (ADR 0010, Fases 1-5) |

## Brechas por requisito funcional

| RF | Tema | Estado | Evidencia / brecha | Acción |
|---|---|---|---|---|
| RF01 | Organización y aislamiento | 🟡 | Aislamiento sólido por `workspaceId`/`OrgUnit`. Falta formalizar la jerarquía **organización → varias empresas → áreas** y el compartir inter-empresa con política expresa | Modifica |
| RF02 | Organigrama y responsables | 🔴 | No existe cargo, **responsable humano titular/suplente** del agente, vista de organigrama, bloqueo de activar sin responsable, ni detección de ciclos de supervisión | Construye |
| RF03 | Catálogo de cargos | 🔴 | No hay entidad `Cargo`/perfil reutilizable (funciones, entradas, entregables, indicadores, límites) | Construye |
| RF04 | Expediente del agente | 🟡 | `Agent` tiene nombre, descripción, modelo, versión, fuentes, herramientas, estado, evaluaciones, icono, routing. Falta **cargo, responsable, política de autonomía explícita, horario** | Modifica |
| RF05 | Configuración y versiones | ✅ | `AgentVersion` inmutable, comparar y revertir | Reutiliza |
| RF06 | Publicación y retiro | 🟡 | Puerta de publicación por salud + evaluación existe. Falta **retiro que reasigna tareas, revoca credenciales y desactiva disparadores**, y registro de quién autorizó | Modifica |
| RF07 | Objetivos y compromisos (P1) | 🔴 | No hay entidad `Objetivo` (indicador, línea base, meta, plazo) ni vínculo a procesos/tareas | Construye |
| RF08 | Tareas y entregables | 🔴 | Hay *ejecuciones* técnicas, no **tareas de negocio** con objetivo, criterio de aceptación, responsable, entregable y aceptación/devolución | Construye |
| RF09 | Colaboración entre agentes | 🟡 | El motor de flujos DAG cubre pasos de ejecución/revisión/decisión/espera. Falta **contrato de entrada/salida por transferencia** y el runtime multi-agente (agentes como herramientas) | Modifica + Construye |
| RF10 | Control de delegación | 🔴 | No hay límites de profundidad/pasos/concurrencia de delegación entre agentes, ni la regla «un agente no crea agentes ni amplía su presupuesto» como política | Construye |
| RF11 | Motor de políticas | 🟡 | Existen piezas server-side (`budgets.plan`, `@MinRole`, DataGuard, `requiresApproval`). Falta el **motor unificado** que evalúe por monto/destinatario/tipo de dato/horario con **versión de política** registrada | Construye |
| RF12 | Bandeja de aprobaciones | 🔴 | Hay aprobación a nivel de herramienta (`requiresApproval`/`approvedTools`) en el bucle de ejecución. Falta la **bandeja persistente** con hash del contenido, **invalidación** al cambiar destino/monto/adjunto, **doble aprobación** y caducidad | Construye |
| RF13 | Suspensión de emergencia | 🔴 | No existe interruptor por agente/proceso/conector/organización | Construye |
| RF14 | Conocimiento empresarial | 🟡 | RAG con permisos y citación por fuente. Falta propietario/clasificación/vigencia formal por documento y el «declarar falta de evidencia / escalar» como contrato | Modifica |
| RF15 | Memoria controlada | 🟡 | Bases + `save_knowledge` con permiso de escritura + retención D7. Falta separar formalmente contexto temporal / memoria persistente autorizada / repositorio y expiración por política | Modifica |
| RF16 | Registro de conectores | ✅ | `Connector` con dueño, alcance, bóveda, esquemas, clasificación lectura/escritura, salud. Afinar credenciales **por entorno** | Reutiliza |
| RF17 | Pasarela de herramientas | 🟡 | Validación de auth/esquema/ámbito + anti-SSRF + registro. Falta **idempotencia** y listas de destinos permitidos por acción como parte de la pasarela | Modifica |
| RF18 | Programaciones y eventos | 🟡 | Cron + webhooks firmados + reconciliación. Falta **deduplicación de eventos** (un evento repetido no crea el mismo trabajo) y la distinción fecha-negocio/UTC/local | Modifica |
| RF19 | Motor de ejecución durable | ✅ | Persistencia de flujo/paso/intento, colas, recuperación de workers. Afinar «esperas humanas sin proceso ocupado» | Reutiliza |
| RF20 | Reintentos y conciliación | 🔴 | Reintentos de cola existen. Falta **claves de idempotencia**, clasificación temporal/permanente/incierto y **conciliación de escrituras inciertas** antes de repetir | Construye |
| RF21 | Excepciones operativas | 🔴 | No hay bandeja de excepciones (causa, impacto, dueño, siguiente acción, reintentar/reasignar/conciliar) | Construye |
| RF22 | Notificaciones | 🟡 | Existe Alertas. Falta bandeja interna de asignaciones/vencimientos/aprobaciones con agrupación y límite de frecuencia | Modifica |
| RF23 | Interacción conversacional | ✅ | Chat con estados (responde/consulta/prepara/espera aprobación/bloqueo), detener ejecución, acciones propuestas revisables | Reutiliza |
| RF24 | Navegación y accesibilidad | 🟡 | Shell, estados vacío/carga/error, filtros, WCAG 2.2 AA iniciada. Falta cobertura a11y completa, aprobación en móvil y separación visible dev/prueba/prod | Modifica |
| RF25 | Control de costos | ✅ | `UsageRecord` consolida por ejecución/agente/área/org; medido vs. estimado por motivo | Reutiliza |
| RF26 | Presupuestos | 🟡 | `Budget` jerárquico con alerta y tope duro. Falta **reserva antes de despachar** concurrente y conciliación posterior (anti doble-gasto del mismo saldo) | Modifica |
| RF27 | Evaluaciones | ✅ | Casos + corridas + juez + bloqueo de publicación + puntajes humanos versionados | Reutiliza |
| RF28 | Mejora continua (P1/P2) | 🟡 | Bucle de retroalimentación + sugerencias + comparación de versiones; multi-modelo. Falta la recomendación de redistribución/automatización de P2 con prueba de calidad | Modifica |

## Brechas en requisitos no funcionales

| RNF | Estado | Nota |
|---|---|---|
| RNF01 disponibilidad 99,5 % | 🔴 | No medido; definir sondas y exclusiones |
| RNF02 P95 ≤ 2 s sin IA | 🔴 | No medido bajo carga |
| RNF03 encolamiento ≤ 2 s P95 | 🟡 | Hay cola; falta medición separada IA/aprobación |
| RNF04 RPO ≤ 1 h / RTO ≤ 4 h | 🟡 | Respaldo de infra iniciado (B8); falta validar por restauración |
| RNF05 cifrado / mínimo privilegio / rotación | ✅ | AES-GCM v2, bóveda, `crypto:rotate`, RBAC |
| RNF06 observabilidad correlacionada | 🟡 | `AgentRun`/analítica; falta correlación por paso/llamada externa completa |
| RNF07 retención por tipo de dato | 🟡 | DataGuard D7; falta política por categoría (D3-D6) |
| RNF08 WCAG 2.2 AA | 🟡 | Iniciada en el chat (RX-13); falta cobertura de recorridos críticos |
| RNF09 exportación de datos/config | 🔴 | No implementada |

## Puertas de calidad del piloto (sección 13)

| QA | Estado | Nota |
|---|---|---|
| QA01 Aislamiento | ✅ | Cubierto por el endurecimiento y pruebas de aislamiento |
| QA02 Inyección | ✅ | DataGuard + contenido externo tratado como no confiable + resistencia probada |
| QA03 Aprobación (hash/invalidación) | 🔴 | Requiere RF12 (bandeja con hash y caducidad) |
| QA04 Duplicación / idempotencia | 🔴 | Requiere RF20 (idempotencia + conciliación) |
| QA05 Presupuesto concurrente | 🟡 | Presupuesto existe; falta reserva/conciliación concurrente (RF26) |
| QA06 Continuidad | ✅ | Motor durable + reconciliación cron (P9/P10) |
| QA07 Revocación antes de despacho | 🟡 | Revalidar permisos/presupuesto al ejecutar (parcial) |
| QA08 Operación (suspensión/restauración) | 🔴 | Requiere RF13 (suspensión) |

## Los 9 pilares que faltan para «organización de empleados digitales»

1. **Cargos + responsable humano + organigrama** (RF02/RF03, expediente RF04). Es la identidad del empleado digital.
2. **Tareas y objetivos de negocio con aceptación de entregable** (RF07/RF08), distintos de las ejecuciones técnicas.
3. **Motor de políticas unificado + bandeja de aprobaciones** con hash, invalidación y doble aprobación (RF11/RF12).
4. **Suspensión de emergencia** por agente/proceso/conector/organización (RF13).
5. **Durabilidad avanzada**: idempotencia, conciliación de escrituras inciertas y bandeja de excepciones (RF20/RF21).
6. **Delegación controlada y colaboración con contratos** entre agentes (RF09/RF10) — runtime multi-agente.
7. **Roles humanos del negocio**: hoy 4 (OWNER/ADMIN/EDITOR/VIEWER) vs. los 8 del documento (responsable de proceso,
   aprobador, operador, auditor, etc.).
8. **KPIs de resultado y pantallas de dirección**: cumplimiento, calidad, tiempo de ciclo, costo por resultado,
   beneficio validado; Inicio gerencial, Mi trabajo, Aprobaciones.
9. **Auditoría inmutable dedicada** (hoy la traza vive en `UsageRecord`/`AgentRun`; falta un registro de auditoría de
   decisiones/aprobaciones/políticas inmutable).

## Recomendación de etapas (alineada a la sección 14 del documento)

- **Etapa 0 — Descubrimiento:** confirmar org/empresas iniciales, proceso piloto (la propuesta de cartera del doc es
  buena), sistemas destino y APIs reales, proveedor de identidad, y levantar línea base de tiempo/calidad.
- **Etapa 1 — Fundaciones P0 (mayor brecha):** cargos, responsable humano, organigrama, estados de ciclo de vida
  completos (En validación/Suspendido/Retirado) y los 8 roles. *Reutiliza* el aislamiento y las versiones existentes.
- **Etapa 2 — Ejecución P0:** tareas/entregables, motor de políticas + bandeja de aprobaciones, suspensión, idempotencia
  y conciliación, bandeja de excepciones. *Reutiliza* el motor durable, conectores y la pasarela.
- **Etapa 3 — Operación P0:** Inicio gerencial, KPIs de resultado, auditoría inmutable. *Reutiliza* costos, presupuestos
  y evaluaciones.
- **Etapas 4-5 — P1/P2:** objetivos e indicadores, diseñador visual de procesos, planificación dinámica. *Reutiliza* la
  orquestación multi-modelo ya construida (ADR 0010).

> Nota de estimación: como pide el documento, no se fija plazo sin revisar equipo y conectores. La mayor parte del
> esfuerzo nuevo es la **capa de organización y gobierno del trabajo** (pilares 1-5 y 8); la capa de ejecución, costos,
> conocimiento y calidad se **reutiliza** en gran medida.
