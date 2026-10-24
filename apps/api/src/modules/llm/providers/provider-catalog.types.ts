import type { ModelTier } from '@prisma/client';
import type { AuthHeaderStyle } from '../llm-provider';

/**
 * Catálogo de proveedores "conectar en un clic" (ADR 0002, D8). Solo conexiones oficiales: clave de API de pago por
 * uso, nube empresarial, modelos locales y los inicios de sesión que cada proveedor documenta para aplicaciones de
 * terceros con **la app registrada de Nexo**. Nunca suscripciones personales ni client_id de otros productos.
 */
export type ProviderCategory = 'FRONTIER' | 'OPEN_MODELS' | 'ENTERPRISE_CLOUD' | 'LOCAL' | 'ROUTER';
export type ProviderBilling = 'PAY_AS_YOU_GO' | 'FREE_TIER' | 'ENTERPRISE' | 'LOCAL';
export type ProviderKind = 'ANTHROPIC' | 'OPENAI_COMPATIBLE';
export type ProviderAuth = 'API_KEY' | 'OAUTH' | 'NONE';
/** Especialidades de un modelo para los filtros de la consola (solo valores verificados; si no, `GENERAL`). */
export type ModelSpecialty = 'CODE' | 'REASONING' | 'VISION' | 'FAST' | 'GENERAL';
export const MODEL_SPECIALTIES: readonly ModelSpecialty[] = ['CODE', 'REASONING', 'VISION', 'FAST', 'GENERAL'];
/**
 * Canal oficial por el que se llega a los modelos Claude. Los modelos son los mismos; cambian la autenticación, la
 * facturación y quién opera el servicio: Anthropic (API directa y Claude en Google Cloud), Google (Vertex AI) o
 * Microsoft (Foundry).
 */
export type ClaudeChannel = 'anthropic' | 'google-cloud' | 'vertex' | 'foundry';
/** Mecanismo de conexión que ofrece la galería. */
export type MechanismType = 'API_KEY' | 'OAUTH' | 'DEVICE_CODE' | 'LOCAL_DETECT';

/**
 * App OAuth **de Nexo** registrada en el proveedor (credenciales en `OAUTH_LLM_<PROVEEDOR>_CLIENT_ID/SECRET`). Las URLs
 * son plantillas con los campos no secretos del formulario (p. ej. `{{ tenantId }}` de Entra ID).
 */
export interface OAuthAppSpec {
  /** Nombre del proveedor de identidad para mensajes (Google, Microsoft, Hugging Face). */
  idpName: string;
  authorizeUrl: string;
  tokenUrl: string;
  /** Endpoint de autorización de dispositivo (RFC 8628), si el proveedor lo documenta. */
  deviceUrl?: string;
  /** Endpoint de revocación documentado (RFC 7009); sin él, desconectar solo borra los tokens de Nexo. */
  revokeUrl?: string;
  scopes: string[];
  /** Parámetros fijos adicionales de la URL de autorización (p. ej. `access_type=offline` de Google). */
  authorizeParams?: Record<string, string>;
  /** Envía `scope` también al canjear y renovar (extensión documentada de Microsoft Entra ID). */
  scopeOnTokenRequest?: boolean;
  /** Autenticación del cliente en el endpoint de token: `post` (client_secret en el cuerpo) o `basic`. */
  clientAuth: 'post' | 'basic';
  /** La app de Nexo debe tener client secret (app web confidencial). */
  secretRequired: boolean;
  /**
   * client_id fijo cuando no hay variable de entorno. Solo para el simulador local de Nexo (`LLM_DEV_SIMULATOR`):
   * jamás un client_id de otro producto. Las URLs que empiezan por `/` son rutas de `PUBLIC_URL`.
   */
  builtinClientId?: string;
  /**
   * Clave de las variables `OAUTH_LLM_<CLAVE>_CLIENT_ID/SECRET` (por defecto el id del proveedor). Permite que varias
   * entradas compartan la misma app de Nexo, p. ej. la app de Google para Vertex AI y Claude en Google Cloud.
   */
  appKey?: string;
}

export interface ProviderMechanismSpec {
  type: MechanismType;
  /** Texto del botón en español (p. ej. «Iniciar sesión con Google»). */
  label: string;
  /** Mecanismo recomendado; si no está disponible la interfaz usa el siguiente disponible. */
  primary: boolean;
  /** App OAuth de Nexo (OAUTH/DEVICE_CODE). OpenRouter no la necesita: su PKCE no exige registrar la app. */
  oauth?: OAuthAppSpec;
}

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
  /** Mecanismos en los que aplica el campo (ausente = todos); p. ej. la clave solo con API_KEY. */
  mechanisms?: MechanismType[];
}

export interface SuggestedModel {
  id: string;
  label: string;
  tier: ModelTier;
  /** Tarifas en USD por millón de tokens: solo las verificadas en la fuente oficial. */
  inputUsdPerMTok?: number;
  outputUsdPerMTok?: number;
  cacheReadUsdPerMTok?: number;
  /** Ventana de contexto verificada en la fuente oficial. */
  contextTokens?: number;
  /** Especialidades verificadas en la fuente oficial (por defecto `['GENERAL']`). */
  specialties?: ModelSpecialty[];
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
  /** Mecanismos de conexión; por defecto `API_KEY` (o `LOCAL_DETECT` en la categoría LOCAL). */
  mechanisms?: ProviderMechanismSpec[];
  // --- Comportamiento del driver (no lo necesita la web, pero no es secreto) ---
  authHeader: AuthHeaderStyle;
  /** Ruta para validar la clave antes de guardar (por defecto `/models`). */
  verifyPath?: string;
  /** Cabeceras fijas no secretas. */
  headers?: Record<string, string>;
  /** Reenviar `reasoning_content` del asistente (requerido por algunos modelos de razonamiento). */
  replayReasoning?: boolean;
  /**
   * `lenient`: un 404/405 en la ruta de verificación no impide conectar (el endpoint no documenta `/models`); un
   * 401/403 sí lo impide. Por defecto `strict`.
   */
  verifyMode?: 'strict' | 'lenient';
  /** Valores derivados de los campos para renderizar la URL base (no se guardan). */
  deriveValues?: (values: Record<string, string>) => Record<string, string>;
  /** Solo existe con `LLM_DEV_SIMULATOR=true` fuera de producción; su URL base es `PUBLIC_URL` + `baseUrl`. */
  devOnly?: boolean;
  /** Familia de modelos: la galería agrupa los canales de Claude bajo «Claude». */
  family?: 'CLAUDE';
  /** Canal de Claude (solo `kind: 'ANTHROPIC'`): decide qué cliente oficial usa el driver. */
  claudeChannel?: ClaudeChannel;
}

/** Mecanismos efectivos de una entrada (los declarados o el valor por defecto de su categoría). */
export function entryMechanisms(entry: Pick<ProviderCatalogEntry, 'mechanisms' | 'category'>): ProviderMechanismSpec[] {
  if (entry.mechanisms?.length) return entry.mechanisms;
  return entry.category === 'LOCAL'
    ? [{ type: 'LOCAL_DETECT', label: 'Detectar servidor local', primary: true }]
    : [{ type: 'API_KEY', label: 'Clave de API', primary: true }];
}

export function findMechanism(
  entry: Pick<ProviderCatalogEntry, 'mechanisms' | 'category'>,
  type: MechanismType,
): ProviderMechanismSpec | undefined {
  return entryMechanisms(entry).find((m) => m.type === type);
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
