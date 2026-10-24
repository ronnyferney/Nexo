import type { LlmConnection, LlmKind, LlmModel, ModelTier } from './models';

/** Familia del proveedor en la galería «Proveedores de IA». */
export type ProviderCategory = 'FRONTIER' | 'OPEN_MODELS' | 'ENTERPRISE_CLOUD' | 'LOCAL' | 'ROUTER';
/** Forma de cobro: Nexo no conecta suscripciones personales (Claude Pro/Max, ChatGPT Plus…), solo cuentas de API. */
export type ProviderBilling = 'PAY_AS_YOU_GO' | 'FREE_TIER' | 'ENTERPRISE' | 'LOCAL';
export type ProviderAuth = 'API_KEY' | 'OAUTH' | 'NONE';
/** Mecanismo con el que se conecta un proveedor; cada uno tiene su propio flujo en el diálogo. */
export type MechanismType = 'API_KEY' | 'OAUTH' | 'DEVICE_CODE' | 'LOCAL_DETECT';
/** Especialidad de un modelo para los filtros del diálogo del proveedor conectado. */
export type ModelSpecialty = 'CODE' | 'REASONING' | 'VISION' | 'FAST' | 'GENERAL';

export interface ProviderMechanism {
  type: MechanismType;
  /** Texto del botón o subtítulo: «Iniciar sesión con Google», «Clave de API»… */
  label: string;
  available: boolean;
  /** Motivo en español cuando `available` es `false` (p. ej. falta configurar la app OAuth en la plataforma). */
  unavailableReason?: string;
  primary: boolean;
  /**
   * Campos que el mecanismo pide antes de iniciar (OAuth de Vertex: `projectId`, `region`; Azure: `resource`).
   * Admite la definición completa o la clave de un campo de `ProviderView.fields`. Si falta, el OAuth usa los campos
   * no secretos y obligatorios del proveedor.
   */
  fields?: (ProviderField | string)[];
}

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
  /** Valor que usa el servidor si no se envía (p. ej. URL local de Ollama): el campo deja de ser obligatorio. */
  default?: string;
  /** Mecanismos en los que aplica el campo (ausente = todos); p. ej. la clave solo con `API_KEY`. */
  mechanisms?: MechanismType[];
}

export interface SuggestedModel {
  id: string;
  label: string;
  tier: ModelTier;
  inputUsdPerMTok?: number;
  outputUsdPerMTok?: number;
  contextTokens?: number;
  specialties?: ModelSpecialty[];
}

export interface ProviderConnectionRef {
  connectionId: string;
  name: string;
  modelCount: number;
  enabled: boolean;
  /** Mecanismo con que se creó la conexión (para «Sesión iniciada con…» o «Conectado con clave de API»). */
  mechanism?: MechanismType;
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
  /** Mecanismos de conexión; si el servidor aún no los envía, la web los deriva de `auth` y `category`. */
  mechanisms?: ProviderMechanism[];
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

/** Metadatos opcionales de un modelo conectado (`GET /admin/llm/connections`); se toleran ausentes. */
export interface LlmModelMeta extends LlmModel {
  specialties?: ModelSpecialty[] | null;
  contextTokens?: number | null;
  /** Importado sin tarifa verificada: la consola pide completarla. */
  needsPricing?: boolean;
}

/** Campos opcionales de una conexión (`GET /admin/llm/connections`). */
export interface LlmConnectionMeta extends LlmConnection {
  /** `OAUTH` = token renovable obtenido al iniciar sesión; `API_KEY` = clave estática. */
  credentialType?: 'API_KEY' | 'OAUTH';
  providerId?: string | null;
  /** Vencimiento del access token OAuth actual. */
  oauthExpiresAt?: string | null;
  /** `true`: el token se renueva solo; `false`: al expirar hay que volver a iniciar sesión. */
  oauthRenewable?: boolean | null;
  /** Conexión OAuth con la sesión cerrada: conserva modelos y agentes hasta volver a iniciar sesión. */
  signedOut?: boolean;
}

/** `GET /admin/llm/connections/:id/usage`: agente que usa la conexión como modelo principal o de respaldo. */
export interface ConnectionUsage {
  agentId: string;
  agentName: string;
  model: string;
  role: 'PRIMARY' | 'FALLBACK';
}

/** `POST /admin/llm/providers/:id/oauth/start` (también `device/start`). `limit` solo aplica a OpenRouter (USD). */
export interface OAuthStartInput {
  name?: string;
  fields?: Record<string, string>;
  models?: string[];
  limit?: number;
  /** «Volver a iniciar sesión» en esta conexión OAuth (renueva sus tokens; no crea otra). */
  connectionId?: string;
}

/** `POST /admin/llm/providers/:id/device/start` (p. ej. Hugging Face). `expiresIn` e `interval` en segundos. */
export interface DeviceStartResult {
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
  flowId: string;
}

export type DevicePollStatus = 'pending' | 'slow_down' | 'connected' | 'expired' | 'denied';

/** `POST /admin/llm/providers/:id/device/poll` `{ flowId }`. */
export interface DevicePollResult {
  status: DevicePollStatus;
  /** Nuevo intervalo sugerido (segundos) tras `slow_down`. */
  interval?: number;
  message?: string;
  /** Conexión creada (con sus modelos) cuando `status` es `connected`. */
  connection?: LlmConnection;
}

/** `DELETE /admin/llm/connections/:id`: `revoked` indica si también se revocó el acceso en el proveedor. */
export interface DeleteConnectionResult {
  deleted: boolean;
  revoked?: boolean;
}

export interface DetectedModel {
  id: string;
  label?: string;
  sizeBytes?: number;
  contextTokens?: number | null;
  specialties?: ModelSpecialty[];
}

/**
 * `POST /admin/llm/providers/:id/detect` `{ baseUrl? }`. Si no alcanza el servidor responde `reachable: false` con
 * `message` (también se tolera un 4xx con `message`).
 */
export interface DetectResult {
  baseUrl: string;
  reachable?: boolean;
  message?: string;
  /** Modelos instalados; se aceptan también como lista de ids. */
  models: (DetectedModel | string)[];
}

/** Mensaje que la ventana emergente de OAuth envía a la principal (`postMessage` al mismo origen y `BroadcastChannel`). */
export interface OAuthReturnMessage {
  type: 'nexo:llm-oauth';
  llm: 'connected' | 'error';
  provider: string | null;
  connectionId: string | null;
  reason: string | null;
}
