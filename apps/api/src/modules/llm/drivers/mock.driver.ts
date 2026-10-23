import { Injectable } from '@nestjs/common';
import { JUDGE_MARKER, OPTIMIZER_MARKER, readSection, readSections } from '../../training/eval-protocol';
import type { LlmClient, LlmDriver, LlmRunRequest, LlmRunResult } from '../llm-provider';

interface MockMessage {
  role: 'user' | 'assistant';
  content: string;
}

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/** Minúsculas, sin acentos y con espacios colapsados. */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const longWords = (s: string) => new Set(fold(s).match(/[a-z0-9]{4,}/g) ?? []);

/**
 * Juez determinista (ADR 0004): 1 si la salida contiene el texto esperado (sin mayúsculas ni acentos), 0.6 si comparte
 * al menos la mitad de las palabras de 4+ letras del esperado y 0 en otro caso. Sin texto esperado: 1 si hay salida.
 */
export function mockJudge(userMessage: string): string {
  const expected = fold(readSection(userMessage, 'esperado') ?? '');
  const output = fold(readSection(userMessage, 'salida', true) ?? '');
  let score: number;
  let reasoning: string;
  if (!expected) {
    score = output ? 1 : 0;
    reasoning = output ? 'Sin respuesta esperada: la salida no está vacía.' : 'La salida está vacía.';
  } else if (output.includes(expected)) {
    score = 1;
    reasoning = 'La salida contiene la respuesta esperada.';
  } else {
    const wanted = [...longWords(expected)];
    const got = longWords(output);
    const shared = wanted.filter((w) => got.has(w)).length;
    score = wanted.length && shared * 2 >= wanted.length ? 0.6 : 0;
    reasoning = `La salida comparte ${shared} de ${wanted.length} palabras clave de la respuesta esperada.`;
  }
  return JSON.stringify({ score, passed: score >= 0.7, reasoning });
}

/** Optimizador determinista: agrega al system prompt una instrucción por cada respuesta esperada de los casos. */
export function mockOptimizer(userMessage: string): string {
  const current = readSection(userMessage, 'system_prompt_actual') ?? '';
  let profile: Record<string, unknown> = {};
  try {
    profile = JSON.parse(readSection(userMessage, 'perfil_actual') || '{}') as Record<string, unknown>;
  } catch {
    profile = {};
  }
  const cases = readSections(readSection(userMessage, 'casos') ?? '', 'caso');
  const expected = [...new Set(cases.map((c) => readSection(c, 'esperado') ?? '').filter(Boolean))].slice(0, 5);
  const rules = expected.length
    ? expected.map((e) => `- Cuando corresponda, incluye en tu respuesta: «${e}».`)
    : ['- Responde de forma completa y precisa a lo que se pregunta.'];
  const goals = Array.isArray(profile.goals) ? (profile.goals as string[]) : [];
  const goal = 'Cubrir las respuestas esperadas de los casos de evaluación';
  return JSON.stringify({
    rationale: `Se analizaron ${cases.length} caso(s) fallido(s) o dudoso(s); se agregan instrucciones explícitas.`,
    systemPrompt: [current.trim(), 'Instrucciones derivadas de la evaluación:', ...rules].filter(Boolean).join('\n'),
    profile: { ...profile, goals: goals.includes(goal) ? goals : [...goals, goal] },
  });
}

/**
 * Cliente determinista para desarrollo y pruebas sin credenciales.
 * `/tool <nombre> <json>` ejecuta esa tool; cualquier otro mensaje responde en eco.
 * Si el system prompt contiene `[NEXO_JUDGE]` o `[NEXO_OPTIMIZER]` responde como juez u optimizador (ADR 0004).
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
    if (req.system.includes(JUDGE_MARKER)) {
      text = mockJudge(req.userMessage);
    } else if (req.system.includes(OPTIMIZER_MARKER)) {
      text = mockOptimizer(req.userMessage);
    } else if (match) {
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
