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
}

export interface LlmCredentials {
  apiKey?: string;
  baseUrl?: string;
}

export interface LlmDriver {
  readonly kind: LlmKind;
  create(credentials: LlmCredentials): LlmClient;
}

export const LLM_DRIVERS = Symbol('LLM_DRIVERS');

export function emptyUsage(): TurnUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}
