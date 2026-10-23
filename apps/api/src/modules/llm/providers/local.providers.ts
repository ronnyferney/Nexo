import type { ProviderCatalogEntry, ProviderField } from './provider-catalog.types';

/**
 * Modelos locales. Fuentes verificadas el 2026-10-23: ollama/ollama `docs/api/openai-compatibility.mdx`
 * (`http://localhost:11434/v1/`, `/v1/models`, la clave es obligatoria en los SDK pero se ignora) y SDK
 * `@lmstudio/sdk` 2.1.0 (servidor local en el puerto 1234).
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
    fields: [baseUrlField('http://localhost:1234/v1')],
    docsUrl: 'https://lmstudio.ai/docs',
    keySteps: [],
    suggestedModels: [],
    notes: `Inicie el servidor de LM Studio y cargue un modelo; elíjalo con «Descubrir». ${LOCAL_WARNING}`,
    pendingVerification: ['ruta /v1 compatible con OpenAI en la documentación de LM Studio'],
    authHeader: 'none',
  },
];
