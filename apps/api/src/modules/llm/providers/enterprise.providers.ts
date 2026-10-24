import { API_KEY_FIELD, type OAuthAppSpec, type ProviderCatalogEntry } from './provider-catalog.types';

/**
 * Nubes empresariales. Fuentes verificadas el 2026-10-23 (learn.microsoft.com, developers.google.com y
 * docs.cloud.google.com estaban bloqueados por el proxy; se usaron los repos oficiales):
 * - Azure OpenAI: openai/openai-node `docs/azure.md` (sección «v1 API», verificada el 2026-10-24) y
 *   `examples/azure/chat.ts` (endpoint v1 `https://<recurso>.openai.azure.com/openai/v1/`, `model` = nombre del
 *   despliegue, token de Entra ID como Bearer obtenido con el scope `https://ai.azure.com/.default`; el scope
 *   `https://cognitiveservices.azure.com/.default` queda para las versiones con fecha y la clase `AzureOpenAI`, cabecera
 *   `api-key`). Roles de Azure RBAC de un recurso de Foundry: «Foundry User» (antes «Azure AI User») o «Cognitive
 *   Services User» (platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry, «Prerequisites»).
 * - Microsoft Entra ID: MicrosoftDocs/entra-docs `docs/identity-platform/v2-oauth2-auth-code-flow.md`
 *   (`https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize|token`, tenant `organizations`/id, PKCE S256
 *   recomendado también para apps confidenciales, `client_secret` en el cuerpo, `scope` en el canje y la renovación,
 *   refresh token solo con `offline_access`). Entra ID no documenta un endpoint de revocación de tokens OAuth.
 * - Vertex AI: GoogleCloudPlatform/generative-ai `gemini/chat-completions/intro_chat_completions_api.ipynb` (URL base
 *   `https://{host}/v1/projects/{proyecto}/locations/{región}/endpoints/openapi`, host `aiplatform.googleapis.com` en
 *   `global` o `{región}-aiplatform.googleapis.com`, access token como clave del SDK de OpenAI, scope
 *   `https://www.googleapis.com/auth/cloud-platform`, vida de 1 hora, ids de modelo `google/<modelo>`).
 * - Google OAuth 2.0: googleapis/google-auth-library-nodejs `src/auth/oauth2client.ts` (`accounts.google.com/o/oauth2/
 *   v2/auth`, `oauth2.googleapis.com/token`, `oauth2.googleapis.com/revoke`, `access_type=offline` para recibir refresh
 *   token, `prompt=consent`, PKCE S256).
 * - Amazon Bedrock (verificado el 2026-10-24): openai/openai-node `docs/bedrock.md` (API raíz por defecto
 *   `https://bedrock-mantle.<región>.api.aws/openai/v1`; «AWS's Chat Completions documentation instead describes a `/v1`
 *   route… If your model or endpoint requires that route, override the API root explicitly»; Bearer con la clave de
 *   Bedrock `AWS_BEARER_TOKEN_BEDROCK`); aws/aws-bedrock-token-generator-js `README.md` (tokens de corta duración con
 *   prefijo `bedrock-api-key-`, vida de hasta 12 horas, generados con credenciales de AWS); platform.claude.com/docs/en/
 *   build-with-claude/claude-in-amazon-bedrock, «Authentication» (rol de servicio o roles de IAM asumidos antes que
 *   tokens Bearer, que son «short-term access… 12-hour maximum, least preferred», y bloquear las claves de larga
 *   duración con la condición `bedrock:BearerTokenType`).
 */
/** App OAuth web de Nexo en Google Cloud (`OAUTH_LLM_VERTEX_CLIENT_ID/SECRET`). */
export const GOOGLE_CLOUD_OAUTH: OAuthAppSpec = {
  idpName: 'Google',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  // `offline` entrega refresh token; `consent` lo vuelve a emitir si el usuario ya había autorizado la app.
  authorizeParams: { access_type: 'offline', prompt: 'consent' },
  clientAuth: 'post',
  secretRequired: true,
};

/**
 * App de Nexo registrada en Microsoft Entra ID (`OAUTH_LLM_AZURE_OPENAI_CLIENT_ID/SECRET`); la comparten Azure OpenAI y
 * Claude en Microsoft Foundry (`appKey: 'azure-openai'`). El scope `https://ai.azure.com/.default` es el de la API v1 de
 * Azure OpenAI (openai-node `docs/azure.md`) y el de Claude en Foundry (platform.claude.com, «Microsoft Entra
 * authentication»; SDK `@anthropic-ai/foundry-sdk` 1.1.0).
 */
export const ENTRA_AI_OAUTH: OAuthAppSpec = {
  idpName: 'Microsoft',
  authorizeUrl: 'https://login.microsoftonline.com/{{ tenantId }}/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/{{ tenantId }}/oauth2/v2.0/token',
  scopes: ['https://ai.azure.com/.default', 'offline_access'],
  // Conexiones de Azure OpenAI creadas con el scope anterior de Cognitive Services (hasta 2026-10-24).
  legacyScopes: [
    {
      match: 'cognitiveservices.azure.com',
      scopes: ['https://cognitiveservices.azure.com/.default', 'offline_access'],
    },
  ],
  scopeOnTokenRequest: true,
  clientAuth: 'post',
  secretRequired: true,
};

export const ENTERPRISE_PROVIDERS: ProviderCatalogEntry[] = [
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    description: 'Modelos de OpenAI desplegados en su suscripción de Azure (API v1).',
    logo: 'azure-openai',
    category: 'ENTERPRISE_CLOUD',
    billing: 'ENTERPRISE',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://{{ resource }}.openai.azure.com/openai/v1',
    auth: 'API_KEY',
    fields: [
      {
        key: 'resource',
        label: 'Nombre del recurso',
        secret: false,
        required: true,
        placeholder: 'mi-recurso',
        help: 'Subdominio de https://<recurso>.openai.azure.com.',
        pattern: '^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$',
      },
      API_KEY_FIELD({
        help: 'Clave del recurso de Azure OpenAI; viaja en la cabecera api-key.',
        mechanisms: ['API_KEY'],
      }),
      {
        key: 'deployment',
        label: 'Nombre del despliegue',
        secret: false,
        required: true,
        placeholder: 'gpt-prod',
        help: 'En la API v1 el modelo es el nombre del despliegue; se importa como modelo de la conexión.',
        pattern: '^[A-Za-z0-9._-]{1,64}$',
      },
      {
        key: 'tenantId',
        label: 'Inquilino de Entra ID',
        secret: false,
        required: false,
        placeholder: 'organizations',
        default: 'organizations',
        help: 'Id o dominio del inquilino de Microsoft Entra ID del recurso; «organizations» acepta cualquier cuenta profesional.',
        pattern: '^[A-Za-z0-9][A-Za-z0-9.-]{0,99}$',
        mechanisms: ['OAUTH'],
      },
    ],
    docsUrl: 'https://learn.microsoft.com/azure/foundry/openai/api-version-lifecycle',
    keySteps: [],
    suggestedModels: [],
    notes:
      'Las tarifas dependen de su contrato con Microsoft: complételas en cada despliegue. Con «Iniciar sesión con ' +
      'Microsoft», su cuenta necesita un rol de Azure RBAC que permita inferencia sobre el recurso (en recursos de ' +
      'Foundry: «Foundry User», antes «Azure AI User», o «Cognitive Services User»); el token se renueva solo. Entra ID ' +
      'no documenta revocación de tokens: al desconectar, Nexo borra sus tokens y usted puede retirar el consentimiento ' +
      'de la app en su inquilino.',
    pendingVerification: [
      'endpoint /models con clave de API y con token de Entra ID en la API v1',
      'pasos para obtener la clave',
      'rol de Azure RBAC en recursos clásicos de Azure OpenAI (posiblemente «Cognitive Services OpenAI User»; solo índice)',
      'host https://<recurso>.services.ai.azure.com/openai/v1 de los recursos de Foundry (solo índice; el SDK @azure/ai-projects usa la ruta de proyecto /api/projects/<proyecto>/openai/v1)',
      'permiso delegado de la app de Nexo para el recurso https://ai.azure.com en Entra ID',
    ],
    authHeader: 'api-key',
    // La API v1 no documenta `/models`: un 404 ahí no impide conectar (un 401/403 sí).
    verifyMode: 'lenient',
    mechanisms: [
      { type: 'OAUTH', label: 'Iniciar sesión con Microsoft', primary: true, oauth: ENTRA_AI_OAUTH },
      { type: 'API_KEY', label: 'Clave del recurso', primary: false },
    ],
  },
  {
    id: 'vertex',
    name: 'Google Vertex AI',
    description:
      'Modelos de Vertex AI (Gemini y Model Garden) en su proyecto de Google Cloud, con su cuenta de Google.',
    logo: 'vertex',
    category: 'ENTERPRISE_CLOUD',
    billing: 'ENTERPRISE',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://{{ apiHost }}/v1/projects/{{ projectId }}/locations/{{ region }}/endpoints/openapi',
    auth: 'OAUTH',
    fields: [
      {
        key: 'projectId',
        label: 'Id del proyecto de Google Cloud',
        secret: false,
        required: true,
        placeholder: 'mi-proyecto-123',
        help: 'Proyecto con la API de Vertex AI habilitada y facturación activa.',
        pattern: '^[a-z][a-z0-9-]{4,28}[a-z0-9]$',
      },
      {
        key: 'region',
        label: 'Región',
        secret: false,
        required: true,
        placeholder: 'global',
        default: 'global',
        help: '«global» o una región de Vertex AI (p. ej. us-central1).',
        pattern: '^(global|[a-z]+-[a-z]+[0-9]+)$',
      },
    ],
    docsUrl: 'https://cloud.google.com/vertex-ai/generative-ai/docs/start/openai',
    keySteps: [],
    suggestedModels: [],
    notes:
      'Inicie sesión con una cuenta de Google con permiso para invocar modelos de Vertex AI en el proyecto. Nexo ' +
      'guarda cifrado el refresh token y renueva el access token (1 hora) automáticamente. Indique los modelos con su ' +
      'id de Vertex (p. ej. google/<modelo>) al conectar o en la pestaña de modelos.',
    pendingVerification: [
      'rol de IAM mínimo para invocar modelos (posiblemente «Vertex AI User»)',
      'listado de modelos (/models) en el endpoint compatible con OpenAI',
      'ids de modelos vigentes y precios',
    ],
    authHeader: 'bearer',
    verifyMode: 'lenient',
    deriveValues: (v) => ({
      apiHost: v.region === 'global' ? 'aiplatform.googleapis.com' : `${v.region}-aiplatform.googleapis.com`,
    }),
    mechanisms: [{ type: 'OAUTH', label: 'Iniciar sesión con Google', primary: true, oauth: GOOGLE_CLOUD_OAUTH }],
  },
  {
    id: 'bedrock',
    name: 'Amazon Bedrock',
    description: 'Endpoint compatible con OpenAI de Amazon Bedrock (bedrock-mantle) con un token de Bedrock.',
    logo: 'bedrock',
    category: 'ENTERPRISE_CLOUD',
    billing: 'ENTERPRISE',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://bedrock-mantle.{{ region }}.api.aws/{{ apiPath }}',
    auth: 'API_KEY',
    fields: [
      {
        key: 'region',
        label: 'Región de AWS',
        secret: false,
        required: true,
        placeholder: 'us-east-1',
        pattern: '^[a-z]{2,8}(-[a-z0-9]+)+-\\d+$',
      },
      {
        key: 'apiPath',
        label: 'Ruta de la API',
        secret: false,
        required: false,
        placeholder: 'openai/v1',
        default: 'openai/v1',
        help: '«openai/v1» (por defecto del SDK de OpenAI) o «v1» si la ficha de su modelo en Bedrock indica esa ruta.',
        pattern: '^(openai/v1|v1)$',
      },
      API_KEY_FIELD({
        label: 'Token de Bedrock',
        placeholder: 'bedrock-api-key-...',
        help:
          'Token de corta duración (empieza con «bedrock-api-key-», dura hasta 12 horas) generado con sus credenciales ' +
          'de AWS; se envía como Bearer y se guarda cifrado.',
      }),
    ],
    docsUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions-mantle.html',
    keyUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html',
    keySteps: [
      'Genere un token de corta duración con la herramienta oficial aws-bedrock-token-generator (npm @aws/bedrock-token-generator) y sus credenciales de AWS.',
      'El token empieza con «bedrock-api-key-» y dura como máximo 12 horas (o menos, si sus credenciales caducan antes).',
      'Al caducar, vuelva a generarlo y actualice la clave de la conexión en Nexo.',
    ],
    // Prefijo de los tokens de corta duración: la interfaz advierte (sin bloquear) si se pega otro tipo de clave.
    keyPrefix: 'bedrock-api-key-',
    suggestedModels: [],
    notes:
      'Anthropic recomienda, antes que los tokens Bearer, un rol de servicio de Bedrock o roles de IAM con credenciales ' +
      'temporales; los tokens de Bedrock son de corta duración (máximo 12 horas) y la opción menos preferida. No use claves de larga ' +
      'duración para Nexo: su administrador puede bloquearlas con la condición bedrock:BearerTokenType. Mientras Nexo no ' +
      'admita roles de IAM, la conexión deja de funcionar al caducar el token. Los modelos y rutas disponibles dependen de ' +
      'su cuenta y región; elija los modelos con «Descubrir».',
    pendingVerification: [
      'conexión con rol de IAM y ExternalId (AssumeRole) sin tokens Bearer',
      'texto de AWS sobre claves de larga duración («Recommended only for exploration»; solo índice, docs.aws.amazon.com no accesible)',
      'Chat Completions con token Bearer en bedrock-mantle para cada modelo y ruta (/openai/v1 o /v1)',
      'precios',
    ],
    authHeader: 'bearer',
  },
];
