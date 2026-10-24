import { SYSTEM_ANTHROPIC_MODELS } from '../pricing';
import { API_KEY_FIELD, type ModelSpecialty, type ProviderCatalogEntry } from './provider-catalog.types';

/**
 * Laboratorios con API propia. Fuentes verificadas el 2026-10-23 (los dominios de documentación de terceros estaban
 * bloqueados por el proxy, por lo que se usaron los SDK oficiales publicados en npm/PyPI y los repos oficiales):
 * - Anthropic: platform.claude.com/docs (precios, modelos y especialidades, ventana de 1M, get-api-key).
 * - OpenAI: SDK `openai` 7.43.0 (URL base, tipos `ChatModel`).
 * - Gemini: google-gemini/cookbook (Get_started_OpenAI_Compatibility, Authentication).
 * - Mistral: SDK `@mistralai/mistralai` 3.1.0. xAI: SDK `@xai-official/sdk` 0.2.4 y xai-org/xai-cookbook.
 * - Moonshot: `kimi-cli` 1.52.0 (plataformas) y MoonshotAI/Kimi-K3 (README).
 * - DeepSeek: deepseek-ai/DeepSeek-R1 (README: API compatible con OpenAI en platform.deepseek.com).
 */
/**
 * Especialidades según platform.claude.com/docs/en/models/overview: todos los modelos actuales admiten visión; Fable
 * «para razonamiento exigente», Opus «para agentes de código y trabajo de conocimiento de larga duración», Sonnet
 * «la mejor combinación de velocidad e inteligencia» (latencia «Fast») y Haiku el más rápido.
 */
const ANTHROPIC_SPECIALTIES: Record<string, ModelSpecialty[]> = {
  'claude-fable-5-1': ['REASONING', 'VISION'],
  'claude-opus-5-5': ['CODE', 'GENERAL', 'VISION'],
  'claude-sonnet-5-5': ['GENERAL', 'FAST', 'VISION'],
  'claude-haiku-5-5': ['FAST', 'VISION'],
};

export const FRONTIER_PROVIDERS: ProviderCatalogEntry[] = [
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    description: 'Modelos Claude con la API oficial de Anthropic (driver nativo con thinking y caché de prompts).',
    logo: 'anthropic',
    category: 'FRONTIER',
    billing: 'PAY_AS_YOU_GO',
    kind: 'ANTHROPIC',
    baseUrl: 'https://api.anthropic.com',
    auth: 'API_KEY',
    fields: [API_KEY_FIELD({ placeholder: 'sk-ant-...', help: 'Clave de la Consola de Claude; se guarda cifrada.' })],
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
      'Claude Haiku 5.5 cobra 0,50/2,50 USD por MTok en prompts de más de 100.000 tokens; Nexo aplica la tarifa base.',
    pendingVerification: [],
    authHeader: 'bearer',
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
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', tier: 'PREMIUM' },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', tier: 'STANDARD' },
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
    pendingVerification: ['precios'],
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
    notes: 'El SDK oficial de xAI usa la Responses API; Nexo usa Chat Completions.',
    pendingVerification: ['precios', 'soporte de /chat/completions', 'pasos para obtener la clave'],
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
    pendingVerification: ['URL base', 'ids de modelos', 'precios', 'pasos para obtener la clave'],
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
];
