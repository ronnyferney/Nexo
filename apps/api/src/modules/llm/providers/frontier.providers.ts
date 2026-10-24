import { SYSTEM_ANTHROPIC_MODELS } from '../pricing';
import {
  ANTHROPIC_WORKSPACE_PATTERN,
  FEDERATION_RULE_PATTERN,
  ORGANIZATION_ID_PATTERN,
  SERVICE_ACCOUNT_PATTERN,
} from '../keyless/keyless-options';
import {
  API_KEY_FIELD,
  type ModelSpecialty,
  type ProviderCatalogEntry,
  type ProviderDataNotice,
  type ProviderField,
} from './provider-catalog.types';

/**
 * Laboratorios con API propia. Fuentes verificadas el 2026-10-23 (los dominios de documentación de terceros estaban
 * bloqueados por el proxy, por lo que se usaron los SDK oficiales publicados en npm/PyPI y los repos oficiales):
 * - Anthropic: platform.claude.com/docs (precios, modelos y especialidades, ventana de 1M, get-api-key).
 * - OpenAI: SDK `openai` 7.43.0 (URL base, tipos `ChatModel`).
 * - Gemini: google-gemini/cookbook (Get_started_OpenAI_Compatibility, Authentication).
 * - Mistral: SDK `@mistralai/mistralai` 3.1.0. xAI: SDK `@xai-official/sdk` 0.2.4 y xai-org/xai-cookbook.
 * - Moonshot: `kimi-cli` 1.52.0 (plataformas) y MoonshotAI/Kimi-K3 (README).
 * - DeepSeek: deepseek-ai/DeepSeek-R1 (README: API compatible con OpenAI en platform.deepseek.com).
 * Revisión del 2026-10-24:
 * - OpenAI: SDK `openai` 7.43.0, tipo `ChatModel` (`gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna`, serie 5.6).
 * - xAI: SDK `@xai-official/sdk` 0.2.5 (`README.md`: cubre la Responses API; `dist/generated/types.d.ts`: la
 *   especificación conserva `ChatRequest` «for `/v1/chat/completions` endpoint» sin marcarlo como legacy, a diferencia de
 *   `/v1/completions` y `/v1/complete`).
 * - Gemini: google-gemini/gemini-cli `docs/resources/tos-privacy.md` (con clave de la Gemini API rigen los «Gemini API
 *   Terms of Service», que «may differ depending on whether you are using an unpaid or paid service»).
 * - Cohere: cohere-ai/cohere-developer-experience `fern/pages/v2/text-generation/compatibility-api.mdx` (URL base
 *   `https://api.cohere.ai/compatibility/v1`, Bearer, `command-a-plus-05-2026`, parámetros admitidos: `model`,
 *   `messages`, `stream`, `tools`, entre otros).
 * - Perplexity: SDK `@perplexity-ai/perplexity_ai` 0.41.0 (URL base `https://api.perplexity.ai`, Bearer,
 *   `POST /chat/completions`, `GET /v1/models`, modelo `sonar` en el README).
 */
/**
 * Especialidades según platform.claude.com/docs/en/models/overview: todos los modelos actuales admiten visión; Fable
 * «para razonamiento exigente», Opus «para agentes de código y trabajo de conocimiento de larga duración», Sonnet
 * «la mejor combinación de velocidad e inteligencia» (latencia «Fast») y Haiku el más rápido.
 */
export const ANTHROPIC_SPECIALTIES: Record<string, ModelSpecialty[]> = {
  'claude-fable-5-1': ['REASONING', 'VISION'],
  'claude-opus-5-5': ['CODE', 'GENERAL', 'VISION'],
  'claude-sonnet-5-5': ['GENERAL', 'FAST', 'VISION'],
  'claude-haiku-5-5': ['FAST', 'VISION'],
};

/**
 * Aviso verificado de los «Covered Models» (platform.claude.com/docs/en/manage-claude/api-and-data-retention): «require
 * 30-day data retention; ZDR is therefore not available for any of them unless expressly authorized by Anthropic» y
 * «The 30-day data retention requirement applies wherever Covered Models are offered».
 */
export const CLAUDE_COVERED_MODELS_NOTICE: ProviderDataNotice = {
  level: 'warning',
  text:
    'Claude Fable 5.1 exige retención de datos de 30 días en todos los canales y no está disponible con retención cero ' +
    '(ZDR) salvo autorización expresa de Anthropic.',
  sourceUrl: 'https://platform.claude.com/docs/en/manage-claude/api-and-data-retention',
};

/**
 * Workload Identity Federation con la API de Anthropic (plan de mejora L2). Verificado el 2026-10-24 en
 * platform.claude.com/docs/en/manage-claude/workload-identity-federation («Set up federation», «Concepts») y …/wif-
 * reference («Token exchange request», formatos `fdrl_`, `svac_`, `wrkspc_` y UUID de organización). Nexo es el emisor
 * OIDC («Custom OIDC»); la regla fija el sujeto exacto del workspace y la audiencia `https://api.anthropic.com`.
 */
export const WORKLOAD_IDENTITY_FIELDS: ProviderField[] = [
  {
    key: 'federationRuleId',
    label: 'Regla de federación',
    secret: false,
    required: true,
    placeholder: 'fdrl_01AbCdEf',
    help: 'Id de la regla de federación (Consola de Claude → Workload identity).',
    pattern: FEDERATION_RULE_PATTERN,
    mechanisms: ['WORKLOAD_IDENTITY'],
  },
  {
    key: 'serviceAccountId',
    label: 'Cuenta de servicio',
    secret: false,
    required: true,
    placeholder: 'svac_01AbCdEf',
    help: 'Id de la cuenta de servicio a la que apunta la regla.',
    pattern: SERVICE_ACCOUNT_PATTERN,
    mechanisms: ['WORKLOAD_IDENTITY'],
  },
  {
    key: 'organizationId',
    label: 'Id de la organización de Anthropic',
    secret: false,
    required: true,
    placeholder: '00000000-0000-0000-0000-000000000000',
    help: 'UUID de la página Settings → Organization de la Consola de Claude.',
    pattern: ORGANIZATION_ID_PATTERN,
    mechanisms: ['WORKLOAD_IDENTITY'],
  },
  {
    key: 'anthropicWorkspaceId',
    label: 'Workspace de Anthropic',
    secret: false,
    required: false,
    placeholder: 'wrkspc_01AbCdEf',
    help: 'Obligatorio si la regla cubre más de un workspace; define cupos, límites y facturación.',
    pattern: ANTHROPIC_WORKSPACE_PATTERN,
    mechanisms: ['WORKLOAD_IDENTITY'],
  },
];

export const WORKLOAD_IDENTITY_STEPS = [
  'En la Consola de Claude abra Settings → Workload identity (platform.claude.com/settings/workload-identity-federation) y pulse «Connect workload» → «Custom OIDC» (requiere rol admin u owner de la organización).',
  'Emisor: use la URL del emisor de Nexo que se muestra aquí, con JWKS por descubrimiento («discovery»). Pulse «Verify issuer» para comprobar que Anthropic lee las claves de Nexo.',
  'Regla: sujeto exacto (subject_prefix sin «*») igual al sujeto de este workspace y audiencia https://api.anthropic.com; alcance workspace:inference (o workspace:developer) y una vida de token corta (p. ej. 600 s).',
  'Copie los ids de la regla (fdrl_…), de la cuenta de servicio (svac_…), de su organización y, si la regla cubre varios workspaces, del workspace (wrkspc_…), y péguelos aquí.',
  'Nexo firma una aserción nueva en cada intercambio y canjea por un token de corta duración; no se guarda ninguna clave.',
];

export const FRONTIER_PROVIDERS: ProviderCatalogEntry[] = [
  {
    id: 'anthropic',
    name: 'Claude · API de Anthropic',
    description: 'Directo con Anthropic: clave de API de la Consola de Claude, todas las funciones el mismo día.',
    logo: 'anthropic',
    category: 'FRONTIER',
    billing: 'PAY_AS_YOU_GO',
    kind: 'ANTHROPIC',
    baseUrl: 'https://api.anthropic.com',
    auth: 'API_KEY',
    fields: [
      API_KEY_FIELD({
        placeholder: 'sk-ant-...',
        help: 'Clave de la Consola de Claude; se guarda cifrada.',
        mechanisms: ['API_KEY'],
      }),
      ...WORKLOAD_IDENTITY_FIELDS,
    ],
    docsUrl: 'https://platform.claude.com/docs/en/get-api-key',
    keyUrl: 'https://platform.claude.com/settings/keys',
    keySteps: [
      'Inicie sesión en la Consola de Claude (platform.claude.com) o cree una cuenta.',
      'Abra la página «API keys» (platform.claude.com/settings/keys).',
      'Pulse «Create key», asigne nombre y expiración; para Nexo use preferiblemente una cuenta de servicio.',
      'Copie la clave (empieza con «sk-ant-»): la Consola solo la muestra una vez.',
    ],
    keyPrefix: 'sk-ant-',
    suggestedModels: SYSTEM_ANTHROPIC_MODELS.map((m) => ({
      id: m.id,
      label: m.label,
      tier: m.tier,
      inputUsdPerMTok: m.inputUsdPerMTok,
      outputUsdPerMTok: m.outputUsdPerMTok,
      ...(m.cacheReadUsdPerMTok !== null ? { cacheReadUsdPerMTok: m.cacheReadUsdPerMTok } : {}),
      contextTokens: 1_000_000,
      specialties: ANTHROPIC_SPECIALTIES[m.id] ?? ['GENERAL', 'VISION'],
    })),
    notes:
      'Claude Haiku 5.5 cobra 0,50/2,50 USD por MTok (0,05 la lectura de caché) en las peticiones cuyo prompt supera ' +
      '100.000 tokens, incluida la caché; Nexo aplica esa tarifa por petición al medir el consumo.',
    dataNotices: [
      {
        level: 'info',
        text:
          'Anthropic no usa los datos retenidos para entrenar modelos sin su permiso expreso. La retención cero (ZDR) se ' +
          'solicita al equipo de ventas de Anthropic para cada organización.',
        sourceUrl: 'https://platform.claude.com/docs/en/manage-claude/api-and-data-retention',
      },
      CLAUDE_COVERED_MODELS_NOTICE,
    ],
    pendingVerification: [
      'emisores OIDC de terceros como Nexo en el asistente «Custom OIDC» (la guía oficial lo describe para Okta, SPIFFE y otros proveedores conformes)',
    ],
    authHeader: 'bearer',
    family: 'CLAUDE',
    claudeChannel: 'anthropic',
    mechanisms: [
      { type: 'API_KEY', label: 'Clave de API', primary: true },
      {
        type: 'WORKLOAD_IDENTITY',
        label: 'Federación de identidad (sin claves)',
        primary: false,
        steps: WORKLOAD_IDENTITY_STEPS,
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'Modelos GPT con la API oficial de OpenAI (Chat Completions).',
    logo: 'openai',
    category: 'FRONTIER',
    billing: 'PAY_AS_YOU_GO',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://api.openai.com/v1',
    auth: 'API_KEY',
    fields: [API_KEY_FIELD({ placeholder: 'sk-...' })],
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
    keySteps: [],
    suggestedModels: [
      { id: 'gpt-6-astra', label: 'GPT-6 Astra', tier: 'PREMIUM' },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', tier: 'STANDARD' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna', tier: 'ECONOMY' },
    ],
    notes: 'Los niveles de los modelos son una sugerencia de Nexo; complete las tarifas vigentes de OpenAI.',
    pendingVerification: ['precios', 'pasos y formato de la clave', 'niveles de modelo'],
    authHeader: 'bearer',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Modelos Gemini mediante el endpoint compatible con OpenAI de la Gemini API.',
    logo: 'gemini',
    category: 'FRONTIER',
    billing: 'PAY_AS_YOU_GO',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    auth: 'API_KEY',
    fields: [API_KEY_FIELD({ help: 'Clave de Google AI Studio.' })],
    docsUrl: 'https://ai.google.dev/gemini-api/docs/openai',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keySteps: [
      'Abra Google AI Studio en aistudio.google.com/app/apikey.',
      'Cree la clave de API con un clic y cópiela; trátela como una contraseña.',
    ],
    suggestedModels: [
      { id: 'gemini-4-argon', label: 'Gemini 4 Argon', tier: 'PREMIUM', contextTokens: 1_000_000 },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', tier: 'STANDARD' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', tier: 'ECONOMY' },
    ],
    notes: 'Una clave inválida responde HTTP 400 («Please pass a valid API key»), no 401.',
    dataNotices: [
      {
        level: 'warning',
        text:
          'Los términos de la Gemini API distinguen servicios gratuitos (Unpaid Services) y de pago (Paid Services) con ' +
          'condiciones distintas: revise cuál aplica a su clave antes de enviar datos de clientes.',
        sourceUrl: 'https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md',
      },
    ],
    pendingVerification: [
      'precios',
      'uso de datos para mejorar productos en el nivel gratuito y servicios de pago obligatorios en el EEE, Suiza y el Reino Unido (solo índice, ai.google.dev no accesible)',
    ],
    authHeader: 'bearer',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    description: 'Modelos de Mistral con su API oficial (La Plateforme).',
    logo: 'mistral',
    category: 'FRONTIER',
    billing: 'PAY_AS_YOU_GO',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://api.mistral.ai/v1',
    auth: 'API_KEY',
    fields: [API_KEY_FIELD()],
    docsUrl: 'https://docs.mistral.ai/getting-started/models/',
    keySteps: [],
    suggestedModels: [
      { id: 'mistral-large-latest', label: 'Mistral Large (última)', tier: 'PREMIUM' },
      { id: 'mistral-small-latest', label: 'Mistral Small (última)', tier: 'ECONOMY' },
    ],
    notes: 'El SDK oficial también ofrece endpoints regionales api.eu.mistral.ai y api.us.mistral.ai.',
    pendingVerification: ['precios', 'pasos para obtener la clave'],
    authHeader: 'bearer',
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    description: 'Modelos Grok con la API oficial de xAI.',
    logo: 'xai',
    category: 'FRONTIER',
    billing: 'PAY_AS_YOU_GO',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://api.x.ai/v1',
    auth: 'API_KEY',
    fields: [API_KEY_FIELD()],
    docsUrl: 'https://docs.x.ai/developers/quickstart',
    keyUrl: 'https://console.x.ai',
    keySteps: [],
    suggestedModels: [{ id: 'grok-4.7', label: 'Grok 4.7', tier: 'PREMIUM' }],
    notes:
      'El SDK oficial de xAI usa la Responses API; Nexo usa Chat Completions (/v1/chat/completions), que la ' +
      'especificación oficial sigue describiendo.',
    pendingVerification: [
      'precios',
      'estado legacy de Chat Completions y migración a la Responses API (solo índice, docs.x.ai no accesible)',
      'pasos para obtener la clave',
    ],
    authHeader: 'bearer',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'Modelos DeepSeek con su API oficial compatible con OpenAI.',
    logo: 'deepseek',
    category: 'FRONTIER',
    billing: 'PAY_AS_YOU_GO',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://api.deepseek.com',
    auth: 'API_KEY',
    fields: [API_KEY_FIELD()],
    docsUrl: 'https://platform.deepseek.com/',
    keyUrl: 'https://platform.deepseek.com/',
    keySteps: [],
    suggestedModels: [],
    notes: 'Elija los modelos con «Descubrir» tras conectar: el catálogo no sugiere ids sin verificar.',
    pendingVerification: [
      'URL base',
      'ids de modelos (deepseek-v4-pro y deepseek-v4-flash según api-docs.deepseek.com; solo índice, dominio no accesible)',
      'docsUrl oficial (api-docs.deepseek.com; solo índice)',
      'jurisdicción y almacenamiento de los datos (solo índice)',
      'precios',
      'pasos para obtener la clave',
    ],
    authHeader: 'bearer',
  },
  {
    id: 'moonshot',
    name: 'Moonshot AI (Kimi)',
    description: 'Modelos Kimi con la plataforma abierta de Moonshot AI.',
    logo: 'moonshot',
    category: 'FRONTIER',
    billing: 'PAY_AS_YOU_GO',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://api.moonshot.ai/v1',
    auth: 'API_KEY',
    fields: [API_KEY_FIELD()],
    docsUrl: 'https://platform.kimi.ai/docs/guide/kimi-k3-quickstart',
    keyUrl: 'https://platform.moonshot.ai',
    keySteps: [],
    suggestedModels: [{ id: 'kimi-k3', label: 'Kimi K3', tier: 'PREMIUM' }],
    notes:
      'Kimi K3 exige reenviar el mensaje del asistente completo (incluido reasoning_content); Nexo lo hace en esta conexión.',
    pendingVerification: ['precios', 'pasos para obtener la clave'],
    authHeader: 'bearer',
    replayReasoning: true,
  },
  {
    id: 'cohere',
    name: 'Cohere',
    description: 'Modelos Command de Cohere mediante su API de compatibilidad con OpenAI.',
    logo: 'cohere',
    category: 'FRONTIER',
    billing: 'PAY_AS_YOU_GO',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://api.cohere.ai/compatibility/v1',
    auth: 'API_KEY',
    fields: [API_KEY_FIELD({ help: 'Clave de API de Cohere; se envía como Bearer y se guarda cifrada.' })],
    docsUrl: 'https://docs.cohere.com/v2/docs/compatibility-api',
    keySteps: [],
    suggestedModels: [{ id: 'command-a-plus-05-2026', label: 'Command A Plus (05-2026)', tier: 'STANDARD' }],
    notes:
      'La API de compatibilidad admite herramientas (tools) y streaming; reasoning_effort solo acepta «none» y «high». ' +
      'El nivel del modelo es una sugerencia de Nexo: complete las tarifas vigentes de Cohere.',
    pendingVerification: [
      'precios',
      'endpoint /models en la API de compatibilidad',
      'pasos y formato de la clave',
      'retención de datos (30 días; ZDR solo para clientes enterprise; solo índice)',
    ],
    authHeader: 'bearer',
    verifyMode: 'lenient',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    description: 'Modelos Sonar de Perplexity con búsqueda web integrada (Chat Completions).',
    logo: 'perplexity',
    category: 'FRONTIER',
    billing: 'PAY_AS_YOU_GO',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: 'https://api.perplexity.ai',
    auth: 'API_KEY',
    fields: [API_KEY_FIELD({ help: 'Clave de API de Perplexity; se envía como Bearer y se guarda cifrada.' })],
    docsUrl: 'https://docs.perplexity.ai/',
    keySteps: [],
    suggestedModels: [{ id: 'sonar', label: 'Sonar', tier: 'STANDARD' }],
    notes:
      'Las respuestas se apoyan en búsquedas web en tiempo real. El nivel del modelo es una sugerencia de Nexo: complete ' +
      'las tarifas vigentes de Perplexity.',
    pendingVerification: [
      'precios',
      'formato de la respuesta de /v1/models (Nexo lista modelos con /models)',
      'pasos y formato de la clave',
      'retención de datos de la API («zero-day retention») y exclusión de la Search API (solo índice)',
      'migración de Sonar a la Agent API (solo índice)',
    ],
    authHeader: 'bearer',
    // Perplexity expone la lista de modelos en `/v1/models` (SDK oficial), no bajo la URL base de Chat Completions.
    verifyPath: '/v1/models',
    verifyMode: 'lenient',
  },
];
