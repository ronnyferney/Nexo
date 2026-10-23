import { API_KEY_FIELD, type ProviderCatalogEntry } from './provider-catalog.types';

/**
 * Nubes empresariales. Fuentes verificadas el 2026-10-23:
 * - Azure OpenAI: openai/openai-node `docs/azure.md` y `examples/azure/chat.ts` (endpoint v1
 *   `https://<recurso>.openai.azure.com/openai/v1/`, `model` = nombre del despliegue) y la clase `AzureOpenAI` del SDK
 *   (cabecera `api-key`).
 * - Amazon Bedrock: openai/openai-node `docs/bedrock.md` y `internal/bedrock.js` (API raíz
 *   `https://bedrock-mantle.<región>.api.aws/openai/v1`, autenticación Bearer con la clave de API de Bedrock
 *   `AWS_BEARER_TOKEN_BEDROCK`, validación de región) y platform.claude.com «Claude in Amazon Bedrock» (bedrock-mantle).
 */
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
      API_KEY_FIELD({ help: 'Clave del recurso de Azure OpenAI; viaja en la cabecera api-key.' }),
      {
        key: 'deployment',
        label: 'Nombre del despliegue',
        secret: false,
        required: true,
        placeholder: 'gpt-prod',
        help: 'En la API v1 el modelo es el nombre del despliegue; se importa como modelo de la conexión.',
        pattern: '^[A-Za-z0-9._-]{1,64}$',
      },
    ],
    docsUrl: 'https://learn.microsoft.com/azure/foundry/openai/api-version-lifecycle',
    keySteps: [],
    suggestedModels: [],
    notes: 'Las tarifas dependen de su contrato con Microsoft: complételas en cada despliegue.',
    pendingVerification: ['endpoint /models con clave de API en la API v1', 'pasos para obtener la clave'],
    authHeader: 'api-key',
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
