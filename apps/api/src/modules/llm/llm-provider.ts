/**
 * Puerto de proveedores LLM. Cada proveedor es dueño de su formato de historial nativo
 * (se persiste tal cual, append-only) y de su bucle de tool use.
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
  signal?: AbortSignal;
}

export interface LlmRunResult {
  history: unknown[];
  text: string;
  stopReason: string;
  turns: number;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ModelInfo {
  id: string;
  label: string;
  description: string;
}

export interface LlmProvider {
  readonly id: string;
  readonly label: string;
  isConfigured(): boolean;
  models(): ModelInfo[];
  run(request: LlmRunRequest): Promise<LlmRunResult>;
}

export const LLM_PROVIDERS = Symbol('LLM_PROVIDERS');
