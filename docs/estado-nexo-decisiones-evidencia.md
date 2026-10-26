# NEXO — Estado, decisiones y evidencia (2026-10-26)

> Responde al mensaje de decisiones del patrocinador **Ronny Ferney Garzón Silva**. Distingue lo **DECIDIDO en ese
> mensaje**, lo **PROPUESTO** y lo **PENDIENTE**. Ninguna integración productiva, contratación o gasto se activa con base
> en este documento; lo que requiere autorización se marca por separado (sección E).

## 0. Rama y commit (evidencia de versión)
- **Rama:** `claude/ia-agents-api-connectors-ydds00`
- **Último commit:** `d6f83dc` (2026-10-26 16:15 UTC) · 227 commits en la rama.
- **Calidad verificada en esta jornada:** API **1327** pruebas unitarias; e2e por épica en verde (ver matriz §C);
  Web **424** unitarias + **19 recorridos E2E de navegador** (18 escritorio estables en 3 corridas + comunidad; 3 móvil).

## A. Tabla de decisiones (puntos 1–8)

| Punto | Decisión (este mensaje) o pendiente | Trabajo que puedo avanzar YA | Dependencia para producción | Evidencia de aceptación |
|---|---|---|---|---|
| **1. Correo** | DECIDIDO: M365 primero, Gmail alternativa; cuentas/credenciales/permisos **por empresa**. Sin contrataciones/gastos. | Adaptador M365 ya construido (sandbox); extender Gmail por adaptador; cuentas por empresa; registro idempotente. | Credenciales M365 por empresa en bóveda. | Enviar/recibir en sandbox por empresa; cero duplicados; sin credenciales en claro. |
| **2. WhatsApp** | DECIDIDO: arquitectura con **Meta Cloud API directa** (cuenta/número por empresa) **y** proveedores tipo Twilio por adaptador; Twilio **no obligatorio**; Meta como opción explícita. Interfaz común (mensajes/plantillas/archivos/estados/webhooks/errores); aislamiento por empresa. | Contrato común + **adaptador Meta** + **adaptador Twilio** (ambos sandbox/simulado) + interfaz de webhooks. **Presentaré esfuerzo/dependencias/costos de ambas** para elegir cuál habilitar primero. | Cuenta/número y credenciales por empresa (Meta o Twilio). | Piloto sandbox por empresa; webhooks firmados; plantillas; aislamiento de credenciales. |
| **3. Voz/telefonía** | DECIDIDO: arquitectura abierta a **Amazon Connect, Google Cloud y otros** por adaptador. Autorizado **diseño + pruebas técnicas con recursos disponibles, sin gasto**. Antes de servicios pagos → presentar alcance y presupuesto. | Contrato `VoiceProvider` (4 capas) + adaptador(es) stub + simulado; pruebas sin gasto. Criterios: calidad ES, latencia, interrupciones, transferencia a humano, integración, disponibilidad, concurrencia, costo/conversación. | Elegir proveedor por prueba técnica/económica (requiere su aprobación de presupuesto para servicios pagos). | Recomendación sustentada; no implica contratación automática. |
| **4. Candado de internet** | PENDIENTE de elegir alternativa (falta comparación exacta, §D). **Requisito obligatorio DECIDIDO:** ningún agente puede eludir una restricción por no tener estación. Separar navegación web / integraciones empresariales / servicios de IA; accesos vigentes a conservar quedan **autorizados explícitamente y registrados**. | Diagnóstico, diseño y pruebas; **comparación detallada** (§D). Dejo la selección A/B pendiente. | Su selección de alternativa + migración de datos. | Comparación que describa permitir/bloquear, con/sin estación, flujos afectados, migración y pruebas. |
| **5. Finanzas** | DECIDIDO: construir el mecanismo; umbrales/límites/fraccionamiento **pendientes de Finanzas**. Piloto: **doble aprobación humana** para pagos/transferencias. Sin ejecución monetaria autónoma por umbrales supuestos. | Mecanismo de catálogo de acciones sensibles + doble aprobación (ya construido); límites acumulados configurables (sin valores). | Umbrales por empresa/moneda de Finanzas. | Doble aprobación exigida en pagos; umbrales nulos hasta definición. |
| **6. Jurídica** | DECIDIDO: avanzar con **controles configurables + pruebas con datos sintéticos**; sin plazos legales ni valor probatorio automático. Separar: tratamiento en llamadas/grabaciones/transcripciones; retención/eliminación/acceso; condiciones del export firmado. | `GrabacionConfig` por empresa (off por defecto); controles de retención/acceso; export con minimización (mecanismo). | Política jurídica aprobada. | Operar con datos sintéticos, grabación off; controles auditables. |
| **7. Cumplimiento** | DECIDIDO: construir **pasaporte base extensible**; validación por jurisdicción/sector/caso **pendiente**. No presentarlo como certificado sin evidencia. | Perfil base del pasaporte (ya construido) + puntos de extensión por sector. | Validación de Cumplimiento por sector. | Pasaporte base verificable; sin sello de conformidad regulatoria. |
| **8. Evidencia** | Entregable: este documento (rama/commit, matriz de estados, evidencia de pruebas, defectos, dependencias). | — | — | Este documento + §C/§D/§F. |

## B. Lo DECIDIDO que habilita construcción inmediata (sin gasto)
1. **Correo (1):** extender a Gmail por adaptador; cuentas por empresa. 
2. **WhatsApp (2):** contrato común + **adaptador Meta Cloud API** + **adaptador Twilio**, ambos en sandbox; interfaz de webhooks; **comparativa de esfuerzo/costo** de ambas vías.
3. **Voz (3):** contrato `VoiceProvider` + adaptador simulado + stubs Connect/Google; pruebas sin gasto.
4. **Candado de internet (4):** diagnóstico + diseño + **comparación detallada** (§D) + pruebas; selección A/B pendiente.
5. **Finanzas (5):** mecanismo + doble aprobación por defecto (ya está); límites configurables sin valores.
6. **Jurídica (6):** `GrabacionConfig` + controles de retención/acceso + export minimizado; pruebas con datos sintéticos.
7. **Cumplimiento (7):** pasaporte base extensible (ya está) + puntos de extensión por sector.

## C. Matriz de requisitos — estado y evidencia
Estados: **IMPLEMENTADO** (código) · **PROBADO** (unit/e2e) · **SIMULADO** (sandbox, sin proveedor real) · **PENDIENTE**.

| Requisito (del CEO) | Estado | Evidencia (módulo / prueba) |
|---|---|---|
| **Resultados verificables** (contrato de resultado, verificador ≠ ejecutor, evidencia) | IMPLEMENTADO + PROBADO | `modules/results/*`; e2e `results-e4`, `pasaporte-e14`; web `features/trabajo` |
| **Comunicación entre agentes** (mensajes/eventos persistentes, handoff ligado a misión/tarea) | IMPLEMENTADO + PROBADO | `modules/messaging/*` (handoff, delegacion.rules); e2e `messaging-e5`; web `features/mensajes` |
| **Jerarquía digital** (línea de mando, sin ciclos, coherencia de nivel, no concede acceso) | IMPLEMENTADO + PROBADO | `modules/hierarchy/*`; e2e `hierarchy-e3`; web `features/organigrama` |
| **Empresas / líneas de negocio / áreas / sedes / centros de costo** (dimensiones) | IMPLEMENTADO + PROBADO | `modules/governance/estructura` + `dimensiones`; e2e `estructura`, `dimensiones-d8`; web `features/admin/estructura` |
| **Comunidad corporativa** (muro: novedades/apoyo/aprendizajes/compromisos) | IMPLEMENTADO + PROBADO (unit+e2e+E2E navegador) | `modules/community/*`; e2e `community-e11`; web `features/comunidad`; `e2e/comunidad.spec.ts` |
| **Superempleado digital** (coordinación transversal de resultados) | **PARCIAL / PENDIENTE** | El nivel `SUPEREMPLEADO` existe en la jerarquía (`NivelJerarquico`); la **coordinación transversal automática** como capacidad distinta **no está construida**. Propuesto como incremento. |
| Gobierno (políticas, aprobaciones, doble aprobación, suspensión, acciones sensibles, riesgo) | IMPLEMENTADO + PROBADO | `modules/governance/actions/*`; e2e `governance-e6`, `governance-e6-acciones-sensibles` |
| Auditoría inmutable encadenada por hash + visor | IMPLEMENTADO + PROBADO | `modules/audit/*`; e2e `audit-e13`; web `features/auditoria` |
| Imputación de costos / indicadores / consola gerencial | IMPLEMENTADO + PROBADO | `modules/governance/imputacion`, `results/indicadores`, `consolas`; e2e `imputacion-e9`, `indicadores-e10`, `consolas-e12` |
| Durabilidad (idempotencia, conciliación, excepciones) | IMPLEMENTADO + PROBADO | `modules/durability/*`; e2e `durability-e7` |
| Pasaporte de resultado (cadena de custodia verificable) | IMPLEMENTADO + PROBADO | `modules/results/pasaporte.*`; e2e `pasaporte-e14` |
| Cuadrillas (plantillas de equipo gobernadas, 100 % declarativas) | IMPLEMENTADO + PROBADO | `modules/crews/*`; e2e `crews-e11`; web `features/cuadrillas` |
| Parámetros de ejecución (estación virtual + salida a internet) + gate en runtime | IMPLEMENTADO + PROBADO | `modules/execution-params/*`; e2e `parametros-ejecucion-e8`; gate en `agent-runtime` |
| **Canales externos — correo (M365)** | IMPLEMENTADO + **SIMULADO** | `modules/channels/*` (adaptador m365 + simulado); e2e `channels-e14`. Envío real **inactivo sin credenciales**. |
| **Canales externos — WhatsApp** | PENDIENTE (autorizado a construir en sandbox) | A construir: interfaz común + adaptador Meta + Twilio (sandbox). |
| **Canales externos — voz** | PENDIENTE (autorizado diseño + pruebas sin gasto) | A construir: contrato `VoiceProvider` + simulado + stubs. |

## D. Candado de internet — comparación para su decisión (requisito obligatorio ya incorporado)
**Requisito obligatorio (decidido):** ningún agente elude la restricción por no tener estación. Las tres categorías
—**navegación web**, **integraciones empresariales**, **servicios de IA**— se gobiernan por separado; los servicios de
IA no son un toggle de usuario (siempre pasan por el runtime y su gobierno propio).

| Criterio | **Opción A — Preservar vigente (recomendada)** | **Opción B — Cierre estricto** |
|---|---|---|
| Qué permite por defecto | Navegación web e integraciones **habilitadas** para los agentes que hoy operan; IA siempre por runtime | Todo **deshabilitado** hasta habilitar explícitamente por agente |
| Qué bloquea | Lo que el equipo restrinja luego, por agente y categoría | Todo egress de red hasta autorización explícita |
| Agente **con estación** (salidaInternet=false) | Bloqueado (se respeta el bloqueo actual) | Bloqueado |
| Agente **sin estación** | **Ya no elude**: queda sujeto a las categorías (habilitadas por el backfill) | **Ya no elude**: queda bloqueado hasta habilitar |
| Flujos existentes afectados | **Ninguno corta** (backfill preserva el comportamiento vigente) | **Pueden cortarse** conectores REST/SOAP/GraphQL/MCP hasta habilitar |
| Migración | Aditiva + backfill (habilita vigentes; respeta bloqueos por estación) — SQL en `docs/correccion-candado-internet.md` | Aditiva (categorías en false) + ventana de habilitación por agente |
| Pruebas | e2e: sin-estación ya no elude; vigentes siguen operando; bloqueo por estación intacto; cada habilitación auditada | e2e: todo bloqueado por defecto; habilitación por agente desbloquea; auditoría |
| Riesgo operativo | Bajo (no corta) | Alto si no hay ventana de revisión |
| Cumple el requisito obligatorio (no elusión) | **Sí** | **Sí** |

> Ambas cumplen el requisito obligatorio. La diferencia es el **impacto operativo inmediato**. Dejo la selección a su
> decisión; mientras tanto avanzo diagnóstico, diseño y pruebas, sin aplicar migración ni cambiar valores de agentes.

## E. Lo que requiere su autorización (gasto / contratación / activación productiva)
| Acción | Tipo | Estado |
|---|---|---|
| Contratar/activar envío real de correo (M365 por empresa) | Activación + credenciales | Requiere su autorización |
| Contratar/activar WhatsApp (Meta o Twilio) | Contratación + credenciales por empresa | Requiere su autorización; antes presento costos de ambas vías |
| Consumir servicios pagos de voz (Connect/Google/otros) | Gasto | Requiere su autorización de **alcance + presupuesto** |
| Aplicar la corrección del candado (migración de datos) | Cambio de comportamiento | Requiere su selección A/B |
| Habilitar ejecución monetaria por umbrales | Riesgo financiero | Requiere umbrales de Finanzas |

## F. Defectos conocidos y limitaciones (transparencia)
1. **Resuelto:** 2 bugs de reactividad de signals (crear estación virtual por UI; estado «sin guardar» de parámetros). Arreglados y cubiertos por E2E.
2. **Prueba flaky:** un test de accesibilidad del diálogo de compartir falla ocasionalmente bajo contención (pasa aislado). No es regresión; mitigable subiendo el límite de alta de usuarios en pruebas.
3. **Entorno de pruebas:** la API viva debe **recompilarse/reiniciarse** al añadir rutas nuevas para verlas (procedimiento documentado); no afecta al código.
4. **Superempleado digital:** la coordinación transversal automática **no está construida** (ver §C).
5. **Canales E14:** todo en **sandbox**; los envíos productivos están **inactivos** (sin credenciales) por diseño.
6. **Chat con LLM real:** requiere `ANTHROPIC_API_KEY`; el entorno usa el proveedor mock determinista.
7. **Firma del export de pasaporte:** hoy usa referencias + hashes + ancla de auditoría; **firma criptográfica** pendiente de gestión de claves.

## G. Próximos pasos autorizados (sin gasto) que inicio ya
- **E14 inc.2:** interfaz común de WhatsApp + adaptador **Meta Cloud API** + adaptador **Twilio** (sandbox) + interfaz de webhooks; comparativa esfuerzo/costo de ambas vías.
- **Voz:** contrato `VoiceProvider` (4 capas) + adaptador simulado + stubs (Connect/Google).
- **Jurídica:** `GrabacionConfig` configurable (off por defecto) + controles de retención/acceso + pruebas con datos sintéticos.
- **Candado de internet:** cerrar el diagnóstico y las pruebas de la comparación (§D), sin aplicar migración.
- **Superempleado digital:** proponer el diseño de la coordinación transversal (ADR) para su aprobación.
