import { Injectable } from '@nestjs/common';
import type { LlmProvider, LlmRunRequest, LlmRunResult, ModelInfo } from '../llm-provider';

interface MockMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Proveedor determinista para desarrollo y pruebas sin credenciales.
 * Si el mensaje es `/tool <nombre> <json>` ejecuta esa tool; si no, responde en eco.
 */
@Injectable()
export class MockProvider implements LlmProvider {
  readonly id = 'mock';
  readonly label = 'Mock (desarrollo)';

  isConfigured(): boolean {
    return true;
  }

  models(): ModelInfo[] {
    return [{ id: 'mock-echo', label: 'Mock Echo', description: 'Respuestas deterministas para pruebas' }];
  }

  async run(req: LlmRunRequest): Promise<LlmRunResult> {
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
    req.onEvent?.({ type: 'text', text });
    history.push({ role: 'assistant', content: text });
    return { history, text, stopReason: 'end_turn', turns: 1, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
