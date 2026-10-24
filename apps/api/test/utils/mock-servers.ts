import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  body: any;
}

export interface Reply {
  status: number;
  body: unknown;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

abstract class MockServer {
  protected server?: Server;
  port = 0;
  readonly requests: RecordedRequest[] = [];

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      void (async () => {
        const raw = await readBody(req);
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        let body: unknown = raw;
        try {
          body = raw ? JSON.parse(raw) : undefined;
        } catch {
          // cuerpo no JSON
        }
        const recorded: RecordedRequest = {
          method: req.method ?? 'GET',
          path: url.pathname,
          query: url.searchParams,
          headers: req.headers,
          body,
        };
        this.requests.push(recorded);
        const reply = this.handle(recorded);
        send(res, reply.status, reply.body);
      })().catch((err: Error) => send(res, 500, { error: { message: err.message } }));
    });
    const server = this.server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    this.port = (server.address() as AddressInfo).port;
    return this;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }

  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  protected abstract handle(req: RecordedRequest): Reply;
}

// ---------------------------------------------------------------------------------------------------------------
// Chat Completions (OpenAI-compatible)
// ---------------------------------------------------------------------------------------------------------------

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens?: number;
}

export function textReply(content: string, usage: ChatUsage = { prompt_tokens: 100, completion_tokens: 20 }) {
  return {
    id: 'chatcmpl-e2e',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: wireUsage(usage),
  };
}

export function toolCallReply(
  calls: { id: string; name: string; args: Record<string, unknown> }[],
  usage: ChatUsage = { prompt_tokens: 100, completion_tokens: 20 },
) {
  return {
    id: 'chatcmpl-e2e-tools',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.args) },
          })),
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: wireUsage(usage),
  };
}

function wireUsage(u: ChatUsage) {
  return {
    prompt_tokens: u.prompt_tokens,
    completion_tokens: u.completion_tokens,
    total_tokens: u.prompt_tokens + u.completion_tokens,
    ...(u.cached_tokens !== undefined ? { prompt_tokens_details: { cached_tokens: u.cached_tokens } } : {}),
  };
}

export const DEFAULT_REPLY_USAGE: ChatUsage = { prompt_tokens: 100, completion_tokens: 20 };

/**
 * Servidor Chat Completions. Cada prueba usa su propio "canal" (`baseUrl(canal)`), con su cola de respuestas
 * guionizadas; sin guion responde texto con DEFAULT_REPLY_USAGE. Exige `Authorization: Bearer <apiKey>`.
 */
export class OpenAiMock extends MockServer {
  readonly apiKey = 'sk-e2e-no-revelar-0123456789';
  private readonly scripts = new Map<string, unknown[]>();

  baseUrl(channel: string): string {
    return `${this.origin}/${channel}/v1`;
  }

  enqueue(channel: string, ...replies: unknown[]): void {
    this.scripts.set(channel, [...(this.scripts.get(channel) ?? []), ...replies]);
  }

  chatRequests(channel: string): RecordedRequest[] {
    return this.requests.filter((r) => r.path === `/${channel}/v1/chat/completions`);
  }

  protected handle(req: RecordedRequest): Reply {
    const match = /^\/([^/]+)\/v1\/(models|chat\/completions)$/.exec(req.path);
    if (!match) return { status: 404, body: { error: { message: 'Ruta no encontrada' } } };
    if (req.headers.authorization !== `Bearer ${this.apiKey}`) {
      return { status: 401, body: { error: { message: 'Incorrect API key provided' } } };
    }
    const [, channel, route] = match;
    if (route === 'models') {
      return { status: 200, body: { object: 'list', data: [{ id: 'eco-mini' }, { id: 'gpt-e2e' }] } };
    }
    if (req.method !== 'POST') return { status: 405, body: { error: { message: 'Método no permitido' } } };
    const queue = this.scripts.get(channel) ?? [];
    const next = queue.shift();
    return { status: 200, body: next ?? textReply('Respuesta simulada', DEFAULT_REPLY_USAGE) };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// REST simple con /openapi.json
// ---------------------------------------------------------------------------------------------------------------

export const WEATHER_OPENAPI = {
  openapi: '3.0.0',
  info: { title: 'Clima E2E', version: '1.0.0' },
  paths: {
    '/weather': {
      get: {
        operationId: 'getWeather',
        summary: 'Clima por ciudad',
        parameters: [{ name: 'city', in: 'query', required: true, schema: { type: 'string' } }],
      },
    },
  },
};

export class RestMock extends MockServer {
  protected handle(req: RecordedRequest): Reply {
    if (req.path === '/openapi.json') return { status: 200, body: WEATHER_OPENAPI };
    if (req.path === '/weather') return { status: 200, body: { city: req.query.get('city'), tempC: 21 } };
    if (req.path === '/') return { status: 200, body: { ok: true } };
    return { status: 404, body: { message: 'No encontrado' } };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Messages API de Claude (con streaming SSE): imita la API de Anthropic y sus canales (Foundry, Google Cloud, Vertex)
// ---------------------------------------------------------------------------------------------------------------

/** Servidor que imita la Messages API de Claude bajo cualquier prefijo (`…/v1/messages`, `count_tokens`, `models`). */
export class ClaudeMessagesMock {
  private server?: Server;
  port = 0;
  readonly requests: RecordedRequest[] = [];
  /** Decide si la credencial es válida (por defecto, cualquier credencial presente). */
  authorize: (headers: IncomingMessage['headers']) => boolean = (h) =>
    !!(h['x-api-key'] || h['api-key'] || h.authorization);
  reply = 'Hola desde Claude simulado';
  /**
   * Endpoint de Workload Identity Federation (`POST …/v1/oauth/token`, RFC 7523): si se define, responde lo que
   * devuelva (p. ej. `AnthropicWifVerifier.exchange`). Sin definir, la ruta responde 404.
   */
  oauthToken?: (body: Record<string, unknown> | undefined, headers: IncomingMessage['headers']) => Reply;
  /** Lista de modelos de `GET …/v1/models`. */
  models = ['claude-opus-5-5'];

  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  tokenRequests(): RecordedRequest[] {
    return this.requests.filter((r) => r.path.endsWith('/v1/oauth/token'));
  }

  messageRequests(): RecordedRequest[] {
    return this.requests.filter((r) => /\/v1\/messages$|:streamRawPredict$/.test(r.path));
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      void (async () => {
        const raw = await readBody(req);
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
        this.requests.push({
          method: req.method ?? 'GET',
          path: url.pathname,
          query: url.searchParams,
          headers: req.headers,
          body,
        });
        if (url.pathname.endsWith('/v1/oauth/token') && req.method === 'POST') {
          const reply = this.oauthToken?.(body, req.headers) ?? { status: 404, body: { error: 'not_found' } };
          send(res, reply.status, reply.body);
          return;
        }
        if (!this.authorize(req.headers)) {
          send(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid credentials' } });
          return;
        }
        if (url.pathname.endsWith('/v1/models')) {
          send(res, 200, {
            data: this.models.map((id) => ({
              type: 'model',
              id,
              display_name: id,
              created_at: '2026-09-01T00:00:00Z',
            })),
            has_more: false,
            first_id: this.models[0] ?? null,
            last_id: this.models.at(-1) ?? null,
          });
          return;
        }
        // Vertex AI: …/publishers/anthropic/models/<modelo>:streamRawPredict (y count-tokens:rawPredict).
        const vertex = /\/publishers\/anthropic\/models\/([^/:]+):(stream)?[rR]awPredict$/.exec(url.pathname);
        if (url.pathname.endsWith('/v1/messages/count_tokens') || vertex?.[1] === 'count-tokens') {
          send(res, 200, { input_tokens: 3 });
          return;
        }
        if (!url.pathname.endsWith('/v1/messages') && !vertex) {
          send(res, 404, { type: 'error', error: { type: 'not_found_error', message: 'not found' } });
          return;
        }
        const model = vertex?.[1] ?? (typeof body?.model === 'string' ? body.model : 'claude-opus-5-5');
        const message = {
          id: 'msg_e2e',
          type: 'message',
          role: 'assistant',
          model,
          content: [] as unknown[],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 12, output_tokens: 1 },
        };
        const events: [string, unknown][] = [
          ['message_start', { type: 'message_start', message }],
          ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
          [
            'content_block_delta',
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: this.reply } },
          ],
          ['content_block_stop', { type: 'content_block_stop', index: 0 }],
          [
            'message_delta',
            {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { output_tokens: 6 },
            },
          ],
          ['message_stop', { type: 'message_stop' }],
        ];
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        res.end();
      })().catch((err: Error) => send(res, 500, { type: 'error', error: { type: 'api_error', message: err.message } }));
    });
    const server = this.server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    this.port = (server.address() as AddressInfo).port;
    return this;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// AWS STS (AssumeRole, protocolo Query con respuestas XML)
// ---------------------------------------------------------------------------------------------------------------

/**
 * STS simulado: `AssumeRole` solo si el rol existe en `roles` y el `ExternalId` coincide con su política de confianza
 * (`sts:ExternalId`); exige una firma SigV4 de la plataforma. Devuelve credenciales temporales numeradas.
 */
export class StsMock {
  private server?: Server;
  port = 0;
  readonly requests: { headers: IncomingMessage['headers']; params: URLSearchParams }[] = [];
  /** ARN del rol → ExternalId que exige su política de confianza. */
  readonly roles = new Map<string, string>();
  /** Vida de las credenciales emitidas (ms). */
  lifetimeMs = 3600_000;
  issued = 0;

  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  assumeRoleRequests() {
    return this.requests.filter((r) => r.params.get('Action') === 'AssumeRole');
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      void (async () => {
        const params = new URLSearchParams(await readBody(req));
        this.requests.push({ headers: req.headers, params });
        const xml = (status: number, body: string) => {
          res.writeHead(status, { 'content-type': 'text/xml' });
          res.end(body);
        };
        const error = (status: number, code: string, message: string) =>
          xml(
            status,
            '<ErrorResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><Error><Type>Sender</Type>' +
              `<Code>${code}</Code><Message>${message}</Message></Error><RequestId>e2e</RequestId></ErrorResponse>`,
          );
        if (!/^AWS4-HMAC-SHA256 Credential=/.test(String(req.headers.authorization ?? ''))) {
          return error(403, 'MissingAuthenticationToken', 'Request is missing Authentication Token');
        }
        if (params.get('Action') !== 'AssumeRole') return error(400, 'InvalidAction', 'unsupported');
        const roleArn = params.get('RoleArn') ?? '';
        const expected = this.roles.get(roleArn);
        if (!expected || params.get('ExternalId') !== expected) {
          return error(403, 'AccessDenied', `not authorized to perform: sts:AssumeRole on resource: ${roleArn}`);
        }
        const n = ++this.issued;
        const session = params.get('RoleSessionName') ?? 'nexo';
        xml(
          200,
          '<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleResult><Credentials>' +
            `<AccessKeyId>ASIAE2E${n}</AccessKeyId><SecretAccessKey>secreto-temporal-${n}</SecretAccessKey>` +
            `<SessionToken>sesion-temporal-${n}</SessionToken>` +
            `<Expiration>${new Date(Date.now() + this.lifetimeMs).toISOString()}</Expiration></Credentials>` +
            `<AssumedRoleUser><AssumedRoleId>AROAE2E:${session}</AssumedRoleId>` +
            `<Arn>${roleArn.replace(':iam::', ':sts::').replace(':role/', ':assumed-role/')}/${session}</Arn>` +
            '</AssumedRoleUser></AssumeRoleResult><ResponseMetadata><RequestId>e2e</RequestId></ResponseMetadata>' +
            '</AssumeRoleResponse>',
        );
      })().catch(() => {
        res.writeHead(500);
        res.end();
      });
    });
    const server = this.server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    this.port = (server.address() as AddressInfo).port;
    return this;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }
}
