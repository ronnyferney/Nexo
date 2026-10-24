import { API_KEY_FIELD, type OAuthAppSpec, type ProviderCatalogEntry } from './provider-catalog.types';

/**
 * Nubes empresariales. Fuentes verificadas el 2026-10-23 (learn.microsoft.com, developers.google.com y
 * docs.cloud.google.com estaban bloqueados por el proxy; se usaron los repos oficiales):
 * - Azure OpenAI: openai/openai-node `docs/azure.md` y `examples/azure/chat.ts` (endpoint v1
 *   `https://<recurso>.openai.azure.com/openai/v1/`, `model` = nombre del despliegue, token de Entra ID como Bearer) y
 *   la clase `AzureOpenAI` del SDK (cabecera `api-key`); Azure/azure-sdk-for-js `sdk/openai/openai/README.md` (scope
 *   `https://cognitiveservices.azure.com/.default`).
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
 * - Amazon Bedrock: openai/openai-node `docs/bedrock.md` y `internal/bedrock.js` (API raíz
 *   `https://bedrock-mantle.<región>.api.aws/openai/v1`, autenticación Bearer con la clave de API de Bedrock
 *   `AWS_BEARER_TOKEN_BEDROCK`, validación de región) y platform.claude.com «Claude in Amazon Bedrock» (bedrock-mantle).
 */
/** App OAuth web de Nexo en Google Cloud (`OAUTH_LLM_VERTEX_CLIENT_ID/SECRET`). */
const GOOGLE_CLOUD_OAUTH: OAuthAppSpec = {
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

/** App de Nexo registrada en Microsoft Entra ID (`OAUTH_LLM_AZURE_OPENAI_CLIENT_ID/SECRET`). */
const ENTRA_COGNITIVE_OAUTH: OAuthAppSpec = {
  idpName: 'Microsoft',
  authorizeUrl: 'https://login.microsoftonline.com/{{ tenantId }}/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/{{ tenantId }}/oauth2/v2.0/token',
  scopes: ['https://cognitiveservices.azure.com/.default', 'offline_access'],
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
      'Microsoft», su cuenta necesita un rol de Azure RBAC que permita inferencia sobre el recurso (p. ej. «Cognitive ' +
      'Services OpenAI User»); el token se renueva solo. Entra ID no documenta revocación de tokens: al desconectar, ' +
      'Nexo borra sus tokens y usted puede retirar el consentimiento de la app en su inquilino.',
    pendingVerification: [
      'endpoint /models con clave de API y con token de Entra ID en la API v1',
      'pasos para obtener la clave',
      'nombre exacto del rol de Azure RBAC requerido',
      'scope para la API v1: el ejemplo v1 de openai-node usa https://ai.azure.com/.default; Nexo usa el de Cognitive Services documentado en el SDK de Azure',
    ],
    authHeader: 'api-key',
    // La API v1 no documenta `/models`: un 404 ahí no impide conectar (un 401/403 sí).
    verifyMode: 'lenient',
    mechanisms: [
      { type: 'OAUTH', label: 'Iniciar sesión con Microsoft', primary: true, oauth: ENTRA_COGNITIVE_OAUTH },
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
    description: 'Endpoint compatible con OpenAI de Amazon Bedrock (bedrock-mantle) con clave de API de Bedrock.',
    logo: 'bedrock',
    category: 'ENTERPRISE_CLOUD',
    billing: 'ENTERPRISE',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://bedrock-mantle.{{ region }}.api.aws/openai/v1',
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
      API_KEY_FIELD({
        label: 'Clave de API de Bedrock',
        help: 'Clave de API de Amazon Bedrock (la misma de AWS_BEARER_TOKEN_BEDROCK); se envía como Bearer.',
      }),
    ],
    docsUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions-mantle.html',
    keyUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html',
    keySteps: [],
    suggestedModels: [],
    notes:
      'Los tokens de corta duración (prefijo bedrock-api-key-) caducan en horas: use una clave de larga duración para Nexo. ' +
      'Los modelos y rutas disponibles dependen de su cuenta y región; elija los modelos con «Descubrir».',
    pendingVerification: [
      'formato de la clave de larga duración y pasos en la consola de AWS',
      'Chat Completions con clave de API en bedrock-mantle para cada modelo',
      'precios',
    ],
    authHeader: 'bearer',
  },
];
