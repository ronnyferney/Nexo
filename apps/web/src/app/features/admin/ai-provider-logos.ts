import {
  siAnthropic,
  siDeepseek,
  siGooglecloud,
  siGooglegemini,
  siHuggingface,
  siLmstudio,
  siMeta,
  siMistralai,
  siMoonshotai,
  siNvidia,
  siOllama,
  siOpenrouter,
  siPerplexity,
  siQwen,
} from 'simple-icons';
import { type BrandLogo, brandLogo } from '../integrations/integration-logos';

/**
 * Logos de los proveedores de IA, en el mismo formato que `integration-logos.ts` (se pintan con `nx-brand-logo [logo]`).
 *
 * - `simple-icons` (CC0-1.0): Anthropic, Gemini, Google Cloud (Vertex AI), Mistral, Ollama,
 *   Hugging Face, NVIDIA, DeepSeek, OpenRouter, LM Studio, Moonshot (Kimi), Meta, Qwen y Perplexity. Las marcas cuyo color oficial es negro se pintan con `currentColor`
 *   para que se vean en modo oscuro.
 * - SVG propio con colores oficiales: OpenAI, Azure OpenAI, Amazon Bedrock y xAI (no están en simple-icons 16).
 * - Monograma con color oficial: Groq, Cerebras, Fireworks AI y Together AI; cualquier id desconocido usa el
 *   monograma estable de `brandLogo`.
 */

interface SimpleIconLike {
  title: string;
  path: string;
  hex: string;
}

/** Luminancia relativa aproximada (0 negro, 1 blanco). */
function luminance(hex: string) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const fromSimpleIcon = (i: SimpleIconLike): BrandLogo => ({
  kind: 'shapes',
  title: i.title,
  shapes: [{ d: i.path, fill: luminance(i.hex) < 0.2 ? 'currentColor' : `#${i.hex}` }],
});

const monogram = (title: string, text: string, color: string): BrandLogo => ({ kind: 'monogram', title, text, color });

/** OpenAI: flor de seis pétalos entrelazados (monocromo, se adapta al tema). */
const OPENAI: BrandLogo = {
  kind: 'shapes',
  title: 'OpenAI',
  shapes: [
    {
      d: 'M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.98 5.98 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07zm-9.02 12.61a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.79.79 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.49 4.5zm-9.66-4.13a4.47 4.47 0 0 1-.53-3.01l.14.08 4.78 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06L9.74 19.95a4.5 4.5 0 0 1-6.14-1.65zM2.34 7.9a4.49 4.49 0 0 1 2.37-1.98v5.68a.77.77 0 0 0 .39.68l5.81 3.35-2.02 1.17a.08.08 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.87zm16.6 3.86L13.1 8.36l2.02-1.16a.08.08 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.68a.79.79 0 0 0-.41-.67zm2.01-3.02l-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.41 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zM8.31 12.86l-2.02-1.16a.08.08 0 0 1-.04-.06V6.07a4.5 4.5 0 0 1 7.38-3.45l-.14.08L8.7 5.46a.79.79 0 0 0-.39.68zm1.1-2.37l2.6-1.5 2.61 1.5v3l-2.6 1.5-2.6-1.5z',
      fill: 'currentColor',
    },
  ],
};

/** Azure: la «A» en dos tonos de azul. */
const AZURE: BrandLogo = {
  kind: 'shapes',
  title: 'Azure OpenAI',
  shapes: [
    { d: 'M13.23 2.7L6.1 8.68 0 19.25h5.5z', fill: '#0078D4' },
    { d: 'M14.03 4.01l-3.04 8.35 5.84 6.94L5.48 21.3H24z', fill: '#50A0E6' },
  ],
};

/** Amazon Bedrock: placa «squid ink» de AWS con la sonrisa naranja. */
const BEDROCK: BrandLogo = {
  kind: 'shapes',
  title: 'Amazon Bedrock',
  shapes: [
    { x: 1, y: 1, w: 22, h: 22, rx: 5, fill: '#232F3E' },
    { d: 'M5 13.6c4.3 2.7 9.7 2.7 14 0l.7 1.1c-4.7 3.1-10.7 3.1-15.4 0z', fill: '#FF9900' },
    { d: 'M17.2 12.6l2.9-.4-.5 2.9-.8-.6-.1-1.2-1.1-.3z', fill: '#FF9900' },
    { x: 6, y: 6.5, w: 12, h: 2.2, rx: 1.1, fill: '#FFFFFF' },
  ],
};

/** xAI: trazo diagonal largo y la «x» partida (monocromo). */
const XAI: BrandLogo = {
  kind: 'shapes',
  title: 'xAI',
  shapes: [
    { d: 'M2.6 3h3.7l12.4 18H15z', fill: 'currentColor' },
    { d: 'M21.4 3h-3.3l-5.5 7.3 1.7 2.4z', fill: 'currentColor' },
    { d: 'M2.6 21h3.3l3.8-5.1-1.7-2.4z', fill: 'currentColor' },
  ],
};

const LOGOS: Record<string, BrandLogo> = {
  anthropic: fromSimpleIcon(siAnthropic),
  // Canales de la familia Claude: el modelo es el mismo, así que se muestra el logo de Anthropic/Claude.
  claude: fromSimpleIcon(siAnthropic),
  'claude-google-cloud': fromSimpleIcon(siAnthropic),
  'claude-vertex': fromSimpleIcon(siAnthropic),
  'claude-foundry': fromSimpleIcon(siAnthropic),
  'claude-bedrock': fromSimpleIcon(siAnthropic),
  'claude-aws': fromSimpleIcon(siAnthropic),
  openai: OPENAI,
  gemini: fromSimpleIcon(siGooglegemini),
  google: fromSimpleIcon(siGooglegemini),
  vertex: fromSimpleIcon(siGooglecloud),
  vertexai: fromSimpleIcon(siGooglecloud),
  'vertex-ai': fromSimpleIcon(siGooglecloud),
  'google-vertex': fromSimpleIcon(siGooglecloud),
  googlecloud: fromSimpleIcon(siGooglecloud),
  mistral: fromSimpleIcon(siMistralai),
  groq: monogram('Groq', 'g', '#F55036'),
  deepseek: fromSimpleIcon(siDeepseek),
  xai: XAI,
  cerebras: monogram('Cerebras', 'C', '#D9480F'),
  fireworks: monogram('Fireworks AI', 'F', '#6720FF'),
  together: monogram('Together AI', 'T', '#0F6FFF'),
  nvidia: fromSimpleIcon(siNvidia),
  moonshot: fromSimpleIcon(siMoonshotai),
  kimi: fromSimpleIcon(siMoonshotai),
  huggingface: fromSimpleIcon(siHuggingface),
  'hugging-face': fromSimpleIcon(siHuggingface),
  openrouter: fromSimpleIcon(siOpenrouter),
  'azure-openai': AZURE,
  azure: AZURE,
  bedrock: BEDROCK,
  'aws-bedrock': BEDROCK,
  ollama: fromSimpleIcon(siOllama),
  lmstudio: fromSimpleIcon(siLmstudio),
  'lm-studio': fromSimpleIcon(siLmstudio),
  meta: fromSimpleIcon(siMeta),
  qwen: fromSimpleIcon(siQwen),
  perplexity: fromSimpleIcon(siPerplexity),
};

/** Normaliza `logo` (`"simple-icons:anthropic"`, `"Anthropic"`, `"lm-studio"`) a una clave del mapa. */
const slug = (v: string | undefined | null) => (v ?? '').split(':').pop()!.trim().toLowerCase();

/** Logo de un proveedor de IA por `logo` o `id`; si no hay mapeo, monograma con color estable. */
export function providerLogo(p: { id: string; name: string; logo?: string | null }): BrandLogo {
  const byLogo = slug(p.logo);
  return LOGOS[byLogo] ?? LOGOS[byLogo.replace(/-/g, '')] ?? LOGOS[slug(p.id)] ?? brandLogo(p);
}

/** Fabricantes de modelos que se distinguen por el prefijo del id en enrutadores (`anthropic/claude-…`, `meta/llama-…`). */
const VENDOR_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  'meta-llama': 'Meta',
  meta: 'Meta',
  mistralai: 'Mistral AI',
  mistral: 'Mistral AI',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  'x-ai': 'xAI',
  xai: 'xAI',
  moonshotai: 'Moonshot AI',
  nvidia: 'NVIDIA',
  perplexity: 'Perplexity',
};
const VENDOR_LOGO_KEY: Record<string, string> = { 'meta-llama': 'meta', mistralai: 'mistral', 'x-ai': 'xai', moonshotai: 'moonshot', google: 'gemini' };

/** Logo y nombre del fabricante si el id del modelo lo indica (`vendor/modelo`) y es conocido; si no, `null`. */
export function vendorOf(modelId: string): { name: string; logo: BrandLogo } | null {
  const i = modelId.indexOf('/');
  if (i <= 0) return null;
  const v = modelId.slice(0, i).toLowerCase();
  const logo = LOGOS[VENDOR_LOGO_KEY[v] ?? v];
  return logo && VENDOR_NAMES[v] ? { name: VENDOR_NAMES[v], logo } : null;
}
