import { API_KEY_FIELD, type ProviderCatalogEntry, type ProviderField } from './provider-catalog.types';

/**
 * Modelos locales. Fuentes verificadas el 2026-10-23: ollama/ollama `docs/api/openai-compatibility.mdx`
 * (`http://localhost:11434/v1/`, `/v1/models`, la clave es obligatoria en los SDK pero se ignora) y SDK
 * `@lmstudio/sdk` 2.1.0 (servidor local en el puerto 1234). LM Studio con token (2026-10-24): `@lmstudio/sdk` 2.1.0
 * `LMStudioClientConstructorOpts.apiToken` («This is not required unless LM Studio is configured to mandate API
 * tokens. API tokens are created within LM Studio») y formato `sk-lm-<8>:<20>`. Ollama Cloud tiene su propia entrada
 * (`open-models.providers.ts`).
 */
const LOCAL_WARNING =
  'Nexo en la nube no alcanza su equipo: use Nexo Edge o una red alcanzable. La protección SSRF bloquea redes ' +
  'privadas salvo que la instalación habilite CONNECTOR_ALLOW_PRIVATE_NETWORKS=true (solo on-premise).';

const baseUrlField = (placeholder: string): ProviderField => ({
  key: 'baseUrl',
  label: 'URL base',
  secret: false,
  required: true,
  placeholder,
  default: placeholder,
  help: 'URL del servidor compatible con OpenAI, terminada en /v1.',
  pattern: '^https?://[^\\s]+$',
});

export const LOCAL_PROVIDERS: ProviderCatalogEntry[] = [
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Modelos abiertos ejecutados en su propio equipo o servidor con Ollama.',
    logo: 'ollama',
    category: 'LOCAL',
    billing: 'LOCAL',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: '{{ baseUrl }}',
    auth: 'NONE',
    fields: [baseUrlField('http://localhost:11434/v1')],
    docsUrl: 'https://docs.ollama.com/api',
    keySteps: [],
    suggestedModels: [],
    notes: `Descargue los modelos con «ollama pull» y elíjalos con «Descubrir». ${LOCAL_WARNING}`,
    pendingVerification: [],
    authHeader: 'none',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    description: 'Servidor local de LM Studio con API compatible con OpenAI.',
    logo: 'lmstudio',
    category: 'LOCAL',
    billing: 'LOCAL',
    kind: 'OPENAI_COMPATIBLE',
    baseUrl: '{{ baseUrl }}',
    auth: 'NONE',
    fields: [
      baseUrlField('http://localhost:1234/v1'),
      API_KEY_FIELD({
        label: 'Token de API de LM Studio',
        required: false,
        placeholder: 'sk-lm-...',
        help: 'Solo si el servidor exige token («Require Authentication»); el token se crea en LM Studio y se guarda cifrado.',
        mechanisms: ['API_KEY'],
      }),
    ],
    docsUrl: 'https://lmstudio.ai/docs',
    keySteps: [],
    keyPrefix: 'sk-lm-',
    suggestedModels: [],
    notes:
      `Inicie el servidor de LM Studio y cargue un modelo; elíjalo con «Descubrir». Si el servidor exige token, use ` +
      `«Servidor con token». ${LOCAL_WARNING}`,
    pendingVerification: [
      'ruta /v1 compatible con OpenAI en la documentación de LM Studio',
      'envío del token como Authorization: Bearer en la API compatible con OpenAI (solo índice; el SDK oficial usa su propio protocolo)',
    ],
    // Sin token no se envía cabecera; con token viaja como Bearer.
    authHeader: 'bearer',
    mechanisms: [
      { type: 'LOCAL_DETECT', label: 'Detectar servidor local', primary: true },
      { type: 'API_KEY', label: 'Servidor con token', primary: false },
    ],
  },
];
