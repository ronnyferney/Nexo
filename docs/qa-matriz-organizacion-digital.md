# Matriz de trazabilidad y plan de pruebas — NEXO organización de empleados digitales

> Cédula de QA del programa «organización de empleados digitales». Gobierna la calidad de las épicas E1-E14
> (`backlog-organizacion-digital.md`), los requisitos RF01-RF47, las historias HU01-HU24 y las puertas QA01-QA16 de la
> **Solicitud de desarrollo de NEXO v3.0** (R. Garzón). Complementa la **auditoría de cierre**
> (`auditoria-cierre-epicas-2026-11-04.md`), la evaluación de brechas (`evaluacion-brechas-empleados-digitales.md`) y el
> registro de seguridad (`plan-de-mejora.md`).
>
> **Regeneración 2026-11-04 (fix A8 de la auditoría).** La versión anterior (2026-10-25) quedó masivamente obsoleta:
> marcaba casi todo 🔴/🟡 «la entidad no existe» cuando los módulos y suites ya estaban construidos. Esta versión se
> **verifica fila por fila contra el código y las suites reales** (`apps/api/test/*.e2e-spec.ts` = 71 archivos,
> `apps/api/src/**/*.spec.ts`, `apps/web/e2e/*.spec.ts` = 16 recorridos), **no de memoria**. Cada cita apunta a un archivo
> cuya existencia se comprobó al regenerar.
>
> **Leyenda de estado:** ✅ verificado por prueba(s) existente(s) · 🟡 parcial (cobertura con nota de ampliación) ·
> **(B)** construido pero a la espera de **activación / gasto / validación externa** (categoría B de la auditoría; **no es
> brecha de prueba construible**). **Tipo de prueba:** **U** unit (`src/**/*.spec.ts`) · **API** e2e de API
> (`test/*.e2e-spec.ts`) · **W** e2e web (Playwright, `apps/web/e2e/`).

## Resumen de cobertura

| Dimensión | ✅ | 🟡 | (B) | Total |
|---|---|---|---|---|
| Puertas QA01-QA16 | **16** | 0 | 0 | 16 |
| Historias HU01-HU24 | **24** | 0 | 0 | 24 |
| Épicas E1-E14 (suites) | **14** | 0 | 0 | 14 |

**Veredicto:** **16/16 puertas QA construibles verificadas** y **24/24 HU cubiertas** (API e2e, más recorrido W donde la HU
lo exige). Con los fixes A1 (prueba dedicada de inyección) y A2-A6 (recorridos Playwright de pantallas nuevas) ya
mergeados, **no queda ninguna brecha de prueba construible**. Lo pendiente del programa es exclusivamente **categoría
(B)**: activación productiva de canales (correo/WhatsApp/voz), umbrales de Finanzas, validación jurídica/sectorial de
Cumplimiento, habilitación por etapas del coordinador (ADR 0016 Inc.2-5) y el go/no-go del piloto de cobranza. Todo ello
tiene su construcción terminada (sandbox/gated) y probada; **espera decisión del patrocinador, no código ni pruebas.**

> **Nota de método.** La matriz anterior se escribió cuando solo existía E2 (`agent-lifecycle`). Entre esa fecha y hoy el
> programa se construyó completo (ADR 0011-0020 + 0016): existen los módulos `governance/{estructura,dimensiones,policy,
> actions,budgets,imputacion}`, `cargos`, `hierarchy`, `results`, `messaging`, `collaboration`, `durability`,
> `execution-params`, `community`, `crews`, `consolas`, `audit`, `channels`, `missions`, `compliance`, `profiles`,
> `agent-templates`. Las entidades que la versión vieja daba por inexistentes (`Aprobacion`, `Suspension`, `Tarea`,
> `ContratoResultado`, `MensajeAgente`, `AsignacionOrganizacional`, `IdempotencyKey`, `Publicacion`, etc.) **sí existen**
> en `schema.prisma` y están cubiertas.

---

## 1. Matriz de puertas de calidad QA01-QA16

> Puertas transversales: ninguna épica las salta para liberar P0. Cada fila cita la(s) prueba(s) real(es) verificada(s).

| QA | Descripción | RF / HU | Épica | Estado | Prueba(s) real(es) verificada(s) |
|---|---|---|---|---|---|
| **QA01** | Aislamiento: usuario/API key de A no lee, modifica, ejecuta ni referencia recursos de B (API, búsqueda, adjuntos, índices, caché) | RF01, RF41, RF46 / HU01, HU23 | E1, E8, E11 | ✅ | `isolation.e2e-spec.ts` (unidades, presupuestos, miembros, conectores, uso, centro de costo, LLM cruzado, agentes); `agent-knowledge-memory.e2e-spec.ts` (RAG cruzado); `agent-access.e2e-spec.ts` (shares) |
| **QA02** | Inyección: contenido externo (correo, página, doc, salida de tool, voz/WhatsApp) no habilita herramientas, no revela secretos ni cambia políticas | RF14, RF17 / HU07, HU08 | E8, E14 | ✅ | **`prompt-injection.e2e-spec.ts`** (8 escenarios: RAG como dato literal, no crea políticas/aprobaciones, no autoriza tool sensible, no eleva permisos de VIEWER, resistencia a `__proto__`, canal entrante como dato, aislamiento multi-tenant QA12); distribuido en `data-protection.e2e-spec.ts`, `connectors-security.e2e-spec.ts`, `correo-controles-e14.e2e-spec.ts` |
| **QA03** | Aprobación ligada al hash del contenido; cambiar contenido/destino/importe/adjunto/tool/versión la invalida; sin autoaprobación; doble aprobación con dos actores | RF11, RF12 / HU06 | E6 | ✅ | `governance-e6.e2e-spec.ts`, `governance-e6-acciones-sensibles.e2e-spec.ts` (hash, invalidación, doble aprobación); **W** `aprobaciones.spec.ts` (el servidor bloquea autoaprobación; bandeja y decisión) |
| **QA04** | Duplicación/idempotencia: repetir un evento o caer tras una escritura no duplica el efecto de negocio | RF17, RF18, RF20, RF35 / HU09, HU13 | E7, E5, E14 | ✅ | `durability-e7.e2e-spec.ts` (idempotencia, dedup de eventos, conciliación de escritura incierta, excepciones); `schedule-reconcile.e2e-spec.ts` |
| **QA05** | Presupuesto concurrente: reserva y límite duro respetados con concurrencia/reintentos; conciliación; sin doble gasto del mismo saldo | RF26, RF45 / HU11, HU24 | E9 | ✅ | `budgets.e2e-spec.ts` (jerárquico, BLOCK/DOWNGRADE/ALERT_ONLY, tope duro, reserva), `imputacion-e9.e2e-spec.ts`; reserva antes de despachar en `actions/action-gateway.service`; **W** `finanzas.spec.ts` (umbrales 50/80/100) |
| **QA06** | Continuidad: reiniciar workers conserva esperas, entradas y versión del flujo; se reanuda con evidencia | RF19, RF20 / HU09 | E7 | ✅ | `schedule-reconcile.e2e-spec.ts` (reconciliación cron, huérfanos, candado de réplica, idempotente); `durability-e7.e2e-spec.ts` |
| **QA07** | Revocación antes de despacho: retirar acceso/permiso/suspender antes del despacho impide ejecutar pese a aprobación previa | RF12, RF13, RF46 / HU06, HU10 | E6 | ✅ | `governance-e6.e2e-spec.ts` (revalidación en el despacho); **W** `aprobaciones.spec.ts` (QA07) |
| **QA08** | Operación: suspensión por agente/proceso/conector/organización bloquea nuevos despachos; reactivación con actor + motivo | RF13 / HU10 | E6, E13 | ✅ | `governance-e6.e2e-spec.ts` (suspensión/interruptor, reactivación con motivo); **W** `aprobaciones.spec.ts` (suspensión de emergencia en UI) |
| **QA09** | No cerrar un resultado con evidencia inválida; el ejecutor no valida su propio resultado | RF29, RF30 / HU14, HU15 | E4 | ✅ | `results-e4.e2e-spec.ts` (ejecutor≠validador, evidencia exigida); **U** `validacion.service.spec.ts`, `validacion.rules.spec.ts`, `incumplimientos.sweep.spec.ts` |
| **QA10** | Detectar órdenes contradictorias y ciclos jerárquicos; una misión = una responsabilidad principal | RF32, RF34, RF42 / HU16 | E3 | ✅ | `hierarchy-e3.e2e-spec.ts` (ciclos 400), `missions-governance-eb.e2e-spec.ts`, `demo-gerente-digital.e2e-spec.ts` |
| **QA11** | Redelivery de mensajes entre agentes sin duplicar tareas; escalamiento por falta de respuesta | RF35, RF36 / HU17 | E5 | ✅ | `messaging-e5.e2e-spec.ts` (`message_id`, redelivery idempotente, suplente/escalamiento); **W** `mensajes-handoff.spec.ts` |
| **QA12** | Aislamiento de comunidad: publicaciones, búsqueda, menciones y notificaciones aplican permisos en consulta y entrega; mencionar no concede acceso | RF37, RF38 / HU18, HU19 | E11 | ✅ | `community-e11.e2e-spec.ts`, `crews-e11.e2e-spec.ts`; reforzado en `prompt-injection.e2e-spec.ts` (QA12), `messaging-e5.e2e-spec.ts`, `governance-e6.e2e-spec.ts`, `missions.e2e-spec.ts` |
| **QA13** | El superempleado no se autoaprueba, no amplía presupuesto, no se otorga permisos, no borra auditoría ni publica a producción sin control | RF39, RF40 / HU20 | E3 | ✅ | `missions-governance-eb.e2e-spec.ts` (`it QA13`), `governance-e6.e2e-spec.ts`, `demo-gerente-digital.e2e-spec.ts`, `piloto-cobranza-p06.e2e-spec.ts` |
| **QA14** | Suspender al coordinador superior y recuperar continuidad sin perder estados; no es punto único de fallo | RF40 / HU20 | E3, E7 | ✅ | `missions-governance-eb.e2e-spec.ts` (`it QA14`: suplente asume, estados persisten, intervención humana) |
| **QA15** | Estructura matricial: cambiar línea o sede no crea ciclos ni otorga permisos no autorizados | RF42, RF46 / HU21, HU22 | E1 | ✅ | `estructura.e2e-spec.ts` (asignación `FUNCIONAL_PRINCIPAL` única, ciclos 400, vigencia/alcance), `dimensiones-d8.e2e-spec.ts` |
| **QA16** | Reorganización: mover un equipo conserva historia, transfiere pendientes y no altera la atribución de resultados pasados | RF46 / HU21 | E1 | ✅ | `estructura.e2e-spec.ts` (`QA16`: historial y atribución pasada estables) |

> **Nota — «QA24» (consolidación económica)** aparece citada en el backlog de E9 pero **no está en la lista oficial
> QA01-QA16**. Se cubre dentro de QA05/HU24 (`imputacion-e9.e2e-spec.ts` + `finanzas.spec.ts`): un gasto compartido reparte
> el 100 % y aparece una sola vez en el total empresarial. Numeración inconsistente ya reportada al dueño del backlog.

**Resultado QA: 16/16 puertas construibles verificadas por e2e de API (+ W donde aplica).** La única puerta que la
auditoría dejaba abierta (QA02) quedó cerrada con `prompt-injection.e2e-spec.ts`.

---

## 2. Matriz de historias HU01-HU24

| HU | Criterio de aceptación (resumen) | Tipo | Épica | Estado | Prueba(s) real(es) verificada(s) |
|---|---|---|---|---|---|
| **HU01** | Consultar recurso de B sin permiso → API deniega, sin contenido ni metadatos | API | E1 | ✅ | `isolation.e2e-spec.ts` |
| **HU02** | Configurar agente desde un cargo; sin campo de activación → publicar falla | API+U | E2 | ✅ | `agent-lifecycle.e2e-spec.ts` («no se puede publicar sin responsable») |
| **HU03** | Prueba crítica fallida bloquea publicación; versión aprobada registra actor/fecha/resultado | API | E2/E10 | ✅ | `agent-lifecycle.e2e-spec.ts`, `agent-access.e2e-spec.ts` (bloqueo por evaluación/override), `training.e2e-spec.ts` (puerta de publicación) |
| **HU04** | Tarea recibe id y estado, conserva entradas, permite ver ejecución/costo/evidencia | API+W | E4 | ✅ | `results-e4.e2e-spec.ts`; **W** `mi-trabajo.spec.ts`, `trabajo-resultados.spec.ts` |
| **HU05** | Revisor recibe salida autorizada; error de contrato bloquea el siguiente paso y crea excepción | API+W | E5/E7 | ✅ | `results-e4.e2e-spec.ts`, `messaging-e5.e2e-spec.ts`, `durability-e7.e2e-spec.ts` (bandeja de excepciones); **W** `excepciones.spec.ts` |
| **HU06** | Aprobar habilita solo esa operación y su vigencia; cambiar destinatario exige nueva aprobación | API+W | E6 | ✅ | `governance-e6.e2e-spec.ts`, `governance-e6-acciones-sensibles.e2e-spec.ts`; **W** `aprobaciones.spec.ts` |
| **HU07** | Respuesta incluye fuente y versión; no cita documentos fuera del acceso; declara falta de evidencia | API | E8 | ✅ | `agent-knowledge-memory.e2e-spec.ts`, `prompt-injection.e2e-spec.ts` |
| **HU08** | La pasarela verifica permisos y registra confirmación externa; tool no habilitada se bloquea; idempotencia | API | E8 | ✅ | `connectors-security.e2e-spec.ts` (ámbito, secretos, SSRF, ReDoS), `durability-e7.e2e-spec.ts` (idempotencia), `prompt-injection.e2e-spec.ts` |
| **HU09** | Reanudar desde el último estado seguro y conciliar escritura incierta antes de repetir | API | E7 | ✅ | `schedule-reconcile.e2e-spec.ts`, `durability-e7.e2e-spec.ts` |
| **HU10** | Suspensión bloquea nuevos despachos y muestra operaciones externas ya enviadas a conciliar | API+W | E6 | ✅ | `governance-e6.e2e-spec.ts`; **W** `aprobaciones.spec.ts` (suspensión de emergencia) |
| **HU11** | Dos tareas concurrentes no superan el saldo reservado; panel separa costo estimado de medido | API+W | E9 | ✅ | `budgets.e2e-spec.ts` (tope duro, estimado/medido), reserva en `action-gateway.service`; **W** `finanzas.spec.ts` |
| **HU12** | Inicio gerencial: filtros respetan alcance; indicadores abren las tareas que explican cada cifra | W+API | E10/E12 | ✅ | `consolas-e12.e2e-spec.ts`, `indicadores-e10.e2e-spec.ts`; **W** `consola-gerencial.spec.ts` |
| **HU13** | Horario respeta zona definida; evento duplicado no genera otra tarea de negocio | API | E7 | ✅ | `schedule-reconcile.e2e-spec.ts` (zona horaria), `durability-e7.e2e-spec.ts` (dedup) |
| **HU14** | Tarea solo se completa al cumplir el criterio; devolución conserva versión y motivo | API+W | E4 | ✅ | `results-e4.e2e-spec.ts`; **W** `mi-trabajo.spec.ts` (devolución conserva motivo) |
| **HU15** | Sin evidencia o validación negativa no se acepta la misión aunque el ejecutor afirme terminar | API+U | E4 | ✅ | `results-e4.e2e-spec.ts`, `validacion.service.spec.ts`, `validacion.rules.spec.ts` |
| **HU16** | Una meta desciende por niveles y consolida sin duplicar indicadores ni perder responsables | API | E3 | ✅ | `hierarchy-e3.e2e-spec.ts`, `missions-governance-eb.e2e-spec.ts` |
| **HU17** | Cada asignación tiene confirmación y plazo; la falta de respuesta activa suplencia/escalamiento | API+W | E5 | ✅ | `messaging-e5.e2e-spec.ts`; **W** `mensajes-handoff.spec.ts` (recibir/aceptar, devolución con motivo) |
| **HU18** | Publicación de apoyo se vincula a tarea autorizada; sus comentarios no alteran permisos ni estados | API+W | E11 | ✅ | `community-e11.e2e-spec.ts`; **W** `comunidad.spec.ts` (autor humano vs. digital) |
| **HU19** | Un comentario no cambia la base oficial; incorporar exige revisión, fuente y versión | API | E11 | ✅ | `community-e11.e2e-spec.ts`, `crews-e11.e2e-spec.ts` (moderación avanzada = refinamiento menor) |
| **HU20** | El superempleado detecta dependencia vencida, propone recuperación y escala fuera de su autoridad | API+W | E3 | ✅ | `missions-governance-eb.e2e-spec.ts`, `demo-gerente-digital.e2e-spec.ts`; **W** `mi-trabajo.spec.ts` (supervisión). *Habilitación operativa por etapas (ADR 0016 Inc.2-5) = (B).* |
| **HU21** | Crear empresa, dos líneas, área compartida, departamento, equipo y sede sin duplicar entidades | API+W | E1 | ✅ | `estructura.e2e-spec.ts`, `dimensiones-d8.e2e-spec.ts`; **W** `estructura-dimensiones.spec.ts`, `organigrama.spec.ts` |
| **HU22** | Un empleado atiende dos líneas con asignaciones vigentes; cada tarea conserva responsable/prioridad/permisos | API | E1 | ✅ | `estructura.e2e-spec.ts` (asignación matricial con alcance y vigencia) |
| **HU23** | El gerente consulta resultados de su línea y servicios recibidos; no accede fuera de su alcance | API+W | E1/E12 | ✅ | `consolas-e12.e2e-spec.ts`, `isolation.e2e-spec.ts`; **W** `consola-gerencial.spec.ts` |
| **HU24** | Una ejecución compartida reparte el 100 % del costo y aparece una sola vez en el total | API+W | E9 | ✅ | `imputacion-e9.e2e-spec.ts`; **W** `finanzas.spec.ts` (consolidación económica) |

**Resultado HU: 24/24 cubiertas.** Las HU que exigían recorrido de navegador (HU04, HU05, HU06, HU10, HU11, HU12, HU14,
HU17, HU18, HU20, HU21, HU23, HU24) tienen ahora su Playwright, además de la cobertura API.

---

## 3. Mapa de suites por épica E1-E14 (estado real)

> Invariantes de seguridad que toda suite P0 ejercita: **(S1)** aislamiento por `workspaceId` de `@CurrentAuth()`;
> **(S2)** denegación por defecto (`@MinRole`); **(S3)** contenido externo = dato no confiable (QA02); **(S4)**
> credenciales solo por bóveda; **(S5)** mutadores idempotentes; **(S6)** auditoría inmutable.

| Épica | Suites reales (API) | Recorridos W | Puertas | Estado |
|---|---|---|---|---|
| **E1 · Estructura empresarial** | `estructura.e2e-spec.ts`, `dimensiones-d8.e2e-spec.ts`, `isolation.e2e-spec.ts` | `estructura-dimensiones.spec.ts`, `organigrama.spec.ts` | QA01, QA15, QA16 | ✅ |
| **E2 · Empleado digital** | `agent-lifecycle.e2e-spec.ts`, `agent-access.e2e-spec.ts`, `agent-studio.e2e-spec.ts` | `agent-chat.spec.ts` | HU02, HU03 | ✅ |
| **E3 · Jerarquía de dirección digital** | `hierarchy-e3.e2e-spec.ts`, `missions-governance-eb.e2e-spec.ts`, `demo-gerente-digital.e2e-spec.ts` | `organigrama.spec.ts`, `mi-trabajo.spec.ts` | QA10, QA13, QA14 | ✅ |
| **E4 · Trabajo por resultados** | `results-e4.e2e-spec.ts` + U `validacion.*`, `incumplimientos.sweep`, `pasaporte.composer` | `trabajo-resultados.spec.ts`, `mi-trabajo.spec.ts` | QA09 | ✅ |
| **E5 · Colaboración y handoff** | `messaging-e5.e2e-spec.ts` | `mensajes-handoff.spec.ts` | QA11 | ✅ |
| **E6 · Gobierno de acciones** | `governance-e6.e2e-spec.ts`, `governance-e6-acciones-sensibles.e2e-spec.ts` | `aprobaciones.spec.ts` | QA03, QA07, QA08 | ✅ |
| **E7 · Durabilidad avanzada** | `durability-e7.e2e-spec.ts`, `schedule-reconcile.e2e-spec.ts` + U `fault`/sweep | `excepciones.spec.ts` | QA04, QA06 | ✅ |
| **E8 · Conocimiento y herramientas** | `prompt-injection.e2e-spec.ts`, `connectors-security.e2e-spec.ts`, `parametros-ejecucion-e8.e2e-spec.ts`, `agent-knowledge-memory.e2e-spec.ts` | `estaciones-ejecucion.spec.ts` | QA02, QA12 | ✅ (RPA = expansión, no P0) |
| **E9 · Costos e imputación** | `budgets.e2e-spec.ts`, `budgets-p01-p11c.e2e-spec.ts`, `imputacion-e9.e2e-spec.ts` | `finanzas.spec.ts` | QA05, QA24 | ✅ |
| **E10 · Indicadores y evaluación** | `indicadores-e10.e2e-spec.ts`, `training.e2e-spec.ts` | `consola-gerencial.spec.ts` | — | ✅ |
| **E11 · Comunidad interna** | `community-e11.e2e-spec.ts`, `crews-e11.e2e-spec.ts` | `comunidad.spec.ts`, `cuadrillas.spec.ts` | QA12 | ✅ (moderación avanzada = refinamiento) |
| **E12 · Consolas y experiencia** | `consolas-e12.e2e-spec.ts` | `consola-gerencial.spec.ts`, `mi-trabajo.spec.ts`, `aprobaciones.spec.ts`, `accessibility.spec.ts` | — | ✅ |
| **E13 · Plataforma / RNF** | `audit-e13.e2e-spec.ts`, `data-protection.e2e-spec.ts`, `juridica-retencion-p02.e2e-spec.ts`, `crypto-rotation.e2e-spec.ts` | `auditoria.spec.ts` | — | ✅ |
| **E14 · Canales externos** | `channels-e14.e2e-spec.ts`, `channels-e14-gmail.e2e-spec.ts`, `channels-e14-whatsapp.e2e-spec.ts`, `channels-voz-e14.e2e-spec.ts`, `correo-controles-e14.e2e-spec.ts`, `grabacion-config-e14.e2e-spec.ts`, `piloto-correo-interno-e14.e2e-spec.ts` | (canales/voz sandbox) | QA02, QA03, QA04, QA12 | ✅ **sandbox** · activación real = (B) |

> **Compuerta de cumplimiento (ADR 0020):** `matriz-cumplimiento-p13.e2e-spec.ts`, `compliance-seed-p13.e2e-spec.ts`; **W**
> `cumplimiento.spec.ts`. Construido y probado como **asesor (no bloqueante)**; modo bloqueante y validación sectorial = (B).
> **Piloto de cobranza:** `piloto-cobranza-p06.e2e-spec.ts` (ejecutado en sandbox); el **go/no-go de producción = (B)**.

---

## 4. Lo que espera activación (categoría B) — no es brecha de prueba construible

> Tomado de la sección 6 de `auditoria-cierre-epicas-2026-11-04.md`. Todos estos ítems tienen su construcción terminada
> (sandbox/gated) **y probada**; esperan exclusivamente una decisión del patrocinador o de un área. **No cuentan como
> cobertura de prueba faltante.**

| Ítem | Qué espera | Evidencia de construcción probada |
|---|---|---|
| Activación productiva de correo (M365/Gmail) | Autorización por canal/empresa + credenciales por bóveda | `channels-e14-gmail.e2e-spec.ts`, `correo-controles-e14.e2e-spec.ts`, `piloto-correo-interno-e14.e2e-spec.ts` (controles GATED inertes) |
| Activación productiva de WhatsApp (Meta/Twilio) | Contratación + cuenta/número + credenciales | `channels-e14-whatsapp.e2e-spec.ts` (sandbox) |
| Voz productiva / servicios pagos | Autorización de alcance + presupuesto de gasto | `channels-voz-e14.e2e-spec.ts`, `grabacion-config-e14.e2e-spec.ts` (simulado + stubs) |
| Umbrales de Finanzas por empresa/moneda | Definición de Finanzas | `budgets.e2e-spec.ts` (doble aprobación + umbrales en NULL construidos) |
| Política jurídica (grabación real, retención, valor probatorio) | Validación de Jurídica | `juridica-retencion-p02.e2e-spec.ts`, `grabacion-config-e14.e2e-spec.ts` (grabación off + retención configurable) |
| Validación sectorial de Cumplimiento + modo bloqueante | Validación por jurisdicción/sector | `matriz-cumplimiento-p13.e2e-spec.ts`, `compliance-seed-p13.e2e-spec.ts` (motor + consola, modo asesor) |
| Habilitación operativa del coordinador (ADR 0016 Inc.2-5) | Activación por etapas (7 decisiones ya ratificadas 2026-11-03) | `missions-governance-eb.e2e-spec.ts` (integración E-B GATED) |
| Go/no-go del piloto de cobranza | Decisión de negocio sobre criterios de producción | `piloto-cobranza-p06.e2e-spec.ts` (piloto sandbox ejecutado) |

---

## 5. Gates de no-regresión

**Suites que deben permanecer verdes** (ampliar solo aditivamente, sin tocar código de producción): 71 archivos
`apps/api/test/*.e2e-spec.ts` + los `apps/api/src/**/*.spec.ts` y 16 recorridos `apps/web/e2e/*.spec.ts`.

**Definición de terminado por cédula (CLAUDE.md):**
1. **Por app tocada antes de cada push:** API → `npm run typecheck && npm run lint && npm test && npm run build`
   (e2e con BD aislada); Web → `npm run build && npm run test:ci` (sin warnings NG8113; Karma necesita `CHROME_BIN`).
2. **Determinismo:** BD de prueba aislada (`prisma migrate reset --force`), Redis con prefijo dedicado, mocks en
   `127.0.0.1`, sin internet ni LLM reales. `CONNECTOR_ALLOW_PRIVATE_NETWORKS=true` solo en la suite que lo requiera,
   con una prueba explícita en `false` para SSRF.
3. **Cada bug corregido lleva una prueba que lo reproduce;** un fallo esperado se reporta al dueño, no se silencia.

---

## 6. Brechas construibles abiertas

**Ninguna.** Tras los fixes A1 (`prompt-injection.e2e-spec.ts`) y A2-A6 (`aprobaciones`, `mi-trabajo`, `finanzas`,
`cumplimiento`, `mensajes-handoff`, `excepciones`), las 16 puertas QA construibles están verificadas por e2e de API (más
recorrido W donde la HU lo exige) y las 24 HU están cubiertas. El resto es **categoría (B)**: activación / gasto /
validación externa, con la construcción terminada y probada. **Construido ≠ activado productivamente.**
</content>
</invoke>
