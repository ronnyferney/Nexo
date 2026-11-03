# Plan de ejecución priorizado — NEXO (2026-11-03)

> Responde a los lineamientos del patrocinador (Ing. R. Garzón, 2026-11-03): cumplimiento sectorial, consola de
> cumplimiento, canales en ambiente controlado, evaluación de voz/LLM, ADR 0016 (compuerta E-B) y jurisdicciones.
> Complementa `docs/decisiones-patrocinador-2026-11-02-plan-ejecucion.md` y los ADR.

## 0. Marco de autorización (rige todo el documento)

Autorizado: **construir / configurar / integrar / probar en ambiente controlado**. **NO** autorizado: **gasto adicional**,
**activación de canales reales / envío real**, **credenciales productivas**, **ejecución de acciones productivas o de
alto impacto** sin aprobación humana expresa. Toda capacidad es **configurable por organización** y **reutilizable**
(multiempresa / multisectorial / multijurisdicción), con miras a su comercialización.

## 1. Estado real por componente

| Componente | Estado real hoy | Qué falta (autorizado) |
|---|---|---|
| **Motor de cumplimiento** (ADR 0020) | ✅ Construido y validado. Resolución + validación asesora (no bloqueante). | — |
| **Reglas transversales CO** | ✅ **Activas** (asesoras), sembradas idempotentes por workspace. | — |
| **Reglas sector cobranza (CO)** | 🟡 Catálogo aprobado, **inactivo**. | **Activar** (asesor, CO). |
| **Reglas salud / retail** | 🟡 Propuesta en doc, sin sembrar. | **Preparar catálogos, inactivos** hasta validación. |
| **Jurisdicción Ecuador (EC)** | ⏳ No existe. | **Preparar catálogo, inactivo** hasta revisión jurídica. |
| **Consola web de cumplimiento** | 🔴 No existe (hoy solo API/CLI). | **Construir** (admin de reglas/jurisdicciones/sectores/obligatoriedad/vigencias/auditoría). |
| **Correo corporativo (canal)** | ✅ Sandbox (M365/Gmail simulado). Diseño de controles ✅. | **Desarrollo + pruebas de integración en ambiente controlado** (sin envío real ni credenciales productivas). |
| **Voz / LLM** | ✅ Contrato + stubs (sandbox). Evaluación indicativa ✅. | **Evaluación técnico-económica comparativa** (costos/precisión/latencia/calidad/escalabilidad). Sin gasto. |
| **ADR 0016 Inc.2–5** | ✅ Diseño + pruebas aisladas (1514 verdes). No cableado. | **Compuerta E-B: integración + pruebas controladas.** Habilitación operativa por etapas, tras validación + 7 decisiones. |

## 2. Dependencias

- **Consola de cumplimiento** depende del **motor** (✅) y se beneficia de tener **catálogos cobranza/salud/retail/EC**
  cargados (para administrarlos desde la UI). → Catálogos primero (o en paralelo), consola encima.
- **ADR 0016 E-B** depende de: Inc.1 (✅), motor de gobierno E6 (✅), jerarquía E3 (✅), y de **cerrar las 7 decisiones de
  producto** antes de **habilitar operativamente** (la integración/pruebas controladas pueden avanzar ya).
- **Correo (pruebas de integración)** depende del diseño de controles (✅) y de la pasarela/gobierno E6 (✅); **no** depende
  de credenciales reales (se prueba con el adaptador simulado y, si se requiere, un servidor de correo local tipo Mailpit).
- **Evaluación voz/LLM** es un entregable documental independiente; no bloquea nada.
- **Jurisdicciones (EC)** depende del **motor** (✅) y de la **consola** para su administración cómoda (pero puede
  prepararse como catálogo antes).

## 3. Plan priorizado (olas)

Responsables = roles del equipo (`docs/AGENTS-TEAM.md`): arquitecto (A), backend-plataforma (BP), backend-IA (BIA),
backend-integraciones (BINT), frontend-UI (FUI), QA-API (QA). Todo con «definición de terminado» del repo y migraciones
aditivas.

### Ola 1 — Cumplimiento configurable (sin gasto, bajo riesgo) — **lista para ejecutar**
| Ítem | Resp. | Dependencias | Criterio de aceptación | Entregable |
|---|---|---|---|---|
| **1.1 Activar reglas de cobranza (CO, asesor)** | BP | Motor ✅, seed ✅ | Sembradas activas y acotadas a CO/cobranza; asesoras; idempotentes; multi-tenant; prueba e2e | Seed + prueba |
| **1.2 Preparar catálogos salud y retail (inactivos)** | BP, A | Motor ✅ | Definiciones cargables; **nacen inactivas**; documentadas para validación | Seed + doc |
| **1.3 Preparar catálogo Ecuador (EC, inactivo)** | BP, A | Motor ✅ | Reglas EC inactivas hasta revisión jurídica; alcance por jurisdicción | Seed + doc |

### Ola 2 — Consola de cumplimiento (web) — **prioridad del patrocinador**
| Ítem | Resp. | Dependencias | Criterio de aceptación | Entregable |
|---|---|---|---|---|
| **2.1 CRUD de reglas desde la plataforma** | FUI, BP | Ola 1, API ✅ | Admin de reglas (alcance, campo, tipo, validación, control), **sin intervención técnica**; rol ADMIN | Página web + e2e |
| **2.2 Administración de jurisdicciones/sectores/obligatoriedad/vigencias** | FUI, BP | 2.1 | Gestionar jurisdicción/sector/proceso/riesgo, obligatoriedad y vigencia desde UI | UI + validación |
| **2.3 Activar/inactivar + auditoría** | FUI, BP | 2.1 | Activar/desactivar reglas con registro en auditoría inmutable (E13); vista de cambios | UI + auditoría |

### Ola 3 — Correo en ambiente controlado (sin envío real)
| Ítem | Resp. | Dependencias | Criterio de aceptación | Entregable |
|---|---|---|---|---|
| **3.1 Pruebas de integración del correo (sandbox)** | BINT, QA | Diseño ✅, E6 ✅ | Flujo extremo a extremo con adaptador simulado / Mailpit local; **sin envío real ni credenciales productivas**; lista blanca, límites, aprobación de salientes y kill-switch ejercidos por prueba | Suite de integración |
| **3.2 Endurecer controles de activación (código, apagado)** | BINT | 3.1 | Controles del diseño implementados pero **inertes** hasta autorización; conciliación de salida | Código gated + pruebas |

### Ola 4 — Evaluación voz/LLM (documental, sin gasto)
| Ítem | Resp. | Dependencias | Criterio de aceptación | Entregable |
|---|---|---|---|---|
| **4.1 Evaluación técnico-económica comparativa** | BINT, A | Eval. previa ✅ | Compara costos, precisión, latencia, calidad conversacional, integración, seguridad y escalabilidad; metodología de prueba controlada **cuando se autorice gasto** | `docs/evaluacion-voz.md` v2 + comparativa LLM |

### Ola 5 — ADR 0016 compuerta E-B (integración + pruebas controladas)
| Ítem | Resp. | Dependencias | Criterio de aceptación | Entregable |
|---|---|---|---|---|
| **5.0 Cerrar 7 decisiones de producto** | A + patrocinador | §4 | Las 7 resueltas (recomendación en §4) | Acta de decisiones |
| **5.1 Migración aditiva `MisionEvento` + back-relations** | BP | 5.0 | Aditiva; respeta índices generados; sin romper nada | Migración |
| **5.2 Cablear gobierno del coordinador (E6/E3/schedule-reconciler) — GATED** | BP, A | 5.1 | Integrado pero **no operativo en producción**; acciones de alto impacto exigen aprobación humana; QA10/QA13/QA14 verdes | Código gated + pruebas |
| **5.3 Pruebas controladas de supervisión/escalamiento/compromisos** | QA, BIA | 5.2 | Supervisa, detecta bloqueos, gestiona compromisos, escala por jerarquía; **no autoaprueba, no amplía permisos/presupuesto, no ejecuta alto impacto** sin humano | Suite controlada |
| **5.4 Habilitación operativa por etapas** | — | 5.3 + validación | **Requiere autorización humana por etapa** | (diferido a su visto bueno) |

## 4. Las 7 decisiones de producto del ADR 0016 — recomendación técnica

| # | Decisión | Recomendación técnica | Por qué |
|---|---|---|---|
| 1 | **Ubicación del módulo** (`modules/missions` nuevo vs dentro de `results/`) | **Módulo `missions` nuevo** | Aísla la coordinación transversal, evita acoplar `Objetivo`/`Tarea`, facilita pruebas y modularidad para comercialización. |
| 2 | **Rol/nivel mínimo** (crear/autorizar misiones; ser coordinador) | Crear/autorizar misión = **ADMIN** (o nivel GERENTE+); coordinador = nivel **SUPEREMPLEADO**, **nunca por debajo** de los agentes que supervisa. Configurable por workspace. | Evita jerarquía invertida y ciclos; respeta E3; parametrizable por organización. |
| 3 | **Alcance inter-empresa del coordinador** | **Intra-empresa por defecto**; inter-empresa (grupo) **solo opt-in con autorización explícita**, acotado por aislamiento (ADR 0011/0007). | Multiempresa es clave para comercialización, pero cruzar empresas debe ser gobernado y deliberado, no implícito. |
| 4 | **Presupuesto de misión** | **Sin bolsa propia ahora**: la misión **agrega** (consolida) el presupuesto de objetivos/tareas por área. El coordinador **no** mueve ni amplía presupuesto (QA13). | No duplica el control de costos existente; bolsa propia = fase posterior con autorización de gasto. |
| 5 | **`LOGRADA` automática vs humana** | El sistema **propone `LOGRADA`** al cumplirse la condición verificable; **confirma el dueño humano**. | Coherente con «resultado de negocio ≠ producto intermedio»; mantiene control humano del cierre. |
| 6 | **Pasaporte de misión** | **Pasaporte por resultado (ADR 0014) como base**; **pasaporte de misión encadenado solo opt-in para sectores regulados**. | Evita sobrecarga universal; reutiliza lo existente; se activa donde el sector lo exige. |
| 7 | **Versionado de la forma JSON** (`alcance`/`payload`) | Incluir **`schemaVersion`** desde el inicio; cambios = **migración aditiva con upcasting**; lectura tolerante a versiones. | Evita romper JSON persistido; misma disciplina de migraciones del repo. |

> Estas recomendaciones se presentan para su **ratificación/ajuste**. Hasta cerrarlas, la Ola 5 avanza solo en
> integración + pruebas controladas (sin habilitación operativa).

## 5. Guardarraíl (multiempresa / multisectorial / multijurisdicción)

- Toda regla, política, jurisdicción y canal = **dato configurable por workspace**, nunca `if (empresa===…)` ni
  `if (sector===…)`.
- Reutilizar puertos existentes (ConnectorAdapter, LlmProvider/Driver, NodeExecutor, ChannelAdapter) y catálogos.
- Cada PR se revisa contra este guardarraíl; si una funcionalidad solo sirve a una empresa/proceso, se rediseña como
  configuración transversal. Objetivo: **reutilizable para comercialización**.

## 6. Qué NO cambia sin su autorización expresa

Gasto adicional · envío real de correo/WhatsApp/voz · credenciales productivas · habilitación operativa del coordinador
(Inc.2–5) · modo bloqueante de cumplimiento · activación de reglas de salud/retail/EC.
