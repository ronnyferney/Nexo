import type { LlmConnection, LlmKind, LlmModel, ModelTier } from './models';

/** Familia del proveedor en la galería «Proveedores de IA». */
export type ProviderCategory = 'FRONTIER' | 'OPEN_MODELS' | 'ENTERPRISE_CLOUD' | 'LOCAL' | 'ROUTER';
/** Forma de cobro: Nexo no conecta suscripciones personales (Claude Pro/Max, ChatGPT Plus…), solo cuentas de API. */
export type ProviderBilling = 'PAY_AS_YOU_GO' | 'FREE_TIER' | 'ENTERPRISE' | 'LOCAL';
export type ProviderAuth = 'API_KEY' | 'OAUTH' | 'NONE';

/** Campo dinámico del formulario de conexión (clave, recurso, región, URL…). */
export interface ProviderField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
  /** Expresión regular (sin delimitadores) que debe cumplir el valor. */
  pattern?: string;
}

export interface SuggestedModel {
  id: string;
  label: string;
  tier: ModelTier;
  inputUsdPerMTok?: number;
  outputUsdPerMTok?: number;
  contextTokens?: number;
}

export interface ProviderConnectionRef {
  connectionId: string;
  name: string;
  modelCount: number;
  enabled: boolean;
}

/** `GET /admin/llm/providers` → `{ providers: ProviderView[] }`. */
export interface ProviderView {
  id: string;
  name: string;
  description: string;
  logo: string;
  category: ProviderCategory;
  billing: ProviderBilling;
  kind: LlmKind;
  auth: ProviderAuth;
  fields: ProviderField[];
  docsUrl: string;
  keyUrl?: string;
  /** Pasos para obtener la clave en la consola del proveedor (vacío = no se muestra la ayuda). */
  keySteps?: string[];
  /** Prefijo habitual de la clave (`sk-ant-`, `sk-`…): solo advierte, nunca bloquea. */
  keyPrefix?: string;
  suggestedModels: SuggestedModel[];
  notes?: string;
  modelCount: number;
  connected: ProviderConnectionRef[];
  /** Solo en el proveedor de la plataforma (Anthropic): conexión incluida por Nexo configurada en el servidor. */
  platform?: { configured: boolean };
}

export interface ProviderConnectInput {
  name?: string;
  fields: Record<string, string>;
  models?: string[];
}

/** `POST /admin/llm/providers/:id/connect`; 400 con `message` en español si la prueba falla. */
export interface ProviderConnectResult {
  connection: LlmConnection;
  models: LlmModel[];
  discoveredModels: string[];
}
