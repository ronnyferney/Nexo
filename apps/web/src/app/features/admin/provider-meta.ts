import type {
  ClaudeChannel,
  MechanismType,
  ModelSpecialty,
  ProviderBilling,
  ProviderCategory,
  ProviderField,
  ProviderMechanism,
  ProviderView,
} from '../../core/llm-providers.models';
import type { ModelTier } from '../../core/models';

export const CATEGORY_LABELS: Record<ProviderCategory, string> = {
  FRONTIER: 'Frontera',
  OPEN_MODELS: 'Modelos abiertos',
  ENTERPRISE_CLOUD: 'Nube empresarial',
  LOCAL: 'Locales',
  ROUTER: 'Enrutadores',
};
export const CATEGORY_ORDER: ProviderCategory[] = ['FRONTIER', 'OPEN_MODELS', 'ENTERPRISE_CLOUD', 'LOCAL', 'ROUTER'];

export const BILLING_LABELS: Record<ProviderBilling, string> = {
  PAY_AS_YOU_GO: 'Pago por uso',
  FREE_TIER: 'Plan gratuito y luego pago por uso',
  ENTERPRISE: 'Empresarial',
  LOCAL: 'Local',
};

/** Filtros por forma de conexión/cobro. No existe «Suscripción»: Nexo no conecta planes personales. */
export type ConnectionFilter = 'PAYG' | 'CLOUD' | 'LOCAL' | 'LOGIN';

export const CONNECTION_FILTERS: { id: ConnectionFilter; label: string; hint: string }[] = [
  { id: 'PAYG', label: 'Pago por uso', hint: 'Clave de API de la cuenta del proveedor' },
  { id: 'CLOUD', label: 'Nube empresarial', hint: 'Azure, Bedrock y nubes con contrato' },
  { id: 'LOCAL', label: 'Local', hint: 'Servidores propios como Ollama o LM Studio' },
  { id: 'LOGIN', label: 'Inicio de sesión', hint: 'Autorización con la cuenta del proveedor (OAuth o código de dispositivo)' },
];

export function matchesFilter(p: ProviderView, f: ConnectionFilter): boolean {
  switch (f) {
    case 'CLOUD':
      return p.category === 'ENTERPRISE_CLOUD' || p.billing === 'ENTERPRISE';
    case 'LOCAL':
      return p.category === 'LOCAL' || p.billing === 'LOCAL' || mechanismsOf(p).some((m) => m.type === 'LOCAL_DETECT');
    case 'LOGIN':
      return mechanismsOf(p).some((m) => m.type === 'OAUTH' || m.type === 'DEVICE_CODE');
    case 'PAYG':
      return (p.billing === 'PAY_AS_YOU_GO' || p.billing === 'FREE_TIER') && p.category !== 'ENTERPRISE_CLOUD';
  }
}

/**
 * Planes personales que el usuario podría intentar conectar: el diálogo explica por qué Nexo usa la clave de API
 * de la cuenta empresarial (términos del proveedor y control de costos por unidad).
 */
export const PERSONAL_PLANS: Record<string, string> = {
  anthropic: 'Claude Pro o Max',
  openai: 'ChatGPT Plus o Pro',
  gemini: 'Gemini Advanced (Google One)',
  xai: 'SuperGrok',
};

// ----- Familia Claude -----

/** Canal de Claude: cómo se presenta en la galería y en el diálogo «Conectar Claude». */
export interface ClaudeChannelInfo {
  /** «API de Anthropic», «Google Cloud»… */
  short: string;
  /** Quién opera el servicio. */
  operator: string;
  /** Cómo se conecta. */
  how: string;
  /** Quién factura y con qué tarifas. */
  billing: string;
  /** Matiz breve del canal. */
  note: string;
}

export const CLAUDE_CHANNEL_ORDER: ClaudeChannel[] = ['anthropic', 'google-cloud', 'vertex', 'foundry'];

export const CLAUDE_CHANNELS: Record<ClaudeChannel, ClaudeChannelInfo> = {
  anthropic: {
    short: 'API de Anthropic',
    operator: 'Anthropic',
    how: 'Clave de API de la Consola de Claude',
    billing: 'Anthropic, pago por uso',
    note: 'Todas las funciones nuevas el mismo día.',
  },
  'google-cloud': {
    short: 'Google Cloud',
    operator: 'Anthropic',
    how: 'Iniciar sesión con Google',
    billing: 'Google Cloud Marketplace',
    note: 'Sin claves de API: proyecto y workspace de Claude.',
  },
  vertex: {
    short: 'Vertex AI',
    operator: 'Google',
    how: 'Iniciar sesión con Google',
    billing: 'Google Cloud, con tarifas de Google',
    note: 'Su proyecto y región de Vertex AI.',
  },
  foundry: {
    short: 'Microsoft Foundry',
    operator: 'Su recurso de Microsoft Foundry (Azure)',
    how: 'Clave del recurso de Azure',
    billing: 'Microsoft Marketplace, con tarifas de Anthropic',
    note: 'Modelos desplegados en su recurso de Azure.',
  },
};

/** Modelos de la familia que se muestran en la tarjeta «Claude» si el catálogo no los trae. */
export const CLAUDE_MODELS_FALLBACK = ['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5', 'Fable 5.1'];

export function isClaude(p: Pick<ProviderView, 'family' | 'claudeChannel'> | null | undefined): boolean {
  return p?.family === 'CLAUDE' || !!p?.claudeChannel;
}

/** Canal de una entrada de la familia (`anthropic` si el servidor no lo informa). */
export function claudeChannelOf(p: Pick<ProviderView, 'id' | 'claudeChannel'>): ClaudeChannel {
  return p.claudeChannel ?? 'anthropic';
}

/** «vía Google Cloud». */
export function claudeVia(p: Pick<ProviderView, 'id' | 'claudeChannel'>): string {
  return `vía ${CLAUDE_CHANNELS[claudeChannelOf(p)].short}`;
}

/** Nombre de una entrada para avisos: «Claude (vía Vertex AI)» en la familia, el nombre en el resto. */
export function displayName(p: Pick<ProviderView, 'id' | 'name' | 'family' | 'claudeChannel'>): string {
  return isClaude(p) ? `Claude (${claudeVia(p)})` : p.name;
}

/** «Opus 5.5 · Sonnet 5.5 · Haiku 5.5 · Fable 5.1»: modelos del canal directo sin el prefijo «Claude». */
export function claudeModelsLine(channels: readonly ProviderView[]): string {
  const src = channels.find((p) => claudeChannelOf(p) === 'anthropic') ?? channels[0];
  const labels = (src?.suggestedModels ?? []).map((m) => m.label.replace(/^claude\s+/i, '').trim()).filter(Boolean);
  if (!labels.length) return CLAUDE_MODELS_FALLBACK.join(' · ');
  const rank = (l: string) => {
    const i = CLAUDE_MODELS_FALLBACK.indexOf(l);
    return i < 0 ? CLAUDE_MODELS_FALLBACK.length : i;
  };
  return [...new Set(labels)].sort((a, b) => rank(a) - rank(b)).join(' · ');
}

/**
 * Texto que la búsqueda considera para un canal de Claude («google», «azure», «vertex»…). No incluye la descripción
 * ni quién opera o factura: «anthropic» debe resaltar solo el canal directo, no los de nubes operados por Anthropic.
 */
export function claudeSearchText(p: Pick<ProviderView, 'id' | 'name' | 'claudeChannel'>): string {
  const c = CLAUDE_CHANNELS[claudeChannelOf(p)];
  return `claude ${p.name} ${p.id} ${c.short} ${c.how}`;
}

/** Mensajes del retorno OAuth (`?llm=error&reason=`). */
const LLM_OAUTH_ERRORS: Record<string, (name: string) => string> = {
  access_denied: (n) => `Se canceló la autorización en ${n}.`,
  invalid_state: () => 'La solicitud de autorización expiró o ya fue usada. Inicie sesión de nuevo.',
  exchange_failed: (n) => `${n} no entregó las credenciales. Intente de nuevo en unos minutos.`,
  forbidden: () => 'Se requiere rol de administrador para conectar proveedores.',
  missing_code: (n) => `${n} no devolvió la autorización. Inicie sesión de nuevo.`,
  verification_failed: () =>
    'La cuenta inició sesión pero no tiene acceso al proyecto o recurso: revise el rol asignado.',
  not_configured: (n) => `El administrador de la plataforma debe configurar la app de ${n}.`,
  browser_mismatch: () =>
    'Por seguridad, el inicio de sesión debe completarse en el mismo navegador donde lo inició. Vuelva a iniciarlo desde Nexo.',
};

export function llmOAuthError(reason: string | null, name = 'el proveedor'): string {
  const msg = reason ? LLM_OAUTH_ERRORS[reason] : undefined;
  return `No se pudo conectar ${name}. ${msg ? msg(name) : 'Intente de nuevo.'}`;
}

// ----- Mecanismos de conexión -----

const ORDER: MechanismType[] = ['OAUTH', 'DEVICE_CODE', 'LOCAL_DETECT', 'API_KEY'];

/**
 * Mecanismos del proveedor con exactamente un primario. Si el servidor aún no envía `mechanisms`, se derivan de
 * `auth`/`category` (contrato anterior): OAuth primero y la clave como alternativa; los locales usan el formulario.
 */
export function mechanismsOf(p: ProviderView): ProviderMechanism[] {
  let list = (p.mechanisms ?? []).filter((m) => ORDER.includes(m.type));
  if (!list.length) {
    const hasFields = (p.fields ?? []).length > 0;
    list = [];
    if (p.auth === 'OAUTH') list.push({ type: 'OAUTH', label: `Iniciar sesión con ${p.name}`, available: true, primary: true });
    if (hasFields || !list.length) {
      const local = p.category === 'LOCAL' || p.auth === 'NONE';
      list.push({ type: 'API_KEY', label: local ? 'Servidor local' : 'Clave de API', available: true, primary: !list.length });
    }
  }
  // El primario declarado si está disponible; si no, el primero disponible (el no disponible queda como alternativa).
  const primary = list.find((m) => m.primary && m.available) ?? list.find((m) => m.available) ?? list.find((m) => m.primary) ?? list[0];
  return [primary, ...list.filter((m) => m !== primary)].map((m) => ({ ...m, primary: m === primary }));
}

export function primaryMechanism(p: ProviderView): ProviderMechanism {
  return mechanismsOf(p)[0];
}

/** «Iniciar sesión con Google» → «Google». */
export function brandOf(m: ProviderMechanism, p: ProviderView) {
  return m.label.replace(/^(iniciar sesi[oó]n|inicie sesi[oó]n|continuar|conectar)\s+(con|en)\s+/i, '').trim() || p.name;
}

/** Subtítulo de la fila de la galería según el mecanismo principal. */
export function mechanismSubtitle(p: ProviderView): string {
  const m = primaryMechanism(p);
  switch (m.type) {
    case 'OAUTH': {
      const label = m.label || `Iniciar sesión con ${p.name}`;
      const product = p.name.replace(new RegExp(`^${escapeRe(brandOf(m, p))}\\s+`, 'i'), '');
      return normalize(label).includes(normalize(product)) ? `${label} · ${BILLING_LABELS[p.billing]}` : `${label} · ${product}`;
    }
    case 'DEVICE_CODE':
      return `Código de dispositivo · ${p.name}`;
    case 'LOCAL_DETECT':
      return 'Servidor local';
    default:
      return p.category === 'LOCAL' || p.auth === 'NONE' ? 'Servidor local' : `Clave de API · ${BILLING_LABELS[p.billing]}`;
  }
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Campos del formulario que aplican a un mecanismo (`ProviderField.mechanisms`; ausente = todos). */
export function fieldsFor(p: ProviderView, type: MechanismType): ProviderField[] {
  return (p.fields ?? []).filter((f) => !f.mechanisms?.length || f.mechanisms.includes(type));
}

/**
 * Campos que se piden antes de iniciar OAuth (Vertex: proyecto y región; Azure: recurso e inquilino). Prioridad:
 * `mechanism.fields`, luego `ProviderField.mechanisms`; sin ninguno de los dos, los no secretos obligatorios.
 */
export function oauthFields(p: ProviderView, m: ProviderMechanism): ProviderField[] {
  const all = p.fields ?? [];
  if (m.fields) {
    return m.fields
      .map((f) => (typeof f === 'string' ? all.find((x) => x.key === f) : f))
      .filter((f): f is ProviderField => !!f && !f.secret);
  }
  if (all.some((f) => f.mechanisms?.length)) return fieldsFor(p, 'OAUTH').filter((f) => !f.secret);
  return all.filter((f) => !f.secret && f.required && !/url/i.test(f.key));
}

/** Obligatorio para la interfaz: el servidor completa los que tienen `default`. */
export function isRequired(f: ProviderField) {
  return f.required && !f.default;
}

// ----- Filtros del diálogo de proveedor conectado -----

export const SPECIALTY_LABELS: Record<ModelSpecialty, string> = {
  CODE: 'Código',
  REASONING: 'Razonamiento',
  VISION: 'Visión',
  FAST: 'Rápido',
  GENERAL: 'General',
};
export const SPECIALTIES: ModelSpecialty[] = ['CODE', 'REASONING', 'VISION', 'FAST', 'GENERAL'];

/**
 * Especialidades del modelo. Si el servidor no las envía se infieren del id (heurística conservadora);
 * sin coincidencias el modelo queda como «General».
 */
export function specialtiesOf(modelId: string, given?: readonly string[] | null): ModelSpecialty[] {
  const valid = (given ?? []).filter((s): s is ModelSpecialty => s in SPECIALTY_LABELS);
  if (valid.length) return valid;
  const id = modelId.toLowerCase();
  const out: ModelSpecialty[] = [];
  if (/cod(e|er|estral)|devstral|starcoder/.test(id)) out.push('CODE');
  if (/reason|think|(^|[^a-z])(o1|o3|o4|r1|qwq)([^a-z]|$)|opus/.test(id)) out.push('REASONING');
  if (/vision|(^|[-_.])vl([-_.]|$)|pixtral|llava|4o|gemini/.test(id)) out.push('VISION');
  if (/mini|flash|haiku|nano|lite|instant|small|fast|turbo|8b/.test(id)) out.push('FAST');
  return out.length ? out : ['GENERAL'];
}

export const COST_OPTIONS: { id: ModelTier; label: string }[] = [
  { id: 'ECONOMY', label: 'Económico' },
  { id: 'STANDARD', label: 'Estándar' },
  { id: 'PREMIUM', label: 'Premium' },
];

export type MemoryFilter = 'UP_32K' | 'UP_200K' | 'OVER_200K' | 'OVER_1M';
export const MEMORY_OPTIONS: { id: MemoryFilter; label: string }[] = [
  { id: 'UP_32K', label: 'Hasta 32 K' },
  { id: 'UP_200K', label: 'Hasta 200 K' },
  { id: 'OVER_200K', label: 'Más de 200 K' },
  { id: 'OVER_1M', label: '1 M o más' },
];

export function matchesMemory(tokens: number | null | undefined, f: MemoryFilter | ''): boolean {
  if (!f) return true;
  if (!tokens) return false;
  switch (f) {
    case 'UP_32K':
      return tokens <= 32_768;
    case 'UP_200K':
      return tokens <= 200_000;
    case 'OVER_200K':
      return tokens > 200_000;
    case 'OVER_1M':
      return tokens >= 1_000_000;
  }
}

/** `131072` → «128 K»; `1048576` → «1 M». */
export function formatContext(tokens?: number | null): string | null {
  if (!tokens) return null;
  // Potencias binarias habituales (131072 → 128 K, 1048576 → 1 M); el resto en base decimal (128000 → 128 K).
  const k = tokens % 8192 === 0 ? 1024 : 1000;
  if (tokens >= 1_000_000) return `${+(tokens / (k * k)).toFixed(1)} M`;
  return `${Math.round(tokens / k)} K`;
}

export function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
