import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LlmProvider, LlmRunRequest, LlmRunResult, ModelInfo } from '../llm-provider';

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ToolResultBlock = Anthropic.Beta.Messages.BetaToolResultBlockParam;

const MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    description: 'Recomendado: razonamiento y agentes de propósito general',
  },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', description: 'Máxima capacidad para tareas largas y complejas' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', description: 'Equilibrio velocidad / capacidad' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', description: 'Rápido y económico para alto volumen' },
];

/**
 * Adaptador Anthropic (Messages API) con bucle de tool use manual:
 * - streaming para no chocar con timeouts y emitir texto en vivo,
 * - thinking adaptativo + effort configurable por agente,
 * - fallback server-side ante rechazos por política,
 * - historial nativo append-only (los bloques de thinking se devuelven sin modificar).
 */
@Injectable()
export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic';
  readonly label = 'Anthropic Claude';
  private readonly logger = new Logger(AnthropicProvider.name);
  private readonly client?: Anthropic;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('llm.anthropicApiKey');
    if (apiKey) this.client = new Anthropic({ apiKey });
  }

  isConfigured(): boolean {
    return !!this.client;
  }

  models(): ModelInfo[] {
    return MODELS;
  }

  async run(req: LlmRunRequest): Promise<LlmRunResult> {
    if (!this.client) throw new Error('ANTHROPIC_API_KEY no está configurada');

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
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        { signal: req.signal },
      );
      stream.on('text', (delta) => req.onEvent?.({ type: 'text', text: delta }));
      const message = await stream.finalMessage();

      usage.inputTokens += message.usage.input_tokens;
      usage.outputTokens += message.usage.output_tokens;
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
