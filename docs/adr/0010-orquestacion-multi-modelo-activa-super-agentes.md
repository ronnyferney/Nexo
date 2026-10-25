# 0010. Orquestación multi-modelo activa: enrutamiento por capacidad/costo y verificación cruzada (super-agentes)

- **Estado:** Aceptado (decisiones de negocio resueltas 2026-10-25 por el dueño del producto)
- **Fecha:** 2026-10-25
- **Responsables:** nexo-architect
- **Relacionado:** ADR 0002 (gobierno multi-LLM y presupuestos), ADR 0003 D1 (cadena de respaldo), ADR 0008
  (DataGuard y observabilidad). Backlog `docs/plan-de-mejora.md` §2 L17 (P1) y L18 (P2), RX-12 (observabilidad).

## Contexto

Nexo ya es multi-proveedor: un agente elige cualquier conexión del catálogo (ADR 0002) y, cuando el modelo principal
falla **por un error del proveedor**, el runtime recorre una **cadena de respaldo** estática `Agent.fallbackModels`
(ADR 0003 D1). Cada intento vuelve a pasar por el gobierno de costos (`budgets.plan`: modelos permitidos por unidad,
presupuesto, degradación) y por `gateway.resolve` (que envuelve el cliente con DataGuard).

Lo que **ya existe** y es reutilizable:

- Catálogo de modelos por workspace con metadatos de capacidad **ya persistidos**: `LlmModel.specialties`
  (`CODE | REASONING | VISION | FAST | GENERAL`, `ModelSpecialty`), `LlmModel.contextTokens` y `tier`
  (`PREMIUM | STANDARD | ECONOMY`), más precio por MTok. No hace falta migración para la metadata de capacidad.
- `LlmGatewayService.resolve(workspaceId, providerId, model)` como **punto único** de acceso al proveedor (incluye
  DataGuard, cupo de plataforma, canales de Claude, OAuth/keyless).
- `AgentRuntimeService.run()` con un bucle que resuelve un modelo, mide cada turno (`beforeTurn`/`onUsage`), imputa el
  consumo al centro de costo y, ante fallo del proveedor, avanza por la cadena (`nextFallback`).
- `UsageRecord` ya registra `model`, `providerId`, unidad, agente, flujo/ejecución y costo por turno.
- Flujos con nodo `agent` y composición (`subworkflow`, `loop`), base para multi-agente.

Lo que **falta** (L17/L18): la selección **activa** del modelo por tarea. Hoy el modelo principal es fijo por agente y
los respaldos solo entran **ante fallo**; no hay forma de decir "usa el modelo rápido y barato para clasificar, el
fuerte para razonar y el de visión para documentos", ni de que un modelo **verifique** lo que otro redactó. La visión
de "super-agentes" es aprovechar varios fabricantes para maximizar resultado y efectividad, no solo tolerar fallos.

Restricciones que la solución debe respetar:
- No romper el modo actual (principal + respaldo). El enrutamiento es **opt-in**.
- Todo candidato debe seguir pasando por el gobierno de costos/presupuestos y por DataGuard; ningún atajo al proveedor.
- El motor de flujos (`apps/api/src/modules/workflows/engine`) sigue siendo TypeScript puro sin Nest ni BD.
- Trazabilidad: hay que poder decir **qué modelo resolvió cada paso y por qué** (relación con RX-12).
- No introducir infraestructura nueva (ni colas, ni tablas que no justifique este ADR).

## Alternativas consideradas

1. **Dejar solo el respaldo ante fallo (statu quo).** Simple, ya probado, pero no cumple la visión: no optimiza
   costo/calidad por tarea ni usa modelos de visión donde hacen falta. Rechazada como solución a L17.

2. **Enrutamiento "mágico" con un LLM que decide el modelo en cada paso.** Un modelo clasifica la tarea y elige el
   mejor modelo. Máxima flexibilidad, pero añade una llamada extra (costo + latencia) y no es determinista ni auditable;
   difícil de presupuestar y de explicar al cliente. Rechazada como mecanismo por defecto; se admite como **estrategia
   opcional** (un modelo `FAST` de triage) dentro del marco de reglas, nunca como única vía.

3. **Capa de enrutamiento declarativa sobre `LlmGateway`, con reglas por capacidad/costo y pool de candidatos del
   workspace, que produce una cadena dinámica (primario + respaldos) consumida por el runtime actual.** Determinista,
   auditable, presupuestable, reutiliza el bucle y el gobierno existentes, y es naturalmente compatible hacia atrás (sin
   política = cadena estática de hoy). **Elegida.**

4. **Verificación cruzada embebida dentro de `client.run` (el driver llama a otro modelo).** Rompe la responsabilidad
   del driver (un cliente = un proveedor, historial nativo propio) y esconde el costo/medición del segundo modelo.
   Rechazada: la verificación cruzada es **orquestación**, vive por encima del gateway, no dentro del driver.

## Decisión

### D1. Una capa de enrutamiento (`ModelRouterService`) sobre `LlmGateway`, no dentro del driver

- Nuevo servicio en `modules/llm` (dueño: `nexo-backend-ai`) que, dado un **contexto de enrutamiento**, devuelve una
  **lista ordenada de referencias `"<providerId>:<modelId>"`** (primario + respaldos) ya filtrada por lo que el
  workspace tiene habilitado. No llama al proveedor: solo **decide y ordena**; resolver, medir e imputar sigue siendo
  del `LlmGatewayService` + `AgentRuntimeService`/`budgets`.
- El `AgentRuntimeService` existente consume esa lista exactamente como hoy consume `fallbackModels`: cada entrada pasa
  por `budgets.plan` (modelos permitidos por unidad, presupuesto, degradación) y por `gateway.resolve` (DataGuard). Así
  el enrutamiento **reutiliza íntegro** el gobierno de costos y la seguridad; no hay un segundo camino al proveedor.
- El contrato del router es puro y testeable (entra el catálogo + la política + señales de la tarea, sale una lista);
  no toca BD directamente, el runtime le pasa el catálogo resuelto.

### D2. Declaración de preferencia: por agente, por skill y por tipo de paso (todo opt-in)

Una **política de enrutamiento** (`RoutingPolicy`, JSON) con esta forma conceptual:

```ts
{
  objective: 'cost' | 'quality' | 'balanced';   // cómo desempatar entre candidatos válidos
  rules: {                                       // en orden; la primera que aplica, gana
    when: { capability?: ModelSpecialty;         // CODE | REASONING | VISION | FAST | GENERAL
            hasImages?: boolean; minContextTokens?: number };
    prefer: { specialties?: ModelSpecialty[]; tier?: Tier; models?: string[] };  // "<providerId>:<modelId>"
  }[];
  maxCandidates?: number;                        // tope de modelos por tarea (costo/latencia)
}
```

- **Por empresa/unidad (gobierno central, decisión 1):** el administrador define desde el inicio los **modelos
  permitidos y los límites** (ya existe `OrgUnit.allowedModels` y el presupuesto jerárquico de ADR 0002) y, además, una
  **política de enrutamiento por defecto** a nivel de workspace/unidad. Cada dueño de agente configura su agente
  **dentro de esas condiciones**: no puede habilitar un modelo prohibido ni superar el presupuesto de su unidad. Este es
  el marco que gobierna a los niveles de abajo.
- **Por agente:** `Agent.routing` (Json, opcional). `null` ⇒ hereda la política por defecto de su unidad (o, si no hay,
  el comportamiento actual: principal `Agent.model` + `Agent.fallbackModels`). Requiere migración (ver Consecuencias). Es
  el nivel principal de L17, siempre acotado por el gobierno central.
- **Por skill:** una skill (ADR 0003 D3) puede declarar una **capacidad requerida** (p. ej. `CODE`); cuando el agente
  carga esa skill, la necesidad se añade como señal de enrutamiento para los pasos de esa skill. Opcional; sin dato, no
  cambia nada.
- **Por tipo de paso / nodo:** el nodo `agent` de flujos y las rutinas pueden traer un **override** de política (p. ej.
  un paso de "triage" fuerza `FAST`/`ECONOMY`; un paso de "extracción de documento" fuerza `VISION`). El override se
  combina sobre la política del agente; no la reemplaza en silencio.

**Determinismo primero:** las señales de la tarea se obtienen de forma **determinista** (modalidad = hay imágenes o
documentos adjuntos en la entrada; capacidad declarada por skill/paso; tamaño de contexto estimado). La opción 2
(un modelo `FAST` que clasifica) es una **estrategia explícita y opcional** declarada en la política, no el camino por
defecto, y su consumo se mide e imputa como cualquier turno.

### D3. Selección de candidatos: capacidad y luego costo, dentro del gobierno existente

Dado el catálogo habilitado del workspace (`gateway.catalog`, que ya refleja conexiones y modelos activos):

1. **Filtra por capacidad:** modelos cuyas `specialties` cubren la necesidad del paso (p. ej. `VISION` si hay
   imágenes); si ninguno declara la capacidad, se usa el conjunto `GENERAL` con un `notice` (no se inventa capacidad).
2. **Filtra por contexto:** descarta los de `contextTokens` insuficiente para la entrada estimada.
3. **Ordena por `objective`:** `cost` → `tier` más económico y menor precio por MTok primero; `quality` → `tier` más
   alto primero; `balanced` → heurística tier/precio documentada.
4. **Recorta** a `maxCandidates`.
5. El runtime pasa cada candidato por `budgets.plan` y `gateway.resolve`: así se respetan `OrgUnit.allowedModels`, el
   presupuesto jerárquico, la **degradación** (`DOWNGRADE`) y el cupo de plataforma. Un candidato no permitido o sin
   presupuesto se omite con aviso (igual que hoy un respaldo inválido); el presupuesto agotado detiene la cadena.

El enrutamiento **nunca habilita** un modelo prohibido por la unidad ni evade un presupuesto: es un **selector sobre lo
ya permitido**. Los modelos con precio 0 (`needsPricing`) no descuentan presupuesto (ADR 0002 D8) y conviene excluirlos
del enrutamiento automático en unidades con presupuesto; el router los deja al final.

### D4. Verificación cruzada y multi-agente heterogéneo (L18): orquestación, no driver

Dos patrones, ambos **por encima** del gateway (reutilizan `AgentRuntimeService`/`gateway.resolve`, cada modelo mide e
imputa su propio consumo):

- **Redactor + verificador (draft-and-critique):** un modelo redacta y **otro de distinto fabricante** critica/verifica
  (y, opcionalmente, el redactor revisa con la crítica). Se declara como una **política opcional de verificación** a
  nivel de agente (`Agent.routing.verify`) o como composición explícita en un flujo. El verificador se elige con las
  mismas reglas de D2/D3. El veredicto del verificador se añade como contexto.
  **Política por defecto (decisión 6):** en tareas **informativas**, un problema detectado **solo advierte**; antes de
  una **acción sensible** (herramienta con efecto, salida al exterior, decisión de negocio, extracción de datos
  sensibles), un problema detectado **exige revisión humana** antes de continuar (no se ejecuta la acción solo). El
  verificador debe **contrastar con las fuentes** (conocimiento del agente, entradas), no opinar en el vacío. Usar **otro
  fabricante** como verificador es **configurable** (recomendado para reducir correlación de errores/sesgos) y siempre
  **respeta los permisos de datos de la empresa** (DataGuard, ADR 0008). Se expone como función **premium** por su costo
  (al menos duplica costo/latencia).
- **Multi-agente por rol con modelos heterogéneos:** agentes como herramientas de otros agentes (backlog "agentes como
  herramientas", item 4 de `AGENTS-TEAM.md`), cada sub-agente con su propio modelo/política. Se apoya en el nodo `agent`
  y en la composición de flujos ya existentes; este ADR no crea un runtime multi-agente nuevo, define cómo encaja el
  enrutamiento por rol cuando ese runtime exista.

**Cuándo aplicarlo:** salidas de alto impacto (decisiones de negocio, código que se ejecutará, contenido que sale al
exterior, extracción de datos sensibles). **Cuándo NO:** triage/clasificación, alto volumen, baja latencia o alta
sensibilidad al costo — la verificación cruzada **al menos duplica** costo y latencia. Por eso es **opt-in** y acotada
por presupuesto; nunca es el modo por defecto.

### D5. Trazabilidad del enrutamiento (relación con RX-12)

- Cada turno ya se mide en `UsageRecord` con `model` y `providerId`; el enrutamiento **no** pierde esa trazabilidad
  porque sigue pasando por `onUsage`.
- **Registro obligatorio (decisión 2):** por cada paso se guarda **modelo utilizado, motivo de selección, costo, tiempo,
  número de intentos y resultado** (éxito/fallo). El **motivo es una regla o código auditable** (p. ej. `VISION_REQUERIDA`,
  `OBJETIVO_COSTO`, `RESPALDO_POR_FALLO`, `VERIFICACION_CRUZADA`), **nunca el razonamiento interno del modelo**: no se
  almacena la cadena de pensamiento ni texto libre generado por el modelo como "motivo". Esto se expone en la consola de
  consumo (`GET /admin/usage/*`) y en RX-12.
- Se añade también el **rol** a la traza (`draft`, `verify`, o el nombre del rol en multi-agente). Decisión de forma de
  dato en Consecuencias (columnas nuevas, preferido, vs. metadato); por la decisión 2 el registro es obligatorio, así que
  se implementa con columnas consultables en `UsageRecord`.
- Se emite un `notice` por cada decisión de enrutamiento (igual que hoy con el respaldo), visible en el chat y en la
  ejecución, para que el usuario sepa qué modelo respondió y por qué.

### D6. Compatibilidad hacia atrás

- `Agent.routing = null` ⇒ el runtime opera **exactamente** como hoy (principal + `fallbackModels`). Ningún agente,
  conversación, flujo, rutina ni definición JSON almacenada cambia de comportamiento sin que alguien active la política.
- El `ModelRouterService` solo se invoca cuando hay política; cuando no, el runtime construye la cadena estática actual.
  La cadena de respaldo ante fallo (ADR 0003 D1) sigue vigente **también** en modo enrutado: el router entrega el orden
  y el bucle sigue tolerando fallos de proveedor.

### D7. Límites y seguridad

- **Topes (decisión 4):** **presupuesto por tarea** y **límite mensual por empresa** (este último reutiliza el
  presupuesto jerárquico de ADR 0002). `maxCandidates` por defecto = **3 intentos totales** por tarea (incluye respaldos
  y verificación; **no** significa consultar 3 modelos en cada tarea: la mayoría resuelve con el primero). Al alcanzar el
  tope de costo o de intentos, el runtime **se detiene e informa** (no sigue gastando en silencio), igual que hoy con el
  presupuesto agotado. El perfil por defecto (decisión 3) es **equilibrado**, con perfiles seleccionables de **ahorro**,
  **equilibrado** y **máxima calidad**, siempre acotados por los límites de la empresa.
- El enrutamiento respeta DataGuard (ADR 0008): el cliente llega envuelto desde `gateway.resolve`; el `privacyScope` se
  mantiene estable por conversación/ejecución aunque cambie el modelo.
- No se introduce ningún camino al proveedor fuera de `LlmGateway`/`HttpClientService`. La política es JSON validado
  (sin `eval`, como toda plantilla); referencias de modelo con el mismo formato `"<providerId>:<modelId>"` ya validado
  (`parseModelRef`).
- Enrutamiento y verificación son estado efímero del turno; nada bloqueante nuevo en la API (el trabajo pesado ya va a
  workers BullMQ en flujos/rutinas).

## Consecuencias

- **Esquema (migración + decisión de producto):**
  - `Agent.routing Json?` (política de enrutamiento y verificación; `null` = comportamiento actual). Migración Prisma
    aditiva, retrocompatible.
  - Trazabilidad de rol/razón (D5): o bien `UsageRecord.role String?` + `UsageRecord.routingReason String?` (consulta y
    agregación directas en la consola, preferido), o bien un metadato ya existente. **Requiere decisión de producto**
    por el impacto en los informes de consumo y en RX-12; si se eligen columnas, es otra migración aditiva.
  - La metadata de capacidad (`specialties`, `contextTokens`, `tier`) **ya existe** en `LlmModel`: sin migración.
- **Contratos de API:**
  - `Agent` (crear/actualizar y `GET /agents/:id`) incluye `routing` opcional.
  - El `done` del chat SSE ya informa `model`/`providerId`/`usage`; se añade la razón de enrutamiento al `notice` y,
    para multi-agente/verificación, el rol por tramo.
  - `GET /admin/usage/*` puede agrupar o mostrar por rol/razón si se añaden las columnas de D5.
- **Frontend:** editor de política de enrutamiento por agente (presets: "equilibrado", "prioriza costo", "prioriza
  calidad", "visión para documentos") y override por nodo `agent`; mostrar en ejecuciones qué modelo resolvió cada paso.
- **Seguridad/rendimiento:** sin nuevos caminos de red; costo/latencia acotados por `maxCandidates` y tope por tarea;
  verificación cruzada opt-in.
- **Compatibilidad de definiciones de flujo:** el override de enrutamiento en el nodo `agent` es un campo opcional nuevo;
  las definiciones guardadas sin él siguen válidas (no requieren versionado de la forma JSON).
- **Plan de pruebas:** unitarias del `ModelRouterService` (selección por capacidad, orden por objetivo, recorte,
  exclusión de `needsPricing`); del runtime (cadena enrutada respeta presupuesto/permisos y degradación, verificación
  cruzada mide ambos modelos, compatibilidad con `routing = null`); e2e de un agente con política de visión sobre un
  documento y de un flujo con triage barato + razonamiento fuerte.

## Decisiones de negocio (resueltas 2026-10-25)

El dueño del producto resolvió las siete preguntas abiertas. Rigen el diseño de arriba y el plan de implementación.

1. **Nivel de configuración → gobierno central desde el inicio.** El administrador define modelos permitidos y límites
   por empresa/unidad, y una política de enrutamiento por defecto a ese nivel. Cada dueño configura su agente **dentro de
   esas condiciones**. (Ver D2, primer nivel.)
2. **Traza de rol/razón → registro obligatorio con columnas.** Se guarda modelo, motivo, costo, tiempo, intentos y
   resultado por paso. El **motivo es una regla/código auditable, nunca el razonamiento interno del modelo**. Se expone
   en la consola de consumo y en RX-12. (Ver D5.)
3. **Objetivo por defecto → equilibrado.** Con perfiles seleccionables de ahorro, equilibrado y máxima calidad, sujetos
   a los límites de la empresa. (Ver D7.)
4. **Topes → presupuesto por tarea + límite mensual por empresa.** `maxCandidates` por defecto = **3 intentos totales**
   (no consultar 3 modelos en cada tarea). Al alcanzar el límite, detener e informar. (Ver D7.)
5. **Triage con LLM → no en la primera versión.** Solo reglas explícitas por tipo de tarea, capacidades requeridas y
   disponibilidad. Se evalúa después si un clasificador mejora los resultados. (Ver D2/D3, señales deterministas.)
6. **Verificación → advertir en tareas informativas; revisión humana antes de acciones sensibles** cuando detecte
   problemas. El verificador contrasta con las fuentes. Otro fabricante es **configurable** y respeta los permisos de
   datos de la empresa. Función premium por su costo. (Ver D4.)
7. **Primera entrega → redactor + verificador**, con trazabilidad y presupuesto compartido. La orquestación completa de
   agentes (agentes como herramientas) queda para una fase posterior, tras validar esta entrega. (Ver plan de
   implementación: fases 1–4 primero; la multi-agente por rol se habilita en una fase posterior.)

## Plan de implementación

Orden de dependencias: contrato (este ADR) → metadata/catálogo → router + runtime → observabilidad → frontend → QA.

| Fase | Tarea | Dueño | Criterio de aceptación |
|---|---|---|---|
| 0 | Confirmar metadata de capacidad del catálogo (`specialties`, `contextTokens`, `tier`) y exponerla donde el router la necesite; sugerir especialidades verificadas para modelos clave | nexo-backend-integrations | El catálogo del workspace entrega capacidad y contexto por modelo; sin inventar datos no verificados |
| 1 | `ModelRouterService` (puro): selección por capacidad, orden por objetivo, recorte, exclusión de `needsPricing`; tipos de `RoutingPolicy` | nexo-backend-ai | Pruebas unitarias cubren capacidad/costo/contexto/topes; función determinista sin BD |
| 2 | Integrar el router en `AgentRuntimeService` (cadena dinámica que reutiliza `budgets.plan`/`gateway.resolve`), `Agent.routing` y migración aditiva; `routing = null` idéntico a hoy | nexo-backend-ai | Enrutamiento respeta presupuesto/permisos/degradación y DataGuard; compatibilidad hacia atrás probada |
| 3 | Verificación cruzada (redactor+verificador) como política opt-in; override de enrutamiento en nodo `agent` y rutinas | nexo-backend-ai (+ nexo-backend-platform para el nodo de flujo) | Ambos modelos miden e imputan; veredicto aplica según política; acotado por tope de costo |
| 4 | Trazabilidad de rol/razón de enrutamiento (columnas D5 si se aprueban) y exposición en consumo/analytics | nexo-backend-platform | `UsageRecord`/informes muestran modelo y razón por paso; alineado con RX-12 |
| 5 | Editor de política por agente (presets) y override por nodo; mostrar el modelo que resolvió cada paso | nexo-frontend-ui + nexo-frontend-core | Build sin warnings; navegación por rol; la política se guarda y se previsualiza |
| 6 | Pruebas de enrutamiento, presupuesto, verificación cruzada y aislamiento | nexo-qa-api + nexo-qa-e2e | Suites en verde contra Postgres/Redis reales; e2e de visión y de triage+razonamiento |
