# Evaluación técnica de capacidades de voz — NEXO

> Marco de evaluación **en entorno controlado y sin gasto** para seleccionar proveedor(es) de voz conversacional, según
> la decisión del patrocinador (2026-11-02, §4). Compara **costos, latencia, calidad conversacional, integración,
> seguridad y escalabilidad**. **No autoriza gasto ni contratación**: cualquier presupuesto o activación paga requiere
> autorización previa. Soporte: `docs/propuesta-presupuesto-voz.md`, contrato `VoiceProvider` (4 capas) ya construido en
> sandbox (`apps/api/src/modules/channels/voice`).

## 1. Alcance

- **Hoy en NEXO (sandbox, sin gasto):** contrato `VoiceProvider` de 4 capas (telefonía, STT, diálogo/LLM, TTS) con
  **adaptador simulado** y **stubs** de Amazon Connect y Google. No hay llamadas reales ni costo.
- **Esta evaluación** define los **criterios, la metodología y una comparación indicativa** para decidir; la medición
  real de latencia/calidad con tráfico se hará **solo cuando se autorice** una prueba controlada con credenciales por
  bóveda (sin exponer datos reales de clientes).

## 2. Criterios de evaluación y cómo se miden

| Criterio | Qué se mide | Cómo (en entorno controlado) |
|---|---|---|
| **Costos** | US$/min de voz, STT, TTS, diálogo/LLM, telefonía entrante/saliente, mínimos/seats | Modelo de costo por minuto de conversación típica (p. ej. 3 min), según tarifas oficiales |
| **Latencia** | Tiempo de primera respuesta y *turn-around* (habla→respuesta) | Medición con la capa real en sandbox acotado; objetivo < 1 s percibido |
| **Calidad conversacional** | Naturalidad TTS, exactitud STT (es-CO), manejo de interrupciones (barge-in), turnos | Guion de prueba en español colombiano; evaluación ciega |
| **Integración** | Esfuerzo para encajar en el contrato `VoiceProvider` de 4 capas; webhooks, SIP | Prueba de implementación del adaptador contra el contrato existente |
| **Seguridad** | Cifrado en tránsito/reposo, residencia de datos, cumplimiento, manejo de PII/grabación | Revisión de controles del proveedor + requisitos de Jurídica (grabación OFF hasta validación) |
| **Escalabilidad** | Concurrencia de llamadas, límites, regiones, SLA | Documentación del proveedor + prueba de carga acotada |

**Matriz de puntuación (0–5 por criterio, ponderada):** Costos 25 % · Latencia 20 % · Calidad 20 % · Integración 15 % ·
Seguridad 15 % · Escalabilidad 5 %. Gana la mayor suma ponderada; empates se rompen por **seguridad** y **costo**.

## 3. Comparación indicativa de proveedores

> Cifras **indicativas** (fuentes de terceros, 2026) para dimensionar; **verificar en las páginas oficiales de AWS y
> Google** antes de decidir. La latencia no está publicada y **debe medirse** en la prueba controlada.

| Proveedor | Modelo de costo (indicativo) | Notas |
|---|---|---|
| **Amazon Connect** | ~**US$0.038/min** de voz (tarifa única "Customer"; básico ~US$0.018/min, IA aparte); saliente ~US$0.045/min; **sin seats ni mínimos** | Tarifa simple por minuto; telefonía incluida; IA/analytics según plan |
| **Google CCAI / Dialogflow CX + Speech** | **Por componente**: STT ~US$0.024/min · TTS WaveNet ~US$0.016/1k caracteres · Dialogflow CX ~US$0.007/solicitud | Más granular (difícil de comparar directo); flexible pero requiere sumar partes |
| **Alternativas a considerar** | Twilio (+ STT/LLM), Azure Communication Services + Speech, Retell/Vapi (orquestadores IVR-IA) | Útiles como *benchmark*; evaluar solo si aportan sobre Connect/Google |

**Lectura rápida:** Amazon Connect ofrece **simplicidad de costo** (una tarifa por minuto); Google ofrece **flexibilidad
por componente** (potencialmente más barato o más caro según uso). La decisión no debe tomarse solo por precio de lista:
pesa la **latencia real**, la **calidad en es-CO** y la **facilidad de integración** con el contrato de 4 capas.

## 4. Metodología de la prueba controlada (cuando se autorice)

1. Implementar el adaptador real de **1–2 proveedores** contra el contrato `VoiceProvider` existente (sin cambiar el
   núcleo).
2. Guion de prueba en **español colombiano** (saludo, verificación, 3 intenciones de cobranza, despedida), con datos
   **sintéticos**.
3. Medir latencia (p50/p95), exactitud STT, naturalidad TTS (evaluación ciega 1–5), barge-in y tasa de error.
4. Registrar **costo real** del lote de pruebas (acotado) para contrastar con el modelo teórico.
5. **Grabación OFF** salvo validación jurídica; PII enmascarada; credenciales por bóveda; límites de concurrencia y de
   gasto duros (tope de prueba).
6. Completar la **matriz de puntuación** y emitir recomendación.

## 5. Recomendación (sin comprometer gasto)

- **Continuar el diseño** del adaptador real de **Amazon Connect** (por simplicidad de costo e integración) y de **Google
  CCAI** como contraste, **sin activarlos**.
- **No tomar la decisión final solo con precios de lista**: agendar una **prueba controlada acotada** (con tope de gasto
  y autorización explícita) para medir latencia y calidad en es-CO.
- Mantener **voz en sandbox** hasta: (a) validación jurídica de grabación/retención y (b) autorización de presupuesto de
  evaluación.

## Fuentes (indicativas, verificar oficiales)
- Amazon Connect pricing 2026: getmacha.com, cekura.ai, nextiva.com (terceros).
- Google Dialogflow CX / Speech (STT/TTS) pricing: comparativas de terceros (retellai.com).
- Páginas oficiales a verificar: `aws.amazon.com/connect/pricing`, `cloud.google.com/dialogflow/pricing`,
  `cloud.google.com/speech-to-text/pricing`, `cloud.google.com/text-to-speech/pricing`.
