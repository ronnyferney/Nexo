import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import type { LlmClient, LlmCredentials, LlmDriver, LlmRunRequest, LlmRunResult } from '../llm-provider';

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ToolResultBlock = Anthropic.Beta.Messages.BetaToolResultBlockParam;

/**
 * Cliente Anthropic (Messages API) con bucle de tool use manual:
 * streaming, thinking adaptativo + effort, caché automática de prompts (ahorro de costos),
 * fallback server-side ante rechazos por política e historial nativo append-only.
 */
class AnthropicClient implements LlmClient {
  private readonly logger = new Logger('AnthropicClient');
  private readonly client: Anthropic;
  private readonly customEndpoint: boolean;

  constructor(credentials: LlmCredentials) {
    this.client = new Anthropic({ apiKey: credentials.apiKey, baseURL: credentials.baseUrl || undefined });
    this.customEndpoint = !!credentials.baseUrl;
  }

  async test() {
    const page = await this.client.models.list({ limit: 5 });
    return { ok: true, message: `Conexión correcta: ${page.data.map((m) => m.id).join(', ')}` };
  }

  async run(req: LlmRunRequest): Promise<LlmRunResult> {
    const history = [...(req.history as MessageParam[]), { role: 'user', content: req.userMessage } as MessageParam];
    const tools: Anthropic.Beta.Messages.BetaTool[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
      eager_input_streaming: true,
    }));
    const usage = { inputTokens: 0, outputTokens: 0 };
    let text = '';
    let stopReason = 'end_turn';
    let turns = 0;

    while (turns < req.maxTurns) {
      await req.beforeTurn?.();
      turns++;
      const stream = this.client.beta.messages.stream(
        {
          model: req.model,
          max_tokens: 64000,
          system: req.system || undefined,
          messages: history,
          tools: tools.length ? tools : undefined,
          thinking: { type: 'adaptive' },
          output_config: { effort: req.effort },
          cache_control: { type: 'ephemeral' },
          // El fallback server-side solo aplica a la API de Anthropic directa (no a proxies/gateways).
          ...(this.customEndpoint
            ? {}
            : {
                betas: ['server-side-fallback-2026-07-01'] as Anthropic.Beta.AnthropicBeta[],
                fallbacks: 'default' as const,
              }),
        },
        { signal: req.signal },
      );
      stream.on('text', (delta) => req.onEvent?.({ type: 'text', text: delta }));
      const message = await stream.finalMessage();

      const u = message.usage;
      usage.inputTokens += u.input_tokens;
      usage.outputTokens += u.output_tokens;
      await req.onUsage?.({
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      });

      stopReason = message.stop_reason ?? 'end_turn';
      history.push({ role: 'assistant', content: message.content });
      text = message.content
        .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      if (stopReason === 'pause_turn') continue;
      if (stopReason === 'refusal') {
        req.onEvent?.({ type: 'notice', message: 'El modelo declinó la solicitud por política de seguridad.' });
        break;
      }
      if (stopReason === 'max_tokens') {
        req.onEvent?.({ type: 'notice', message: 'Respuesta truncada por límite de tokens.' });
        break;
      }
      if (stopReason !== 'tool_use') break;

      const calls = message.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use');
      // Las tools se ejecutan en paralelo y todos los resultados vuelven en un solo mensaje.
      const results = await Promise.all(
        calls.map(async (call): Promise<ToolResultBlock> => {
          const input = (call.input ?? {}) as Record<string, unknown>;
          req.onEvent?.({ type: 'tool_call', id: call.id, name: call.name, input });
          const outcome = await req.executeTool({ id: call.id, name: call.name, input }).catch((err: Error) => ({
            content: `Error: ${err.message}`,
            isError: true,
          }));
          req.onEvent?.({
            type: 'tool_result',
            id: call.id,
            name: call.name,
            output: outcome.content,
            isError: !!outcome.isError,
          });
          return { type: 'tool_result', tool_use_id: call.id, content: outcome.content, is_error: outcome.isError };
        }),
      );
      history.push({ role: 'user', content: results });
    }

    if (turns >= req.maxTurns && stopReason === 'tool_use') {
      this.logger.warn(`Agente alcanzó maxTurns=${req.maxTurns}`);
      req.onEvent?.({ type: 'notice', message: `Se alcanzó el máximo de ${req.maxTurns} turnos.` });
    }
    return { history, text, stopReason, turns, usage };
  }
}

@Injectable()
export class AnthropicDriver implements LlmDriver {
  readonly kind = 'ANTHROPIC' as const;
  create(credentials: LlmCredentials): LlmClient {
    if (!credentials.apiKey) throw new Error('La conexión Anthropic no tiene API key');
    return new AnthropicClient(credentials);
  }
}
