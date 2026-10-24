import type { LlmKind } from '@prisma/client';

/**
 * Puerto de proveedores LLM. Un *driver* por tipo de proveedor crea clientes a partir de las credenciales de una
 * conexión. Cada cliente es dueño de su formato de historial nativo (se persiste tal cual, append-only) y de su bucle
 * de tool use, e informa el consumo de cada turno para medición y control de presupuesto.
 */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolOutcome {
  content: string;
  isError?: boolean;
}

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; output: string; isError: boolean }
  | { type: 'notice'; message: string };

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Tokens consumidos por una llamada al modelo. */
export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface LlmRunRequest {
  model: string;
  system: string;
  effort: Effort;
  history: unknown[];
  userMessage: string;
  tools: ToolSpec[];
  maxTurns: number;
  executeTool: (call: ToolCall) => Promise<ToolOutcome>;
  onEvent?: (event: AgentEvent) => void;
  /** Se invoca antes de cada llamada al modelo; si lanza, la ejecución se detiene (control de presupuesto). */
  beforeTurn?: () => Promise<void>;
  /** Se invoca después de cada llamada con los tokens reales (medición). */
  onUsage?: (usage: TurnUsage) => Promise<void>;
  signal?: AbortSignal;
  /**
   * Ámbito de los marcadores de DataGuard (ADR 0008 D2): el id de la conversación o sesión, para que un mismo dato
   * tenga el mismo marcador en todos sus turnos (caché de prompts). Sin ámbito, cada ejecución usa uno aleatorio.
   */
  privacyScope?: string;
}

export interface LlmRunResult {
  history: unknown[];
  text: string;
  stopReason: string;
  turns: number;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LlmClient {
  run(request: LlmRunRequest): Promise<LlmRunResult>;
  test(): Promise<{ ok: boolean; message: string }>;
  /**
   * Verifica credenciales y alcance del endpoint con una llamada barata (sin tokens). Lanza `LlmHttpError` si el
   * proveedor responde con error HTTP, o `Error` si no es alcanzable o la política de red lo bloquea.
   */
  verify?(): Promise<void>;
  /** Ids de modelos que expone el proveedor (`/models`). */
  listModels?(): Promise<string[]>;
}

/** Cómo viaja la clave en el driver compatible con OpenAI: `both` es el comportamiento heredado (sin catálogo). */
export type AuthHeaderStyle = 'bearer' | 'api-key' | 'none' | 'both';

export interface LlmCredentials {
  apiKey?: string;
  /**
   * Token OAuth vigente (conexiones `credentialType = OAUTH`): se invoca en cada llamada para que el token se renueve
   * antes de expirar, también en ejecuciones largas. Tiene prioridad sobre `apiKey`.
   */
  getAccessToken?: () => Promise<string>;
  baseUrl?: string;
  /** Cabeceras adicionales no secretas (p. ej. `X-OpenRouter-Title`). */
  headers?: Record<string, string>;
  authHeader?: AuthHeaderStyle;
  /** Ruta usada por `verify()` (por defecto `/models`). */
  verifyPath?: string;
  /** Reenvía `reasoning_content` del asistente en turnos siguientes (p. ej. Kimi K3 lo exige). */
  replayReasoning?: boolean;
  /** Canal de Claude y sus datos no secretos (proyecto, región, workspace o recurso). */
  claude?: ClaudeChannelOptions;
  /**
   * Workload Identity Federation con la API de Anthropic (sin clave): `identityToken` firma una aserción nueva en cada
   * intercambio (los `jti` son de un solo uso) y el SDK la canjea por un token de acceso que cachea hasta su expiración.
   */
  workloadIdentity?: {
    federationRuleId: string;
    organizationId: string;
    serviceAccountId?: string;
    workspaceId?: string;
    identityToken: () => string | Promise<string>;
  };
  /**
   * Credenciales temporales de AWS (STS AssumeRole del rol del cliente) para firmar con SigV4 en Claude en Amazon
   * Bedrock y Claude Platform on AWS. Se piden en cada solicitud; el proveedor las cachea hasta su expiración.
   */
  awsCredentials?: () => Promise<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    expiration?: Date;
  }>;
}

/** Datos del canal por el que el driver Anthropic llega a Claude (ver `ClaudeChannel`). */
export interface ClaudeChannelOptions {
  channel: 'anthropic' | 'google-cloud' | 'vertex' | 'foundry' | 'bedrock' | 'aws';
  /** Proyecto de Google Cloud (google-cloud, vertex). */
  project?: string;
  /** Región de Vertex AI (`global` recomendada) o de AWS (bedrock, aws). */
  region?: string;
  /** Workspace de Claude en Google Cloud o en Claude Platform on AWS (`wrkspc_...`). */
  workspaceId?: string;
  /** Recurso de Microsoft Foundry (`https://<recurso>.services.ai.azure.com`). */
  resource?: string;
}

/** Error HTTP de un proveedor LLM (estado y mensaje del proveedor, nunca la clave). */
export class LlmHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'LlmHttpError';
  }
}

export interface LlmDriver {
  readonly kind: LlmKind;
  create(credentials: LlmCredentials): LlmClient;
}

export const LLM_DRIVERS = Symbol('LLM_DRIVERS');

export function emptyUsage(): TurnUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}
