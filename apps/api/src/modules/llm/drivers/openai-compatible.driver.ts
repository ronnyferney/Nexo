import { Injectable } from '@nestjs/common';
import { HttpClientService } from '../../../common/http/http-client.service';
import {
  LlmHttpError,
  type LlmClient,
  type LlmCredentials,
  type LlmDriver,
  type LlmRunRequest,
  type LlmRunResult,
} from '../llm-provider';

interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  /** Razonamiento visible de algunos proveedores (DeepSeek, Kimi); se guarda tal cual en el historial. */
  reasoning_content?: string;
  [extra: string]: unknown;
}

interface ChatResponse {
  choices?: { message: ChatMessage; finish_reason: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  error?: { message?: string };
}

const LLM_TIMEOUT_MS = 300_000;
const PROBE_TIMEOUT_MS = 15_000;
/** Campos que se reenvían al proveedor; el historial guardado conserva el mensaje completo (append-only). */
const REPLAY_KEYS = ['role', 'content', 'tool_calls', 'tool_call_id', 'name'] as const;

/** Mensaje de error del proveedor (`{ error: { message } }`, `[{ error }]` de Gemini o texto). */
export function providerErrorMessage(body: unknown, rawBody: string): string {
  const first = Array.isArray(body) ? (body[0] as unknown) : body;
  const err = (first as { error?: { message?: unknown } | string } | null)?.error;
  const msg = typeof err === 'string' ? err : err?.message;
  return typeof msg === 'string' && msg ? msg.slice(0, 300) : rawBody.slice(0, 300);
}

/** Ids de modelos de una respuesta `/models` (OpenAI `{ data: [{ id }] }`; tolera `models/` de Gemini). */
export function parseModelIds(body: unknown): string[] {
  const list = (body as { data?: unknown; models?: unknown } | null) ?? {};
  const items = Array.isArray(list.data) ? list.data : Array.isArray(list.models) ? list.models : [];
  const ids = items
    .map((m) =>
      typeof m === 'string' ? m : ((m as { id?: unknown; name?: unknown })?.id ?? (m as { name?: unknown })?.name),
    )
    .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200)
    .map((id) => id.replace(/^models\//, ''));
  return [...new Set(ids)].sort();
}

/**
 * Cliente para APIs compatibles con Chat Completions (OpenAI, Azure OpenAI, Ollama, vLLM, Gemini compatible,
 * gateways). Usa el cliente HTTP seguro de Nexo, por lo que un endpoint en red privada (p. ej. Ollama local)
 * requiere CONNECTOR_ALLOW_PRIVATE_NETWORKS=true.
 */
class OpenAiCompatibleClient implements LlmClient {
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpClientService,
    private readonly credentials: LlmCredentials,
  ) {
    this.baseUrl = (credentials.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      ...(this.credentials.headers ?? {}),
      'content-type': 'application/json',
      accept: 'application/json',
    };
    const key = this.credentials.apiKey;
    const style = this.credentials.authHeader ?? 'both';
    if (key && (style === 'bearer' || style === 'both')) h.authorization = `Bearer ${key}`;
    if (key && (style === 'api-key' || style === 'both')) h['api-key'] = key; // Azure OpenAI
    return h;
  }

  private async get(path: string) {
    const res = await this.http.request({
      url: `${this.baseUrl}${path}`,
      headers: this.headers(),
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (!res.ok) throw new LlmHttpError(res.status, providerErrorMessage(res.body, res.rawBody));
    return res;
  }

  async verify(): Promise<void> {
    await this.get(this.credentials.verifyPath ?? '/models');
  }

  async listModels(): Promise<string[]> {
    return parseModelIds((await this.get('/models')).body);
  }

  async test() {
    try {
      await this.verify();
    } catch (err) {
      const status = err instanceof LlmHttpError ? `HTTP ${err.status}: ` : '';
      return { ok: false, message: `${status}${(err as Error).message}` };
    }
    const ids = await this.listModels().catch(() => [] as string[]);
    return { ok: true, message: `Conexión correcta${ids.length ? `: ${ids.slice(0, 5).join(', ')}` : ''}` };
  }

  /** Proyección enviada al proveedor: sin campos de respuesta (refusal, annotations...) salvo el razonamiento opcional. */
  private outbound(m: ChatMessage): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of REPLAY_KEYS) if (m[k] !== undefined) out[k] = m[k];
    if (this.credentials.replayReasoning && m.role === 'assistant' && m.reasoning_content !== undefined) {
      out.reasoning_content = m.reasoning_content;
    }
    return out;
  }

  async run(req: LlmRunRequest): Promise<LlmRunResult> {
    const history = [...(req.history as ChatMessage[]), { role: 'user', content: req.userMessage } as ChatMessage];
    const tools = req.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
    const usage = { inputTokens: 0, outputTokens: 0 };
    let text = '';
    let stopReason = 'end_turn';
    let turns = 0;

    while (turns < req.maxTurns) {
      await req.beforeTurn?.();
      turns++;
      const replay = history.map((m) => this.outbound(m));
      const messages = req.system ? [{ role: 'system', content: req.system }, ...replay] : replay;
      const res = await this.http.request({
        url: `${this.baseUrl}/chat/completions`,
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ model: req.model, messages, ...(tools.length ? { tools } : {}) }),
        timeoutMs: LLM_TIMEOUT_MS,
      });
      const body = res.body as ChatResponse;
      if (!res.ok || !body.choices?.length) {
        throw new Error(`Proveedor LLM respondió HTTP ${res.status}: ${providerErrorMessage(res.body, res.rawBody)}`);
      }

      const cached = body.usage?.prompt_tokens_details?.cached_tokens ?? 0;
      const turnUsage = {
        inputTokens: Math.max((body.usage?.prompt_tokens ?? 0) - cached, 0),
        outputTokens: body.usage?.completion_tokens ?? 0,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
      };
      usage.inputTokens += turnUsage.inputTokens;
      usage.outputTokens += turnUsage.outputTokens;
      await req.onUsage?.(turnUsage);

      const { message, finish_reason } = body.choices[0];
      // Historial nativo append-only: se guarda el mensaje completo del proveedor (incluido el razonamiento).
      history.push({ ...message, role: 'assistant', content: message.content ?? null });
      text = message.content ?? '';
      if (text) req.onEvent?.({ type: 'text', text });
      stopReason = finish_reason === 'tool_calls' ? 'tool_use' : finish_reason === 'length' ? 'max_tokens' : 'end_turn';
      if (!message.tool_calls?.length) break;

      const results = await Promise.all(
        message.tool_calls.map(async (call) => {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
          } catch {
            return { id: call.id, content: 'Error: argumentos JSON inválidos', isError: true };
          }
          req.onEvent?.({ type: 'tool_call', id: call.id, name: call.function.name, input });
          const outcome = await req
            .executeTool({ id: call.id, name: call.function.name, input })
            .catch((err: Error) => ({ content: `Error: ${err.message}`, isError: true }));
          req.onEvent?.({
            type: 'tool_result',
            id: call.id,
            name: call.function.name,
            output: outcome.content,
            isError: !!outcome.isError,
          });
          return { id: call.id, content: outcome.content, isError: !!outcome.isError };
        }),
      );
      for (const r of results) history.push({ role: 'tool', tool_call_id: r.id, content: r.content });
    }

    if (turns >= req.maxTurns && stopReason === 'tool_use') {
      req.onEvent?.({ type: 'notice', message: `Se alcanzó el máximo de ${req.maxTurns} turnos.` });
    }
    return { history, text, stopReason, turns, usage };
  }
}

@Injectable()
export class OpenAiCompatibleDriver implements LlmDriver {
  readonly kind = 'OPENAI_COMPATIBLE' as const;
  constructor(private readonly http: HttpClientService) {}
  create(credentials: LlmCredentials): LlmClient {
    return new OpenAiCompatibleClient(this.http, credentials);
  }
}
