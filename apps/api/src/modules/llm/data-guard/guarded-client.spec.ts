import { createHash } from 'node:crypto';
import type { AgentEvent, LlmClient, LlmRunRequest, LlmRunResult, ToolCall } from '../llm-provider';
import { DataBlockedException, guardClient } from './guarded-client';
import { MaskSession, StreamUnmasker, type DataGuardMode } from './mask-session';

const MARKER = /\[(CORREO|TELEFONO|DOCUMENTO|TARJETA|CUENTA)_[0-9a-f]{8}\]/g;
const key = (scope: string) => createHash('sha256').update(`prueba|${scope}`).digest();

interface Sent {
  system: string;
  history: unknown[];
  userMessage: string;
  tools: LlmRunRequest['tools'];
  toolResults: string[];
}

/**
 * Proveedor falso con formato de historial tipo Anthropic: pide una herramienta con el primer marcador que recibió,
 * recibe su resultado y responde citando el marcador (en fragmentos, como el streaming real) con un bloque de thinking.
 */
class FakeProvider implements LlmClient {
  readonly sent: Sent[] = [];
  /** Historial (en la forma que vio el proveedor) que devolvió la última ejecución. */
  produced: unknown[] = [];
  toolOutput = 'sin datos';

  async test() {
    return { ok: true, message: 'ok' };
  }

  async run(req: LlmRunRequest): Promise<LlmRunResult> {
    const record: Sent = {
      system: req.system,
      history: JSON.parse(JSON.stringify(req.history)) as unknown[],
      userMessage: req.userMessage,
      tools: req.tools,
      toolResults: [],
    };
    this.sent.push(record);
    const history: unknown[] = [...req.history, { role: 'user', content: req.userMessage }];
    const marker = req.userMessage.match(MARKER)?.[0] ?? 'ninguno';
    const call: ToolCall = { id: 'toolu_1', name: 'crm__buscar', input: { documento: marker, filtros: [marker] } };
    req.onEvent?.({ type: 'tool_call', ...call });
    const outcome = await req.executeTool(call);
    record.toolResults.push(outcome.content);
    req.onEvent?.({ type: 'tool_result', id: call.id, name: call.name, output: outcome.content, isError: false });
    history.push({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: `El usuario dio ${marker}`, signature: 'firma-opaca' },
        { type: 'tool_use', id: call.id, name: call.name, input: call.input },
      ],
    });
    history.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: outcome.content }] });
    const answer = `Listo, registré ${marker} correctamente.`;
    const cut = answer.indexOf('[') + 4;
    req.onEvent?.({ type: 'text', text: answer.slice(0, cut) });
    req.onEvent?.({ type: 'text', text: answer.slice(cut) });
    history.push({ role: 'assistant', content: [{ type: 'text', text: answer }] });
    this.produced = JSON.parse(JSON.stringify(history)) as unknown[];
    return { history, text: answer, stopReason: 'end_turn', turns: 2, usage: { inputTokens: 1, outputTokens: 1 } };
  }
}

function setup(mode: DataGuardMode, secrets: string[] = []) {
  const provider = new FakeProvider();
  const client = guardClient(provider, async (scope) => new MaskSession(key(scope ?? 'sin-ambito'), mode, secrets));
  const events: AgentEvent[] = [];
  const executed: ToolCall[] = [];
  const run = (userMessage: string, history: unknown[] = [], scope = 'conversation:c1', system = 'Eres un asistente') =>
    client.run({
      model: 'm',
      system,
      effort: 'low',
      history,
      userMessage,
      tools: [{ name: 'crm__buscar', description: 'Busca clientes', inputSchema: {} }],
      maxTurns: 3,
      privacyScope: scope,
      onEvent: (e) => events.push(e),
      executeTool: async (c) => {
        executed.push(c);
        return { content: provider.toolOutput };
      },
    });
  return { provider, run, events, executed };
}

const text = (events: AgentEvent[]) =>
  events
    .filter((e): e is Extract<AgentEvent, { type: 'text' }> => e.type === 'text')
    .map((e) => e.text)
    .join('');

describe('DataGuard · cliente protegido (modo mask)', () => {
  const message = 'Registre a Ana, cédula 1020304050, correo ana.perez@cliente.co y celular 3105556677';

  it('el proveedor solo recibe marcadores; la herramienta y el usuario reciben los valores restituidos', async () => {
    const { provider, run, events, executed } = setup('mask');
    provider.toolOutput = JSON.stringify({
      ok: true,
      data: { email: 'ana.perez@cliente.co', tel: '+57 310 555 6677' },
    });
    const result = await run(message);

    const sent = JSON.stringify(provider.sent);
    for (const v of ['1020304050', 'ana.perez@cliente.co', '3105556677', '310 555 6677']) expect(sent).not.toContain(v);
    expect(provider.sent[0].userMessage).toMatch(/cédula \[DOCUMENTO_[0-9a-f]{8}\], correo \[CORREO_[0-9a-f]{8}\]/);
    // El resultado de la herramienta vuelve al modelo enmascarado con el mismo marcador del correo.
    const emailMarker = provider.sent[0].userMessage.match(/\[CORREO_[0-9a-f]{8}\]/)![0];
    expect(provider.sent[0].toolResults[0]).toContain(emailMarker);

    // La herramienta se ejecuta con el valor real (a cualquier profundidad de la entrada).
    expect(executed[0].input).toEqual({ documento: '1020304050', filtros: ['1020304050'] });
    // Eventos y respuesta al usuario restituidos, también con el marcador partido entre fragmentos de texto.
    expect(text(events)).toBe('Listo, registré 1020304050 correctamente.');
    expect(result.text).toBe('Listo, registré 1020304050 correctamente.');
    const call = events.find((e) => e.type === 'tool_call') as Extract<AgentEvent, { type: 'tool_call' }>;
    expect(call.input).toEqual({ documento: '1020304050', filtros: ['1020304050'] });
    const notice = events.find((e) => e.type === 'notice') as Extract<AgentEvent, { type: 'notice' }>;
    expect(notice.message).toMatch(
      /se enmascararon 3 datos personales \(documento de identidad, correo electrónico y teléfono\)/,
    );
    expect(notice.message).not.toMatch(/ana|1020304050/);

    // Historial para guardar: formato nativo con los valores restituidos y el thinking intacto (firma incluida).
    const stored = JSON.stringify(result.history);
    expect(stored).toContain('ana.perez@cliente.co');
    expect(stored).not.toMatch(/\[(CORREO|TELEFONO)_/);
    expect(result.history[1]).toMatchObject({
      content: [{}, { type: 'tool_use', input: { documento: '1020304050' } }],
    });
    const thinking = (result.history[1] as { content: { type: string; thinking?: string; signature?: string }[] })
      .content[0];
    expect(thinking).toMatchObject({ type: 'thinking', signature: 'firma-opaca' });
    expect(thinking.thinking).toMatch(/\[DOCUMENTO_[0-9a-f]{8}\]/);
  });

  it('el historial se enmascara de forma determinista entre turnos (no rompe la caché de prompts)', async () => {
    const first = setup('mask');
    const r1 = await first.run(message);
    const second = setup('mask');
    await second.run('¿Y su correo sigue siendo el mismo?', r1.history);

    // Lo que el proveedor recibe como historial en el turno 2 es idéntico a lo que vio y generó en el turno 1,
    // aunque lo guardado tenga los valores reales (incluida la entrada de la herramienta, sin la palabra "cédula").
    expect(JSON.stringify(r1.history)).toContain('"documento":"1020304050"');
    expect(second.provider.sent[0].history).toEqual(first.provider.produced);
    // Mismo turno repetido → mismos bytes.
    const third = setup('mask');
    await third.run('¿Y su correo sigue siendo el mismo?', r1.history);
    expect(JSON.stringify(third.provider.sent[0])).toBe(JSON.stringify(second.provider.sent[0]));
  });

  it('otra conversación usa otros marcadores para el mismo dato', async () => {
    const a = setup('mask');
    await a.run(message, [], 'conversation:A');
    const b = setup('mask');
    await b.run(message, [], 'conversation:B');
    expect(a.provider.sent[0].userMessage).not.toBe(b.provider.sent[0].userMessage);
  });
});

describe('DataGuard · modos block y off', () => {
  it('block: el mensaje con datos personales se rechaza sin llamar al proveedor', async () => {
    const { provider, run } = setup('block');
    const err = await run('Mi correo es ana@cliente.co').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataBlockedException);
    expect((err as Error).message).toMatch(/datos personales \(correo electrónico\)/);
    expect((err as Error).message).not.toContain('ana@cliente.co');
    expect(provider.sent).toHaveLength(0);
  });

  it('block: un resultado de herramienta con datos personales no llega al modelo', async () => {
    const { provider, run } = setup('block');
    provider.toolOutput = 'Cliente: tel 3105556677';
    await run('Busque el cliente 42');
    expect(provider.sent[0].toolResults[0]).toMatch(/^BLOQUEADO POR PROTECCIÓN DE DATOS/);
    expect(JSON.stringify(provider.sent)).not.toContain('3105556677');
  });

  it('off: los datos personales pasan, pero las credenciales se ocultan siempre', async () => {
    const { provider, run } = setup('off');
    await run('Correo ana@cliente.co, password: Hunter2!');
    expect(provider.sent[0].userMessage).toBe('Correo ana@cliente.co, password: [CREDENCIAL_OCULTA]');
  });
});

describe('DataGuard · las credenciales de la bóveda nunca llegan al LLM', () => {
  const secret = 'crm-api-token-9f8e7d6c5b';

  it.each<DataGuardMode>(['off', 'mask', 'block'])(
    'modo %s: ni en system, mensaje, herramientas ni historial',
    async (mode) => {
      const { provider, run } = setup(mode, [secret]);
      provider.toolOutput = JSON.stringify({
        headers: { authorization: secret },
        b64: Buffer.from(secret).toString('base64'),
      });
      const history = [
        { role: 'user', content: `token viejo ${secret}` },
        { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      ];
      const result = await run(`Use ${secret} para consultar`, history, 'conversation:v', `Clave del CRM: ${secret}`);

      const sent = JSON.stringify(provider.sent);
      expect(sent).not.toContain(secret);
      expect(sent).not.toContain(Buffer.from(secret).toString('base64'));
      expect(sent).toContain('[CREDENCIAL_OCULTA]');
      // Lo nuevo que se guarda tampoco contiene la credencial (el marcador de credencial es irreversible).
      expect(JSON.stringify(result.history.slice(history.length))).not.toContain(secret);
    },
  );
});

describe('DataGuard · desenmascarado en streaming', () => {
  it('retiene un marcador partido y deja pasar corchetes normales', () => {
    const s = new MaskSession(key('x'), 'mask');
    const masked = s.maskText('correo ana@x.co');
    const marker = masked.slice('correo '.length);
    const out: string[] = [];
    const u = new StreamUnmasker(
      (t) => s.unmaskText(t),
      (t) => out.push(t),
    );
    u.push('Hola [nota] ');
    u.push(`es ${marker.slice(0, 5)}`);
    u.push(`${marker.slice(5)} fin [`);
    u.flush();
    expect(out.join('')).toBe('Hola [nota] es ana@x.co fin [');
  });
});
