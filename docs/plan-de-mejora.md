# Plan de mejora y seguridad de Nexo

Registro único de lo que falta para que Nexo sea seguro y completo. Nada se elimina de esta lista: cada punto cambia
de estado (`Pendiente` → `En curso` → `Hecho (commit)`) o pasa a `Descartado (motivo)`. Fuentes: auditoría de
seguridad independiente (2026-10-24), investigación de mecanismos de conexión de los proveedores LLM (2026-10-24) y
hallazgos del desarrollo y de las pruebas RPA.

Prioridades: **P0** antes de abrir el registro o desplegar a clientes · **P1** esta semana · **P2** siguiente
iteración · **P3** higiene.

## 1. Seguridad

| ID | Sev. | Prio. | Hallazgo | Corrección | Estado |
|---|---|---|---|---|---|
| C1 | Crítica | P0 | Registro y alta de miembros sin verificar el correo: alguien crea de antemano la cuenta de un correo ajeno y recibe la membresía cuando el cliente lo agrega (`auth.service.ts`, `org.service.ts` `addMember`) | Verificación de correo; alta de miembros por invitación que acepta el dueño del correo; nunca unir una cuenta no verificada a otro workspace; registro público desactivable | Hecho (2c14ff8, ebbd311): invitaciones, verificación con enlace + sesión, `REGISTRATION_MODE`, recuperación de contraseña por correo y revocación de API keys al recuperar una cuenta |
| A1 | Alta | P0 | Los SDK de Claude (Anthropic, Vertex, Google Cloud, Foundry) salen sin la protección SSRF y devuelven la respuesta en el error (`drivers/anthropic.driver.ts`) | `fetch` con la política SSRF de Nexo en todos los SDK; solo hosts oficiales por canal o `LLM_PROVIDER_URL_OVERRIDES`; sin cuerpo crudo en errores | Hecho (21bb525) |
| A2 | Alta | P0 | `POST/PATCH /admin/llm/connections` aceptan `baseUrl`/`kind` libres: un ADMIN desvía claves y tokens OAuth que no puede ver | `baseUrl`/`kind` inmutables con `providerId`; pedir la clave al cambiar destino; borrar tokens OAuth si cambia | Hecho (3f84936) |
| A3 | Alta | P1 | SSRF eludible: IPv6 mapeada en hexadecimal, NAT64 y 6to4 sin bloquear; DNS rebinding (`http-client.service.ts`, adaptadores de BD y MCP) | `net.BlockList` con rangos IPv4/IPv6; resolver una vez y conectar a la IP validada | Hecho (749f411) |
| A4 | Alta | P1 | Un EDITOR o una API key leen cualquier secreto de la bóveda desde un conector (`connectors.service.ts` `resolveAll`) | Secretos permitidos por conector, fijados por un ADMIN | Hecho (12b09ea): `Connector.allowedSecrets`, `PUT /connectors/:id/allowed-secrets` (ADMIN), migración con los secretos ya referenciados y existentes (ADR 0005); un EDITOR tampoco puede cambiar el destino (URL, host, URLs OAuth) de un conector con secretos permitidos |
| A5 | Alta | P0 | Sin `trust proxy` el throttling usa la IP de nginx: 10 intentos de login por minuto bloquean a todos; almacenamiento en memoria por instancia | `trust proxy` (ALB + nginx), throttling en Redis, límite por cuenta en el login | Hecho (6897876) |
| A6 | Alta | P0 | Cualquier registro gratuito consume la `ANTHROPIC_API_KEY` de la plataforma sin cupo | Cupo mensual de plataforma por workspace (como el Copilot), habilitable por plan | Hecho (3f84936): `PLATFORM_LLM_MONTHLY_USD`, por defecto 5 USD |
| A7 | Alta (cond.) | P0 | `PLATFORM_ADMIN_EMAILS` se apropia registrando un correo listado sin cuenta | Correo verificado (C1) y aviso en el arranque de correos sin cuenta | Hecho (2c14ff8) |
| A8 | Alta (cond.) | P0 | `docker-compose.yml` publica PostgreSQL (`nexo/nexo`) y Redis sin contraseña en 0.0.0.0 | Enlazar a 127.0.0.1 o quitar `ports`; `requirepass`; contraseña obligatoria | Hecho (6897876) |
| M1 | Media | P1 | `state` OAuth no ligado al navegador: phishing de consentimiento y de código de dispositivo | Cookie HttpOnly con nonce comprobada en el callback; mostrar la cuenta autorizada | Hecho: OAuth web (92b45a1), conectores (12b09ea) y código de dispositivo con confirmación de la cuenta (6274fb6) |
| M1b | Media | P1 | El OAuth de conectores (ADR 0005) tampoco liga el `state` al navegador; el código de dispositivo no admite cookie | Misma cookie de ligadura en conectores; en código de dispositivo, mostrar la cuenta autorizada antes de activar | Hecho: cookie en conectores (12b09ea); código de dispositivo con la cuenta autorizada y confirmación del ADMIN (6274fb6) |
| M2 | Media | P1 | `/api/mcp` sin `@MinRole`: un VIEWER ejecuta flujos | `@MinRole('EDITOR')` | Hecho (6897876) |
| M3 | Media | P1 | Un ADMIN se asciende a OWNER y saca al fundador | Solo un OWNER otorga o retira OWNER | Hecho (6897876) |
| M4 | Media | P1 | Valores del LLM sin codificar en ruta y query de conectores REST | `encodeURIComponent`; rechazar `..`, `?`, `#` y URL absolutas | Hecho (749f411) |
| M5 | Media | P1 | Límite de 5 MB comprobado tras leer todo el cuerpo | Lectura por flujo con corte al superar el límite | Hecho (749f411) |
| M6 | Media | P1 | La web no envía CSP, `X-Frame-Options`, HSTS ni `Referrer-Policy`; JWT en `localStorage` | Cabeceras en nginx; evaluar cookie HttpOnly para la sesión | Hecho: cabeceras (6897876); sesión en cookie HttpOnly + CSRF de doble envío firmado y `POST /auth/logout` (d6be879) |
| M7 | Media | P1 | Sin dominio el piloto se publica por HTTP | Exigir TLS en el despliegue | Hecho (447b1aa): sin dominio con certificado el piloto no se sintetiza |
| M8 | Media | P2 | ADR 0008 sin implementar: datos personales sin enmascarar hacia el LLM; conversaciones sin retención | DataGuard D1-D2 y retención D7 | Hecho en parte (6274fb6): DataGuard D1-D2 (off/mask/block) y retención D7; ajustes en PostgreSQL (2593633); pendiente: D3-D6 y política por categoría |
| M9 | Media | P1 | Los secretos de ejemplo (`JWT_SECRET`, `ENCRYPTION_KEY` en ceros) pasan la validación | Rechazar placeholders y claves de baja entropía | Hecho (6897876) |
| B1 | Baja | P2 | Token de webhook y `code`/`state` OAuth en los logs | Redactar rutas y query sensibles | Hecho (6897876) |
| B2 | Baja | P2 | Uso único del `state` solo en memoria por instancia | `jti` en Redis/BD con `SET NX` | Hecho: OAuth de LLM y OpenRouter (e1cbc74) y de conectores (6274fb6), con fallo cerrado |
| B3 | Baja | P2 | JWT sin revocación; API keys sin expiración ni alcance | `tokenVersion`; expiración y alcance de API keys | Hecho: `tokenVersion` (2c14ff8); expiración, alcance y revocación de API keys (ebbd311) |
| B4 | Baja | P2 | Enumeración de correos (registro y tiempo de login) | Respuesta genérica y bcrypt ficticio | Hecho (d6be879): registro con respuesta única sin sesión; login con hash ficticio |
| B5 | Baja | P1 | `POST /connectors/:id/test` sin `@MinRole` | `@MinRole('EDITOR')` | Hecho (749f411) |
| B6 | Baja | P2 | ReDoS por `pattern` del `inputSchema` | Ajv con RE2 o límite de longitud | Hecho (749f411) |
| B7 | Baja | P2 | AES-GCM sin AAD ni versión de clave (rotación imposible) | Prefijo de versión + AAD; rotación con KMS (ADR 0008 fase 2) | Hecho (6274fb6, 0abbe43): formato `v2:<kid>:`, AAD, `ENCRYPTION_KEYS` en compose y en el piloto, `npm run crypto:rotate`; pendiente: KMS (ADR 0008 fase 2) |
| B8 | Baja | P2 | Redis sin AUTH/TLS; RDS sin protección contra borrado; ECS Exec activo | Endurecer la infraestructura | Hecho en infraestructura (447b1aa); `REDIS_TLS` en la API (2c14ff8) |
| B9 | Baja | P2 | El Copilot guarda agentes con modelos fuera del catálogo | Reusar `LlmUsageService.assertAgentModels` | Hecho (3f84936) |
| B10 | Baja | P2 | Swagger público en producción | Solo fuera de producción o autenticado | Hecho (6897876) |
| I1 | Info | P2 | El simulador LLM depende de `NODE_ENV=production` | No registrar el controlador fuera de desarrollo + prueba del bloqueo | Hecho (3f84936): exige `NODE_ENV=development` o `test` |
| I2 | Info | P3 | `npm audit`: 9 altas y 2 moderadas en la API, 3 altas en Edge (hoy no explotables) | Actualizar en el ciclo normal | Hecho (cf32f31): `npm audit` en 0 en api, web, edge e infra |
| I3 | Info | P3 | `/auth/me` y `/auth/switch-workspace` con API key responden 500 | 403 explícito | Hecho (6897876) |

Buenas prácticas ya presentes que no se deben romper: ver la sección 4 del informe de auditoría (rol leído de la
membresía en cada petición, consultas acotadas por `workspaceId`, PKCE S256 y `state` firmado de un solo uso, tokens y
claves cifrados con AES-256-GCM, `redirect: 'manual'` en el cliente HTTP, `postMessage` con origen exacto, etc.).

## 2. Conexión con proveedores LLM

| ID | Prio. | Punto | Estado |
|---|---|---|---|
| L1 | P0 | Postura: Nexo no usa suscripciones personales (Claude Pro/Max, ChatGPT Plus) ni client_id de otros productos (ADR 0002 D8) | Hecho |
| L2 | P1 | Workload Identity Federation para la API de Anthropic (sin claves; requiere emisor OIDC público de Nexo) | Hecho (e1cbc74): requiere dominio público https para el emisor OIDC y `LLM_WIF_SIGNING_KEYS` |
| L3 | P1 | Amazon Bedrock y Claude Platform on AWS con rol de IAM + `ExternalId` (sin claves de larga duración) | Hecho (e1cbc74): requiere `LLM_AWS_PRINCIPAL_ARN` y permiso `sts:AssumeRole` en la infraestructura |
| L4 | P1 | Corregir el catálogo de Bedrock: hoy recomienda una clave de larga duración («solo para exploración» según AWS) | Hecho (bf53087): token de corta duración |
| L5 | P1 | Retirar modelos retirados: Llama 4 Scout en Groq, Kimi K2 0905 en Fireworks | Hecho (bf53087); pendiente: sugerir reemplazos verificados |
| L6 | P1 | Azure: alcance `https://ai.azure.com/.default`, host `services.ai.azure.com`, rol RBAC documentado | En parte (bf53087): alcance y roles de Foundry; pendiente: host y rol de recursos clásicos |
| L7 | P1 | Entra ID para Claude en Microsoft Foundry (verificar el alcance oficial) | Hecho (bf53087); el operador registra el redirect URI en la app de Entra |
| L8 | P1 | Verificación de la app de Google (sin ella el refresh token caduca a los 7 días) y registro de los redirect URI | Pendiente |
| L9 | P2 | OpenAI: modelos actuales; programa «Sign in with ChatGPT» solo si Nexo es aceptado como socio | En parte (bf53087): modelos actuales |
| L10 | P2 | xAI con la API Responses (Chat Completions marcada como legacy) | Pendiente: la especificación oficial aún no marca Chat Completions como legacy |
| L11 | P2 | DeepSeek: modelos `deepseek-v4-pro`/`v4-flash` y `docsUrl` oficial | Pendiente: sin fuente oficial accesible |
| L12 | P2 | OpenRouter: usar el parámetro `state` (ya soportado) y `usage_limit_type` | En parte (bf53087): `usage_limit_type` no aplica al flujo del navegador |
| L13 | P2 | LM Studio con token Bearer; Ollama Cloud; Cohere; Perplexity | Hecho (bf53087) |
| L14 | P2 | Avisos de datos por proveedor en el catálogo (entrenamiento con datos en niveles gratuitos, residencia, retención) | Hecho (bf53087) |
| L15 | P2 | Tarifa escalonada de Claude Haiku 5.5 (>100.000 tokens: 0,50/2,50 USD por MTok) | Hecho (bf53087) |
| L16 | P2 | Mostrar la tarifa de lectura de caché en «Modelos de IA» | Hecho (bf53087) |
| L17 | P1 | **Orquestación multi-modelo activa (super-agentes).** Visión del producto: aprovechar el potencial de varios modelos de distintos fabricantes para maximizar resultado y efectividad, más allá del respaldo. Enrutar cada tarea/subtarea al mejor modelo por capacidad y costo (p. ej. uno rápido y barato para triage/clasificación, uno fuerte para razonamiento, uno con visión para imágenes/documentos). | Base lista: Nexo ya es multi-proveedor (Anthropic, OpenAI-compatibles, OpenRouter — ADR 0002) con cadena de respaldo entre fabricantes (ADR 0003 D1). **Pendiente**: el enrutamiento activo por capacidad/costo (hoy es un modelo principal + respaldos ante fallo, no selección por tarea). |
| L18 | P2 | **Colaboración y verificación cruzada entre modelos.** Un modelo redacta y otro de distinto fabricante verifica o critica (reduce errores y sesgos); patrones multi-agente con modelos heterogéneos por rol. Parte de la visión de «super agentes». | Pendiente (depende de L17 y del runtime multi-agente). |

## 3. Producto y pruebas

| ID | Prio. | Punto | Estado |
|---|---|---|---|
| P1 | P0 | Agentes nuevos nacían con el modelo simulado cuando la plataforma no tenía clave | Hecho (249df02) |
| P2 | P1 | Avisar al ejecutar un flujo sin los datos de entrada que espera (hoy falla en el primer nodo) | Hecho: `trigger.config.inputFields`, 400 con los campos que faltan y avisos en el panel «Ejecutar» |
| P3 | P1 | Probar los inicios de sesión reales (Google, Microsoft, Hugging Face) contra los proveedores, no solo contra simuladores | Pendiente |
| P4 | P1 | RPA con Claude real en el equipo del usuario | Pendiente |
| P5 | P2 | Pruebas unitarias de la web (`ng test`) en CI para los componentes nuevos | Hecho (717cfa9) |
| P6 | P2 | Implementar ADR 0008 (protección de datos y observabilidad) | Ver M8 |
| P7 | P2 | Decidir la regla de exposición de flujos por MCP | Pendiente |
| P8 | P3 | 19 advertencias de lint en la API | Hecho (5a18f4a): 0 errores y 0 advertencias de lint en la API |
| P9 | P0 | Los programadores cron de flujos y rutinas viven solo en Redis: al reemplazar Redis (B8) o perder sus datos dejan de ejecutarse | Reconciliar al arrancar desde la base de datos | Hecho (3dd5396) |
| P10 | P1 | Un nodo sin `config` dejaba la ejecución en RUNNING para siempre | Hecho (4e95be7) |

## 4. Conexión de apps (Apps conectadas)

| ID | Prio. | Punto | Estado |
|---|---|---|---|
| C-1 | P0 | El asistente mostraba los campos de app propia y el navegador los autocompletaba (client ID ajeno, AADSTS700016) | Hecho (bdf89dc) |
| C-2 | P0 | Integraciones OAuth sin conectar se mostraban como instaladas; sin diagnóstico de qué app se usa | Hecho (d00acca, 3e940ba) |
| C-3 | P1 | Gestionar cuentas por app: conectar, reconectar, desconectar y eliminar, con el impacto en agentes y flujos | Hecho (e1a616e) |
| C-4 | P1 | Errores del proveedor explicados en español y enlace de aprobación de administrador (Microsoft) para TI | Hecho |
| C-5 | P1 | Al eliminar una cuenta, borrar las credenciales que solo ella usaba (evita reutilizar valores viejos) | Hecho |
| C-6 | P0 | Consola de plataforma: configurar una vez la app OAuth de cada proveedor; los clientes conectan con un clic sin registrar nada | Hecho |
| C-7b | P0 | Verificación de editor de la app de Microsoft (AI Cloud Partner Program) y verificación de Google (CASA para Gmail) | Pendiente (trámite externo; lo gestiona el negocio) |
| C-7 | P2 | Apps menos usadas vía servidores MCP externos, opcionales y aprobados por un ADMIN | Pendiente (decisión de negocio) |

## 5. Rediseño UX/UI empresarial (AI Studio)

Iniciativa de rediseño integral (requerimiento v1.0). Prioridad de negocio: primero perfeccionar el
chat del agente (P0) y luego extender el mismo estándar al resto de Nexo. Dueño = tipo de agente
especializado asignado; el líder coordina y el chat tiene un solo dueño por archivo.

| ID | Prio. | § | Punto | Dueño | Estado |
|---|---|---|---|---|---|
| RX-1 | P0 | 3.1 | Chat: separar Conversación / Actividad / Diagnóstico + agrupar eventos de protección de datos | Líder | Hecho (2b91fc9) |
| RX-2 | P0 | 3.3 | Chat: máquina de estados visible (pensando / consultando… / esperando aprobación / completado / fallado / cancelado) ligada a eventos reales | Líder | Hecho (d872ea3) |
| RX-3 | P0 | 3.4 | Chat: errores empresariales (mapeo de causas + acciones) y nombres legibles de herramienta | Líder | Hecho (ade7502) |
| RX-4 | P0 | 3.6/3.7 | Chat: compositor (estado de conexión, anti-doble-envío) y sesiones de prueba (versión/ejecución que respondió) | Líder | Pendiente |
| RX-5 | P1 | 4.3 | Panel de salud orientado a la acción (estado de publicación + hallazgos con acción) | nexo-frontend-ui | Hecho (83cd96d) |
| RX-5b | P1 | 4.3 | **Ajuste de UX del panel de salud** (feedback): (1) debe aparecer **recogido** por defecto, como tarjeta compacta, sin empujar el formulario; (2) **conservar el indicador visual** (anillo/medidor con el puntaje, coloreado por nivel) que el rediseño quitó; (3) «Ver detalle» abre los hallazgos en un **modal** (patrón corporativo de drill-down), no expande en línea. Mantiene los hallazgos con acción ya hechos y la API del componente. | nexo-frontend-ui | Hecho (0ab066d) |
| RX-6 | P1 | 4.1 | Chat redimensionable / pantalla completa y distribución de 3 áreas | nexo-frontend-core | Pendiente |
| RX-7 | P1 | 4.2 | Formularios de configuración por secciones con estado por sección | nexo-frontend-ui | Pendiente |
| RX-8 | P1 | 4.4 | Diferenciar Guardar borrador / Probar / Publicar + confirmación de publicación | nexo-frontend-ui | Pendiente |
| RX-9 | P1 | 5 | Design System: tokens y biblioteca de componentes (AppShell, Sidebar, Topbar, EmptyState, etc.) | nexo-frontend-core | Base hecha (45550d0): EmptyState/LoadingState/ErrorState + guía de tokens; falta adoptarlos en las páginas y los componentes de shell |
| RX-10 | P1 | 5.4 | Tablas y listados estandarizados (agentes, integraciones, ejecuciones, usuarios) | nexo-frontend-ui | Pendiente |
| RX-11 | P1 | 5.4 + 6 | **Rediseño del tablero de Agentes**: tarjetas KPI (totales, activos, ejecuciones 30 d, costo estimado, alertas con tendencias), pestañas con contadores (Todos/Activos/En pruebas/Borradores/Archivados), búsqueda + filtros (área, estado), vista tarjetas/lista, tarjeta de agente con favorito, métricas (ejecuciones, usuarios, costo), estado y salud, y paginación; con estados vacío/carga/error. Evoluciona `agents-list.page.ts`. | nexo-frontend-ui (UI) + nexo-backend-platform (agregación de KPIs y filtros por área/estado) | Backend hecho (f937b5f): `GET /agents/dashboard`; UI pendiente. Con datos faltantes (ver nota) |
| RX-12 | P2 | 6 | Observabilidad: latencia al primer token, duración, tasas de éxito, reintentos, cancelaciones, eventos de seguridad | nexo-backend-platform | Primer corte hecho (f937b5f): `GET /agents/analytics` (consumo por origen + rutinas con estado/duración); faltan métricas por turno de chat |
| RX-13 | P2 | 5.5 | Accesibilidad WCAG 2.2 AA (teclado, foco, contraste) y pruebas de regresión del chat | nexo-qa-e2e | Pendiente |
| RX-14 | P1 | 6/7 | **Historial de tareas del agente.** Registrar de forma persistente cada tarea/ejecución que realiza un agente (cuándo, origen chat/flujo/rutina/MCP, resultado éxito/fallo, duración, costo, conversación/ejecución asociada) y ofrecer una **vista de histórico** por agente (y consulta transversal), con filtros por fecha/estado/origen. Es la base que faltaba también para los KPIs reales y la observabilidad: se apoya en la tabla `AgentRun` propuesta en la nota de RX-11/RX-12 (requiere migración y decisión de producto). Idea del dueño del producto. | nexo-backend-platform (persistencia `AgentRun` + endpoints) + nexo-frontend-ui (vista de histórico) | Pendiente (depende de instrumentar `AgentRun`) |

> Nota de clasificación de RX-11: la UI es de `nexo-frontend-ui`, pero los KPIs del encabezado
> (ejecuciones de 30 días, costo estimado, alertas, y las tendencias ↑%) y los contadores por
> pestaña/filtro requieren **endpoints de agregación** del backend; por eso lleva también a
> `nexo-backend-platform`. Las métricas por agente (ejecuciones, usuarios, costo) deben confirmarse
> contra lo que ya expone la API antes de implementar. Relacionado con RX-10 (tablas/listados) y RX-12
> (observabilidad); la visión de super-agentes multi-modelo está en L17/L18 (sección 2).

> **Datos faltantes del tablero/observabilidad (requieren decisión de producto + migración; no se inventan números —§6).**
> Hoy la API los devuelve como `null`: (1) estado «en pruebas» y pestaña/KPI correspondiente — el ciclo de vida
> del agente solo tiene DRAFT/LAUNCHED; (2) «archivado» — el borrado de agentes es físico (haría falta
> `Agent.archivedAt`/soft-delete); (3) «% de ejecuciones exitosas» por turno de chat — `UsageRecord` no guarda
> éxito/fallo por llamada; (4) latencia al primer token, duración, reintentos y cancelaciones de chat — no
> instrumentados; (5) recuento de eventos de protección de datos (DataGuard) — hoy no se persiste nada. Fuente
> propuesta para (3)(4)(5): una tabla run-level de agente (`AgentRun` con status/error/tiempos y time-to-first-token)
> y un `DataGuardEvent`. «favorito/estrella» y «área» como concepto propio también requieren campos nuevos. La UI de
> RX-11 debe degradar con elegancia los `null` (ocultar la métrica o marcarla «sin datos»), nunca mostrar cifras falsas.

