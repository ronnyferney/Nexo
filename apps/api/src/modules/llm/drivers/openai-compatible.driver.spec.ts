import type { HttpClientService, HttpRequest, HttpResponse } from '../../../common/http/http-client.service';
import { LlmHttpError, type LlmCredentials } from '../llm-provider';
import { OpenAiCompatibleDriver, parseModelIds, providerErrorMessage } from './openai-compatible.driver';

/** Cliente HTTP falso: registra las peticiones y responde en orden. */
class FakeHttp {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly replies: { status: number; body: unknown }[]) {}
  request(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    const r = this.replies.shift() ?? { status: 200, body: {} };
    return Promise.resolve({
      status: r.status,
      ok: r.status < 400,
      headers: { 'content-type': 'application/json' },
      body: r.body,
      rawBody: JSON.stringify(r.body),
      durationMs: 1,
    });
  }
}

const client = (http: FakeHttp, creds: LlmCredentials) =>
  new OpenAiCompatibleDriver(http as unknown as HttpClientService).create({ baseUrl: 'https://llm.test/v1', ...creds });

const chatReply = (message: Record<string, unknown>, finish = 'stop') => ({
  status: 200,
  body: { choices: [{ message, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 2 } },
});

const run = (c: ReturnType<typeof client>, history: unknown[] = []) =>
  c.run({
    model: 'm',
    system: 'sys',
    effort: 'medium',
    history,
    userMessage: 'hola',
    tools: [],
    maxTurns: 3,
    executeTool: () => Promise.resolve({ content: 'ok' }),
  });

describe('OpenAiCompatibleDriver', () => {
  it('cabecera api-key (Azure) sin Authorization, más cabeceras fijas de la conexión', async () => {
    const http = new FakeHttp([{ status: 200, body: { data: [{ id: 'gpt' }] } }]);
    await client(http, { apiKey: 'k1', authHeader: 'api-key', headers: { 'X-Extra': 'v' } }).verify!();
    expect(http.requests[0].url).toBe('https://llm.test/v1/models');
    expect(http.requests[0].headers).toMatchObject({ 'api-key': 'k1', 'X-Extra': 'v' });
    expect(http.requests[0].headers).not.toHaveProperty('authorization');
  });

  it('Bearer sin api-key; sin clave en modo none; ambos en conexiones heredadas', async () => {
    const http = new FakeHttp([]);
    await client(http, { apiKey: 'k2', authHeader: 'bearer' }).verify!();
    expect(http.requests[0].headers).toMatchObject({ authorization: 'Bearer k2' });
    expect(http.requests[0].headers).not.toHaveProperty('api-key');
    await client(http, { apiKey: 'k3', authHeader: 'none' }).verify!();
    expect(http.requests[1].headers).not.toHaveProperty('authorization');
    await client(http, { apiKey: 'k4' }).verify!();
    expect(http.requests[2].headers).toMatchObject({ authorization: 'Bearer k4', 'api-key': 'k4' });
  });

  it('verify usa verifyPath y lanza LlmHttpError con el mensaje del proveedor', async () => {
    const http = new FakeHttp([{ status: 401, body: { error: { message: 'No auth credentials found' } } }]);
    const err = await client(http, { apiKey: 'x', verifyPath: '/key' }).verify!().catch((e: unknown) => e);
    expect(http.requests[0].url).toBe('https://llm.test/v1/key');
    expect(err).toBeInstanceOf(LlmHttpError);
    expect(err).toMatchObject({ status: 401, message: 'No auth credentials found' });
  });

  it('el historial guarda el mensaje completo y reenvía reasoning_content solo si la conexión lo pide', async () => {
    const assistant = { role: 'assistant', content: 'r1', reasoning_content: 'pensé', refusal: null };
    const plain = new FakeHttp([chatReply(assistant), chatReply({ role: 'assistant', content: 'r2' })]);
    const first = await run(client(plain, { apiKey: 'k' }));
    // Append-only nativo: el mensaje del proveedor se guarda tal cual.
    expect(first.history[1]).toEqual(assistant);
    await run(client(plain, { apiKey: 'k' }), first.history);
    const sent = JSON.parse(plain.requests[1].body!) as { messages: Record<string, unknown>[] };
    expect(sent.messages[2]).toEqual({ role: 'assistant', content: 'r1' });

    const kimi = new FakeHttp([chatReply({ role: 'assistant', content: 'r2' })]);
    await run(client(kimi, { apiKey: 'k', replayReasoning: true }), first.history);
    const replayed = JSON.parse(kimi.requests[0].body!) as { messages: Record<string, unknown>[] };
    expect(replayed.messages[2]).toEqual({ role: 'assistant', content: 'r1', reasoning_content: 'pensé' });
  });

  it('parseModelIds y providerErrorMessage toleran los formatos de Gemini', () => {
    expect(parseModelIds({ data: [{ id: 'models/gemini-x' }, { id: 'b' }, { id: 'b' }, {}] })).toEqual([
      'b',
      'gemini-x',
    ]);
    expect(parseModelIds(null)).toEqual([]);
    expect(providerErrorMessage([{ error: { message: 'Please pass a valid API key' } }], '')).toBe(
      'Please pass a valid API key',
    );
    expect(providerErrorMessage('texto', 'texto plano')).toBe('texto plano');
  });
});

describe('OpenAiCompatibleDriver con token OAuth renovable', () => {
  it('pide el token en cada llamada (renovación entre turnos) y lo envía como Bearer', async () => {
    const http = new FakeHttp([
      { status: 200, body: { data: [{ id: 'm' }] } },
      chatReply({ role: 'assistant', content: 'hola' }),
    ]);
    const tokens = ['ya29.uno', 'ya29.dos'];
    const getAccessToken = jest.fn(() => Promise.resolve(tokens.shift()!));
    const c = client(http, { apiKey: 'no-usar', getAccessToken, authHeader: 'bearer' });
    await c.verify!();
    await run(c);
    expect(getAccessToken).toHaveBeenCalledTimes(2);
    expect(http.requests.map((r) => r.headers?.authorization)).toEqual(['Bearer ya29.uno', 'Bearer ya29.dos']);
    expect(http.requests.every((r) => r.headers?.['api-key'] === undefined)).toBe(true);
  });
});
