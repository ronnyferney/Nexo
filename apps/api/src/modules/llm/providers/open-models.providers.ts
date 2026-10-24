import { API_KEY_FIELD, type OAuthAppSpec, type ProviderCatalogEntry } from './provider-catalog.types';

/**
 * Plataformas de inferencia de modelos abiertos. Fuentes verificadas el 2026-10-23: SDK `groq-sdk` 1.6.0 y
 * groq/groq-api-cookbook; `@cerebras/cerebras_cloud_sdk` 1.91.0; `fireworks-ai` 1.2.30 (PyPI); `together-ai` 1.0.0 y
 * togethercomputer/together-cookbook; `langchain-nvidia-ai-endpoints` (repo langchain-ai/langchain-nvidia, mantenido por
 * NVIDIA); huggingface/hub-docs (inference-providers, security-tokens, pricing, `docs/hub/oauth.md`: «Sign in with
 * HF», `huggingface.co/oauth/authorize|token|device`, scope `inference-api`, PKCE, apps públicas sin secreto o
 * `Authorization: Basic` con secreto, código de dispositivo) y huggingface/huggingface.js (`oauth-login-url.ts`,
 * `oauth-handle-redirect.ts`: el token trae `expires_in` y no documenta refresh token); deepseek-ai/DeepSeek-R1
 * (modelo de razonamiento).
 * Revisión del 2026-10-24 (L5): se retiraron de las sugerencias `meta-llama/llama-4-scout-17b-16e-instruct` de Groq
 * (desaprobado el 2026-07-17 en los niveles gratuito y de desarrollador según console.groq.com/docs/deprecations) y
 * `accounts/fireworks/models/kimi-k2-instruct-0905` de Fireworks («serverless: Not supported» en su ficha). Ambas
 * evidencias son **(índice)**: esos dominios no son accesibles desde el entorno de verificación; retirar una sugerencia
 * no agrega datos sin verificar y el modelo sigue disponible con «Descubrir» si la cuenta lo expone. `openai/gpt-oss-20b`
 * se mantiene: es el modelo de los ejemplos del SDK `groq-sdk` 1.6.0.
 * Ollama Cloud: ollama/ollama `docs/cloud.mdx` y `docs/api/openai-compatibility.mdx` (`https://ollama.com/v1`, clave
 * `OLLAMA_API_KEY` como Bearer creada en ollama.com/settings/keys, modelos con los nombres de `https://ollama.com/api/tags`;
 * «We do not use them to train models»).
 */

/** App OAuth de Nexo en Hugging Face (`OAUTH_LLM_HUGGINGFACE_CLIENT_ID/SECRET`; el secreto es opcional). */
const HUGGING_FACE_OAUTH: OAuthAppSpec = {
  idpName: 'Hugging Face',
  authorizeUrl: 'https://huggingface.co/oauth/authorize',
  tokenUrl: 'https://huggingface.co/oauth/token',
  deviceUrl: 'https://huggingface.co/oauth/device',
  scopes: ['openid', 'profile', 'inference-api'],
  clientAuth: 'basic',
  secretRequired: false,
};
export const OPEN_MODEL_PROVIDERS: ProviderCatalogEntry[] = [
  {
    id: 'groq',
    name: 'Groq',
    description: 'Inferencia de muy baja latencia de modelos abiertos en hardware LPU.',
    logo: 'groq',
    category: 'OPEN_MODELS',
    billing: 'FREE_TIER',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://api.groq.com/openai/v1',
    auth: 'API_KEY',
    fields: [API_KEY_FIELD()],
    docsUrl: 'https://console.groq.com/docs',
    keyUrl: 'https://console.groq.com/',
    keySteps: [],
    suggestedModels: [{ id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', tier: 'ECONOMY' }],
    notes: 'La clave se obtiene gratis al crear una cuenta; el uso de pago depende del plan de Groq.',
    pendingVerification: [
      'precios',
      'límites del nivel gratuito',
      'pasos y formato de la clave',
      'reemplazo vigente de Llama 4 Scout (openai/gpt-oss-120b o qwen/qwen3.6-27b; solo índice)',
    ],
    authHeader: 'bearer',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    description: 'Inferencia rápida de modelos abiertos sobre sistemas Cerebras CS-3.',
    logo: 'cerebras',
    category: 'OPEN_MODELS',
    billing: 'PAY_AS_YOU_GO',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://api.cerebras.ai/v1',
    auth: 'API_KEY',
    fields: [API_KEY_FIELD()],
    docsUrl: 'https://inference-docs.cerebras.ai/models/overview',
    keyUrl: 'https://cloud.cerebras.ai/',
    keySteps: [],
    suggestedModels: [{ id: 'gpt-oss-120b', label: 'GPT-OSS 120B', tier: 'STANDARD' }],
    pendingVerification: ['precios', 'pasos y formato de la clave'],
    authHeader: 'bearer',
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    description: 'Plataforma de inferencia y ajuste de modelos abiertos.',
    logo: 'fireworks',
    category: 'OPEN_MODELS',
    billing: 'PAY_AS_YOU_GO',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    auth: 'API_KEY',
    fields: [API_KEY_FIELD({ placeholder: 'fw_...' })],
    docsUrl: 'https://docs.fireworks.ai/',
    keySteps: [],
    keyPrefix: 'fw_',
    suggestedModels: [{ id: 'accounts/fireworks/models/gemma-4-31b-it', label: 'Gemma 4 31B', tier: 'ECONOMY' }],
    pendingVerification: [
      'precios',
      'endpoint /models',
      'pasos para obtener la clave',
      'modelo serverless vigente que reemplace a Kimi K2 Instruct 0905 (solo índice)',
    ],
    authHeader: 'bearer',
  },
  {
    id: 'together',
    name: 'Together AI',
    description: 'Nube de inferencia con un amplio catálogo de modelos abiertos.',
    logo: 'together',
    category: 'OPEN_MODELS',
    billing: 'PAY_AS_YOU_GO',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://api.together.ai/v1',
    auth: 'API_KEY',
    fields: [API_KEY_FIELD()],
    docsUrl: 'https://docs.together.ai/docs/introduction',
    keyUrl: 'https://api.together.ai/signin',
    keySteps: [],
    suggestedModels: [],
    notes: 'Elija los modelos con «Descubrir» tras conectar: el catálogo no sugiere ids sin verificar.',
    pendingVerification: ['precios', 'ids de modelos vigentes', 'pasos y formato de la clave'],
    authHeader: 'bearer',
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    description: 'Catálogo de API de NVIDIA (build.nvidia.com) con microservicios NIM.',
    logo: 'nvidia',
    category: 'OPEN_MODELS',
    billing: 'PAY_AS_YOU_GO',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    auth: 'API_KEY',
    fields: [API_KEY_FIELD({ placeholder: 'nvapi-...' })],
    docsUrl: 'https://build.nvidia.com/models',
    keyUrl: 'https://build.nvidia.com/',
    keySteps: [
      'Cree una cuenta gratuita en el catálogo de API de NVIDIA (build.nvidia.com) e inicie sesión.',
      'Pulse el icono de su perfil y luego «API Keys».',
      'Pulse «Generate API Key» y después «Generate Key».',
      'Copie la clave (empieza con «nvapi-»).',
    ],
    keyPrefix: 'nvapi-',
    suggestedModels: [{ id: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super 120B', tier: 'STANDARD' }],
    notes: 'Un NIM autoalojado expone la misma API; regístrelo como conexión manual compatible con OpenAI.',
    pendingVerification: ['precios y condiciones de uso del catálogo alojado'],
    authHeader: 'bearer',
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    description: 'Router de Inference Providers de Hugging Face, compatible con OpenAI.',
    logo: 'huggingface',
    category: 'OPEN_MODELS',
    billing: 'PAY_AS_YOU_GO',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://router.huggingface.co/v1',
    auth: 'API_KEY',
    fields: [API_KEY_FIELD({ label: 'Token de acceso', placeholder: 'hf_...', mechanisms: ['API_KEY'] })],
    docsUrl: 'https://huggingface.co/docs/inference-providers',
    keyUrl:
      'https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained',
    keySteps: [
      'Abra la configuración de tokens de Hugging Face (huggingface.co/settings/tokens).',
      'Cree un token «fine-grained» con el permiso «Make calls to Inference Providers».',
      'Copie el token (empieza con «hf_»).',
    ],
    keyPrefix: 'hf_',
    suggestedModels: [
      { id: 'openai/gpt-oss-120b:fastest', label: 'GPT-OSS 120B (proveedor más rápido)', tier: 'STANDARD' },
      { id: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1', tier: 'PREMIUM', specialties: ['REASONING'] },
    ],
    notes:
      'Los usuarios gratuitos deben comprar créditos; PRO/Team/Enterprise incluyen créditos mensuales. El sufijo :fastest ' +
      'elige el proveedor. Con «Iniciar sesión con Hugging Face» el token caduca y Hugging Face no documenta refresh ' +
      'token: al expirar, Nexo pide volver a iniciar sesión (para uso continuo prefiera un token «hf_»).',
    pendingVerification: [
      'precios por modelo (dependen del proveedor elegido)',
      'refresh token y endpoint de revocación en el OAuth de Hugging Face',
    ],
    authHeader: 'bearer',
    mechanisms: [
      { type: 'OAUTH', label: 'Iniciar sesión con Hugging Face', primary: true, oauth: HUGGING_FACE_OAUTH },
      { type: 'DEVICE_CODE', label: 'Conectar con un código', primary: false, oauth: HUGGING_FACE_OAUTH },
      { type: 'API_KEY', label: 'Token de acceso (hf_)', primary: false },
    ],
  },
  {
    id: 'ollama-cloud',
    name: 'Ollama Cloud',
    description: 'Modelos abiertos en la nube de Ollama, sin servidor propio, con clave de API.',
    logo: 'ollama-cloud',
    category: 'OPEN_MODELS',
    billing: 'PAY_AS_YOU_GO',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://ollama.com/v1',
    auth: 'API_KEY',
    fields: [
      API_KEY_FIELD({ help: 'Clave de API de Ollama (OLLAMA_API_KEY); se envía como Bearer y se guarda cifrada.' }),
    ],
    docsUrl: 'https://docs.ollama.com/cloud',
    keyUrl: 'https://ollama.com/settings/keys',
    keySteps: [
      'Inicie sesión en ollama.com y abra «API keys» (ollama.com/settings/keys).',
      'Cree una clave y cópiela; manténgala fuera del código y del navegador.',
    ],
    suggestedModels: [],
    notes:
      'Use los nombres de modelo de la lista de modelos en la nube (p. ej. gemma4:31b) y elíjalos con «Descubrir». ' +
      'La API en la nube no admite Responses con estado. Revise los retiros de modelos en la configuración de uso de Ollama.',
    dataNotices: [
      {
        level: 'info',
        text: 'Ollama procesa los prompts y respuestas en la nube para responder y no los usa para entrenar modelos.',
        sourceUrl: 'https://docs.ollama.com/cloud',
      },
    ],
    pendingVerification: ['precios y planes', 'endpoint /v1/models en ollama.com (la documentación lista /api/tags)'],
    authHeader: 'bearer',
    // La lista oficial de modelos en la nube es `/api/tags`; un 404 en `/models` no impide conectar.
    verifyMode: 'lenient',
  },
];
