# Plan de pruebas de parametrización — NEXO

Valida que **todo lo configurable** de NEXO se parametriza correctamente, **persiste**, respeta **rol y aislamiento
por workspace**, rechaza entradas inválidas y, sobre todo, **surte efecto aguas abajo** (la parametrización cambia el
comportamiento real del runtime, los costos y el gobierno). Es complementario a `guia-pruebas-funcionales.md` (que prueba
el comportamiento de cada feature) y a `qa-matriz-organizacion-digital.md` (trazabilidad QA/HU).

> **Marco de autorización (gobierno).** Toda la parametrización de este plan se ejecuta en **sandbox con datos
> sintéticos** (Transportes Vigía), **sin gasto** y **sin activación productiva** de canales externos. Las credenciales
> se cargan solo por la **bóveda** (`{{ secrets.NOMBRE }}`), nunca por chat ni en el cuerpo de la prueba. Activar correo,
> WhatsApp, voz o un gasto real requiere autorización específica (ver `plantilla-solicitud-activacion-real.md`).

## 1. Objetivo y alcance

- **Objetivo:** dar un criterio go/no-go de que NEXO es **parametrizable de forma segura y consistente** antes de liberar
  la versión de pruebas.
- **En alcance:** la configuración que hace un ADMIN/OWNER al implantar una empresa: workspace y seguridad, estructura
  organizacional y dimensiones, empleados digitales (cargos, expediente, jerarquía), conexiones y canales (conectores,
  Edge, estaciones, candado de internet), IA (conexiones LLM y enrutamiento), economía (presupuestos, imputación,
  umbrales), gobierno (políticas, aprobaciones, suspensión) y la configuración por agente.
- **Fuera de alcance (lo cubre la guía funcional):** el comportamiento interno de cada feature una vez configurada (p. ej.
  cómo responde un agente, cómo avanza un flujo). Aquí probamos *que la configuración existe, valida, persiste y aplica*.

## 2. Criterios de aceptación transversales (aplican a CADA parámetro)

Cada caso se da por aprobado solo si cumple todos los que le apliquen:

1. **Persistencia:** el valor guardado se relee igual tras recargar y tras reiniciar la sesión.
2. **Validación de entrada:** valores inválidos/vacíos/fuera de rango se rechazan con mensaje claro (nunca 5xx).
3. **Rol mínimo:** un VIEWER/EDITOR sin permiso no puede ver ni cambiar el parámetro (`@MinRole`, 403/oculto).
4. **Aislamiento multi-tenant:** el parámetro de un workspace no es visible ni editable desde otro (filtra por
   `workspaceId` del token, nunca del cuerpo).
5. **Efecto aguas abajo:** el cambio **se refleja** donde debe (runtime, costos, gobierno, versión inmutable del agente).
6. **Idempotencia / no duplicado:** reenviar la misma alta no crea duplicados; las claves únicas se respetan.
7. **Auditoría:** los cambios sensibles (políticas, presupuestos, accesos, lanzamiento) quedan en la bitácora encadenada.
8. **Sin fuga de secretos:** credenciales nunca se devuelven en claro; se guardan cifradas / como hash.

## 3. Entorno y datos de prueba

- **Entorno:** proveedor LLM **mock**, `REGISTRATION_MODE=open`, red privada permitida (ver `guia-pruebas-funcionales.md`
  §1). API `:3000`, Web `:4200`. Validación de código: `npm run build` + `npm run test:ci` (Karma: `CHROME_BIN`) en web;
  `npm run typecheck && lint && test && build` en API.
- **Juego de datos sintéticos (Transportes Vigía):**
  - Grupo: *Grupo Empresarial Vigía*; empresas: *Transportes Vigía*, *Phari Tech*; líneas de negocio y 2 sedes.
  - Centros de costo por área (Operaciones, Cartera, TI); dimensión D8 ejemplo (p. ej. "Proyecto").
  - Cargos: *Analista de cobranza*, *Coordinador de flota*; 1 agente por cargo con responsable titular y suplente.
  - 2 usuarios por rol (OWNER, ADMIN, EDITOR, VIEWER) para las pruebas de permisos.

## 4. Matriz de parametrización por dominio

Formato de cada caso: **parámetro → caso válido / caso inválido / límite → efecto esperado**. Nivel sugerido de prueba
entre corchetes: `[API]` unit/integración (Jest+Supertest), `[E2E]` Playwright, `[Man]` manual exploratoria.

### 4.1 Workspace y seguridad (`/ajustes` → Ajustes generales / Seguridad; módulo `workspaces`, `data-protection`)
- Ajustes generales del workspace (nombre, `allowPersonalAgents`): guarda y persiste; `allowPersonalAgents=false` impide
  crear agentes personales. [API][E2E]
- Privacidad/retención de conversaciones: cambiar el período de retención aplica al limpiar; valor negativo se rechaza. [API]
- **Bóveda de secretos** (`{{ secrets.X }}`): alta de secreto → se guarda **cifrado**, no se devuelve en claro; usado por
  un conector resuelve en la llamada saliente. Borrar un secreto en uso avisa/bloquea. [API][Man]
- **API keys** del workspace: generación muestra el valor **una sola vez**; se guarda como **hash**; revocar invalida el
  acceso a `/api/mcp`. [API]

### 4.2 Organización (`/ajustes` → Organización/Estructura/Dimensiones/Grupos; módulo `governance/estructura`, `dimensiones`, `groups`)
- **Estructura** (grupo → empresas → líneas → sedes → centros de costo): alta jerárquica; un solo "root" por workspace
  (índice parcial `OrgUnit_root_per_workspace`); no permite borrar una unidad con hijos o asignaciones. [API][E2E]
- Asignación matricial empleado↔(área/línea/sede) con alcance y vigencia: fechas invertidas se rechazan. [API]
- **Dimensiones configurables (D8):** crear una dimensión y sus valores; clasificar sin cambiar esquema; la dimensión
  aparece como eje en la consola de análisis (pivot). [API][E2E]
- **Grupos de usuarios:** crear grupo, agregar miembros; un share a ese grupo habilita USE incluso a VIEWER. [API]

### 4.3 Empleado digital (Agentes · Cargos · Organigrama; módulo `cargos`, `agents`, `hierarchy`)
- **Cargo** (propósito, funciones, entregables, indicadores, límites, nivel): alta y reutilización en varios agentes. [E2E]
- **Expediente del agente:** responsable **titular** y **suplente**, nivel jerárquico, estado de ciclo de vida.
  **Regla dura:** no se puede **publicar/lanzar** un agente **sin responsable**. [API][E2E]
- **Jerarquía / organigrama:** delegación, supervisión y reemplazo. **Negativos:** rechazar **ciclos** y
  **autoaprobación** (un nodo no se supervisa a sí mismo). [API]

### 4.4 Conexiones y canales (`/ajustes`; módulo `connectors`, `oauth`, `edge`, `execution-params`)
- **Conectores** REST/SOAP/GraphQL/MCP/DATABASE: alta + importación de operaciones (OpenAPI/WSDL); autenticación
  (API key, Bearer, Basic, OAuth2) referida a la **bóveda**. Host privado bloqueado por **SSRF** salvo whitelric del
  entorno. DATABASE en modo `read` solo acepta `SELECT`/`WITH`; escritura solo con `allowWrites`. [API][E2E]
- **Catálogo/integraciones:** instalar una integración crea secretos `<SLUG>_<CAMPO>`, el conector y sus operaciones. [API]
- **OAuth2 de usuario:** iniciar y completar el callback deja tokens **cifrados**; renovación serializada por conector. [API]
- **Nexo Edge:** registrar un Edge emite token `nexoedge_...` (guardado como hash); `edge.yaml` re-valida políticas locales;
  un conector DATABASE en modo `edge` enruta por el socket. [API][Man]
- **Estaciones virtuales:** alta de estación por la UI (el proveedor es solo etiqueta, **nunca** guarda credenciales);
  asignación a un agente en la pestaña «Ejecución». [E2E]
- **Candado de internet (parámetros de ejecución):** por agente, **navegación web** y **sistemas autorizados** como
  categorías independientes. **Efecto aguas abajo crítico:** con el candado cerrado, el runtime **bloquea** la salida
  correspondiente **con y sin estación** (cierre de elusión); con permiso explícito, el flujo legítimo pasa. La versión
  inmutable del agente registra el valor. [API][E2E]

### 4.5 IA (`/ajustes` → Conecta tu IA; módulo `llm`)
- **Conexión LLM:** alta de proveedor (Anthropic / OpenAI-compatible) con clave en bóveda; selección de **modelo** y
  **tarifa**; probar conexión. Clave inválida se reporta sin exponerla. [API][E2E]
- **Modelo por defecto** del agente y **cadena de respaldo** (`fallbackModels`): si el primero falla, recorre la cadena y
  **cada intento pasa por el gobierno de costos**. [API]
- **Política de enrutamiento multi-modelo (ADR 0010):** editor de política; el router asigna rol/razón y queda trazado en
  `UsageRecord`. [API][E2E]

### 4.6 Economía (`/ajustes` → Presupuestos/Imputación; módulo `governance` budgets/imputacion)
- **Bolsas de presupuesto** por empresa/línea/período: alta de límite; **modelos permitidos**; **bloqueo** o
  **degradación** al superar. **Efecto:** `assertCanSpend` **bloquea o degrada** el turno del agente; `record` incrementa
  el libro mayor de forma **atómica** en toda la cadena. [API]
- **Umbrales/alertas:** configurar umbral → al cruzarlo se registra `BudgetAlert` y se ve en la consola (no notifica por
  correo/Slack). [API]
- **Imputación de costos / servicios compartidos:** definir servicio interno y reparto. **Negativo:** el reparto debe
  **sumar 100 %** y **sin doble conteo**; cualquier otra cosa se rechaza. [API]

### 4.7 Gobierno de acciones (`/ajustes`/Gobierno; módulo `governance/policy`+`actions`, `audit`)
- **Políticas versionadas** de acciones sensibles + **niveles de riesgo**: crear/editar política; aplica **server-side**. [API]
- **Bandeja de aprobaciones:** acción que requiere aprobación **no procede** sin ella; el **hash del contenido** invalida
  la aprobación si el contenido cambió; **doble aprobación** donde se exige. [API][E2E]
- **Suspensión de emergencia:** suspender detiene la ejecución; reactivar la restablece. [E2E]
- **Auditoría inmutable:** cada decisión/aprobación/política/acceso encadena por **hash**; el visor verifica la cadena y
  detecta manipulación. [API][E2E]

### 4.8 Trabajo por resultados (Mi trabajo; módulo `results`)
- **Objetivo → tarea → ContratoResultado:** parametrizar criterios de aceptación e indicadores. **Regla dura:** el
  **ejecutor no valida su propio resultado** (lo acepta un tercero). Incumplimiento escala según lo configurado. [API][E2E]

### 4.9 Configuración por agente (Agentes; módulo `agents`, `agent-access`, `skills`, `knowledge`, `routines`)
- **Perfil/prompt:** composición desde el perfil; previsualización (`/agents/:id/prompt-preview`). [E2E]
- **Operaciones asignadas, skills, conocimiento:** habilitar/deshabilitar cambia las tools disponibles del agente. [API]
- **Visibilidad y shares** (`PRIVATE/TEAM/WORKSPACE`; principal USER/UNIT/GROUP; permiso USE/EDIT): un agente no visible
  responde **404**; pasar a WORKSPACE exige estado **LAUNCHED**. [API]
- **Salud y lanzamiento:** `launch` exige **salud ≥ 70** y última evaluación ≥ `targetScore` (o override ADMIN con motivo). [API]
- **Rutinas (cron con zona horaria):** alta de rutina; solo corre si el agente está `LAUNCHED` (o `PRIVATE` con dueño). [API]

### 4.10 Canales externos — sandbox (`/ajustes` → Canales externos/Voz; módulo `channels`)
- **Cuentas de correo/WhatsApp/voz por empresa:** alta de cuenta/número con credenciales en bóveda; **modo sandbox**
  (adaptador simulado), **sin envío real** ni gasto. Plantillas y estados de mensaje. [E2E][Man]
- **Grabación/retención (Jurídica):** configurar `GrabacionConfig` (grabar/retención) y verificar que el control aplica
  en el flujo simulado. [API]

## 5. Pruebas transversales de seguridad y multi-tenant (bloqueantes)

- **Aislamiento:** crear datos en WS-A y verificar que WS-B no los ve ni edita en **todos** los módulos anteriores. [API]
- **Rol mínimo:** repetir cada alta/edición con VIEWER y EDITOR y confirmar 403/oculto donde corresponde. [API]
- **SSRF / entradas:** conectores/estaciones/Edge rechazan host privado no autorizado; DTO inválido no produce 5xx. [API]
- **Secretos:** ningún endpoint devuelve secreto/token en claro; API keys y tokens Edge como hash. [API]

## 6. Pruebas negativas y de límites (checklist)

- Duplicados (misma empresa/conector/estación) → rechazo por clave única. 
- Jerarquía con ciclo o autoaprobación → rechazo. 
- Reparto de imputación ≠ 100 % o con doble conteo → rechazo. 
- Fechas de vigencia invertidas, números negativos, cadenas vacías → rechazo con mensaje. 
- Publicar agente sin responsable / lanzar con salud < 70 → bloqueo. 
- Acción sensible sin aprobación / con contenido cambiado tras aprobar → bloqueo.

## 7. Niveles de prueba y automatización

- **API (Jest + Supertest contra Postgres/Redis reales):** persistencia, validación, rol, multi-tenant, efecto en costos
  y gobierno (la mayor parte de §4–§6).
- **E2E (Playwright, stack vivo):** recorridos de parametrización por la UI (estructura, dimensiones, estación + candado,
  aprobaciones, lanzamiento). Caso de referencia ya verde: `e2e/estaciones-ejecucion.spec.ts` (menú → Ajustes → estación
  → asignación → candado → guardar).
- **Manual exploratoria:** Edge, canales sandbox, verificación visual de consolas.
- **Comando de validación obligatorio** por cambio tocado (regla de calidad del repo). Cada bug encontrado lleva una
  prueba que lo reproduce.

## 8. Criterios de entrada / salida (go / no-go)

- **Entrada:** entorno sandbox levantado, datos de Transportes Vigía cargados, build y suite unitaria en verde.
- **Salida (liberar):** 100 % de casos **bloqueantes** (§5, §6 y los "efecto aguas abajo" de §4.4/4.6/4.7) en verde;
  0 defectos críticos/altos abiertos; e2e de parametrización en verde; evidencia registrada (§10).

## 9. Riesgos y dependencias

- Sin autorización de activación real, los canales externos solo se prueban en **sandbox**.
- Umbrales de Finanzas y controles de Jurídica dependen de definiciones del patrocinador (ver
  `solicitud-finanzas-umbrales.md`, `consultas-juridica-grabaciones-evidencia.md`).
- El "efecto aguas abajo" del candado y del presupuesto es lo más crítico: si uno falla, es **no-go**.

## 10. Registro de evidencia (plantilla por caso)

| Id | Dominio | Parámetro | Caso (válido/inválido/límite) | Rol | WS | Resultado esperado | Efecto aguas abajo | Resultado | Evidencia |
|----|---------|-----------|-------------------------------|-----|----|--------------------|--------------------|-----------|-----------|
| P-001 | 4.4 | Candado internet | Cerrado, sin estación | ADMIN | A | Egress bloqueado | Runtime niega salida | ✅/❌ | captura/log |
