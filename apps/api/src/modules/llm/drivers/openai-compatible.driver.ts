import { Injectable } from '@nestjs/common';
import { HttpClientService } from '../../../common/http/http-client.service';
import type { LlmClient, LlmCredentials, LlmDriver, LlmRunRequest, LlmRunResult } from '../llm-provider';

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
}

interface ChatResponse {
  choices?: { message: ChatMessage; finish_reason: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  error?: { message?: string };
}

const LLM_TIMEOUT_MS = 300_000;

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
    const h: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
    if (this.credentials.apiKey) {
      h.authorization = `Bearer ${this.credentials.apiKey}`;
      h['api-key'] = this.credentials.apiKey; // Azure OpenAI
    }
    return h;
  }

  async test() {
    const res = await this.http.request({ url: `${this.baseUrl}/models`, headers: this.headers() });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}: ${res.rawBody.slice(0, 200)}` };
    const ids = ((res.body as { data?: { id: string }[] }).data ?? []).slice(0, 5).map((m) => m.id);
    return { ok: true, message: `Conexión correcta${ids.length ? `: ${ids.join(', ')}` : ''}` };
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
      const messages = req.system ? [{ role: 'system', content: req.system }, ...history] : history;
      const res = await this.http.request({
        url: `${this.baseUrl}/chat/completions`,
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ model: req.model, messages, ...(tools.length ? { tools } : {}) }),
        timeoutMs: LLM_TIMEOUT_MS,
      });
      const body = res.body as ChatResponse;
      if (!res.ok || !body.choices?.length) {
        throw new Error(
          `Proveedor LLM respondió HTTP ${res.status}: ${body?.error?.message ?? res.rawBody.slice(0, 300)}`,
        );
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
      history.push({ role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls });
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
