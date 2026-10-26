# NEXO — Plan de cierre de bloqueantes y piloto verificable (2026-10-26)

> Responde a la guía de cierre del patrocinador **Ronny Ferney Garzón Silva**. Distingue cuatro autorizaciones, que
> **no se implican entre sí**: (1) **construir**, (2) **acceso a cuentas/datos**, (3) **gasto**, (4) **activación
> productiva**. Ninguna integración productiva, contratación o gasto se activa con base en este documento. No se
> registran recomendaciones como aprobaciones; no se reabren requisitos ya confirmados.
>
> Evidencia de versión: rama `claude/ia-agents-api-connectors-ydds00`, commit **`4ac7eb3`** (2026-10-26 20:02 UTC), 230 commits.

## 1. Resumen ejecutivo del estado real
- **Núcleo de la organización de empleados digitales: IMPLEMENTADO Y VALIDADO** (backend + web, con pruebas): estructura
  (empresa/línea/área/sede/centro de costo + dimensiones), empleado digital (cargo/responsable/ciclo), **jerarquía/
  organigrama**, **trabajo por resultados** (verificador ≠ ejecutor), **comunicación + handoff**, **gobierno** (políticas,
  aprobaciones, doble aprobación, suspensión, acciones sensibles + riesgo), **durabilidad** (idempotencia, conciliación,
  excepciones), **imputación/indicadores/consola gerencial**, **auditoría inmutable + visor**, **Pasaporte de resultado**,
  **Cuadrillas** y **comunidad interna**.
- **Canales externos (E14): IMPLEMENTADO EN SANDBOX, SIN ENVÍOS REALES.** Correo M365 y WhatsApp (Meta directo + Twilio)
  con contrato común, webhooks firmados, idempotencia; **inactivos sin credenciales** por diseño.
- **Voz:** PROPUESTO (diseño). **Superempleado digital:** PROPUESTO (ADR 0016). **Candado de internet:** parte segura
  lista; cierre de elusión PENDIENTE de su selección A/B.
- **Base de la afirmación "construido y validado":** API 1355 pruebas unitarias + e2e por épica en verde; Web 424
  unitarias + 19 recorridos E2E de navegador (estables). No se usan porcentajes: la trazabilidad requisito→componente→
  prueba está en la matriz §C del documento `docs/estado-nexo-decisiones-evidencia.md` y en §2 de este documento.

## 2. Matriz de decisiones y bloqueantes
Estados: **confirmado** · **propuesto** · **pendiente de validación** · **aprobado** · **implementado** · **validado**.

| ID | Tema | Definición vigente | Estado | Responsable de decidir | Evidencia requerida | Trabajo que puede avanzar |
|---|---|---|---|---|---|---|
| D1 | Correo | M365 primera integración; Gmail alternativa; cuentas por empresa | confirmado (construir) · **pendiente** (acceso/activación) | CEO (acceso/activación) | Buzón piloto + permisos definidos; envío gated por aprobación | Gmail por adaptador; buzón piloto; matriz de permisos; envío simulado gated |
| D2 | WhatsApp | Meta directo **y** Twilio por adaptador; cuenta/número por empresa; Twilio no obligatorio | confirmado (arquitectura) · **propuesto** (Meta 1º) · **pendiente** (acceso/activación) | CEO (cuál 1º + acceso) | Comparativa esfuerzo/costo (ya entregada); onboarding por empresa | Interfaz común + adaptadores Meta/Twilio **ya construidos** (sandbox) |
| D3 | Voz | Abierto a Amazon Connect + Google Cloud + otros; pruebas sin gasto | confirmado (apertura + diseño) · **pendiente de validación** (proveedor) | CEO (presupuesto) + Arquitectura (prueba) | Presupuesto §4; recomendación sustentada | Contrato `VoiceProvider` + simulado + stubs; pruebas sin gasto |
| D4 | Candado internet | No-elusión **obligatoria**; separar navegación/integraciones/IA; A/B por decidir | confirmado (requisito) · **pendiente** (A/B) | CEO (A/B) | Comparación §5; pruebas de bloqueo y continuidad | Diagnóstico + diseño + pruebas; **no** aplicar migración |
| D5 | Superempleado | Coordinación superior confirmada; revisar ADR 0016 | confirmado (requisito) · **propuesto** (diseño) | CEO (aprobar ADR) | ADR 0016 §6 | Trabajo previo reusa E4/E5/E6; Inc.1 depende de aprobar ADR |
| D6 | Finanzas | Construir mecanismo; umbrales pendientes; piloto con doble aprobación de pagos | confirmado (mecanismo) · **pendiente de validación** (umbrales) | Finanzas | Umbrales por empresa/moneda | Mecanismo + doble aprobación **ya construidos**; límites configurables sin valores |
| D7 | Jurídica | Controles configurables + datos sintéticos; sin valor probatorio automático | confirmado (construir) · **pendiente de validación** (política) | Jurídica | Política de tratamiento/retención/export | `GrabacionConfig` + retención/acceso + export minimizado |
| D8 | Cumplimiento | Pasaporte base extensible; validación por sector pendiente | confirmado (base) · **pendiente de validación** (sector) | Cumplimiento | Campos/controles por jurisdicción/sector | Perfil base **ya construido**; puntos de extensión por sector |

## 3. Ficha del piloto propuesto
**Proceso: Gestión de cobranza de cartera vencida (un alcance acotado).** Demuestra el ciclo completo **sin** activar
correo/WhatsApp/voz reales: el "envío" usa el **adaptador simulado** (gobernado y auditado), con **datos sintéticos**.

1. **Empresa / línea / área:** una empresa piloto del grupo · línea "Servicios" · área **Tesorería / Cartera**.
2. **Problema:** facturas próximas a vencer o vencidas requieren gestión de cobro oportuna y trazable.
3. **Resultado esperado y criterio de aceptación:** por cada factura en alcance, una **gestión de cobro preparada,
   aprobada y despachada (simulada)** con evidencia. *Resultado = "gestión completada con evidencia", NO "recaudado":
   el recaudo lo confirma el sistema de negocio, no el agente.* Aceptación: datos correctos, aprobada por Tesorería,
   despachada y registrada; **verificador ≠ ejecutor**.
4. **Responsable humano y participantes:** Jefe de Tesorería (titular) + suplente; analista humano revisor.
5. **Empleados digitales y supervisión:** "Analista de cartera digital" (ejecutor) + "Revisor digital" (verificador) +
   (opcional) superempleado coordinador si se aprueba el ADR 0016. Línea de mando en el organigrama.
6. **Canal inicial y sistemas:** **correo en modo simulado** (sandbox); fuente de facturas = conjunto de prueba.
7. **Datos:** **sintéticos** (facturas ficticias); sin datos reales de clientes.
8. **Permisos y acciones permitidas:** leer la fuente de facturas de prueba; preparar el mensaje; **despachar solo tras
   aprobación**. Sin acceso a sistemas reales de pago ni a datos de otra empresa (aislamiento).
9. **Aprobaciones y límites de autonomía:** el despacho externo (EMAIL_SEND) exige **aprobación de Tesorería** (política
   de E6). No hay pagos en este proceso (es cobro). Ninguna acción monetaria autónoma.
10. **Volumen, duración y costo máximo:** p. ej. **20 facturas sintéticas**, **1–2 semanas**, costo de modelo **tope
    configurable** (en sandbox con proveedor mock = 0). Cifra exacta a confirmar por usted.
11. **Errores y escalamiento:** factura con datos inconsistentes / fuente no disponible / aprobación vencida → **excepción**
    → escalar al responsable humano; reintentos idempotentes.
12. **Detención y revocación:** **suspensión con un clic** (por agente/proceso) y **revocación de accesos**; todo queda
    en la auditoría inmutable; opcional: publicar la novedad del cierre del piloto en la comunidad.

> Esta ficha cubre: empresa/línea/área, jerarquía digital, responsable humano, intake→asignación→ejecución→aprobación→
> verificación→resultado validado→**pasaporte**→**auditoría**→(opcional) comunidad. Sin habilitar canales reales.

## 4. Voz — plan de estimación (NO cotización)
> No se inventan precios. Se entrega el **marco de estimación**, los supuestos y lo que falta cotizar; las cifras se
> completan con tarifas vigentes por región antes de cualquier gasto.

**Caso de uso común para ambas:** atención/seguimiento de cobranza por voz (continuación del piloto), **N** llamadas/día,
duración media **M** minutos, en español, con transferencia a humano.

| Dimensión | Amazon Connect | Google Cloud |
|---|---|---|
| Arquitectura | Connect (telefonía/IVR) + Lex/Polly o STT/TTS + lógica + integración NEXO por adaptador | CCAI / Dialogflow CX + Speech-to-Text/Text-to-Speech + telefonía (partner/SIP) + adaptador NEXO |
| Recursos/config | Instancia Connect, número, flujos, permisos IAM; webhook/Lambda hacia NEXO | Proyecto GCP, agente CCAI, número (partner), credenciales de servicio; webhook hacia NEXO |
| Costo de telefonía | Por minuto entrante/saliente + número | Según partner de telefonía (variable) |
| Costo de conversación | STT/TTS + motor por minuto/solicitud | STT/TTS + CCAI por minuto/solicitud |
| Esfuerzo de integración (separado del consumo) | Adaptador `VoiceProvider` (capa telefonía + STT/TTS + motor) — **a construir en sandbox** | Ídem, adaptador independiente |
| Falta cotizar | Tarifas por minuto/número por región; volumen real | Tarifas del partner de telefonía + CCAI/Speech por región; volumen real |

**Prueba técnica (sin gasto hasta su aprobación):** diseño + simulador + stubs ahora; para la prueba con servicios pagos
se presentará **duración, límite de gasto, alertas, bloqueo de consumo y eliminación de recursos** antes de activar.
**Criterios de selección:** calidad en español, latencia, manejo de interrupciones (barge-in), transferencia a humano,
disponibilidad telefónica, concurrencia, integración con herramientas/aprobaciones de NEXO y **costo por conversación
completada**. La selección se sustenta en los resultados; no implica contratación automática.

## 5. Candado de internet — comparación A/B
Requisito obligatorio (confirmado): **ningún agente elude la restricción por no tener estación**. Se separan tres
categorías: **navegación web**, **integraciones empresariales** y **servicios de IA** (estos últimos no son un toggle de
usuario; pasan siempre por el runtime y su gobierno).

| Criterio | Opción A — preservar vigente (recomendada) | Opción B — cierre estricto |
|---|---|---|
| Por defecto | Navegación e integraciones habilitadas para quien hoy opera; IA por runtime | Todo deshabilitado hasta habilitar por agente |
| Agente con estación (sin internet) | Bloqueado | Bloqueado |
| Agente sin estación | **Ya no elude**: sujeto a categorías (habilitadas por backfill) | **Ya no elude**: bloqueado hasta habilitar |
| Flujos existentes | No se cortan (backfill preserva lo vigente) | Pueden cortarse hasta habilitar |
| Migración | Aditiva + backfill (SQL en `docs/correccion-candado-internet.md`) | Aditiva (categorías en false) + ventana de habilitación |
| Pruebas | No-elusión; continuidad operativa; bloqueo por estación; cada habilitación auditada | No-elusión; todo bloqueado por defecto; habilitación por agente; auditoría |
| Cumple no-elusión | **Sí** | **Sí** |

Ambas cumplen el requisito obligatorio; difieren en impacto operativo inmediato. **No se asume ninguna aprobada.** Se
incluirán pruebas de **bloqueo** y de **continuidad operativa** al implementar la opción elegida.

## 6. ADR 0016 — superempleado digital (resumen y recomendación)
- **Qué define:** el superempleado es un `Agent` de nivel SUPEREMPLEADO con rol de **coordinador** (no ejecutor) de una
  entidad delgada `MisionTransversal` que agrupa, por referencia, objetivos/tareas de varias empresas/áreas.
- **Autoridad/límites:** coordina metas y dependencias entre áreas/líneas; **verifica por evidencia**; **no aprueba sus
  propias excepciones ni amplía permisos/presupuesto**; coordinar **no concede acceso**; respeta AGENTE_NO_CREA_AGENTES;
  continuidad por suplente; contradicción sin regla → detener y escalar.
- **Trabajo previo que avanza sin aprobar el ADR:** nada nuevo es imprescindible — reutiliza E4/E5/E6/E9/E10/E12/E13 ya
  construidos. **La implementación (Inc.1: modelo `MisionTransversal` + asignación/seguimiento) depende de aprobar el ADR.**
- **Recomendación:** **aprobar el ADR 0016** para construir Inc.1; es aditivo, reversible y sin infraestructura nueva.

## 7. Backlog ordenado con dependencias
**A. Autorizado y reversible (puedo avanzar ya, sin gasto):**
1. **Piloto de cobranza (sandbox)** — datos sintéticos, correo simulado; demuestra el ciclo completo. *Dep.: su visto
   bueno a la ficha §3.*
2. **Voz** — contrato `VoiceProvider` + simulado + stubs Connect/Google + pruebas. *Dep.: ninguna para sandbox.*
3. **Jurídica-controles** — `GrabacionConfig` + retención/acceso + export minimizado + pruebas sintéticas. *Dep.: ninguna para construir.*
4. **Gmail** adaptador (alternativa de correo). *Dep.: ninguna para sandbox.*
5. **WhatsApp web** — UI de plantillas/estados/webhooks. *Dep.: ninguna.*

**B. Depende de una decisión suya:**
6. **Superempleado Inc.1** — *Dep.: aprobar ADR 0016.*
7. **Candado de internet (aplicar)** — *Dep.: elegir A/B.*

**C. Depende de acceso/gasto/validación externa (activación productiva):**
8. Correo/WhatsApp productivos — *Dep.: credenciales por empresa (acceso).*
9. Voz productiva — *Dep.: presupuesto (gasto) + proveedor elegido.*
10. Umbrales monetarios — *Dep.: Finanzas.* · Grabación productiva — *Dep.: Jurídica.* · Pasaporte por sector — *Dep.: Cumplimiento.*

## 8. Solicitudes concretas a otras áreas (para avanzar en paralelo)
- **Finanzas:** límites por empresa/moneda/operación; exposición acumulada; reglas de fraccionamiento; responsables y
  niveles de aprobación por tipo de acción (pagos/transferencias/cambios de cuenta).
- **Jurídica:** condiciones de tratamiento de llamadas/grabaciones/transcripciones; conservación, eliminación, acceso; y
  condiciones de uso de **exportaciones firmadas como evidencia**.
- **Cumplimiento:** jurisdicción, sector y caso de uso; campos y controles **adicionales** del pasaporte por sector.
> Estas validaciones **no detienen** el desarrollo independiente; **sí** condicionan los usos productivos afectados.

## 9. Decisiones concretas que requieren su respuesta
1. **Ficha del piloto (§3):** ¿la aprueba como está, o ajusta empresa/área/volumen?
2. **Superempleado (ADR 0016):** ¿aprueba construir el Inc.1?
3. **Candado de internet:** ¿Opción A o B? (A recomendada, no corta flujos).
4. **WhatsApp:** ¿confirma **Meta directo** como primera vía del piloto? (Twilio queda disponible por adaptador).
5. **Voz:** ¿autoriza que prepare el **presupuesto detallado** (aún sin gasto) para una prueba acotada?
6. **Prioridad de construcción autorizada:** ¿empiezo por el **piloto de cobranza** (recomendado) o por **voz/grabación**?

> Avanzo en el trabajo autorizado y reversible que no dependa de decisiones pendientes. No contrato, no habilito gastos,
> no amplío permisos ni activo producción con base en supuestos.
