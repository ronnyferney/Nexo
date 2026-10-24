# 0002. Gobierno de IA: consola de administración, múltiples LLM y bolsas de presupuesto por unidad corporativa

- **Estado:** Aceptado
- **Fecha:** 2026-10-22
- **Responsables:** nexo-architect

## Contexto
Los clientes necesitan usar varios proveedores de IA y controlar el gasto por áreas de la empresa. El riesgo número uno
que perciben es el costo descontrolado. Se requieren dos experiencias: una **consola de administración** (gobierno,
costos, proveedores, organización) y un **portal de usuarios** (agentes, flujos, ejecuciones, consumo propio).

## Decisiones

### D1. Una sola SPA con dos zonas por rol
- Portal (`/`): Inicio, Agentes, Flujos, Ejecuciones, Conectores, **Mi consumo**. Todos los roles.
- Administración (`/admin/*`): Costos, Proveedores IA, Organización (unidades y miembros), Presupuestos, Alertas,
  Seguridad (secretos, API keys, MCP). Solo **ADMIN** y **OWNER** (guard en frontend + `@MinRole('ADMIN')` en API).

### D2. Conexiones LLM dinámicas por workspace
- `LlmConnection` (tipo `ANTHROPIC` | `OPENAI_COMPATIBLE` | `MOCK`) con API key cifrada (AES-256-GCM) y `baseUrl` opcional.
  `OPENAI_COMPATIBLE` cubre OpenAI, Azure OpenAI, Ollama/vLLM on-premise, Gemini (endpoint compatible) y gateways.
- `LlmModel`: catálogo por conexión con precio por millón de tokens (entrada, salida, lectura de caché) y nivel
  (`PREMIUM`, `STANDARD`, `ECONOMY`). **Los precios son datos configurables**, no constantes de código.
- Conexiones de sistema (sin fila en BD): `anthropic` (si existe `ANTHROPIC_API_KEY`) y `mock`. Conservan los ids
  actuales, por lo que los agentes existentes siguen funcionando sin migración de datos.
- `Agent.provider` = id de conexión (`anthropic`, `mock` o cuid de `LlmConnection`); `Agent.model` = id del modelo.

### D3. Jerarquía organizacional y centro de costo
- `OrgUnit` en árbol (profundidad libre) por workspace, con una **raíz creada automáticamente** que actúa como tope global.
- `Membership.orgUnitId` asigna cada usuario a una unidad (por defecto la raíz).
- `Agent.costCenterId` (opcional) define a quién se cobra cuando el agente corre sin usuario (flujos, webhooks, MCP).
- Regla de imputación: chat de un usuario → su unidad; ejecución sin usuario → `costCenterId` del agente; si no hay → raíz.

### D4. Bolsas de presupuesto en dinero (USD)
- `Budget` (uno por unidad): `period` (`MONTHLY`|`QUARTERLY`|`YEARLY`), `limitUsd`, `policy`, `alertThresholds`
  (por defecto `[50, 80, 100]`), modelo de degradación opcional.
- Se presupuesta en **dinero** porque los modelos tienen precios distintos; los tokens se registran igualmente.
- **Jerárquico:** un consumo descuenta de su unidad **y de todos sus ancestros**; debe haber saldo en toda la cadena.
- Políticas al agotarse: `BLOCK` (rechaza con HTTP 402), `DOWNGRADE` (cambia al modelo económico configurado;
  si no hay, bloquea), `ALERT_ONLY` (solo alerta).
- **Libro mayor** `BudgetLedger(orgUnitId, periodKey, spentUsd)` con incrementos atómicos por cada ancestro:
  la verificación cuesta O(profundidad) y no requiere agregaciones sobre el histórico.
- Claves de periodo en UTC: `2026-10`, `2026-Q4`, `2026`.

### D5. Medición y control en cada llamada al modelo
- El puerto `LlmProvider` expone `beforeTurn()` (se invoca **antes** de cada llamada; puede abortar) y `onUsage()`
  (después de cada respuesta, con tokens reales). El sobregiro máximo queda acotado a un turno.
- La degradación de modelo se decide **al inicio** de la ejecución (no a mitad del bucle de herramientas).
- `UsageRecord` guarda workspace, unidad, usuario, agente, flujo/ejecución, conversación, conexión, modelo, tokens
  (entrada, salida, caché) y costo. **Nunca** guarda contenido de prompts ni respuestas.
- Al cruzar un umbral se crea un `BudgetAlert` único por (unidad, periodo, umbral).

### D6. Políticas de modelos por unidad
- `OrgUnit.allowedModels`: lista `"<providerId>:<modelId>"`. Vacía = hereda. Si una unidad de la cadena restringe y el
  modelo no está permitido, la ejecución se rechaza con un mensaje claro (HTTP 403).

### D7. Optimización
- Caché automática de prompts en Anthropic (`cache_control` de nivel superior) y precio de lectura de caché en el catálogo.
- Recomendación operativa: modelos `ECONOMY` como degradación para áreas de alto volumen.

### D8. Catálogo de proveedores (addendum, 2026-10-23)
**Decisión de negocio (no negociable):** Nexo **no conecta suscripciones personales** (Claude Pro/Max vía claude.ai,
ChatGPT Plus, GitHub Copilot u otras): sus términos no permiten que una plataforma de terceros las use y su consumo no
se puede medir para los presupuestos de D4/D5. Solo se admiten conexiones oficiales:
- **Clave de API de pago por uso** del proveedor (Anthropic, OpenAI, Gemini, Mistral, xAI, DeepSeek, Moonshot, Cohere,
  Perplexity, Groq, Cerebras, Fireworks, Together, NVIDIA, Hugging Face, Ollama Cloud).
- **Nube empresarial** (Azure OpenAI v1 con cabecera `api-key`; Amazon Bedrock por su endpoint compatible con OpenAI
  `bedrock-mantle` con un **token de Bedrock de corta duración**, addendum 2026-10-24: ver «Bedrock» más abajo).
- **Modelos locales** (Ollama, LM Studio, este último con token opcional): desde la nube requieren Nexo Edge o una red
  alcanzable; la protección SSRF bloquea redes privadas salvo `CONNECTOR_ALLOW_PRIVATE_NETWORKS=true` (solo on-premise).
- **OpenRouter** para modelos de terceros, con su **OAuth PKCE oficial** (o clave de API).
- **Inicio de sesión oficial del proveedor** (addendum 2026-10-23, segunda parte): Google Vertex AI («Iniciar sesión con
  Google»), Azure OpenAI con Microsoft Entra ID («Iniciar sesión con Microsoft») y Hugging Face (OAuth web y código de
  dispositivo), además de la detección de servidores locales.

**Regla no negociable sobre identidades OAuth:** Nexo **nunca** usa identificadores de cliente OAuth de otros productos
(p. ej. el `client_id` de Claude Code, de Codex/ChatGPT, de GitHub Copilot o de una CLI de terceros) ni flujos pensados
para suscripciones personales: eso suplanta a otro producto y viola sus términos. Solo se admiten los mecanismos que el
proveedor documenta para **aplicaciones de terceros con su propia app registrada**. Las credenciales de la app de Nexo
viven en variables de entorno `OAUTH_LLM_<PROVEEDOR>_CLIENT_ID/SECRET` (nunca en el código ni en el catálogo; una
prueba unitaria lo verifica). Si no están configuradas, el proveedor se muestra con `mechanisms[].available=false` y
`unavailableReason`, y los endpoints de inicio responden 400. El redirect URI que se registra en cada proveedor es
`${PUBLIC_URL}/api/llm/oauth/<proveedor>/callback`.

Diseño:
- El catálogo vive en código (`apps/api/src/modules/llm/providers/*.providers.ts`, un archivo por familia). Cada entrada
  define categoría, facturación, driver (`ANTHROPIC` nativo u `OPENAI_COMPATIBLE`), plantilla de URL base renderizada
  con el motor de plantillas de Nexo, campos del formulario (solo `apiKey` es secreto), pasos verificados para obtener
  la clave (`keySteps`), prefijo documentado (`keyPrefix`, solo advertencia), modelos sugeridos y
  `pendingVerification` (lo que no se pudo verificar en la fuente oficial).
- **Precios:** solo los verificados en la fuente oficial (hoy, Anthropic). **Tarifa escalonada** (addendum 2026-10-24):
  `LONG_CONTEXT_PRICING` en `pricing.ts` (tabla en código por id de modelo, sin columnas nuevas) define el umbral y las
  tarifas altas; hoy solo `claude-haiku-5-5`: si el prompt de **una petición** (entrada + lecturas + escrituras de caché)
  supera 100.000 tokens, todos sus tokens pagan 0,50 / 2,50 USD por MTok (0,05 la lectura de caché, 0,625 la escritura de
  5 min) según platform.claude.com/docs/en/about-claude/pricing («Long context pricing»). `LlmGatewayService.resolve`
  la adjunta (`ModelPricing.longContext`) solo si el modelo conserva las tarifas base estándar de Anthropic (API de
  Anthropic y Foundry); con tarifas propias del administrador (p. ej. Vertex AI) se respetan las suyas. `costUsd` se
  calcula por turno, que es la unidad de tarificación. El resto se importa con precio 0 y
  `LlmModel.needsPricing = true`; la consola pide completarlo (fijar una tarifa lo apaga). Los modelos locales no lo
  necesitan. Mientras un modelo tenga precio 0 su consumo no descuenta presupuesto: se recomienda completar la tarifa
  antes de habilitarlo para áreas con presupuesto.
- **Conectar = probar antes de guardar:** se validan campos y URL, se llama a un endpoint sin costo (`/models`, o `/key`
  en OpenRouter) y solo si pasa se crea la `LlmConnection` con la clave cifrada (AES-256-GCM) y `providerId`.
- Por conexión se guardan `providerFields` (valores no secretos), `headers` (cabeceras fijas no secretas, p. ej.
  `X-OpenRouter-Title`) y `driverOptions` (`authHeader`: `bearer` | `api-key` | `none`; `verifyPath`;
  `replayReasoning`). Las conexiones anteriores (`providerId` null) conservan el comportamiento heredado (clave en
  `Authorization` y `api-key`).
- El historial del driver compatible con OpenAI guarda el mensaje completo del proveedor (append-only, incluido
  `reasoning_content`) y al reenviarlo proyecta solo `role`, `content`, `tool_calls`, `tool_call_id`, `name`, más
  `reasoning_content` si la conexión lo exige (Kimi K3).
- `LLM_PROVIDER_URL_OVERRIDES` (JSON `{ "<providerId>": "<url>" }`) sustituye la URL base de un proveedor (gateways
  corporativos de salida y pruebas); `OPENROUTER_AUTH_URL` sustituye la pantalla de consentimiento.
- **OAuth de OpenRouter:** `state` firmado de un solo uso (en Redis entre réplicas, D9 addendum B2) con el `code_verifier` cifrado (reutiliza `OAuthStateService`
  del ADR 0005 con `connectorId = 'llm-provider:openrouter'`). El `state` viaja en la query del `callback_url`: el SDK
  oficial `@openrouter/sdk` 1.5.7 no documenta un parámetro `state` propio en `openrouter.ai/auth` (el anuncio del blog de
  OpenRouter queda en `pendingVerification` hasta leerlo en la documentación) y `usage_limit_type` solo existe en
  `POST /auth/keys/code`, autenticado con la clave del usuario, por lo que no aplica al flujo del navegador. El SDK sí
  confirma que `callback_url` admite URLs https y localhost/127.0.0.1 en cualquier puerto. El callback canjea el código en `POST https://openrouter.ai/api/v1/auth/keys`
  (`{ code, code_verifier, code_challenge_method: 'S256' }` → `{ key }`), exige que quien inició siga siendo ADMIN+ y
  redirige siempre a `${WEB_URL}/admin/providers`.
- **Mecanismos por proveedor** (`ProviderCatalogEntry.mechanisms`, por defecto `API_KEY` o `LOCAL_DETECT` en los locales;
  un único `primary`; si no está disponible la interfaz usa el siguiente):
  | Proveedor | Mecanismos | Detalle verificado (fuente) |
  |---|---|---|
  | Vertex AI (`vertex`) | `OAUTH` | Google OAuth 2.0 web + PKCE, scope `https://www.googleapis.com/auth/cloud-platform`, `access_type=offline` y `prompt=consent` (refresh token), revocación en `oauth2.googleapis.com/revoke` (google-auth-library-nodejs). Endpoint compatible con OpenAI `https://{host}/v1/projects/{proyecto}/locations/{región}/endpoints/openapi`, host `aiplatform.googleapis.com` en `global` o `{región}-aiplatform.googleapis.com` (GoogleCloudPlatform/generative-ai). |
  | Azure OpenAI (`azure-openai`) | `OAUTH` (principal), `API_KEY` | Entra ID v2 `login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize|token`, PKCE S256, `scope` también en el canje y la renovación, refresh token con `offline_access`, refresh rotado se reemplaza (MicrosoftDocs/entra-docs). Scope `https://ai.azure.com/.default` (addendum 2026-10-24: el de la API v1 en openai-node `docs/azure.md`; `cognitiveservices` queda para las versiones con fecha). Las conexiones creadas antes conservan el scope anterior al renovar (`OAuthAppSpec.legacyScopes`). Token como Bearer en la API v1 (openai-node). Roles en recursos de Foundry: «Foundry User» (antes «Azure AI User») o «Cognitive Services User». Entra ID no documenta revocación: se borran los tokens de Nexo. |
  | Claude en Foundry (`claude-foundry`) | `OAUTH` (principal), `API_KEY` | Misma app de Entra ID de Nexo (`appKey: 'azure-openai'`; se registra también `/api/llm/oauth/claude-foundry/callback`) y el mismo scope `https://ai.azure.com/.default`, verificado en platform.claude.com («Microsoft Entra authentication») y en `@anthropic-ai/foundry-sdk` 1.1.0. |
  | Hugging Face (`huggingface`) | `OAUTH` (principal), `DEVICE_CODE`, `API_KEY` | `huggingface.co/oauth/authorize|token|device`, scope `inference-api`, PKCE, app pública sin secreto o `Authorization: Basic` con secreto (huggingface/hub-docs). El token expira (`expires_in`) y no se documenta refresh token: al expirar se pide volver a iniciar sesión. |
  | OpenRouter | `OAUTH` (principal, sin app registrada), `API_KEY` | Ver arriba. |
  | Ollama, LM Studio | `LOCAL_DETECT` (LM Studio además `API_KEY` «Servidor con token») | `POST …/detect` prueba la URL indicada o la local por defecto y lista modelos sin guardar. LM Studio admite un token opcional (`sk-lm-…`, `@lmstudio/sdk` 2.1.0: «not required unless LM Studio is configured to mandate API tokens») que se guarda cifrado y viaja como Bearer. |
  | Resto | `API_KEY` | — |
- **GitHub Models no se incluye:** la documentación oficial (github/docs, `content/github-models/index.md`) indica que
  el servicio se retiró por completo el 30-07-2026 (catálogo, API de inferencia y BYOK). El flujo de código de dispositivo
  quedó genérico (RFC 8628) y hoy lo usa Hugging Face.
- **Tokens OAuth de la conexión:** `LlmConnection.credentialType = OAUTH`; `apiKeyCipher` guarda el access token vigente,
  `oauthRefreshCipher` el refresh token (AES-256-GCM), `oauthExpiresAt` y `oauthScope`. El driver pide el token en cada
  llamada (`LlmCredentials.getAccessToken`), y `LlmTokenService` lo renueva 60 s antes de expirar con una sola solicitud
  por conexión aunque haya llamadas concurrentes. Los tokens OAuth viajan siempre como `Authorization: Bearer`.
- **Flujos en curso:** tabla `LlmAuthFlow` (vida ≤ 15 min) con los campos no secretos del formulario, nombre y modelos
  pedidos, y el `device_code` cifrado (nunca viaja al navegador). El `state` firmado lleva
  `connectorId = 'llm-provider:<proveedor>:<flujo>'`; flujo y `state` son de un solo uso. El sondeo de dispositivo
  respeta el `interval` del proveedor (si la web sondea antes responde `pending` sin llamarlo) y reclama el turno de forma
  atómica.
- **Confirmación de la cuenta en el código de dispositivo (auditoría M1b):** el código no se puede ligar al navegador
  (quien lo escribe en la página del proveedor puede ser otra persona, en su propia cuenta). Cuando el proveedor entrega
  los tokens, el flujo pasa a `confirm`: los tokens quedan cifrados en el flujo (`deviceCodeCipher`, contexto
  `llm-auth-flow.pending-tokens`) y la web muestra la cuenta autorizada (`id_token` con audiencia = app de Nexo o el
  `userinfoUrl` documentado del proveedor; si no la informa, lo dice). Solo el ADMIN que inició el flujo la ve y la
  confirma (`POST device/confirm`) o la rechaza (`POST device/cancel`, que revoca los tokens si hay `revokeUrl`); el plazo
  es de 10 minutos y vencido se descarta igual.
- **Verificación tolerante** (`verifyMode: 'lenient'`, Vertex, Azure, Cohere, Perplexity y Ollama Cloud): la API v1 de
  Azure, el endpoint de Vertex y la API de compatibilidad de Cohere no documentan `/models` (Perplexity lo expone en
  `/v1/models`, que usa como `verifyPath`; Ollama Cloud lista modelos en `/api/tags`); un 404/405 ahí no impide conectar,
  un 401/403 sí (falta de rol sobre el recurso o proyecto).
- **Bedrock** (addendum 2026-10-24): el catálogo ya no recomienda claves de larga duración. Pide un token de corta
  duración (`bedrock-api-key-…`, hasta 12 horas, generado con `@aws/bedrock-token-generator`; prefijo como advertencia)
  y explica que Anthropic recomienda antes un rol de servicio o roles de IAM, y que las claves de larga duración se
  pueden bloquear con `bedrock:BearerTokenType` (platform.claude.com, «Claude in Amazon Bedrock»). La ruta es un campo
  (`apiPath`: `openai/v1` por defecto o `v1`), porque openai-node documenta `/openai/v1` y señala que la guía de AWS
  describe `/v1`. Sigue pendiente la conexión sin tokens con `AssumeRole` + `ExternalId` (L3).
- **Avisos de datos** (`ProviderCatalogEntry.dataNotices[]`, addendum 2026-10-24): `{ level: 'info'|'warning'; text;
  sourceUrl }`, solo con afirmaciones verificadas en `sourceUrl`; la vista pública los expone y el diálogo de conexión
  los muestra con el enlace a la fuente. Hoy: retención de 30 días de Claude Fable 5.1 sin ZDR (todos los canales de
  Claude), no uso para entrenamiento sin permiso expreso (API de Anthropic), datos que permanecen en Azure (Claude en
  Foundry alojado en Azure), condiciones distintas de los niveles gratuito y de pago de la Gemini API y no uso para
  entrenamiento en Ollama Cloud. Lo no verificable (DeepSeek, Perplexity, Cohere, detalle del nivel gratuito de Gemini)
  queda en `pendingVerification`.
- **Metadatos de modelos:** `suggestedModels[]` y `LlmModel` llevan `specialties` (`CODE|REASONING|VISION|FAST|GENERAL`)
  y `contextTokens`, además de `tier`. Solo valores verificados en la fuente oficial (hoy Anthropic y DeepSeek R1);
  si no, `['GENERAL']` y contexto `null`.
- `LLM_OAUTH_ENDPOINT_OVERRIDES` (JSON `{ "<proveedor>": { authorizeUrl?, tokenUrl?, deviceUrl?, revokeUrl? } }`)
  sustituye los endpoints OAuth (proxies de identidad corporativos y pruebas); solo lo define el operador.

### D9. Claude como familia de modelos con canales oficiales (addendum, 2026-10-24)
Claude es una **familia de modelos** (Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1) a la que se llega por varios canales
oficiales; los modelos son los mismos y cambian quién opera el servicio, la autenticación y la facturación. La galería
los agrupa bajo «Claude» (`ProviderCatalogEntry.family = 'CLAUDE'`, `claudeChannel`) y el driver `ANTHROPIC` usa el
**SDK oficial de cada canal** (mismo bucle de tool use, thinking adaptativo y caché):

| Canal (`providerId`) | Operado por | Conexión | Cliente oficial | Facturación |
|---|---|---|---|---|
| API de Anthropic (`anthropic`) | Anthropic | Clave de API (cuenta de servicio) o Workload Identity Federation sin claves (D9, addendum L2) | `@anthropic-ai/sdk` (`credentials: oidcFederationProvider(...)` en WIF) | Tarifas de Anthropic |
| Claude en Google Cloud (`claude-google-cloud`) | Anthropic | «Iniciar sesión con Google» (token de Google, rol `roles/claude.user`), proyecto y workspace `wrkspc_` | `@anthropic-ai/google-cloud-sdk` (`bearerTokenProvider`) | Google Cloud Marketplace |
| Claude en Vertex AI (`claude-vertex`) | Google | «Iniciar sesión con Google», proyecto y región | `@anthropic-ai/vertex-sdk` (`authClient` OAuth2 con el token vigente, uno por solicitud) | Tarifas de Google |
| Claude en Microsoft Foundry (`claude-foundry`) | Microsoft (Azure) | «Iniciar sesión con Microsoft» (Entra ID, scope `https://ai.azure.com/.default`, rol «Foundry User» o «Cognitive Services User») o clave del recurso (`api-key`) | `@anthropic-ai/foundry-sdk` (`azureADTokenProvider` con el token vigente) | Microsoft Marketplace a tarifas de Anthropic (CCU) |
| Claude en Amazon Bedrock (`claude-bedrock`) | AWS | Rol de IAM del cliente + `ExternalId` (STS AssumeRole, SigV4 `bedrock-mantle`), región | `@anthropic-ai/bedrock-sdk` (`AnthropicBedrockMantle`, `providerChainResolver` con las credenciales temporales) | Tarifas de AWS (`needsPricing`) |
| Claude Platform on AWS (`claude-aws`) | Anthropic | Rol de IAM del cliente + `ExternalId` (SigV4 `aws-external-anthropic`), región y workspace `wrkspc_` | `@anthropic-ai/aws-sdk` (`AnthropicAws`, beta) | AWS Marketplace en CCU (`needsPricing`) |

- **Este es el «iniciar sesión» legítimo para Claude:** Anthropic prohíbe que terceros ofrezcan el inicio de sesión de
  Claude.ai o usen planes Free/Pro/Max (code.claude.com/docs/en/legal-and-compliance). El acceso con cuenta de empresa
  y sin claves es por la nube del cliente (Google Cloud, Vertex AI, AWS) o por Workload Identity Federation.
- Las entradas de Google comparten la **misma app OAuth de Nexo** (`OAuthAppSpec.appKey = 'vertex'` →
  `OAUTH_LLM_VERTEX_CLIENT_ID/SECRET`); en la app se registra un redirect URI por entrada
  (`/api/llm/oauth/<claude-google-cloud|claude-vertex|vertex>/callback`).
- La conexión guarda el canal en `driverOptions.claude` (`channel`, `project`, `region`, `workspaceId`, `resource`;
  solo valores no secretos, validados al leer).
- El fallback server-side ante rechazos solo se pide en canales operados por Anthropic (API y Google Cloud) y con el
  host oficial; Vertex AI y Foundry no lo admiten. Vertex AI y Foundry no ofrecen API de modelos: se verifican con un
  conteo de tokens (gratuito) y `verifyMode: 'lenient'` (404 si el modelo no está activado; 401/403 impiden conectar).
- **Precios:** API de Anthropic y Foundry con las tarifas verificadas en platform.claude.com/docs/en/about-claude/pricing;
  Google Cloud y Vertex AI se importan con `needsPricing`.
- Entra ID para Foundry quedó resuelto (addendum 2026-10-24). Workload Identity Federation y los canales de AWS con rol
  de IAM quedaron resueltos en el addendum siguiente.

#### Addendum 2026-10-24 (L2, L3, B2): conexiones Claude sin claves y uso único del `state` entre réplicas
Fuentes verificadas el 2026-10-24: platform.claude.com/docs/en/manage-claude/workload-identity-federation, …/wif-
reference y …/wif-providers/okta (WIF); …/build-with-claude/claude-in-amazon-bedrock y …/claude-platform-on-aws (AWS);
SDK `@anthropic-ai/sdk` 1.1.0 (`lib/credentials/oidc-federation`, `TokenCache`), `@anthropic-ai/bedrock-sdk` 1.1.0,
`@anthropic-ai/aws-sdk` 1.1.1 y `@aws-sdk/client-sts` 3.1156.0 (modelo oficial de `AssumeRole`). La guía de IAM sobre
`ExternalId` (docs.aws.amazon.com) no fue accesible desde el entorno: la plantilla de confianza sigue el modelo del SDK y
el texto exacto de la guía queda pendiente de verificación.

- **Conexiones sin claves** (`MechanismType` `WORKLOAD_IDENTITY` y `AWS_ROLE`): no guardan secretos
  (`apiKeyCipher = null`); los identificadores no secretos van en `driverOptions.keyless` (sin cambios de esquema),
  validados al leer (`keyless/keyless-options.ts`). `credentialType` sigue en `API_KEY`. El driver obtiene la credencial
  en cada uso y toda llamada (canje WIF, STS, Bedrock, AWS) sale por `HttpClientService.safeFetch` (A1).
- **L2 · Workload Identity Federation con la API de Anthropic.** Nexo es un emisor OIDC «Custom OIDC»:
  - Emisor `LLM_WIF_ISSUER` (por defecto `${PUBLIC_URL}/api/oidc`); endpoints públicos con `@Public()` y 120/min:
    `GET /api/oidc/.well-known/openid-configuration` y `GET /api/oidc/jwks` (solo claves públicas, `Cache-Control`
    5 min; 404 si no hay clave). Anthropic exige https, puerto 443 y DNS público (sin IP literales): sin dominio público
    el mecanismo se muestra no disponible con el motivo.
  - Claves `LLM_WIF_SIGNING_KEYS` (JSON `[{ kid?, pem, active? }]`) o `LLM_WIF_SIGNING_KEY`: RSA ≥ 2048 (RS256) o EC
    P-256/P-384/P-521 (ES256/384/512); HMAC y Ed25519 se rechazan al arrancar (Anthropic solo acepta RSA/ECDSA). `kid`
    por defecto = huella RFC 7638. Rotación: se publican todas, firma la `active` (o la primera privada); publicar la
    nueva ≥ 15 min antes de activarla y conservar la anterior hasta que expiren sus aserciones (caché de JWKS de Anthropic
    de hasta 1 min). Fuera de producción, sin clave, se genera una efímera P-256 con aviso; en producción, no se ofrece.
  - Aserción: `iss` = emisor, `sub = nexo:workspace:<workspaceId>` (la regla se crea antes que la conexión, por eso el
    sujeto es por workspace), `aud = https://api.anthropic.com`, `iat`/`nbf`/`exp` con vida de 10 min (≤ 1 h del emisor),
    `jti` aleatorio (Anthropic lo trata como de un solo uso: se firma una aserción nueva por canje) y `nexo_workspace_id`.
  - Canje: el SDK oficial (`oidcFederationProvider`) hace `POST /v1/oauth/token` con `grant_type = jwt-bearer`,
    `assertion`, `federation_rule_id` (`fdrl_`), `organization_id` (UUID), `service_account_id` (`svac_`) y
    `workspace_id` (`wrkspc_`, opcional) y la cabecera beta `oidc-federation-2026-04-01`; el token `sk-ant-oat01-…` viaja
    como Bearer con `oauth-2025-04-20` y el `TokenCache` del SDK lo reutiliza hasta su expiración (renovación 120 s / 30 s
    antes). El cliente se cachea por conexión en `LlmGatewayService`, así que el token se comparte entre ejecuciones.
  - Pasos para el cliente (en `mechanisms[].steps`): Consola de Claude → Workload identity → «Connect workload» →
    «Custom OIDC»; emisor = URL de Nexo con JWKS por descubrimiento («Verify issuer»); regla con `subject_prefix` exacto
    (sin `*`) igual al sujeto del workspace y `audience = https://api.anthropic.com`; alcance `workspace:inference` (o
    `workspace:developer`) y vida corta; pegar en Nexo los ids de la regla, cuenta de servicio, organización y workspace.
  - Errores: el 401 opaco de Anthropic («Authentication failed») se traduce a un mensaje accionable
    (`KeylessAuthError`) que remite al historial de autenticación de la Consola; nunca se devuelve el cuerpo.
- **L3 · Claude en AWS con rol de IAM + `ExternalId`** (`claude-bedrock`, `claude-aws`; el `bedrock` compatible con
  OpenAI sigue con token de corta duración, sin SigV4):
  - `LLM_AWS_PRINCIPAL_ARN`: principal de IAM de la plataforma que aparece en la política de confianza del cliente. Sin
    él, el mecanismo no está disponible. Las credenciales de la plataforma salen de la cadena estándar del SDK de AWS
    (rol de tarea de ECS, perfil, variables `AWS_*`); esas consultas de credenciales de la propia plataforma (metadatos de
    ECS/IMDS) no pasan por la política SSRF, que sí aplica a STS (`requestHandler` sobre `safeFetch`) y a los endpoints de
    Claude. `LLM_AWS_STS_ENDPOINT` solo para pruebas o un VPC endpoint.
  - `ExternalId` generado por Nexo (`nexo-` + 192 bits base64url), nunca elegido por el cliente (confused deputy):
    `POST …/keyless/prepare` lo devuelve con un comprobante HMAC ligado al workspace (vida 24 h); `POST …/connect` exige
    ese comprobante y rechaza un `ExternalId` ya usado por cualquier conexión (uno por conexión).
  - `AssumeRole` (`DurationSeconds` 3600, `RoleSessionName = nexo-<workspaceId>`) con las credenciales temporales en
    caché hasta 5 min antes de expirar y una sola solicitud por rol aunque haya concurrencia. AccessDenied se explica
    («revise la política de confianza…») sin el cuerpo de STS.
  - Bedrock: `https://bedrock-mantle.{región}.api.aws/anthropic`, ids `anthropic.claude-…`, sin API de modelos: se
    verifica con un conteo de tokens y `verifyMode: 'lenient'` (tras asumir el rol); sin fallback server-side. Claude
    Platform on AWS: `https://aws-external-anthropic.{región}.api.aws`, cabecera `anthropic-workspace-id`, API de
    modelos; el cliente debe ejecutar `aws iam enable-outbound-web-identity-federation`. En ambos `apiKey: null` impide
    que el SDK tome un Bearer del entorno.
  - Plantillas que muestra la web: confianza `{ Principal: { AWS: <principal de Nexo> }, Action: sts:AssumeRole,
    Condition: { StringEquals: { sts:ExternalId } } }`; permisos `bedrock-mantle:CreateInference` (Bedrock, `Resource: *`
    hasta verificar el ARN de modelos de bedrock-mantle) y `aws-external-anthropic:CreateInference|CountTokens|GetModel|
    ListModels|GetWorkspace` sobre `arn:aws:aws-external-anthropic:<región>:*:workspace/<wrkspc>` (AWS).
  - `pendingVerification`: ARN de modelos de bedrock-mantle, `count_tokens` en bedrock-mantle, tarifas de ambos canales,
    fallback server-side en Claude Platform on AWS y emisores de terceros en «Custom OIDC».
- **B2 · uso único del `state` OAuth entre réplicas.** `SingleUseService` (`infrastructure/redis/single-use.service.ts`)
  reclama el `jti` con `SET nexo:once:<ámbito>:<jti> 1 NX PX <vida restante>` en el Redis de la aplicación y **falla
  cerrado** (sin Redis el `state` se rechaza y hay que iniciar sesión de nuevo). `OAuthStateService.consume(state,
  { replayGuard })` lo aplica de forma opcional; lo usan el OAuth de proveedores IA (`llm-auth-flows`) y el de
  OpenRouter. El OAuth de conectores puede adoptarlo pasando la misma opción (sin cambios en este addendum).
- **Contrato** (ADMIN/OWNER salvo lo público):
  - `POST /admin/llm/providers/:id/keyless/prepare` `{ mechanism: 'WORKLOAD_IDENTITY'|'AWS_ROLE', fields? }` → 200
    `{ mechanism: 'WORKLOAD_IDENTITY', issuerUrl, discoveryUrl, jwksUrl, audience, subject, suggestedScope,
    assertionTtlSeconds, consoleUrl, ephemeralKey, steps }` o `{ mechanism: 'AWS_ROLE', externalId, setupToken,
    expiresAt, principalArn, trustPolicy, permissionsPolicy, steps }`; 400 si el proveedor no tiene el mecanismo o no
    está disponible (motivo en español); no guarda nada.
  - `POST /admin/llm/providers/:id/connect` agrega `mechanism?: 'API_KEY'|'WORKLOAD_IDENTITY'|'AWS_ROLE'` (por defecto
    `API_KEY`) y `setupToken?` (solo `AWS_ROLE`); igual que con clave, prueba la conexión antes de guardarla.
  - `ProviderView.mechanisms[]` agrega `steps?: string[]`; `LlmConnection` agrega `keyless: null | { type:
    'WORKLOAD_IDENTITY' } | { type: 'AWS_ROLE'; externalId; roleArn }`.
  - Públicos: `GET /api/oidc/.well-known/openid-configuration` y `GET /api/oidc/jwks`.

## Contrato de API

Todas las cantidades monetarias son `number` en USD. Rutas bajo `/api`.

### Catálogo (cualquier rol)
`GET /llm/catalog` y su alias `GET /agents/providers` →
```ts
{ id: string; label: string; kind: 'ANTHROPIC'|'OPENAI_COMPATIBLE'|'MOCK'; system: boolean; configured: boolean;
  models: { id: string; label: string; description: string; tier: 'PREMIUM'|'STANDARD'|'ECONOMY';
            inputUsdPerMTok: number; outputUsdPerMTok: number }[] }[]
```
Solo incluye conexiones y modelos habilitados.

### Unidades para selectores (cualquier rol)
`GET /org/units` → `{ id: string; name: string; parentId: string | null }[]`

### Mi consumo (cualquier rol)
`GET /me/usage` →
```ts
{ orgUnit: { id: string; name: string };
  budgets: { orgUnitId: string; orgUnitName: string; period: string; periodKey: string; limitUsd: number;
             spentUsd: number; pct: number; policy: 'BLOCK'|'DOWNGRADE'|'ALERT_ONLY' }[];   // unidad del usuario → raíz
  me: { costUsd: number; calls: number; inputTokens: number; outputTokens: number; since: string } }  // mes en curso
```

### Administración (ADMIN/OWNER)
**Conexiones y modelos**
- `GET /admin/llm/connections` → `LlmConnection[]` donde
  `LlmConnection = { id; name; kind; baseUrl: string|null; hasApiKey: boolean; enabled: boolean; createdAt; updatedAt; models: LlmModel[] }`
  y `LlmModel = { id; connectionId; modelId; label; tier; inputUsdPerMTok; outputUsdPerMTok; cacheReadUsdPerMTok: number|null; enabled }`
- `POST /admin/llm/connections` `{ name, kind, baseUrl?, apiKey?, enabled? }` → `LlmConnection`
- `PATCH /admin/llm/connections/:id` (parcial; `apiKey` solo si se envía) → `LlmConnection`
- `DELETE /admin/llm/connections/:id` (409 si hay agentes usándola)
- `POST /admin/llm/connections/:id/test` → `{ ok: boolean; message: string }`
- `POST /admin/llm/connections/:id/models` `{ modelId, label, tier, inputUsdPerMTok, outputUsdPerMTok, cacheReadUsdPerMTok?, enabled? }` → `LlmModel`
- `PATCH /admin/llm/models/:id` (parcial) → `LlmModel` · `DELETE /admin/llm/models/:id`

**Organización**
- `GET /admin/org/units` → `{ id; name; code: string|null; parentId: string|null; allowedModels: string[]; memberCount: number; isRoot: boolean }[]`
- `POST /admin/org/units` `{ name, code?, parentId }` · `PATCH /admin/org/units/:id` `{ name?, code?, parentId?, allowedModels? }`
- `DELETE /admin/org/units/:id` (no la raíz; hijos y miembros pasan al padre)
- `GET /admin/org/members` → `{ membershipId; userId; name; email; role; orgUnitId: string; createdAt }[]`
- `POST /admin/org/members` `{ email, name, role, orgUnitId?, password? }` (password obligatorio si el usuario no existe)
- `PATCH /admin/org/members/:membershipId` `{ role?, orgUnitId? }` · `DELETE /admin/org/members/:membershipId`
  (no se puede dejar el workspace sin OWNER)

**Presupuestos**
- `GET /admin/budgets` → por cada unidad:
  `{ orgUnitId; orgUnitName; parentId; budget: null | { period; limitUsd; policy; alertThresholds: number[]; downgradeProviderId: string|null; downgradeModel: string|null }; periodKey: string|null; spentUsd: number; pct: number|null }[]`
- `PUT /admin/budgets/:orgUnitId` `{ period, limitUsd, policy, alertThresholds?, downgradeProviderId?, downgradeModel? }`
- `DELETE /admin/budgets/:orgUnitId`

**Consumo y alertas**
- `GET /admin/usage/summary?from&to&groupBy=orgUnit|model|agent|user|day` →
  `{ from; to; totalCostUsd; inputTokens; outputTokens; calls; groups: { key; label; costUsd; inputTokens; outputTokens; calls }[] }`
  (`from`/`to` ISO; por defecto el mes en curso; `groups` ordenado por costo desc., salvo `day` que va cronológico)
- `GET /admin/usage/records?take&cursor` → `{ items: { id; createdAt; source; model; providerId; orgUnitName; userName; agentName; inputTokens; outputTokens; costUsd }[]; nextCursor }`
- `GET /admin/alerts` → `{ id; orgUnitId; orgUnitName; periodKey; threshold; spentUsd; limitUsd; createdAt }[]` (últimas 100)

### Catálogo de proveedores (ADMIN/OWNER, D8)
- `GET /admin/llm/providers` → `{ providers: ProviderView[] }`, con
  `ProviderView = { id; name; description; logo; category: 'FRONTIER'|'OPEN_MODELS'|'ENTERPRISE_CLOUD'|'LOCAL'|'ROUTER';
  billing: 'PAY_AS_YOU_GO'|'FREE_TIER'|'ENTERPRISE'|'LOCAL'; kind: 'ANTHROPIC'|'OPENAI_COMPATIBLE'; baseUrl;
  auth: 'API_KEY'|'OAUTH'|'NONE'; fields: { key; label; secret; required; placeholder?; help?; pattern?; default? }[];
  docsUrl; keyUrl?; keySteps: string[]; keyPrefix?; suggestedModels: { id; label; tier; inputUsdPerMTok?;
  outputUsdPerMTok?; cacheReadUsdPerMTok?; contextTokens? }[]; notes?;
  dataNotices?: { level: 'info'|'warning'; text; sourceUrl }[]; pendingVerification: string[];
  connected: { connectionId; name; modelCount; enabled }[]; modelCount: number;
  platform: { configured: boolean; models: number } | null }` (`platform` solo en `anthropic`).
- `POST /admin/llm/providers/:id/connect` `{ name?, fields: Record<string,string>, models?: string[] }` → 201
  `{ connection: LlmConnection; models: LlmModel[]; discoveredModels: string[] }`; 400 con mensaje claro si los campos
  no son válidos o la prueba falla (clave rechazada, URL 404, inalcanzable, SSRF); 404 si el proveedor no existe.
  Sin `models` se importan los sugeridos que el proveedor expone (Azure agrega su `deployment`).
- `GET /admin/llm/providers/:id/discover?connectionId=` → `{ connectionId; models: string[]; discoveredModels: string[]; importedModels: string[] }` (`models` = `discoveredModels`).
- `ProviderView` agrega `mechanisms: { type: 'API_KEY'|'OAUTH'|'DEVICE_CODE'|'LOCAL_DETECT'; label: string;
  available: boolean; unavailableReason?: string; primary: boolean }[]`; `fields[]` agrega `mechanisms?: string[]`
  (ausente = el campo aplica a todos; p. ej. `apiKey` solo en `API_KEY`, `tenantId` de Azure solo en `OAUTH`);
  `suggestedModels[]` siempre trae `specialties: string[]` y `contextTokens: number|null`. `POST …/connect` es el
  mecanismo `API_KEY` (o la URL manual de los locales): en un proveedor sin `API_KEY` (Vertex) responde 400.
- `POST /admin/llm/providers/:id/oauth/start` `{ name?, fields?, models?, limit? }` → 200 `{ authorizeUrl }` (sirve para
  `openrouter`, `vertex`, `azure-openai`, `huggingface`; `limit` solo en OpenRouter; `fields` = campos no secretos del
  mecanismo `OAUTH`, p. ej. Vertex `{ projectId, region? }`, Azure `{ resource, deployment, tenantId? }`). 400 si el
  proveedor no tiene el mecanismo, la app de Nexo no está configurada o los campos no son válidos; 404 si no existe.
- `GET /llm/oauth/:provider/callback?code&state` (público, 30/min) → 302 a
  `${WEB_URL}/admin/providers?llm=connected&provider=…&connectionId=…` o
  `?llm=error&provider=…&reason=invalid_state|access_denied|missing_code|forbidden|not_configured|exchange_failed|verification_failed`
  (`verification_failed`: el token no pudo usar el endpoint, p. ej. sin rol sobre el proyecto o recurso).
- `POST /admin/llm/providers/:id/device/start` `{ name?, fields?, models? }` → 200 `{ flowId; userCode; verificationUri;
  verificationUriComplete?; expiresIn; interval }` (hoy `huggingface`).
- `POST /admin/llm/providers/:id/device/poll` `{ flowId }` → 200 `{ status: 'pending'|'slow_down'|'connected'|'expired'|
  'denied'; interval?; message?; connection? }` (`connection` = `LlmConnection` con `models`; 404 si el flujo no es del
  workspace). Sondear cada `interval` segundos; tras `slow_down` usar el nuevo `interval`.
- `POST /admin/llm/providers/:id/detect` `{ baseUrl? }` → 200 `{ providerId; baseUrl; reachable: boolean;
  models: { id; label; tier; specialties; contextTokens }[]; message? }` (solo `ollama`/`lmstudio`; no guarda nada;
  respeta SSRF). Para guardar, `POST …/connect` `{ fields: { baseUrl }, models }`.
- `DELETE /admin/llm/connections/:id` → 200 `{ deleted: true; revoked: boolean }`: si la conexión es OAuth y el proveedor
  documenta revocación (Google) revoca el grant antes de borrar.
- `GET /admin/llm/connections/:id/models` → `LlmModel[]`.
- `LlmConnection` agrega `providerId: string|null`, `providerFields: Record<string,string>`,
  `credentialType: 'API_KEY'|'OAUTH'`, `oauthExpiresAt: string|null` y `oauthRenewable: boolean|null`; `LlmModel` agrega
  `needsPricing: boolean`, `specialties: string[]` (GENERAL si no hay datos) y `contextTokens: number|null`.

### Cambios en contratos existentes
- `Agent` incluye `costCenterId: string | null` (crear/actualizar).
- Chat SSE `done` agrega `usage: { inputTokens; outputTokens; costUsd }`, `model` y `providerId`; puede emitirse
  `notice` con la degradación aplicada. Presupuesto agotado → evento `error` (o HTTP 402 sin streaming).

## Consecuencias
- Nueva migración Prisma (tablas `LlmConnection`, `LlmModel`, `OrgUnit`, `Budget`, `BudgetLedger`, `BudgetAlert`,
  `UsageRecord`; columnas `Membership.orgUnitId`, `Agent.costCenterId`).
- Los agentes y conversaciones existentes siguen funcionando (`anthropic`/`mock` son conexiones de sistema).
- El costo es una estimación según los precios configurados; la factura del proveedor manda. Se documenta en la consola.
- Pendiente (fase siguiente): SigV4 con rol de IAM en el proveedor `bedrock` compatible con OpenAI (Claude en Bedrock ya
  lo tiene, D9),
  notificaciones por correo/Slack de alertas, presupuestos por usuario,
  streaming en el proveedor OpenAI-compatible, contador en Redis para muy alto volumen.

## Plan de implementación
| Tarea | Dueño | Criterio de aceptación |
|---|---|---|
| Esquema, migración, módulos `llm-admin`, `org`, `budgets`, `usage` | backend-platform | Endpoints del contrato con roles y aislamiento por workspace |
| Proveedores dinámicos, OpenAI-compatible, medición y control por turno | backend-ai | Uso registrado por turno; 402 al agotar; degradación funcional |
| Zonas portal/admin, páginas de administración y Mi consumo | frontend-core + frontend-ui | Build sin warnings; navegación por rol |
| Pruebas de presupuesto jerárquico, políticas y aislamiento | qa-api | Suite en verde contra Postgres/Redis reales |
