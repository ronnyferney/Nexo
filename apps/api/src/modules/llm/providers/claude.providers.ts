import { SYSTEM_ANTHROPIC_MODELS } from '../pricing';
import { GOOGLE_CLOUD_OAUTH } from './enterprise.providers';
import { ANTHROPIC_SPECIALTIES } from './frontier.providers';
import {
  API_KEY_FIELD,
  type ProviderCatalogEntry,
  type ProviderField,
  type SuggestedModel,
} from './provider-catalog.types';

/**
 * Claude es una familia de modelos a la que se llega por varios canales oficiales: los modelos son los mismos y cambian
 * quién opera el servicio, la autenticación y la facturación. Fuentes: skill oficial `claude-api` de Anthropic
 * (2026-10-06): «Claude Models on Google Cloud (Anthropic managed)» (SDK `@anthropic-ai/google-cloud-sdk`, token de
 * Google, rol `roles/claude.user`, workspace `wrkspc_`, ubicación `global`, sin claves de API), «Google Cloud Vertex AI»
 * (`@anthropic-ai/vertex-sdk`, proyecto y región, ids sin prefijo, tarifas de Google) y «Microsoft Foundry»
 * (`@anthropic-ai/foundry-sdk`, recurso `https://<recurso>.services.ai.azure.com/anthropic`, clave o token de Entra ID,
 * tarifas de la API de Anthropic vía Microsoft Marketplace). Ninguno usa suscripciones personales (Pro/Max).
 */

/** Modelos Claude actuales; `priced: false` cuando el canal factura con tarifas propias (Google). */
function claudeModels(priced: boolean): SuggestedModel[] {
  return SYSTEM_ANTHROPIC_MODELS.map((m) => ({
    id: m.id,
    label: m.label,
    tier: m.tier,
    ...(priced
      ? {
          inputUsdPerMTok: m.inputUsdPerMTok,
          outputUsdPerMTok: m.outputUsdPerMTok,
          ...(m.cacheReadUsdPerMTok !== null ? { cacheReadUsdPerMTok: m.cacheReadUsdPerMTok } : {}),
        }
      : {}),
    contextTokens: 1_000_000,
    specialties: ANTHROPIC_SPECIALTIES[m.id] ?? ['GENERAL', 'VISION'],
  }));
}

const PROJECT_FIELD: ProviderField = {
  key: 'projectId',
  label: 'Id del proyecto de Google Cloud',
  secret: false,
  required: true,
  placeholder: 'mi-proyecto-123',
  pattern: '^[a-z][a-z0-9-]{4,28}[a-z0-9]$',
};

export const CLAUDE_CHANNEL_PROVIDERS: ProviderCatalogEntry[] = [
  {
    id: 'claude-google-cloud',
    name: 'Claude en Google Cloud',
    description: 'Operado por Anthropic con su cuenta de Google Cloud: inicie sesión con Google, sin claves de API.',
    logo: 'claude-google-cloud',
    category: 'ENTERPRISE_CLOUD',
    billing: 'ENTERPRISE',
    kind: 'ANTHROPIC',
    baseUrl: 'https://claude.googleapis.com',
    auth: 'OAUTH',
    fields: [
      { ...PROJECT_FIELD, help: 'Proyecto suscrito a Claude en Google Cloud Marketplace.' },
      {
        key: 'workspaceId',
        label: 'Workspace de Claude',
        secret: false,
        required: true,
        placeholder: 'wrkspc_01AbCdEf',
        help: 'En la Consola de Claude abierta desde Google Cloud: Settings → Workspaces.',
        pattern: '^wrkspc_[A-Za-z0-9]{4,64}$',
      },
    ],
    docsUrl: 'https://platform.claude.com/docs/en/build-with-claude/claude-on-google-cloud',
    keySteps: [],
    suggestedModels: claudeModels(false),
    notes:
      'Misma API de Claude (operada por Anthropic), facturada por Google Cloud Marketplace. Requisitos: suscripción en ' +
      'Marketplace, la API claude.googleapis.com habilitada y el rol roles/claude.user para la cuenta que inicia sesión. ' +
      'Es una organización de Anthropic distinta de la de la Consola de Claude. Revise las tarifas en «Modelos de IA».',
    pendingVerification: ['tarifas por token de este canal (no publicadas en la fuente consultada)'],
    authHeader: 'bearer',
    family: 'CLAUDE',
    claudeChannel: 'google-cloud',
    mechanisms: [
      {
        type: 'OAUTH',
        label: 'Iniciar sesión con Google',
        primary: true,
        oauth: { ...GOOGLE_CLOUD_OAUTH, appKey: 'vertex' },
      },
    ],
  },
  {
    id: 'claude-vertex',
    name: 'Claude en Vertex AI',
    description: 'Claude operado por Google en Vertex AI: inicie sesión con Google y use su proyecto y región.',
    logo: 'claude-vertex',
    category: 'ENTERPRISE_CLOUD',
    billing: 'ENTERPRISE',
    kind: 'ANTHROPIC',
    baseUrl: 'https://aiplatform.googleapis.com',
    auth: 'OAUTH',
    fields: [
      { ...PROJECT_FIELD, help: 'Proyecto con Vertex AI habilitado y los modelos Claude activados en Model Garden.' },
      {
        key: 'region',
        label: 'Región',
        secret: false,
        required: true,
        placeholder: 'global',
        default: 'global',
        help: '«global» (recomendada), «us», «eu» o una región de Vertex AI (p. ej. us-east5).',
        pattern: '^(global|us|eu|[a-z]+-[a-z]+[0-9]+)$',
      },
    ],
    docsUrl: 'https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai',
    keySteps: [],
    suggestedModels: claudeModels(false),
    notes:
      'Operado y facturado por Google con sus tarifas: complételas en «Modelos de IA». Active cada modelo Claude en ' +
      'Model Garden. Algunas funciones de la API de Anthropic no están disponibles en Vertex AI (p. ej. web fetch y el ' +
      'fallback server-side).',
    pendingVerification: [],
    authHeader: 'bearer',
    // Vertex AI no ofrece API de modelos: se verifica con un conteo de tokens (404 si el modelo no está activado).
    verifyMode: 'lenient',
    family: 'CLAUDE',
    claudeChannel: 'vertex',
    mechanisms: [
      {
        type: 'OAUTH',
        label: 'Iniciar sesión con Google',
        primary: true,
        oauth: { ...GOOGLE_CLOUD_OAUTH, appKey: 'vertex' },
      },
    ],
  },
  {
    id: 'claude-foundry',
    name: 'Claude en Microsoft Foundry',
    description: 'Claude en su recurso de Microsoft Foundry (Azure), facturado por Microsoft Marketplace.',
    logo: 'claude-foundry',
    category: 'ENTERPRISE_CLOUD',
    billing: 'ENTERPRISE',
    kind: 'ANTHROPIC',
    baseUrl: 'https://{{ resource }}.services.ai.azure.com/anthropic',
    auth: 'API_KEY',
    fields: [
      {
        key: 'resource',
        label: 'Nombre del recurso de Foundry',
        secret: false,
        required: true,
        placeholder: 'mi-recurso',
        help: 'El nombre de https://<recurso>.services.ai.azure.com.',
        pattern: '^[a-z0-9][a-z0-9-]{1,62}$',
      },
      API_KEY_FIELD({ label: 'Clave del recurso', help: 'Clave del recurso de Foundry; se guarda cifrada.' }),
    ],
    docsUrl: 'https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry',
    keySteps: [
      'En el portal de Azure AI Foundry, despliegue los modelos Claude en su recurso.',
      'Abra el recurso y copie una de sus claves.',
      'Use como modelo el nombre del despliegue (por defecto, el id del modelo, p. ej. claude-opus-5-5).',
    ],
    suggestedModels: claudeModels(true),
    notes: 'Facturado por Microsoft Marketplace con las tarifas de la API de Anthropic.',
    pendingVerification: ['inicio de sesión con Microsoft Entra ID (alcance del token) para Claude en Foundry'],
    authHeader: 'api-key',
    verifyMode: 'lenient',
    family: 'CLAUDE',
    claudeChannel: 'foundry',
  },
];
