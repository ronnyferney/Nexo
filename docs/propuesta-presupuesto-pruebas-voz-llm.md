# Propuesta de presupuesto MÁXIMO para pruebas con servicios pagos (voz y LLM) — NEXO

> **Versión 1** (2026-11-03). Entregable **documental** para decisión del patrocinador. El patrocinador **autorizó la
> EVALUACIÓN, no el gasto**. Este documento propone un **tope máximo de presupuesto** para una **prueba controlada**
> con servicios pagos (voz conversacional y modelos LLM reales), con el fin de obtener mediciones que hoy no pueden
> obtenerse sin consumo real. **No ejecuta ni autoriza gasto alguno:** ninguna cifra aquí es una aprobación. La
> ejecución requiere que el patrocinador **apruebe expresamente una cifra concreta** (ver §6).
>
> **Guardarraíl:** análisis **multiempresa/multisectorial**; cifras **indicativas, no oficiales**; fuentes oficiales a
> verificar antes de cualquier compromiso económico. Complementa, sin duplicar, `docs/evaluacion-voz.md` (v2),
> `docs/evaluacion-llm.md`, `docs/propuesta-presupuesto-voz.md` y el **ADR 0010** (enrutamiento de modelos). La
> metodología de medición vive en aquellos documentos; aquí se dimensiona **cuánto costaría** ejecutarla y **cómo se
> controla** ese gasto.

## 1. Objetivo

Obtener, en una **prueba controlada y acotada**, mediciones reales que la documentación pública **no permite** conocer,
para decidir proveedor(es) de voz y enrutamiento de LLM **antes de cualquier decisión de producción**:

- **Precisión:** exactitud del piloto de cobranza con modelo real (contra *gold set*) y **WER %** de STT en es-CO.
- **Latencia p50/p95:** *turn-around* de voz (fin de habla del usuario → inicio de voz del bot) y tiempo a primer token
  del LLM, por tipo de tarea.
- **Calidad conversacional (es-CO):** naturalidad TTS (MOS 1–5, evaluación ciega), manejo de turnos, barge-in,
  seguimiento de instrucciones del diálogo.
- **Costo real por corrida:** consumo medido por llamada/ejecución, contrastado con el modelo indicativo de las
  evaluaciones previas (US$/min, US$/MTok).
- **Escalabilidad:** comportamiento bajo la concurrencia del lote acotado (sin tráfico real de clientes).

Las sub-métricas numéricas (p50/p95, WER, MOS, costo real) **solo se obtienen midiendo**; esa es la justificación del
gasto propuesto.

## 2. Alcance acotado (lote mínimo y topes duros)

Prueba **mínima suficiente** para percentiles representativos, con datos **sintéticos** (sin PII real de clientes),
credenciales por bóveda y **grabación OFF** salvo validación jurídica previa.

### 2.1 Voz

- **Lote:** ≥ **30 llamadas simuladas de ~3 min** por proveedor candidato (guion es-CO: saludo, verificación, 3
  intenciones de cobranza, despedida), con datos sintéticos.
- **Proveedores:** hasta **2** (Amazon Connect y Google CCAI) para contraste.
- **Minutos por proveedor:** ~30 × 3 = **90 min**; con reintentos/afinamiento, tope **≤ 150 min/proveedor**.
- **Concurrencia máxima:** **5 llamadas simultáneas** (tope duro), suficiente para medir sin disparar costo.

### 2.2 LLM

- **Lote:** **N = 3 a 5 ejecuciones** del *gold set* del piloto de cobranza
  (`docs/ficha-piloto-cobranza.md`, `docs/informe-piloto-cobranza.md`) **por modelo candidato**, cubriendo el
  enrutamiento del ADR 0010 (triage → Haiku, redacción → Sonnet, razonamiento/verificación → Opus).
- **Volumen estimado por ejecución del gold set:** del orden de **0,3–0,5 MTok entrada + 0,1–0,2 MTok salida**
  (indicativo; se ajusta al tamaño real del gold set del piloto).
- **Verificación cruzada (ADR 0010 D4):** solo un subconjunto de salidas de alto impacto (duplica costo/latencia);
  acotada dentro del mismo tope.
- **Concurrencia / tope de tasa:** limitada a la del *runner* del piloto; sin lotes masivos.

> Los dos lotes son **independientes** y pueden aprobarse por separado. El diálogo de voz (capa 3) puede resolverse con
> el motor nativo del proveedor **o** con el LLM de NEXO; si usa LLM, su costo se contabiliza en el lote LLM.

## 3. Estimación de presupuesto MÁXIMO (indicativo — verificar oficial)

> Todas las cifras son **indicativas y no oficiales**; provienen de las evaluaciones previas y de terceros. **Verificar
> en fuentes oficiales** (AWS, Google, Anthropic; ver §7 de `docs/evaluacion-voz.md` y `docs/evaluacion-llm.md`) antes
> de aprobar. Los precios cambian por región, volumen y fecha. Se dimensiona un **MÁXIMO**, no un gasto esperado.

### 3.1 Voz (por proveedor, lote de ~150 min con margen)

| Proveedor | Base de costo (indicativo) | US$/min (ind.) | Minutos (máx.) | Subtotal (máx.) |
|---|---|---|---|---|
| **Amazon Connect** (voz + básico, sin IA extra) | tarifa por minuto, telefonía incl. | ~US$0.038–0.045 | 150 | **~US$7** |
| **Google CCAI** (STT + TTS + Dialogflow) | por componente | ~US$0.04–0.06 equiv. | 150 | **~US$9** |
| **Telefonía/números DID, cargos fijos y reintentos** | provisión de número + salientes | — | — | **~US$10–20** |
| **Colchón de imprevistos voz (contingencia)** | — | — | — | **~US$15** |

**Subtotal voz (2 proveedores, con cargos fijos y contingencia): ~US$40–55 → tope duro propuesto US$75.**

### 3.2 LLM (por modelo, 3–5 ejecuciones del gold set)

Precios **indicativos** por MTok (entrada / salida) de `docs/evaluacion-llm.md` §3. Supuesto por ejecución:
~0,4 MTok entrada + 0,15 MTok salida; **5 ejecuciones** por modelo (máximo del rango).

| Modelo (tier) | Entrada (ind.) | Salida (ind.) | Costo/ejec. (ind.) | 5 ejec. (máx.) |
|---|---|---|---|---|
| **claude-haiku-5-5** (ECONOMY) | ~US$0.80/MTok | ~US$4/MTok | ~US$0.9 | **~US$5** |
| **claude-sonnet-5-5** (STANDARD) | ~US$3/MTok | ~US$15/MTok | ~US$3.5 | **~US$18** |
| **claude-opus-5-5** (PREMIUM, default) | ~US$15/MTok | ~US$75/MTok | ~US$17 | **~US$85** |
| **Verificación cruzada / contraste otro fabricante** | variable | variable | ~duplica Opus en subconjunto | **~US$30** |

**Subtotal LLM (toda la familia + verificación cruzada acotada): ~US$140 → tope duro propuesto US$200.**

> El caching de prompt (system prompt estable del agente) reduce el costo de entrada de prompts repetidos; el consumo
> real será **menor o igual** al máximo. Opus domina el costo: si el patrocinador desea un tope más bajo, se limita el
> lote de Opus/verificación cruzada (ver variante "bajo" en §3.3).

### 3.3 Tope máximo recomendado (para aprobar una cifra)

| Variante | Voz | LLM | **Tope duro total** | Para qué alcanza |
|---|---|---|---|---|
| **Bajo** | 1 proveedor voz, ~90 min | Haiku + Sonnet + Opus limitado (3 ejec.), sin verificación cruzada | **US$150** | Señal inicial de latencia/calidad y costo real básico |
| **Medio (recomendado)** | 2 proveedores voz, ~150 min c/u | Familia completa (5 ejec.) + verificación cruzada acotada | **US$300** | Prueba completa comparable y matriz de decisión con datos reales |

**Recomendación:** aprobar un **tope duro de US$300** (variante media) como **techo absoluto del lote**; el gasto
esperado es sensiblemente menor. Si se prefiere mínima exposición, **US$150** (variante baja) permite una primera señal.
Ambas cifras incluyen contingencia. **Ninguna se ejecuta sin aprobación expresa (§6).**

## 4. Controles de gasto (obligatorios durante la prueba)

- **Credenciales solo por bóveda** (`{{ secrets.NOMBRE }}`); nunca por chat ni en código. Toda llamada saliente pasa por
  `HttpClientService` (SSRF, timeout, tamaño).
- **Tope por lote (hard cap):** la cifra aprobada por el patrocinador es un límite **duro**; al alcanzarse, la prueba se
  **detiene automáticamente**.
- **Límite de concurrencia:** voz ≤ 5 llamadas simultáneas; LLM limitado al *runner* del piloto (sin lotes masivos).
- **Apagado inmediato:** interruptor para desactivar los adaptadores/proveedores al instante; por defecto permanecen en
  sandbox.
- **Medición de costo real por corrida:** cada llamada/ejecución se registra en `UsageRecord` (proveedor, modelo,
  US$/min o US$/MTok, duración); tablero de gasto acumulado del lote frente al tope.
- **Criterio de parada:** se detiene si (a) se alcanza el tope de gasto, (b) se alcanza el tamaño de muestra objetivo,
  (c) se detecta fuga de PII o grabación no autorizada, o (d) un proveedor incumple residencia/seguridad exigida.
- **Datos sintéticos**, PII enmascarada, **grabación OFF** salvo validación jurídica; sin datos reales de clientes.
- **Sin activación productiva:** construir/medir no implica acceso, gasto ni producción (son autorizaciones distintas).

## 5. Qué se entregaría tras la prueba

- **Matriz de puntuación ponderada completada con datos reales:**
  - Voz (pesos de `docs/evaluacion-voz.md` §2): Costos 25 % · Latencia 20 % · Calidad 20 % · Integración 15 % ·
    Seguridad 15 % · Escalabilidad 5 %.
  - LLM (pesos de `docs/evaluacion-llm.md` §6): Calidad 25 % · Costo 25 % · Latencia 15 % · Idoneidad 10 % ·
    Seguridad/residencia 15 % · Escalabilidad 10 %, puntuada **por franja de tarea**.
- **Recomendación de proveedor de voz** (Amazon Connect vs Google CCAI) y **de enrutamiento LLM** (política por tarea
  del ADR 0010), con p50/p95, WER, MOS y **costo real por minuto / por MTok / por lote** medidos.
- **Contraste modelo teórico vs. costo real** y ajuste de las cifras indicativas de las evaluaciones previas.
- **Informe de decisión** condicionado a validación jurídica (grabación/retención) y a autorización de producción.

## 6. Recordatorio de gobierno (autorización de gasto)

**Ningún gasto se ejecuta sin la autorización expresa del patrocinador de una cifra concreta.** Este documento es una
**propuesta**; no es una aprobación, no activa proveedores y no habilita consumo. Se distinguen cuatro autorizaciones
—**construir / acceso / gasto / activación productiva**— y una no implica las otras. Para proceder, el patrocinador debe
aprobar **explícitamente** un **tope en dólares** (p. ej. US$150 o US$300) y el alcance (voz, LLM o ambos). Las
credenciales se cargarán **solo por la bóveda**, nunca por chat. Las recomendaciones de este documento **no** constituyen
aprobación.
