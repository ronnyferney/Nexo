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
| C1 | Crítica | P0 | Registro y alta de miembros sin verificar el correo: alguien crea de antemano la cuenta de un correo ajeno y recibe la membresía cuando el cliente lo agrega (`auth.service.ts`, `org.service.ts` `addMember`) | Verificación de correo; alta de miembros por invitación que acepta el dueño del correo; nunca unir una cuenta no verificada a otro workspace; registro público desactivable | Pendiente |
| A1 | Alta | P0 | Los SDK de Claude (Anthropic, Vertex, Google Cloud, Foundry) salen sin la protección SSRF y devuelven la respuesta en el error (`drivers/anthropic.driver.ts`) | `fetch` con la política SSRF de Nexo en todos los SDK; solo hosts oficiales por canal o `LLM_PROVIDER_URL_OVERRIDES`; sin cuerpo crudo en errores | Pendiente |
| A2 | Alta | P0 | `POST/PATCH /admin/llm/connections` aceptan `baseUrl`/`kind` libres: un ADMIN desvía claves y tokens OAuth que no puede ver | `baseUrl`/`kind` inmutables con `providerId`; pedir la clave al cambiar destino; borrar tokens OAuth si cambia | Pendiente |
| A3 | Alta | P1 | SSRF eludible: IPv6 mapeada en hexadecimal, NAT64 y 6to4 sin bloquear; DNS rebinding (`http-client.service.ts`, adaptadores de BD y MCP) | `net.BlockList` con rangos IPv4/IPv6; resolver una vez y conectar a la IP validada | Pendiente |
| A4 | Alta | P1 | Un EDITOR o una API key leen cualquier secreto de la bóveda desde un conector (`connectors.service.ts` `resolveAll`) | Secretos permitidos por conector, fijados por un ADMIN | Pendiente |
| A5 | Alta | P0 | Sin `trust proxy` el throttling usa la IP de nginx: 10 intentos de login por minuto bloquean a todos; almacenamiento en memoria por instancia | `trust proxy` (ALB + nginx), throttling en Redis, límite por cuenta en el login | Pendiente |
| A6 | Alta | P0 | Cualquier registro gratuito consume la `ANTHROPIC_API_KEY` de la plataforma sin cupo | Cupo mensual de plataforma por workspace (como el Copilot), habilitable por plan | Pendiente |
| A7 | Alta (cond.) | P0 | `PLATFORM_ADMIN_EMAILS` se apropia registrando un correo listado sin cuenta | Correo verificado (C1) y aviso en el arranque de correos sin cuenta | Pendiente |
| A8 | Alta (cond.) | P0 | `docker-compose.yml` publica PostgreSQL (`nexo/nexo`) y Redis sin contraseña en 0.0.0.0 | Enlazar a 127.0.0.1 o quitar `ports`; `requirepass`; contraseña obligatoria | Pendiente |
| M1 | Media | P1 | `state` OAuth no ligado al navegador: phishing de consentimiento y de código de dispositivo | Cookie HttpOnly con nonce comprobada en el callback; mostrar la cuenta autorizada | Pendiente |
| M2 | Media | P1 | `/api/mcp` sin `@MinRole`: un VIEWER ejecuta flujos | `@MinRole('EDITOR')` | Pendiente |
| M3 | Media | P1 | Un ADMIN se asciende a OWNER y saca al fundador | Solo un OWNER otorga o retira OWNER | Pendiente |
| M4 | Media | P1 | Valores del LLM sin codificar en ruta y query de conectores REST | `encodeURIComponent`; rechazar `..`, `?`, `#` y URL absolutas | Pendiente |
| M5 | Media | P1 | Límite de 5 MB comprobado tras leer todo el cuerpo | Lectura por flujo con corte al superar el límite | Pendiente |
| M6 | Media | P1 | La web no envía CSP, `X-Frame-Options`, HSTS ni `Referrer-Policy`; JWT en `localStorage` | Cabeceras en nginx; evaluar cookie HttpOnly para la sesión | Pendiente |
| M7 | Media | P1 | Sin dominio el piloto se publica por HTTP | Exigir TLS en el despliegue | Pendiente |
| M8 | Media | P2 | ADR 0008 sin implementar: datos personales sin enmascarar hacia el LLM; conversaciones sin retención | DataGuard D1-D2 y retención D7 | Pendiente |
| M9 | Media | P1 | Los secretos de ejemplo (`JWT_SECRET`, `ENCRYPTION_KEY` en ceros) pasan la validación | Rechazar placeholders y claves de baja entropía | Pendiente |
| B1 | Baja | P2 | Token de webhook y `code`/`state` OAuth en los logs | Redactar rutas y query sensibles | Pendiente |
| B2 | Baja | P2 | Uso único del `state` solo en memoria por instancia | `jti` en Redis/BD con `SET NX` | Pendiente |
| B3 | Baja | P2 | JWT sin revocación; API keys sin expiración ni alcance | `tokenVersion`; expiración y alcance de API keys | Pendiente |
| B4 | Baja | P2 | Enumeración de correos (registro y tiempo de login) | Respuesta genérica y bcrypt ficticio | Pendiente |
| B5 | Baja | P1 | `POST /connectors/:id/test` sin `@MinRole` | `@MinRole('EDITOR')` | Pendiente |
| B6 | Baja | P2 | ReDoS por `pattern` del `inputSchema` | Ajv con RE2 o límite de longitud | Pendiente |
| B7 | Baja | P2 | AES-GCM sin AAD ni versión de clave (rotación imposible) | Prefijo de versión + AAD; rotación con KMS (ADR 0008 fase 2) | Pendiente |
| B8 | Baja | P2 | Redis sin AUTH/TLS; RDS sin protección contra borrado; ECS Exec activo | Endurecer la infraestructura | Pendiente |
| B9 | Baja | P2 | El Copilot guarda agentes con modelos fuera del catálogo | Reusar `LlmUsageService.assertAgentModels` | Pendiente |
| B10 | Baja | P2 | Swagger público en producción | Solo fuera de producción o autenticado | Pendiente |
| I1 | Info | P2 | El simulador LLM depende de `NODE_ENV=production` | No registrar el controlador fuera de desarrollo + prueba del bloqueo | Pendiente |
| I2 | Info | P3 | `npm audit`: 9 altas y 2 moderadas en la API, 3 altas en Edge (hoy no explotables) | Actualizar en el ciclo normal | Pendiente |
| I3 | Info | P3 | `/auth/me` y `/auth/switch-workspace` con API key responden 500 | 403 explícito | Pendiente |

Buenas prácticas ya presentes que no se deben romper: ver la sección 4 del informe de auditoría (rol leído de la
membresía en cada petición, consultas acotadas por `workspaceId`, PKCE S256 y `state` firmado de un solo uso, tokens y
claves cifrados con AES-256-GCM, `redirect: 'manual'` en el cliente HTTP, `postMessage` con origen exacto, etc.).

## 2. Conexión con proveedores LLM

| ID | Prio. | Punto | Estado |
|---|---|---|---|
| L1 | P0 | Postura: Nexo no usa suscripciones personales (Claude Pro/Max, ChatGPT Plus) ni client_id de otros productos (ADR 0002 D8) | Hecho |
| L2 | P1 | Workload Identity Federation para la API de Anthropic (sin claves; requiere emisor OIDC público de Nexo) | Pendiente |
| L3 | P1 | Amazon Bedrock y Claude Platform on AWS con rol de IAM + `ExternalId` (sin claves de larga duración) | Pendiente |
| L4 | P1 | Corregir el catálogo de Bedrock: hoy recomienda una clave de larga duración («solo para exploración» según AWS) | Pendiente |
| L5 | P1 | Retirar modelos retirados: Llama 4 Scout en Groq, Kimi K2 0905 en Fireworks | Pendiente |
| L6 | P1 | Azure: alcance `https://ai.azure.com/.default`, host `services.ai.azure.com`, rol RBAC documentado | Pendiente |
| L7 | P1 | Entra ID para Claude en Microsoft Foundry (verificar el alcance oficial) | Pendiente |
| L8 | P1 | Verificación de la app de Google (sin ella el refresh token caduca a los 7 días) y registro de los redirect URI | Pendiente |
| L9 | P2 | OpenAI: modelos actuales; programa «Sign in with ChatGPT» solo si Nexo es aceptado como socio | Pendiente |
| L10 | P2 | xAI con la API Responses (Chat Completions marcada como legacy) | Pendiente |
| L11 | P2 | DeepSeek: modelos `deepseek-v4-pro`/`v4-flash` y `docsUrl` oficial | Pendiente |
| L12 | P2 | OpenRouter: usar el parámetro `state` (ya soportado) y `usage_limit_type` | Pendiente |
| L13 | P2 | LM Studio con token Bearer; Ollama Cloud; Cohere; Perplexity | Pendiente |
| L14 | P2 | Avisos de datos por proveedor en el catálogo (entrenamiento con datos en niveles gratuitos, residencia, retención) | Pendiente |
| L15 | P2 | Tarifa escalonada de Claude Haiku 5.5 (>100.000 tokens: 0,50/2,50 USD por MTok) | Pendiente |
| L16 | P2 | Mostrar la tarifa de lectura de caché en «Modelos de IA» | Pendiente |

## 3. Producto y pruebas

| ID | Prio. | Punto | Estado |
|---|---|---|---|
| P1 | P0 | Agentes nuevos nacían con el modelo simulado cuando la plataforma no tenía clave | Hecho (249df02) |
| P2 | P1 | Avisar al ejecutar un flujo sin los datos de entrada que espera (hoy falla en el primer nodo) | Pendiente |
| P3 | P1 | Probar los inicios de sesión reales (Google, Microsoft, Hugging Face) contra los proveedores, no solo contra simuladores | Pendiente |
| P4 | P1 | RPA con Claude real en el equipo del usuario | Pendiente |
| P5 | P2 | Pruebas unitarias de la web (`ng test`) en CI para los componentes nuevos | Pendiente |
| P6 | P2 | Implementar ADR 0008 (protección de datos y observabilidad) | Pendiente |
| P7 | P2 | Decidir la regla de exposición de flujos por MCP | Pendiente |
| P8 | P3 | 19 advertencias de lint en la API | Pendiente |
