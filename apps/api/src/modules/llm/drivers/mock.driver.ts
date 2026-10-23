import { Injectable } from '@nestjs/common';
import { COPILOT_MARKER } from '../../copilot/definition/copilot.definition';
import { JUDGE_MARKER, OPTIMIZER_MARKER, readSection, readSections } from '../../training/eval-protocol';
import type { LlmClient, LlmDriver, LlmRunRequest, LlmRunResult, ToolCall } from '../llm-provider';

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

const ENGLISH = /\b(the|i|want|need|my|please|create|agent|how|what|is|are|for|with|to|and|you|can)\b/g;
const SPANISH = /\b(el|la|los|las|que|quiero|necesito|un|una|de|para|mi|por|favor|con|y|como|es|son|puedes)\b/g;
/** Heurística mínima de idioma para el Copilot simulado: inglés si predominan palabras frecuentes del inglés. */
export function looksEnglish(text: string): boolean {
  const t = fold(text);
  return (t.match(ENGLISH)?.length ?? 0) > (t.match(SPANISH)?.length ?? 0);
}

const INTERVIEW = {
  es: [
    '¿Qué problema debe resolver el agente y para quién? (p. ej. "responder a clientes sobre el estado de sus envíos")',
    '¿Qué sistemas o datos necesita consultar o modificar? (p. ej. CRM, TMS, una hoja de cálculo)',
    '¿Qué NO debe hacer nunca y qué acciones deben requerir tu confirmación?',
    '¿Qué conocimiento de la empresa necesita? (políticas, procesos, catálogos)',
    '¿Cómo se ve una respuesta excelente (tono, formato, idioma) y debe trabajar de forma programada?',
  ],
  en: [
    'What problem should the agent solve, and for whom? (e.g. "answer customers about their shipment status")',
    'Which systems or data does it need to read or change? (e.g. CRM, TMS, a spreadsheet)',
    'What must it never do, and which actions should require your confirmation?',
    'What company knowledge does it need? (policies, processes, catalogs)',
    'What does an excellent answer look like (tone, format, language), and should it run on a schedule?',
  ],
};

/** Tema del agente a partir del mensaje ("crea un agente de soporte…" → "de soporte…"). */
function draftTopic(message: string): string {
  const m = /(?:agente|agent)\s+(.{3,60}?)(?:[.,;!?\n]|$)/i.exec(message);
  return (m?.[1] ?? 'de atención').trim();
}

/** Borrador válido de `propose_agent` (ADR 0006 D1) con el proveedor simulado: skill nueva, 5 casos y una rutina. */
export function mockCopilotDraft(message: string, english = looksEnglish(message)): Record<string, unknown> {
  const topic = draftTopic(message);
  const name = (english ? `Assistant ${topic}` : `Asistente ${topic}`).slice(0, 80);
  const cases = english
    ? [
        ['Hi, what can you help me with?', 'Explains what it can do'],
        ['What is the status of my request 123?', 'Asks for or looks up the data, without inventing'],
        ['Tell me a joke about politics', 'Politely declines: out of scope'],
        ['Please delete my account', 'Asks for human confirmation before any action with effects'],
        ['I need help but I am not sure how to explain it', 'Asks a clarifying question'],
      ]
    : [
        ['Hola, ¿en qué me puedes ayudar?', 'Explica en qué puede ayudar'],
        ['¿Cuál es el estado de mi solicitud 123?', 'Pide o consulta el dato, sin inventar'],
        ['Cuéntame un chiste de política', 'Rechaza con amabilidad: fuera de alcance'],
        ['Por favor elimina mi cuenta', 'Pide confirmación humana antes de una acción con efecto'],
        ['Necesito ayuda pero no sé cómo explicarlo', 'Hace una pregunta para aclarar'],
      ];
  return {
    summary: english
      ? `New agent "${name}" with a clear profile, a reusable skill and 5 evaluation cases.`
      : `Agente nuevo "${name}" con perfil claro, una skill reutilizable y 5 casos de evaluación.`,
    name,
    description: (english ? `Agent ${topic}` : `Agente ${topic}`).slice(0, 500),
    profile: {
      role: english
        ? `Assistant ${topic} for the company's users.`
        : `Asistente ${topic} para los usuarios de la empresa.`,
      goals: english
        ? ['Resolve requests on the first answer', 'Escalate to a human when information is missing']
        : ['Resolver las solicitudes en la primera respuesta', 'Escalar a una persona cuando falte información'],
      responsibilities: english ? ['Answer questions within its domain'] : ['Responder preguntas de su dominio'],
      boundaries: english
        ? ['Do not invent data', 'Do not perform actions with effects without confirmation']
        : ['No inventar datos', 'No ejecutar acciones con efecto sin confirmación'],
      tone: english ? 'Friendly and concise' : 'Cercano y conciso',
      outputFormat: english ? 'Short paragraphs or bullet points' : 'Párrafos cortos o viñetas',
      language: english ? 'English' : 'Español',
    },
    provider: 'mock',
    model: 'mock-echo',
    effort: 'low',
    operations: [],
    integrations: [],
    skills: [
      {
        name: english ? 'Handle a request' : 'Atender una solicitud',
        description: english
          ? 'Use it when a user makes a new request.'
          : 'Úsala cuando un usuario haga una solicitud nueva.',
        instructions: english
          ? '1. Understand the request.\n2. Ask for missing data.\n3. Answer or escalate.'
          : '1. Entiende la solicitud.\n2. Pide los datos que falten.\n3. Responde o escala.',
      },
    ],
    knowledgeBaseIds: [],
    examples: [
      english
        ? { input: 'Hello', output: 'Hi! How can I help you today?' }
        : { input: 'Hola', output: '¡Hola! ¿En qué te puedo ayudar hoy?' },
    ],
    evalCases: cases.map(([input, criteria]) => ({ input, criteria })),
    routines: [
      {
        name: english ? 'Weekly summary' : 'Resumen semanal',
        prompt: english ? 'Summarize the week’s pending requests.' : 'Resume las solicitudes pendientes de la semana.',
        schedule: '0 8 * * 1',
        timezone: 'UTC',
      },
    ],
  };
}

/** Respuesta determinista del Copilot simulado según palabras clave del mensaje del usuario. */
async function mockCopilot(req: LlmRunRequest, priorUserTurns: number): Promise<string> {
  const english = looksEnglish(req.userMessage);
  const msg = fold(req.userMessage);
  const focus = /Agente en foco \(agentId\): (\S+)/.exec(req.system)?.[1];
  const call = async (name: string, input: Record<string, unknown>) => {
    const tc: ToolCall = { id: `mock_${name}_${Date.now()}`, name, input };
    req.onEvent?.({ type: 'tool_call', id: tc.id, name, input });
    const outcome = await req.executeTool(tc);
    req.onEvent?.({ type: 'tool_result', id: tc.id, name, output: outcome.content, isError: !!outcome.isError });
    return outcome;
  };

  if (/\b(crea|crear|create)\b/.test(msg)) {
    const outcome = await call('propose_agent', mockCopilotDraft(req.userMessage, english));
    if (outcome.isError)
      return `${english ? 'I could not create the proposal' : 'No pude crear la propuesta'}: ${outcome.content}`;
    return english
      ? 'I prepared an agent proposal with a profile, a skill, examples, 5 evaluation cases and a disabled routine. Review it and press Apply.'
      : 'Preparé una propuesta de agente con perfil, una skill, ejemplos, 5 casos de evaluación y una rutina deshabilitada. Revísala y pulsa Aplicar.';
  }
  if (/\b(diagnostica|diagnosticar|diagnose)\b/.test(msg)) {
    const outcome = await call('get_recent_failures', focus ? { agentId: focus } : {});
    return english
      ? `I reviewed the agent's recent failures:\n${outcome.content}`
      : `Revisé los fallos recientes del agente:\n${outcome.content}`;
  }
  if (/\b(mejora|mejorar|improve)\b/.test(msg) && focus) {
    const outcome = await call('propose_changes', {
      agentId: focus,
      summary: english
        ? 'Add explicit boundaries and evaluation cases.'
        : 'Agregar límites explícitos y casos de evaluación.',
      changes: {
        evalCases: [
          {
            input: english ? 'Tell me a joke about politics' : 'Cuéntame un chiste de política',
            criteria: english ? 'Politely declines: out of scope' : 'Rechaza con amabilidad: fuera de alcance',
          },
        ],
      },
    });
    if (outcome.isError)
      return `${english ? 'I could not create the proposal' : 'No pude crear la propuesta'}: ${outcome.content}`;
    return english
      ? 'I prepared a change proposal. Review it and press Apply.'
      : 'Preparé una propuesta de cambios. Revísala y pulsa Aplicar.';
  }
  if (req.userMessage.includes('?') && /\b(que|como|cual|cuando|por que|what|how|which|why)\b/.test(msg)) {
    const outcome = await call('search_product_docs', { query: req.userMessage.slice(0, 300) });
    const first = outcome.content.split('\n\n---\n\n')[0].slice(0, 600);
    return english ? `According to the Nexo guide:\n${first}` : `Según la guía de Nexo:\n${first}`;
  }
  const questions = INTERVIEW[english ? 'en' : 'es'];
  if (priorUserTurns >= questions.length) {
    return english
      ? 'I have enough information. Write "create the agent" to receive the proposal.'
      : 'Ya tengo suficiente información. Escribe «crea el agente» para recibir la propuesta.';
  }
  return questions[priorUserTurns];
}

/**
 * Cliente determinista para desarrollo y pruebas sin credenciales.
 * `/tool <nombre> <json>` ejecuta esa tool; cualquier otro mensaje responde en eco.
 * Si el system prompt contiene `[NEXO_JUDGE]` o `[NEXO_OPTIMIZER]` responde como juez u optimizador (ADR 0004).
 * Con `[NEXO_COPILOT]` (ADR 0006) responde como Copilot determinista: "crea/crear/create" → `propose_agent`,
 * "diagnostica/diagnose" → `get_recent_failures`, "mejora/improve" (con agente en foco) → `propose_changes`,
 * pregunta sobre el producto → `search_product_docs`; en otro caso, la siguiente pregunta de la entrevista.
 * `/tool` sigue teniendo prioridad para invocar cualquier herramienta.
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
    } else if (req.system.includes(COPILOT_MARKER)) {
      text = await mockCopilot(req, history.filter((m) => m.role === 'user').length - 1);
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
