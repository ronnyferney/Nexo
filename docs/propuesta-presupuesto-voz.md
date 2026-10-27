# Propuesta — Evaluación acotada de voz (Amazon Connect y Google Cloud)

> **Propósito:** proponer una **evaluación acotada** de dos proveedores de voz, Amazon Connect y Google Cloud, **sin gasto adicional** en esta fase, aprovechando el diseño y los simuladores ya construidos.
> **Estado:** **propuesta.** Este documento **no** autoriza gasto, **no** crea cuentas, **no** contacta proveedores y **no** inventa tarifas. Todo valor de tarifa queda "(pendiente de cotización, fuente: calculadora oficial del proveedor)".

## 1. Qué proponemos y qué NO

Proponemos **evaluar** la viabilidad de integrar voz con Amazon Connect y Google Cloud, apoyándonos en lo ya construido:

- Un **contrato `VoiceProvider` de 4 capas** (dominio en `apps/api/src/modules/channels/voice/domain/voice-provider.ts`) que abstrae al proveedor concreto.
- **Stubs inactivos** de ambos proveedores: `adapters/amazon-connect-voice.adapter.ts` y `adapters/google-cloud-voice.adapter.ts`, más un adaptador simulado (`simulado-voice.adapter.ts`) para pruebas sin servicio externo.

Gracias a ello, la evaluación de diseño y la prueba con **simuladores** pueden avanzar **sin gasto** y sin contratar nada.

**Lo que esta propuesta NO hace, de forma explícita:**

- No contrata ni contacta a AWS ni a Google Cloud.
- No crea cuentas ni credenciales (hoy **no existen**).
- No autoriza ningún gasto.
- No fija tarifas ni duración definitiva: son propuestas a aprobar.

> **Se puede avanzar sin gasto** (diseño + simuladores). **Cualquier servicio pago requiere aprobación previa y una cuenta/credenciales que hoy no existen.**

## 2. Prueba acotada propuesta (a aprobar)

| Parámetro | Propuesta | Nota |
|---|---|---|
| Duración | Ventana de **X días** | Valor a aprobar; se propone acotado. (pendiente de definición) |
| Consumo máximo | Tope de **minutos / llamadas** | Límite duro para evitar gasto no previsto. (pendiente de definición) |
| Alcance | Solo simuladores en esta fase | La prueba con servicio pago exige aprobación y cuenta separadas. |
| Datos de prueba | Internos y acotados | Sin datos productivos de terceros. |

## 3. Costos — conceptos y tarifas (sin inventar cifras)

Las tarifas **no** se estiman aquí. Deben tomarse de la **calculadora oficial de cada proveedor** cuando se autorice una fase con gasto.

| Concepto | Amazon Connect | Google Cloud |
|---|---|---|
| Telefonía entrante | (pendiente de cotización, fuente: calculadora oficial del proveedor) | (pendiente de cotización, fuente: calculadora oficial del proveedor) |
| Telefonía saliente | (pendiente de cotización, fuente: calculadora oficial del proveedor) | (pendiente de cotización, fuente: calculadora oficial del proveedor) |
| STT (voz a texto) | (pendiente de cotización, fuente: calculadora oficial del proveedor) | (pendiente de cotización, fuente: calculadora oficial del proveedor) |
| TTS (texto a voz) | (pendiente de cotización, fuente: calculadora oficial del proveedor) | (pendiente de cotización, fuente: calculadora oficial del proveedor) |
| Motor / plataforma | (pendiente de cotización, fuente: calculadora oficial del proveedor) | (pendiente de cotización, fuente: calculadora oficial del proveedor) |

> La consolidación de un costo total también debe pasar por **Finanzas** antes de cualquier decisión de gasto.

## 4. Criterios de selección (comparativa)

La tabla se diligencia durante la evaluación; aquí se fijan los criterios y su importancia.

| Criterio | Qué se evalúa | Amazon Connect | Google Cloud |
|---|---|---|---|
| Cobertura regional | Disponibilidad y numeración en las regiones de interés. | (por evaluar) | (por evaluar) |
| Latencia | Retardo extremo a extremo aceptable para conversación. | (por evaluar) | (por evaluar) |
| Idiomas / es-CO | Calidad en español, especialmente **es-CO**. | (por evaluar) | (por evaluar) |
| Integración | Esfuerzo para completar el adaptador del contrato `VoiceProvider`. | (por evaluar) | (por evaluar) |
| Costo | Según calculadora oficial (ver sección 3). | (pendiente de cotización) | (pendiente de cotización) |
| Portabilidad entre proveedores | Facilidad de cambiar de proveedor sin reescribir, vía el adaptador de 4 capas. | (por evaluar) | (por evaluar) |

## 5. Gobierno de autorizaciones

Recordamos la distinción del patrocinador entre **construir / acceso / gasto / activación productiva**. Esta propuesta cubre únicamente la fase de **construir/evaluar sin gasto**. El paso a una prueba con servicio pago requiere, por separado: autorización de **gasto**, creación de **cuenta/credenciales** (hoy inexistentes, a cargar por bóveda) y, si procede uso productivo, **activación productiva** del patrocinador.

## 6. Lo que esta propuesta NO hace (resumen)

- No inventa tarifas ni totales.
- No contacta a AWS ni a GCP.
- No crea cuentas ni credenciales.
- No autoriza gasto ni activación productiva.

---

**Estado del documento:** propuesta — se avanza **sin gasto** (diseño/simuladores); cualquier servicio pago **requiere aprobación previa**. Tarifas **pendientes de cotización (calculadora oficial del proveedor)**.
