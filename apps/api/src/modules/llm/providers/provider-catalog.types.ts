import type { ModelTier } from '@prisma/client';
import type { AuthHeaderStyle } from '../llm-provider';

/**
 * Catálogo de proveedores "conectar en un clic" (ADR 0002, D8). Solo conexiones oficiales: clave de API de pago por
 * uso, nube empresarial, modelos locales y OpenRouter con su OAuth PKCE. Nunca suscripciones personales.
 */
export type ProviderCategory = 'FRONTIER' | 'OPEN_MODELS' | 'ENTERPRISE_CLOUD' | 'LOCAL' | 'ROUTER';
export type ProviderBilling = 'PAY_AS_YOU_GO' | 'FREE_TIER' | 'ENTERPRISE' | 'LOCAL';
export type ProviderKind = 'ANTHROPIC' | 'OPENAI_COMPATIBLE';
export type ProviderAuth = 'API_KEY' | 'OAUTH' | 'NONE';

export interface ProviderField {
  /** `apiKey` es el único campo secreto: se guarda cifrado en `LlmConnection.apiKeyCipher`. */
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
  /** Expresión regular (sintaxis JavaScript, anclada) que debe cumplir el valor. */
  pattern?: string;
  /** Valor por defecto si el usuario no envía el campo (p. ej. URL local de Ollama). */
  default?: string;
}

export interface SuggestedModel {
  id: string;
  label: string;
  tier: ModelTier;
  /** Tarifas en USD por millón de tokens: solo las verificadas en la fuente oficial. */
  inputUsdPerMTok?: number;
  outputUsdPerMTok?: number;
  cacheReadUsdPerMTok?: number;
  contextTokens?: number;
}

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  /** Una línea en español. */
  description: string;
  /** Clave del logo en la web (= id). */
  logo: string;
  category: ProviderCategory;
  billing: ProviderBilling;
  kind: ProviderKind;
  /** Plantilla con `{{ campo }}` renderizada con `common/template/template.engine.ts`. */
  baseUrl: string;
  auth: ProviderAuth;
  fields: ProviderField[];
  docsUrl: string;
  /** Dónde obtener la clave. */
  keyUrl?: string;
  /** Pasos verificados en la documentación oficial para obtener la clave (vacío si no se pudieron verificar). */
  keySteps: string[];
  /** Prefijo documentado de la clave: la interfaz solo advierte si no coincide. */
  keyPrefix?: string;
  suggestedModels: SuggestedModel[];
  notes?: string;
  /** Aspectos aún no verificados en la documentación oficial (transparencia para la consola y QA). */
  pendingVerification: string[];
  // --- Comportamiento del driver (no lo necesita la web, pero no es secreto) ---
  authHeader: AuthHeaderStyle;
  /** Ruta para validar la clave antes de guardar (por defecto `/models`). */
  verifyPath?: string;
  /** Cabeceras fijas no secretas. */
  headers?: Record<string, string>;
  /** Reenviar `reasoning_content` del asistente (requerido por algunos modelos de razonamiento). */
  replayReasoning?: boolean;
}

/** Fecha de la última revisión del catálogo contra las fuentes oficiales. */
export const CATALOG_VERIFIED_AT = '2026-10-23';

export const API_KEY_FIELD = (overrides: Partial<ProviderField> = {}): ProviderField => ({
  key: 'apiKey',
  label: 'Clave de API',
  secret: true,
  required: true,
  ...overrides,
});
