# Informe del piloto de cobranza (P0.6)

> **Entregable** del plan de ejecución (`docs/decisiones-patrocinador-2026-11-02-plan-ejecucion.md` §3 P0, ítems 6a/6b/6c)
> y de la `docs/ficha-piloto-cobranza.md`. Responde al lineamiento del patrocinador §1.6.
> **Estado:** corrida ejecutada en **sandbox** con **datos sintéticos**, **proveedor mock** y **US$ 0 de gasto externo**.
> **Fecha de corrida:** 2026-11-03. **Autor:** QA-API, con A (arquitecto) para los criterios y riesgos.

## 1. Alcance y condiciones de la corrida

- **Entorno:** sandbox (suite e2e del repo, Postgres/Redis locales). Ningún sistema productivo tocado.
- **Datos:** 100 % sintéticos (empresa/cartera/facturas ficticias: `FV-SINT-001/002/003`, cliente sintético). Sin PII real.
- **Proveedor de modelo:** `mock` (`mock-echo`), `ANTHROPIC_API_KEY` vacío. **Ninguna llamada a un modelo real.**
- **Canales:** modo `SIMULADO`; **sin** envíos de correo/WhatsApp/voz. Grabación de voz **OFF**.
- **Gasto externo:** **US$ 0** (medido). El mock imputa un costo **nominal simulado** de ~US$ 0.0004 por los 5 turnos del
  gestor; **no es gasto real** y se reporta solo como verificación de que el preset de piloto no consume proveedor externo.
- **Arnés reproducible:** `apps/api/test/piloto-cobranza-p06.e2e-spec.ts` (14 casos). Vuelca las métricas reales en un
  bloque `PILOTO_METRICAS_JSON=` al final de la corrida. No hay cifras inventadas: todo número aquí proviene de esa salida.

**Comando de ejecución (infra Postgres/Redis en localhost, env estándar del repo):**

```bash
cd apps/api
NODE_OPTIONS=--max-old-space-size=4096 ANTHROPIC_API_KEY="" \
  npx jest --config ./test/jest-e2e.json --runInBand piloto-cobranza-p06
```

## 2. Recorrido ejecutado (extremo a extremo)

El arnés recorre el ciclo de trabajo por resultados (E4) aplicado a cobranza, con los controles de gobierno intercalados:

1. **Asignación (E5):** se crea el **objetivo** «Recaudo cartera vencida Q4 (sintético)» y se asigna la tarea de cobranza
   al **gestor** (empleado digital, proveedor mock) mediante un `MensajeAgente` de tipo `ASIGNACION`.
2. **Ejecución + contrato de resultado:** el gestor «trabaja» el caso (5 turnos contra el mock, medibles) y se registra el
   **contrato de resultado** con **criterio de aceptación**, **regla de validación determinista** y **evidencia exigida**
   (`confirmacion_tesoreria`). El contrato se compromete y avanza hasta `PENDIENTE_VALIDACION`.
3. **Acción económica (acuerdo de pago):** se solicita una acción `PAGO`; el `ActionGateway` la **detiene** y exige
   **doble aprobación** de **dos humanos distintos**. El **solicitante no puede autoaprobar** (rechazado). Dos aprobadores
   distintos cierran la aprobación.
4. **Excepción y recuperación (contrato):** una primera validación determinista **falla por evidencia faltante** →
   `DEVUELTO_INCUMPLIDO` (excepción detectada y clasificada `EVIDENCIA_FALTANTE:confirmacion_tesoreria`). Se **recupera**:
   se reabre a producción, se aporta la evidencia y se re-presenta a validación.
5. **Verificación por tercero (RF30):** un intento de **autoverificación** (por el agente ejecutor y por el dueño ejecutor)
   es **rechazado**. Un **verificador humano distinto** acepta → resultado `ACEPTADO` (único que cuenta como recaudo).
6. **Devolución con motivo:** un segundo resultado (`FV-SINT-002`) es **devuelto con motivo** por el verificador, para
   demostrar que solo el `ACEPTADO` cuenta y que la devolución conserva el motivo.
7. **Pasaporte de resultado (E14/ADR 0014):** se **emite** sobre el `ACEPTADO`, se **verifica** (cadena verde) y se
   **exporta** con garantías de integridad (hash sha256), trazabilidad (ancla de auditoría) y la leyenda
   `SIN_VALOR_PROBATORIO_PRESUMIDO`.
8. **Trazabilidad (E13):** la **cadena de auditoría** del workspace **verifica OK** (encadenada por hash).
9. **Escalamiento por timeout (HU17):** una solicitud sin respuesta a tiempo genera un mensaje de `ESCALAMIENTO`
   correlacionado.
10. **Clasificación de riesgo:** un impacto sin evidencia → `DESCONOCIDO` → control `DETENER_Y_ESCALAR`.
11. **Excepción por plazo:** el barrido de incumplimientos **detecta** una tarea vencida y abre un incumplimiento
    clasificado `PLAZO_VENCIDO`.
12. **Tiempos:** se leen las latencias de los `UsageRecord` (turnos del gestor) y se confirma gasto externo 0.
13. **Aislamiento multi-tenant:** otra empresa (otro workspace) no ve la tarea ni el pasaporte (404).

## 3. Qué se midió y resultados reales

> Valores de la corrida del 2026-11-03. La latencia del mock es **sub-milisegundo** (no representativa de un modelo real);
> se publica como control de instrumentación, no como medida de rendimiento productivo.

| Métrica | Qué se midió | Resultado real observado |
|---|---|---|
| **Cumplimiento del proceso** | Controles de proceso/gobierno ejercitados y superados | **24/24 = 100 %** |
| **Trazabilidad** | Cadena de auditoría verificable + pasaporte verificable | Cadena `ok=true` (2 entradas ancladas: `APROBACION_CONCEDIDA`, `PASAPORTE_EMITIDO`); pasaporte `verify ok=true`, `documentHash` sha256, `SIN_VALOR_PROBATORIO_PRESUMIDO` |
| **Gestión de excepciones** | Detección, clasificación y recuperación | Contrato: detectada → clasificada `EVIDENCIA_FALTANTE` → **recuperada** y luego `ACEPTADO`. Plazo: detectada → `PLAZO_VENCIDO` (1 incumplimiento abierto) |
| **Tiempos de respuesta** | `latenciaMs` del turno (mock) + ciclo asignación→aceptación | Latencia turno: 5 muestras, 0–1 ms (promedio < 1 ms, p95 ≤ 1 ms). **Ciclo asignación→aceptación: ~0.66–0.77 s** |
| **Efectividad de escalaciones** | Doble aprobación a humanos distintos; timeout; riesgo | Doble aprobación `requiredApprovals=2`, autoaprobación **bloqueada**, aprobado por **2 humanos distintos**; timeout: 1 vencido → **1 escalado**; riesgo `DESCONOCIDO` → `DETENER_Y_ESCALAR` |
| **Gasto externo** | Consumo de proveedor externo | **US$ 0** (mock; costo nominal simulado ~US$ 0.0004, no es gasto real) |
| **Aislamiento multi-tenant** | Visibilidad desde otro workspace | 404 en tarea y pasaporte |
| **Precisión** | Correctitud de las respuestas del modelo | **No medible con mock** — ver §6 (metodología + pendiente de autorización) |

## 4. Criterios de aceptación propuestos (umbrales por métrica)

Umbrales propuestos para la **decisión go/no-go a producción**. Los marcados «hoy» se cumplen en esta corrida sandbox;
los de precisión/latencia real requieren la corrida con modelo real (§6).

| Métrica | Umbral propuesto | Estado en sandbox |
|---|---|---|
| Cumplimiento del proceso | **100 %** de los controles de gobierno (no hay acción económica sin doble aprobación; verificador ≠ ejecutor; solo `ACEPTADO` cuenta) | **Cumple** (24/24) |
| Trazabilidad | Cadena de auditoría `ok` **siempre**; 100 % de resultados aceptados con **pasaporte verificable** y export íntegro | **Cumple** |
| Gestión de excepciones | 100 % de excepciones **detectadas y clasificadas**; **≥ 90 %** recuperadas o declaradas (nunca «activo para siempre») | **Cumple** (recuperación y declaración acotada demostradas) |
| Tiempos — ciclo | Ciclo asignación→aceptación **p95 ≤ 1 día hábil** (a validar con volumen real) | Instrumentado (sandbox: < 1 s, no representativo) |
| Tiempos — latencia modelo | **p95 ≤ 8 s** por turno (umbral a confirmar con modelo real) | Instrumentado (mock sub-ms, no representativo) |
| Efectividad de escalaciones | **100 %** de acciones de alto impacto a aprobación humana distinta del solicitante; **100 %** de bloqueos/timeouts con escalamiento correlacionado | **Cumple** |
| Gasto externo (piloto) | **US$ 0** externo | **Cumple** |
| Aislamiento multi-tenant | **0** fugas entre workspaces | **Cumple** |
| **Precisión** (con modelo real) | **≥ 90 %** de acierto contra un **gold set** etiquetado por humano (umbral inicial, calibrable) | **Pendiente** (§6) |

## 5. Riesgos identificados

1. **Precisión no evaluada (ALTA).** Con mock no hay señal de calidad del modelo. Un go a producción sin la corrida del §6
   sería una decisión sin dato de precisión. **Dueño: BIA + QA.**
2. **Enrutamiento del escalamiento a la persona concreta es un seam (MEDIA).** El `ESCALAMIENTO` se crea y correlaciona,
   pero la resolución del **suplente/superior concreto** (a qué humano exacto llega) está marcada como seam de E3/IA en
   `mensajes.service.ts` (`destinatarioAgentId: null`). El control fuerte sí existe hoy en el flujo de **aprobaciones**
   (humano distinto del solicitante). Debe cerrarse el ruteo nominal antes de producción. **Dueño: BIA (E3/E5).**
3. **Latencia y costo reales desconocidos (MEDIA).** Los tiempos de respuesta del modelo y el costo por resultado solo
   serán representativos con la corrida con modelo real; los umbrales de §4 son provisionales. **Dueño: BP + QA.**
4. **Umbrales monetarios de acciones económicas sin fijar (MEDIA).** El catálogo nace con `umbralMonto`/`moneda` nulos
   (los define Finanzas). El piloto usó doble aprobación por defecto; falta parametrizar umbrales reales. **Dueño: BP + Finanzas.**
5. **Volumen y concurrencia no probados (MEDIA).** La corrida es de un caso guiado; no mide carga, colas ni condiciones de
   carrera con cartera masiva. **Dueño: QE.**
6. **Cumplimiento/jurídica pendientes (MEDIA).** El pasaporte declara explícitamente `SIN_VALOR_PROBATORIO_PRESUMIDO`; la
   validación de valor probatorio y matriz de cumplimiento siguen pendientes (P1 3a/3b, lineamientos §2/§3). **Dueño: A.**
7. **Canales reales no autorizados (controlado).** Todo en `SIMULADO`; la activación de correo corporativo está en diseño
   (P2.7) y **no** se ejecuta. Riesgo controlado mientras no se autorice. **Dueño: BINT + BP.**

## 6. Precisión — metodología y pendiente de autorización

**Por qué no se mide hoy:** el proveedor `mock` es determinista y no razona; sus salidas no provienen de un modelo real,
por lo que cualquier «precisión» medida sería un artefacto del mock, no de la capacidad de cobranza. **No se reporta
ninguna cifra de precisión.** Estado: `PENDIENTE_CORRIDA_CON_MODELO_REAL`.

**Metodología propuesta para medirla (corrida acotada con modelo real):**

1. **Gold set etiquetado por humano:** un conjunto acotado (p. ej. 50–100 casos sintéticos) con la **respuesta correcta
   esperada** por caso: ¿procede acuerdo de pago?, monto/plazo correcto, tono y política aplicada, evidencia exigida
   correcta, decisión de escalamiento adecuada.
2. **Ejecución controlada:** correr el mismo recorrido del arnés con el modelo por defecto (`claude-opus-5-5`) sobre el gold
   set, en sandbox, con presupuesto **acotado y tope duro** (bloqueo al 100 %) y degradación desactivada para no sesgar.
3. **Métricas de precisión:** acierto global (%), precisión/recall por tipo de decisión (acuerdo/escalamiento/devolución),
   tasa de alucinación (afirmaciones sin evidencia), y tasa de acciones económicas correctamente detenidas. Comparar
   siempre la salida del modelo contra la etiqueta humana, **no** contra otra salida del modelo.
4. **Criterio de aceptación inicial:** **≥ 90 %** de acierto contra el gold set (calibrable por el patrocinador), con
   **0** acciones económicas ejecutadas sin aprobación humana.

**Qué autorización requiere:** esta corrida implica **gasto de proveedor externo** (consumo de modelo real), hoy impedido
por el límite **US$ 0**. Requiere **autorización específica de gasto** del patrocinador (una de las 4 autorizaciones:
**gasto**), con un tope presupuestario definido. No implica activar canales reales ni contactar clientes: sigue siendo
sandbox con datos sintéticos.

## 7. Recomendación (no es aprobación)

El piloto en sandbox demuestra que el **proceso gobernado** de cobranza funciona extremo a extremo: controles,
trazabilidad, excepciones y escalaciones se comportan según la ficha. **Queda como condición de go/no-go a producción** la
corrida de **precisión con modelo real** (§6, requiere autorización de gasto) y el cierre de los riesgos 2–6. Se deja a
decisión del patrocinador; este informe **registra evidencia y recomendación, no constituye aprobación** de gasto,
activación de canales ni producción.

## 8. Evidencia y reproducibilidad

- **Arnés de métricas (e2e):** `apps/api/test/piloto-cobranza-p06.e2e-spec.ts` — 14 casos, todos en verde.
- **Salida de métricas:** bloque `PILOTO_METRICAS_JSON=` impreso al final de la corrida (origen de todas las cifras de §3).
- **Validaciones ejecutadas:** `npm run typecheck`, `npm run lint`, `npm test` (1465 pruebas en verde) y `npm run build`,
  más el e2e del piloto con `NODE_OPTIONS=--max-old-space-size=4096` y `ANTHROPIC_API_KEY=""`.
