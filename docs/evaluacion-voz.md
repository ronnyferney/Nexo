# Evaluación técnica de capacidades de voz — NEXO

> **Versión 2** (2026-11-03). Marco de evaluación **en entorno controlado y sin gasto** para seleccionar proveedor(es) de
> voz conversacional, según la decisión del patrocinador (2026-11-02, §4). Compara **costos, latencia, calidad
> conversacional, integración, seguridad y escalabilidad**. **No autoriza gasto ni contratación**: cualquier presupuesto
> o activación paga requiere autorización previa del patrocinador. Soporte: `docs/propuesta-presupuesto-voz.md`, contrato
> `VoiceProvider` (4 capas) ya construido en sandbox (`apps/api/src/modules/channels/voice`).
>
> **Documento complementario:** la comparativa de **modelos LLM** (capa de diálogo de la voz y motor conversacional de
> NEXO) vive en `docs/evaluacion-llm.md`. Léanse en conjunto: la capa 3 (diálogo/LLM) del contrato de voz se dimensiona
> con los costos y el enrutamiento descritos allí.

> **Cambios v1 → v2:** (a) se amplían los criterios con sub-métricas medibles y umbrales objetivo; (b) se detalla la
> metodología de prueba controlada (guion, muestreo, cálculo de p50/p95, evaluación ciega); (c) la tabla de costos
> indicativos separa componentes y marca cada cifra como **por verificar en fuente oficial**; (d) se añaden criterios de
> decisión ponderados y el enlace con la evaluación LLM. Todo sigue **sin gasto**.

## 1. Alcance

- **Hoy en NEXO (sandbox, sin gasto):** contrato `VoiceProvider` de 4 capas (telefonía, STT, diálogo/LLM, TTS) con
  **adaptador simulado** y **stubs** de Amazon Connect y Google. No hay llamadas reales ni costo.
- **Esta evaluación** define los **criterios, la metodología y una comparación indicativa** para decidir; la medición
  real de latencia/calidad con tráfico se hará **solo cuando se autorice** una prueba controlada con credenciales por
  bóveda (sin exponer datos reales de clientes).

## 2. Criterios de evaluación y cómo se miden

| Criterio | Qué se mide (sub-métricas) | Cómo (en entorno controlado) | Umbral objetivo |
|---|---|---|---|
| **Costos** | US$/min de voz, STT, TTS, diálogo/LLM, telefonía entrante/saliente, mínimos/seats, cargos por región | Modelo de costo por minuto de conversación típica (p. ej. 3 min), según tarifas **oficiales** por componente | Costo total por llamada de 3 min competitivo vs. línea base del piloto |
| **Latencia** | Primera respuesta (TTFB de voz), *turn-around* (fin de habla del usuario → inicio de voz del bot), **p50 y p95** | Instrumentar la capa real en sandbox acotado; registrar marcas de tiempo por turno y agregar percentiles | *Turn-around* p95 < 1,2 s; p50 < 0,8 s (percibido como natural) |
| **Calidad conversacional** | Naturalidad TTS (MOS 1–5), exactitud STT en es-CO (**WER %**), barge-in, manejo de turnos y silencios | Guion en español colombiano; evaluación **ciega** por 3+ evaluadores; WER calculado contra transcripción de referencia | WER < 10 % en es-CO; MOS TTS ≥ 4,0; barge-in funcional |
| **Integración** | Esfuerzo para encajar en el contrato `VoiceProvider` de 4 capas; webhooks, SIP/telefonía, SDK | Prueba de implementación del adaptador contra el contrato existente; conteo de días-persona | Adaptador funcional sin modificar el núcleo del contrato |
| **Seguridad** | Cifrado en tránsito/reposo, residencia de datos (región), cumplimiento, manejo de PII/grabación, retención | Revisión de controles del proveedor + requisitos de Jurídica (grabación **OFF** hasta validación) | Cumple residencia y controles exigidos; grabación gobernada |
| **Escalabilidad** | Concurrencia de llamadas, límites por cuenta/región, SLA publicado | Documentación del proveedor + prueba de carga acotada (sin tráfico real de clientes) | Soporta la concurrencia proyectada del piloto con margen |

**Matriz de puntuación (0–5 por criterio, ponderada):** Costos 25 % · Latencia 20 % · Calidad 20 % · Integración 15 % ·
Seguridad 15 % · Escalabilidad 5 %. Gana la mayor suma ponderada; empates se rompen por **seguridad** y **costo**.

> Las sub-métricas con número (p50/p95, WER, MOS) **no están publicadas** por los proveedores de forma comparable y
> **solo se obtienen midiendo** en la prueba controlada; hasta entonces la matriz se completa con columnas estimadas,
> marcadas como tales, y la decisión final queda condicionada a la medición real.

## 3. Comparación indicativa de proveedores

> Cifras **indicativas** (fuentes de terceros, 2026) para dimensionar; **ninguna es oficial**. **Verificar en las páginas
> oficiales de AWS y Google** (ver §6) antes de decidir. La latencia no está publicada y **debe medirse** en la prueba
> controlada. Los precios cambian por región, volumen y fecha.

### 3.1 Costo por componente (indicativo — verificar oficial)

| Proveedor | Componente | Costo indicativo | Estado |
|---|---|---|---|
| **Amazon Connect** | Voz entrante ("Customer", tarifa única) | ~US$0.038/min (básico de servicio ~US$0.018/min + telefonía) | Por verificar |
| **Amazon Connect** | Voz saliente | ~US$0.045/min | Por verificar |
| **Amazon Connect** | IA/analytics (Contact Lens, etc.) | Según plan, aparte | Por verificar |
| **Google CCAI** | STT (Speech-to-Text) | ~US$0.024/min | Por verificar |
| **Google CCAI** | TTS (WaveNet/Neural2) | ~US$0.016/1k caracteres | Por verificar |
| **Google CCAI** | Dialogflow CX (diálogo) | ~US$0.007/solicitud | Por verificar |
| **Alternativas** | Twilio (voz + STT/LLM), Azure Communication Services + Speech, Retell/Vapi (orquestadores IVR-IA) | Variable; como *benchmark* | Por verificar |

> **Nota:** el "diálogo/LLM" de la capa 3 puede resolverse con el motor nativo del proveedor (Dialogflow, Lex) **o** con
> la familia LLM de NEXO (ver `docs/evaluacion-llm.md`). En el segundo caso, el costo de diálogo se toma de esa
> evaluación (costo por MTok por los tokens de cada turno) y **no** de la tarifa del proveedor de voz.

### 3.2 Costo modelado por llamada tipo (3 min, indicativo — no oficial)

| Proveedor | Cálculo (indicativo) | Total aprox. por llamada 3 min |
|---|---|---|
| **Amazon Connect** (voz + básico, sin IA extra) | 3 min × ~US$0.038 | ~US$0.11 |
| **Google CCAI** (STT + TTS + diálogo, ~400 car. TTS y ~6 solicitudes) | 3×0.024 + 0.4×0.016 + 6×0.007 | ~US$0.12 |

> Estas sumas son **ilustrativas** para dimensionar órdenes de magnitud, no cotizaciones. El número de solicitudes de
> diálogo y los caracteres de TTS por llamada **se medirán** en la prueba controlada; con diálogo vía LLM de NEXO, añádase
> el costo por MTok del modelo enrutado.

**Lectura rápida:** Amazon Connect ofrece **simplicidad de costo** (una tarifa por minuto, telefonía incluida); Google
ofrece **flexibilidad por componente** (potencialmente más barato o más caro según uso y según si el diálogo lo lleva
Dialogflow o el LLM de NEXO). La decisión no debe tomarse solo por precio de lista: pesa la **latencia real**, la
**calidad en es-CO** y la **facilidad de integración** con el contrato de 4 capas.

## 4. Metodología de la prueba controlada (cuando se autorice)

1. Implementar el adaptador real de **1–2 proveedores** contra el contrato `VoiceProvider` existente (sin cambiar el
   núcleo).
2. Guion de prueba en **español colombiano** (saludo, verificación, 3 intenciones de cobranza, despedida), con datos
   **sintéticos**. Fijar un **tamaño de muestra** mínimo (p. ej. ≥ 30 llamadas simuladas por proveedor) para que los
   percentiles sean representativos.
3. Medir y agregar:
   - **Latencia:** marca de tiempo de fin de habla del usuario y de inicio de voz del bot por turno; calcular **p50 y
     p95** del *turn-around* y de la primera respuesta sobre todos los turnos de la muestra.
   - **STT:** **WER %** por comparación con transcripción de referencia del guion.
   - **TTS:** **MOS 1–5** en evaluación **ciega** (los evaluadores no saben qué proveedor es), ≥ 3 evaluadores; reportar
     promedio y dispersión.
   - **Barge-in** y **tasa de error** (turnos fallidos / total).
4. Registrar **costo real** del lote de pruebas (acotado) para contrastar con el modelo teórico de §3; si el diálogo usa
   el LLM de NEXO, separar el costo por MTok (ver `docs/evaluacion-llm.md`).
5. **Grabación OFF** salvo validación jurídica; PII enmascarada; credenciales por bóveda; **sin datos reales de
   clientes**; límites de concurrencia y de **gasto duros** (tope de prueba) autorizados por el patrocinador.
6. Completar la **matriz de puntuación** (§2) con los números medidos y emitir recomendación.

## 5. Recomendación (sin comprometer gasto)

- **Continuar el diseño** del adaptador real de **Amazon Connect** (por simplicidad de costo e integración) y de **Google
  CCAI** como contraste, **sin activarlos**.
- **No tomar la decisión final solo con precios de lista**: agendar una **prueba controlada acotada** (con tope de gasto
  y autorización explícita) para medir latencia y calidad en es-CO.
- Mantener **voz en sandbox** hasta: (a) validación jurídica de grabación/retención y (b) autorización de presupuesto de
  evaluación.

## 6. Fuentes (indicativas, verificar oficiales)

**Fuentes de terceros usadas para las cifras indicativas (no oficiales):**
- Amazon Connect pricing 2026: getmacha.com, cekura.ai, nextiva.com.
- Google Dialogflow CX / Speech (STT/TTS) pricing: comparativas de terceros (retellai.com).

**Páginas oficiales a verificar antes de decidir (prevalecen sobre lo anterior):**
- `aws.amazon.com/connect/pricing` (voz, telefonía, Contact Lens/IA).
- `cloud.google.com/dialogflow/pricing` (Dialogflow CX / CCAI).
- `cloud.google.com/speech-to-text/pricing` (STT).
- `cloud.google.com/text-to-speech/pricing` (TTS).
- Alternativas: `twilio.com/pricing/voice`, `azure.microsoft.com/pricing` (Communication Services + Speech),
  `retellai.com/pricing`, `vapi.ai/pricing`.

> Recordatorio: estas cifras son **indicativas**. La medición real de latencia/calidad y el **costo real** del lote
> requieren una **prueba controlada con autorización de gasto del patrocinador**. Esta evaluación **no** autoriza consumo.
