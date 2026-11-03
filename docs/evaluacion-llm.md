# Evaluación técnico-económica comparativa de modelos LLM — NEXO

> **Versión 1** (2026-11-03). Entregable **documental**, en **entorno de análisis y sin gasto**: compara modelos LLM
> pertinentes para NEXO en **costo, latencia, calidad/razonamiento, ventana de contexto, caching, idoneidad por tarea,
> seguridad/residencia y escalabilidad**, y propone un **enrutamiento por tarea** alineado con el **ADR 0010** (router de
> modelos) y el default `claude-opus-5-5` (CLAUDE.md). **No autoriza gasto, contratación ni activación productiva**:
> cualquier consumo adicional (incluidas pruebas con modelos reales de pago) requiere **autorización de gasto del
> patrocinador**. Complementa `docs/evaluacion-voz.md` (la capa 3 "diálogo/LLM" de la voz se dimensiona aquí).
>
> **Guardarraíl:** análisis **multiempresa/multisectorial**; nada atado a un cliente concreto. Las cifras de precio son
> **indicativas, no oficiales**; verifíquense en las páginas oficiales de cada proveedor (§7).

## 1. Alcance y supuestos

- NEXO es **multi-proveedor** (ADR 0002): el catálogo de modelos por workspace ya persiste metadata de capacidad
  (`LlmModel.specialties`: `CODE | REASONING | VISION | FAST | GENERAL`), `contextTokens` y `tier`
  (`PREMIUM | STANDARD | ECONOMY`), más precio por millón de tokens (MTok). El enrutamiento por tarea es la decisión del
  **ADR 0010**.
- **Default de plataforma:** `claude-opus-5-5` (CLAUDE.md). La familia Claude 5.x (Opus/Sonnet/Haiku) es la base; se
  incluyen **otros proveedores como contraste** para no atar la plataforma a un fabricante.
- **Sin gasto:** esta comparativa se arma con documentación pública y conocimiento de dominio; **no** ejecuta llamadas de
  pago. Los números de calidad/latencia relativos son **cualitativos** hasta que una prueba controlada los mida.

## 2. Criterios de comparación

| Criterio | Qué se compara | Cómo se obtiene sin gasto |
|---|---|---|
| **Costo** | US$/MTok de **entrada** y **salida** (indicativo); efecto del caching | Tarifas públicas por fuente oficial (§7); modelado por tarea |
| **Latencia relativa** | Rapidez percibida (tokens/s, tiempo a primer token) **relativa** entre tiers | Clasificación cualitativa por tier; medición real en prueba controlada |
| **Calidad / razonamiento** | Capacidad de razonamiento, seguimiento de instrucciones, veracidad | Juicio cualitativo por tier + prueba controlada con *gold set* del piloto |
| **Ventana de contexto** | `contextTokens` máximos de entrada | Metadata del catálogo / ficha oficial del modelo |
| **Caching** | Soporte de caché de prompt (descuento por tokens cacheados) | Documentación oficial; impacto en costo de prompts repetidos |
| **Idoneidad por tarea** | Ajuste a redacción, verificación, clasificación/triage, visión, código | Mapa capacidad→tarea (§4) alineado con `ModelSpecialty` |
| **Seguridad / residencia** | Cifrado, región/residencia de datos, no-entrenamiento con datos del cliente, cumplimiento | Controles del proveedor + DataGuard (ADR 0008) |
| **Escalabilidad** | Límites de tasa (RPM/TPM), disponibilidad regional, SLA | Documentación oficial + prueba de carga acotada |

## 3. Comparativa indicativa de modelos

> **Precios indicativos por MTok (entrada / salida), NO oficiales — verificar en §7.** Los nombres `*-5-5` reflejan la
> familia usada en NEXO (CLAUDE.md); los contrastes de otros fabricantes usan nombres genéricos de su tier equivalente.
> Latencia y calidad son **relativas** (cualitativas) hasta medición real.

| Modelo | Tier | Precio entrada (ind.) | Precio salida (ind.) | Contexto | Caching | Latencia rel. | Calidad/razonamiento | Idoneidad principal |
|---|---|---|---|---|---|---|---|---|
| **claude-opus-5-5** (default) | PREMIUM | ~US$15/MTok | ~US$75/MTok | ~200k | Sí (prompt cache) | Media | Muy alta (razonamiento, verificación) | Razonamiento, verificación, decisiones de alto impacto |
| **claude-sonnet-5-5** | STANDARD | ~US$3/MTok | ~US$15/MTok | ~200k | Sí | Media-alta | Alta (equilibrio) | Redacción general, agentes, uso cotidiano |
| **claude-haiku-5-5** | ECONOMY | ~US$0.80/MTok | ~US$4/MTok | ~200k | Sí | Alta (rápido) | Media | Clasificación, triage, alto volumen, FAST |
| **Contraste proveedor B — tier premium** | PREMIUM | ~US$10–15/MTok | ~US$40–75/MTok | ~128k–1M | Según proveedor | Media | Muy alta | Razonamiento; contraste de verificación (otro fabricante) |
| **Contraste proveedor B — tier estándar** | STANDARD | ~US$0.50–3/MTok | ~US$1.50–15/MTok | ~128k+ | Según proveedor | Alta | Alta | Redacción/uso general alternativo |
| **Contraste proveedor C — tier económico/abierto** | ECONOMY | ~US$0.10–1/MTok | ~US$0.30–5/MTok | ~128k+ | Según proveedor | Muy alta | Media | Clasificación/volumen; opción de residencia/autoalojado |

> **Importante:** los rangos de los contrastes son amplios **a propósito**: dependen del modelo exacto y cambian con
> frecuencia. No se citan como oficiales. El objetivo no es rankear fabricantes, sino mostrar que hay **tres franjas de
> tier** (premium/estándar/económico) y que el enrutamiento por tarea (§4) explota esas franjas.

**Lectura de costo:** dentro de la familia Claude hay ~**1:5:20** entre Haiku, Sonnet y Opus (orden de magnitud
indicativo). Usar el tier correcto por tarea es la palanca de costo más grande, mayor que cambiar de fabricante.

## 4. Idoneidad por tarea y enrutamiento (alineado con ADR 0010)

El **ADR 0010** define un `ModelRouterService` **determinista** que, según capacidad requerida, contexto y objetivo
(`cost | quality | balanced`, default **equilibrado**), ordena candidatos del catálogo permitido del workspace, siempre
dentro del gobierno de costos (ADR 0002) y DataGuard (ADR 0008). Esta evaluación propone el **mapa tarea → capacidad →
tier** que alimenta esas reglas. No reemplaza el gobierno central: es la **política por defecto sugerida**.

| Tarea | Capacidad (`ModelSpecialty`) | Modelo sugerido (default) | Por qué |
|---|---|---|---|
| **Clasificación / triage / enrutamiento** | `FAST` | `claude-haiku-5-5` (ECONOMY) | Alto volumen, baja latencia, costo mínimo; la calidad media basta |
| **Redacción / respuesta conversacional general** | `GENERAL` | `claude-sonnet-5-5` (STANDARD) | Mejor relación calidad/costo para el grueso del tráfico |
| **Razonamiento complejo / decisiones de negocio** | `REASONING` | `claude-opus-5-5` (PREMIUM, default) | Máxima calidad donde el error cuesta; es el default de plataforma |
| **Verificación cruzada (draft-and-critique)** | `REASONING` | `claude-opus-5-5` y/o **otro fabricante** | ADR 0010 D4: verificador de **otro fabricante** reduce correlación de errores; premium, opt-in |
| **Extracción de documentos / imágenes** | `VISION` | modelo con `VISION` del catálogo | ADR 0010 D3: filtro por capacidad `VISION` cuando hay adjuntos |
| **Código** | `CODE` | modelo con `CODE` del catálogo | Especialidad declarada; `claude-sonnet-5-5` como base razonable |

### Recomendación de enrutamiento (resumen)

1. **Default de plataforma `claude-opus-5-5`** se mantiene como respaldo de calidad y para tareas de razonamiento y
   verificación; **no** como modelo único para todo el tráfico (sería caro e innecesario para triage).
2. **Perfil por defecto "equilibrado"** (ADR 0010, decisión 3): triage → **Haiku 5.5**; redacción general → **Sonnet
   5.5**; razonamiento/decisiones de alto impacto y verificación → **Opus 5.5**; visión → modelo con `VISION`.
3. **Verificación cruzada** solo en salidas de alto impacto (decisiones de negocio, acciones sensibles, salida al
   exterior, extracción de datos sensibles), **opt-in y acotada por presupuesto**: al menos duplica costo y latencia
   (ADR 0010 D4). Preferir **otro fabricante** como verificador cuando esté habilitado.
4. **Perfiles seleccionables** (ADR 0010 D7): "ahorro" baja un tier donde sea tolerable; "máxima calidad" sube a Opus
   más ampliamente. Siempre dentro de `OrgUnit.allowedModels`, presupuesto jerárquico y `maxCandidates` (= 3 intentos
   totales por defecto, no 3 modelos por tarea).
5. **Caching de prompt** para instrucciones de sistema y contexto estable del agente: reduce el costo de entrada de
   prompts repetidos; aplicar en agentes con system prompt grande y recurrente.

## 5. Seguridad, residencia y escalabilidad

- **Seguridad/residencia:** toda llamada sale por `HttpClientService`/`LlmGateway` envuelta por **DataGuard** (ADR 0008);
  el `privacyScope` es estable por conversación aunque cambie el modelo (ADR 0010 D7). Criterios por proveedor a
  verificar: **no entrenamiento** con datos del cliente, **región/residencia** de datos, cifrado en tránsito/reposo,
  certificaciones de cumplimiento. Un modelo con residencia/autoalojado puede ganar peso si un sector lo exige.
- **Escalabilidad:** límites de tasa (RPM/TPM) y cupos por cuenta/región; la cadena de respaldo (ADR 0003 D1) y el
  enrutamiento toleran degradación del proveedor. Verificar SLA y disponibilidad regional en §7.
- **Trazabilidad:** cada turno se mide en `UsageRecord` (modelo, proveedor, costo, tiempo) con **motivo auditable** de
  enrutamiento (ADR 0010 D5), nunca el razonamiento interno del modelo.

## 6. Criterios de decisión ponderados

**Matriz de puntuación (0–5 por criterio, ponderada):**

| Criterio | Peso |
|---|---|
| Calidad / razonamiento | 25 % |
| Costo | 25 % |
| Latencia | 15 % |
| Idoneidad por tarea (cobertura de capacidades) | 10 % |
| Seguridad / residencia | 15 % |
| Escalabilidad | 10 % |

Gana la mayor suma ponderada **por franja de tarea** (no un único ganador global): la plataforma usa varios modelos
mediante el router. Empates se rompen por **seguridad/residencia** y luego **costo**.

### Qué se mediría en una prueba controlada (con autorización de gasto)

1. **Precisión del piloto con modelo real:** correr el *gold set* del piloto de cobranza (`docs/informe-piloto-cobranza.md`,
   `docs/ficha-piloto-cobranza.md`) con cada modelo candidato y medir exactitud/calidad de respuesta contra la referencia.
2. **Latencia p50/p95** por modelo y por tipo de tarea (triage vs. redacción vs. razonamiento), con tamaño de muestra
   representativo.
3. **Costo real** del lote (entrada/salida, efecto del caching) contrastado con el modelo indicativo de §3.
4. **Efecto de la verificación cruzada** (calidad ganada vs. costo/latencia duplicados) en salidas de alto impacto.
5. Datos **sintéticos** o enmascarados, credenciales por bóveda, **tope de gasto duro** autorizado.

> **Recordatorio (gobierno):** esta evaluación es un entregable documental. **Cualquier consumo adicional** —incluidas
> las pruebas con modelos reales de pago— requiere **autorización de gasto del patrocinador**. Construir/analizar no
> implica acceso, gasto ni activación productiva (son autorizaciones distintas).

## 7. Fuentes (indicativas, verificar oficiales)

Las cifras de §3 son **indicativas y no oficiales**. Verificar en las páginas oficiales (prevalecen sobre cualquier
tercero):

- Anthropic (Claude Opus/Sonnet/Haiku, precios, contexto, prompt caching): `anthropic.com/pricing`,
  `docs.anthropic.com` (model overview y prompt caching).
- OpenAI: `openai.com/api/pricing`.
- Google (Gemini / Vertex AI): `ai.google.dev/pricing`, `cloud.google.com/vertex-ai/pricing`.
- Amazon Bedrock (modelos de varios fabricantes, residencia por región): `aws.amazon.com/bedrock/pricing`.
- Azure OpenAI / Azure AI: `azure.microsoft.com/pricing`.
- Modelos abiertos/autoalojados (residencia): documentación del proveedor elegido y del *hosting*.

> Nota: los nombres y precios de modelos cambian con frecuencia. Antes de cualquier decisión con impacto económico,
> reconfirmar precio por MTok (entrada/salida), ventana de contexto, soporte de caching y condiciones de residencia/no
> entrenamiento directamente en la fuente oficial.
