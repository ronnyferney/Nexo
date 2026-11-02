# Decisiones del patrocinador (2026-11-02) y plan de ejecución priorizado

> Registro de los lineamientos del patrocinador (Ing. Ronny Garzón) para NEXO, el mapeo de **implementado vs.
> pendiente** y el **plan de ejecución priorizado**. Complementa `docs/estado-nexo-decisiones-evidencia.md`,
> `docs/backlog-organizacion-digital.md` y los ADR.

## 0. Marco de autorización (rige todo este documento)

Las autorizaciones de este documento son de **construir / configurar / diseñar / evaluar en entornos controlados**.
**NO** constituyen: aprobación de **gastos**, **contratación** de servicios, **activación de ambientes productivos**,
**activación de canales reales** ni **grabación de conversaciones reales**. **Presupuesto externo del piloto = US$ 0**
(solo recursos ya disponibles). Credenciales **solo por la bóveda de secretos**, nunca por chat.

## 1. Lineamientos del patrocinador (registro)

1. **Finanzas:** presupuestos configurables por **organización, empresa, área y agente**, con alertas **80 % / 90 % /
   100 %**. Al **100 % → bloqueo** de consumos, salvo autorización expresa. **Degradación automática** a modelos más
   baratos: **solo para procesos no críticos** y **previa validación de impacto**. **Piloto: US$ 0 externo**; el
   presupuesto productivo se definirá luego con consumos reales proyectados.
2. **Jurídica:** retención **preliminar de 180 días** para conversaciones ordinarias (sujeta a validación jurídica).
   Políticas **diferenciadas por organización, canal y tipo de información** (conservación de evidencias, trazabilidad,
   consentimiento, eliminación segura). **No se autoriza grabación real** hasta validación jurídica. Exportables firmados:
   **integridad, autenticidad y trazabilidad**, **sin presumir valor probatorio**.
3. **Cumplimiento:** aprobado **conceptualmente** avanzar con una **matriz configurable** por jurisdicción, sector,
   proceso y nivel de riesgo. Antes de aprobación definitiva, presentar **campos obligatorios, reglas de validación y
   controles de protección de datos**. NEXO **multisectorial** (no limitado a transporte/cobranza).
4. **Voz:** autorizada la **evaluación técnica** de Amazon Connect, Google y otras, **en entornos controlados y sin
   gasto**. Selección sustentada en **costos, latencia, calidad conversacional, integración, seguridad y escalabilidad**.
   Cualquier presupuesto adicional requiere autorización previa.
5. **ADR 0016 (Superempleado):** **Inc.1 ratificado**. **Inc.2–5**: pueden avanzar en **diseño funcional, arquitectura y
   pruebas aisladas**; su **implementación operativa** va a **revisión por etapas**. Capacidades: coordinación
   transversal, seguimiento de compromisos, detección de bloqueos, escalamiento y **supervisión** de otros agentes,
   **respetando jerarquía y permisos**. **Acciones de alto impacto e irreversibles → autorización humana.**
6. **Piloto de cobranza:** autorizado **en sandbox con datos sintéticos**, sin gasto ni interacción con clientes reales.
   Medir mínimo: **precisión, cumplimiento del proceso, trazabilidad, gestión de excepciones, tiempos de respuesta,
   efectividad de escalaciones**. Antes de producción: **informe de resultados** con criterios de aceptación y riesgos.
7. **Canales reales:** **NO autorizada** la activación productiva de correo/WhatsApp/voz. Se **priorizará el correo
   corporativo** como primer canal real (luego), inicialmente con **destinatarios internos autorizados, permisos
   restringidos, trazabilidad completa, límites operativos y desactivación inmediata**. Credenciales **por bóveda**.

**Lineamiento estratégico:** NEXO es una plataforma **multiempresa, multiagente y multisectorial**. Gobierno,
presupuestos, cumplimiento, seguridad, auditoría y automatización deben ser **transversales, configurables y
reutilizables**. **Prohibido** construir funcionalidades particulares que comprometan la escalabilidad o aten NEXO a un
proceso o empresa.

## 2. Implementado vs. pendiente (por decisión)

| # | Decisión | Ya implementado | Pendiente (autorizado por este documento, sin gasto) |
|---|---|---|---|
| 1 | Finanzas | Bolsas por empresa/línea/período; `assertCanSpend`; **bloqueo** y **degradación**; alertas `BudgetAlert`; libro mayor atómico; consola de costos. | Parametrizar **3 umbrales 80/90/100**; **nivel agente** y **área** explícitos; **marca de "proceso no crítico"** para habilitar degradación + registro de **validación de impacto**; **preset de piloto US$ 0** (proveedor mock). |
| 2 | Jurídica | `data-protection` (retención configurable `conversationRetention`, enmascarado/bloqueo PII); `GrabacionConfig` (grabación/retención, sandbox, **off**). | Fijar **retención 180 d**; **políticas diferenciadas por organización/canal/tipo**; integridad/trazabilidad del **exportable firmado** (sin valor probatorio presumido); mantener **grabación real OFF**. |
| 3 | Cumplimiento | Pasaporte de resultado verificable (hash, lookup por contrato); propuesta de matriz en `matriz-cumplimiento-campos.md`. | **Motor de matriz configurable** (jurisdicción/sector/proceso/riesgo) **multisectorial**; **presentar campos obligatorios + reglas de validación + controles de protección** para aprobación definitiva. |
| 4 | Voz | Contrato `VoiceProvider` (4 capas) + adaptador simulado + stubs Connect/Google (sandbox, sin gasto). | **Evaluación técnica comparativa** (costos/latencia/calidad/integración/seguridad/escalabilidad) en entorno controlado; informe de selección. |
| 5 | ADR 0016 | **Inc.1** coordinación transversal (seguimiento, bloqueos, escalamiento) construido y ratificado. | **Inc.2–5: diseño funcional + arquitectura + pruebas aisladas**; implementación operativa por **etapas con revisión**; alto impacto/irreversible → **autorización humana**. |
| 6 | Piloto cobranza | Ficha definitiva + **seed sandbox** (datos sintéticos). | **Ejecutar el piloto** en sandbox; **instrumentar métricas** (precisión, cumplimiento, trazabilidad, excepciones, tiempos, escalaciones); **informe** con criterios de aceptación y riesgos. |
| 7 | Canales reales | Correo (M365+Gmail), WhatsApp (Meta+Twilio), voz: **todo en sandbox**; suspensión/kill-switch y auditoría existentes. | **Diseño de controles de activación de correo** (destinatarios internos, permisos restringidos, límites, trazabilidad, **desactivación inmediata**, bóveda) **listo para cuando se autorice**; **sin activar**. |

## 3. Plan de ejecución priorizado

Responsables = roles del equipo (`docs/AGENTS-TEAM.md`): arquitecto (A), backend-plataforma (BP), backend-IA (BIA),
backend-integraciones (BINT), frontend-UI (FUI), QA-API (QA), QA-E2E (QE). Todo con la «definición de terminado» del
repo (permisos, aislamiento, auditoría, consumo, errores/recuperación, pruebas) y **migraciones aditivas**.

### P0 — Habilita el piloto de cobranza (sin gasto)
| Ítem | Resp. | Dependencias | Criterio de aceptación | Entregable |
|---|---|---|---|---|
| **1a. Presupuestos: 3 umbrales + bloqueo 100 % + nivel agente/área** | BP, FUI | Base de presupuestos | Alertas a 80/90/100 %; al 100 % bloquea salvo autorización; configurable por org/empresa/área/agente | Config + UI + pruebas |
| **1b. Preset piloto US$ 0 (proveedor mock, sin consumo externo)** | BP | 1a | El piloto corre sin generar costo externo; consumo medido = 0 | Preset + evidencia |
| **2a. Retención 180 d + políticas diferenciadas (org/canal/tipo); grabación OFF** | BP, FUI | `data-protection` | Retención configurable aplicada; grabación real deshabilitada | Config + UI + pruebas |
| **6a. Ejecutar piloto cobranza en sandbox (datos sintéticos)** | QA, BIA | Ficha + seed | Recorrido extremo a extremo sin gasto ni datos reales | Corrida + trazas |
| **6b. Instrumentar métricas del piloto** | QA, BP | 6a | Mide precisión, cumplimiento, trazabilidad, excepciones, tiempos, escalaciones | Tablero/informe |
| **6c. Informe de resultados del piloto** | A, QA | 6a/6b | Criterios de aceptación + riesgos; go/no-go a producción | `docs/informe-piloto-cobranza.md` |

### P1 — Capacidades transversales (diseño/construcción sin gasto)
| Ítem | Resp. | Dependencias | Criterio de aceptación | Entregable |
|---|---|---|---|---|
| **3a. Motor de matriz de cumplimiento configurable (multisectorial)** | A, BP | Pasaporte | Reglas por jurisdicción/sector/proceso/riesgo, sin lógica hardcodeada de un sector | ADR + esquema + API |
| **3b. Presentar campos obligatorios + reglas + controles de protección** | A | 3a | Documento para **aprobación definitiva** del patrocinador | `docs/matriz-cumplimiento-campos.md` (v2) |
| **5a. ADR 0016 Inc.2–5: diseño funcional + arquitectura + pruebas aisladas** | A, BIA | Inc.1 | Diseño y pruebas aisladas sin implementación operativa; alto impacto → aprobación humana | ADR 0016 (actualizado) + pruebas |
| **4a. Evaluación técnica de voz (controlada, sin gasto)** | BINT, A | Stubs voz | Comparativa costos/latencia/calidad/integración/seguridad/escalabilidad | `docs/evaluacion-voz.md` |
| **1c. Degradación solo "no crítico" + validación de impacto** | BP | 1a | Degradación gated por criticidad + registro de impacto validado | Config + pruebas |

### P2 — Requiere autorización específica del patrocinador (no se ejecuta aún)
| Ítem | Resp. | Qué espera | Entregable listo |
|---|---|---|---|
| **7. Activación de correo corporativo** | BINT, BP | Autorización + parámetros (empresa, buzón, responsable, destinatarios internos, límites) + credenciales por bóveda | Diseño de controles de activación/desactivación |
| **Presupuesto productivo / voz paga** | — | Autorización de gasto | Propuesta cuantificada |
| **ADR 0016 Inc.2–5 operativo** | — | Revisión por etapas | Diseño aprobado |

## 4. Guardarraíl de arquitectura (multisectorial / multiempresa)

- Toda capacidad nueva es **configurable por workspace** (organización) y **tipada por catálogo/política**, no por
  `if (empresa === ...)` ni `if (sector === ...)`.
- Reutilizar los puertos existentes (ConnectorAdapter, LlmProvider/Driver, NodeExecutor) y los catálogos declarativos.
- La matriz de cumplimiento, los presupuestos y las políticas se definen como **datos configurables**, no como código
  específico de un cliente.
- Revisión de cada PR contra este guardarraíl: si una funcionalidad solo sirve a una empresa/proceso, se rediseña como
  configuración transversal.
