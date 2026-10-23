import type { ProviderBilling, ProviderCategory, ProviderView } from '../../core/llm-providers.models';

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
  { id: 'LOGIN', label: 'Inicio de sesión', hint: 'Autorización con la cuenta del proveedor (OAuth)' },
];

export function matchesFilter(p: ProviderView, f: ConnectionFilter): boolean {
  switch (f) {
    case 'CLOUD':
      return p.category === 'ENTERPRISE_CLOUD' || p.billing === 'ENTERPRISE';
    case 'LOCAL':
      return p.category === 'LOCAL' || p.billing === 'LOCAL';
    case 'LOGIN':
      return p.auth === 'OAUTH';
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

/** Mensajes del retorno OAuth de OpenRouter (`?llm=error&reason=`). */
const LLM_OAUTH_ERRORS: Record<string, string> = {
  access_denied: 'Se canceló la autorización en OpenRouter.',
  invalid_state: 'La solicitud de autorización expiró o ya fue usada. Inicie sesión de nuevo.',
  exchange_failed: 'OpenRouter no entregó la clave de API. Intente de nuevo en unos minutos.',
  forbidden: 'Se requiere rol de administrador para conectar proveedores.',
};

export function llmOAuthError(reason: string | null): string {
  return `No se pudo conectar OpenRouter. ${(reason && LLM_OAUTH_ERRORS[reason]) || 'Intente de nuevo.'}`;
}

export function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
