import { Injectable } from '@nestjs/common';
import type { LlmClient, LlmDriver, LlmRunRequest, LlmRunResult } from '../llm-provider';

interface MockMessage {
  role: 'user' | 'assistant';
  content: string;
}

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Cliente determinista para desarrollo y pruebas sin credenciales.
 * `/tool <nombre> <json>` ejecuta esa tool; cualquier otro mensaje responde en eco.
 * Informa un consumo estimado (caracteres / 4) para poder probar presupuestos.
 */
class MockClient implements LlmClient {
  async test() {
    return { ok: true, message: 'Proveedor simulado disponible' };
  }

  async run(req: LlmRunRequest): Promise<LlmRunResult> {
    await req.beforeTurn?.();
    const history = [...(req.history as MockMessage[]), { role: 'user' as const, content: req.userMessage }];
    let text: string;
    const match = /^\/tool\s+(\S+)\s*(.*)$/s.exec(req.userMessage.trim());
    if (match) {
      const [, name, rawInput] = match;
      const input = rawInput ? (JSON.parse(rawInput) as Record<string, unknown>) : {};
      const id = `mock_${Date.now()}`;
      req.onEvent?.({ type: 'tool_call', id, name, input });
      const outcome = await req.executeTool({ id, name, input });
      req.onEvent?.({ type: 'tool_result', id, name, output: outcome.content, isError: !!outcome.isError });
      text = `Resultado de ${name}: ${outcome.content}`;
    } else {
      const tools = req.tools.map((t) => t.name).join(', ') || 'ninguna';
      text = `Eco: ${req.userMessage}\n(tools disponibles: ${tools})`;
    }
    const usage = {
      inputTokens: estimateTokens(req.system + JSON.stringify(history)),
      outputTokens: estimateTokens(text),
    };
    await req.onUsage?.({ ...usage, cacheReadTokens: 0, cacheWriteTokens: 0 });
    req.onEvent?.({ type: 'text', text });
    history.push({ role: 'assistant', content: text });
    return { history, text, stopReason: 'end_turn', turns: 1, usage };
  }
}

@Injectable()
export class MockDriver implements LlmDriver {
  readonly kind = 'MOCK' as const;
  create(): LlmClient {
    return new MockClient();
  }
}
