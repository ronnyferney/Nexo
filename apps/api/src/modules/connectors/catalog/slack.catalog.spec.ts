import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpClientService } from '../../../common/http/http-client.service';
import { render } from '../../../common/template/template.engine';
import { OAUTH_PROVIDERS } from '../../oauth/oauth.providers';
import { RestAdapter } from '../adapters/rest.adapter';
import type { ConnectorRuntime } from '../domain/connector.types';
import { findCatalogEntry } from './catalog.index';
import { WRITE_NOTICE, type CatalogEntry, type CatalogOperation } from './catalog.types';
import { SLACK_BOT_SCOPES } from './integrations/slack';

const ajv = addFormats(new Ajv({ strict: true, strictRequired: false, allowUnionTypes: true, allErrors: true }));

const entry = (): CatalogEntry => findCatalogEntry('slack')!;
const op = (key: string): CatalogOperation => entry().operations.find((o) => o.key === key)!;
const validator = (key: string) => ajv.compile(op(key).inputSchema);

interface Def {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  bodyType?: string;
  successPath?: string;
}
const renderDef = (key: string, input: Record<string, unknown>) => render<Def>(op(key).definition, { input });
/** Lo que realmente viaja: JSON.stringify descarta las claves con valor ausente. */
const wire = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

const C = 'C0123ABCD';
const TS = '1712345678.123456';

describe('Slack (catálogo)', () => {
  it('mantiene post_message intacta (mismas claves, esquema y definición) y como primera operación', () => {
    expect(entry().operations[0]).toEqual({
      key: 'post_message',
      name: 'Publicar mensaje en canal',
      description:
        `Publica un mensaje en un canal de Slack (o responde en un hilo) ${WRITE_NOTICE}. Úsala para notificar al ` +
        'equipo (p. ej. lead caliente, negocio creado).',
      write: true,
      inputSchema: {
        type: 'object',
        required: ['channel', 'text'],
        properties: {
          channel: { type: 'string', description: 'Id del canal (C0123...) o nombre (#ventas)' },
          text: { type: 'string', minLength: 1, description: 'Texto del mensaje (admite formato mrkdwn de Slack)' },
          thread_ts: { type: 'string', description: 'ts del mensaje padre para responder en hilo (opcional)' },
        },
      },
      definition: {
        method: 'POST',
        path: '/chat.postMessage',
        successPath: 'ok',
        body: { channel: '{{ input.channel }}', text: '{{ input.text }}', thread_ts: '{{ input.thread_ts }}' },
      },
      verified: true,
      docsUrl: 'https://docs.slack.dev/reference/methods/chat.postMessage/',
    });
  });

  it('expone las operaciones de la Web API, todas con successPath "ok" (Slack responde 200 con ok:false)', () => {
    expect(entry().operations.map((o) => o.key)).toEqual([
      'post_message',
      'reply_in_thread',
      'post_blocks_message',
      'update_message',
      'schedule_message',
      'add_reaction',
      'open_direct_message',
      'join_channel',
      'list_channels',
      'get_channel_history',
      'get_thread_replies',
      'lookup_user_by_email',
      'get_user_info',
    ]);
    for (const o of entry().operations) {
      expect(o.definition.successPath).toBe('ok');
      expect(o.docsUrl).toMatch(/^https:\/\/docs\.slack\.dev\/reference\/methods\//);
      expect(o.verified).toBe(true);
    }
    const reads = [
      'list_channels',
      'get_channel_history',
      'get_thread_replies',
      'lookup_user_by_email',
      'get_user_info',
    ];
    for (const o of entry().operations) {
      expect(o.write).toBe(!reads.includes(o.key));
      // Las lecturas van por GET con query string; nunca con cuerpo.
      if (reads.includes(o.key)) expect(o.definition).toMatchObject({ method: 'GET' });
      if (reads.includes(o.key)) expect(o.definition.body).toBeUndefined();
    }
  });

  it('conserva el token de bot como método predeterminado y agrega "Agregar a Slack" (OAuth v2)', () => {
    const e = entry();
    expect(Object.keys(e.auth)).toEqual(['bearer', 'oauth2_code']);
    expect(e.auth.bearer).toEqual({ type: 'bearer', token: '{{ secrets.SLACK_BOT_TOKEN }}' });
    const oauth = e.auth.oauth2_code;
    expect(oauth).toMatchObject({
      type: 'oauth2_code',
      provider: 'slack',
      authorizeUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      scopeSeparator: ',',
      pkce: false,
      accountLabel: { tokenField: 'team.name' },
    });
    expect(OAUTH_PROVIDERS.slack).toMatchObject({
      authorizeUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
    });
    expect(oauth?.type === 'oauth2_code' && oauth.scopes).toEqual(SLACK_BOT_SCOPES);
    expect(SLACK_BOT_SCOPES).toEqual([
      'chat:write',
      'channels:read',
      'groups:read',
      'im:read',
      'channels:history',
      'groups:history',
      'im:history',
      'reactions:write',
      'users:read',
      'users:read.email',
      'im:write',
      'channels:join',
    ]);
  });

  it('el token de bot solo se pide con bearer y su ayuda documenta todos los scopes', () => {
    const fields = Object.fromEntries(entry().credentialFields.map((f) => [f.key, f]));
    expect(fields.botToken).toMatchObject({ required: true, secret: true, authMethods: ['bearer'] });
    expect(fields.clientId).toMatchObject({ required: false, authMethods: ['oauth2_code'] });
    expect(fields.clientSecret).toMatchObject({ required: false, secret: true, authMethods: ['oauth2_code'] });
    for (const scope of SLACK_BOT_SCOPES) {
      expect(fields.botToken.help).toContain(scope);
      expect(fields.clientId.help).toContain(scope);
    }
    const token = new RegExp(fields.botToken.pattern!);
    expect(token.test('xoxb-123-456-abc')).toBe(true);
    expect(token.test('xoxe.xoxb-1-abc')).toBe(true);
    expect(token.test('xoxb-1\r\nX: y')).toBe(false);
    expect(token.test('firma-secreta')).toBe(false);
    const id = new RegExp(fields.clientId.pattern!);
    expect(id.test('1234567890.1234567890123')).toBe(true);
    expect(id.test('https://evil.example')).toBe(false);
  });

  describe('validación de entradas', () => {
    it('rechaza ids, ts y emojis con saltos de línea, rutas o caracteres extraños', () => {
      const validate = validator('add_reaction');
      expect(validate({ channel: C, timestamp: TS, name: 'thumbsup' })).toBe(true);
      expect(validate({ channel: C, timestamp: TS, name: '+1' })).toBe(true);
      expect(validate({ channel: C, timestamp: TS, name: 'wave::skin-tone-3' })).toBe(true);
      for (const name of [':thumbsup:', 'a b', 'x\ny', 'Pulgar', '']) {
        expect(validate({ channel: C, timestamp: TS, name })).toBe(false);
      }
      for (const channel of ['#ventas', 'c0123', 'C01\r\n', '../x', 'U0123ABC']) {
        expect(validate({ channel, timestamp: TS, name: 'eyes' })).toBe(false);
      }
      for (const timestamp of ['1712345678', 'abc', '1712345678.1\n', '1.2']) {
        expect(validate({ channel: C, timestamp, name: 'eyes' })).toBe(false);
      }
      expect(validate({ channel: C, timestamp: TS, name: 'eyes', extra: 1 })).toBe(false);
    });

    it('reply_in_thread exige el ts del padre y admite reply_broadcast', () => {
      const validate = validator('reply_in_thread');
      expect(validate({ channel: C, thread_ts: TS, text: 'Hecho' })).toBe(true);
      expect(validate({ channel: C, thread_ts: TS, text: 'Hecho', reply_broadcast: true })).toBe(true);
      expect(validate({ channel: C, text: 'Hecho' })).toBe(false);
      expect(validate({ channel: C, thread_ts: TS, text: '' })).toBe(false);
    });

    it('post_blocks_message exige un arreglo de bloques (1 a 50) con type y texto alternativo', () => {
      const validate = validator('post_blocks_message');
      const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: '*Lead*' } }];
      expect(validate({ channel: '#ventas', blocks, text: 'Lead' })).toBe(true);
      expect(validate({ channel: C, blocks, text: 'Lead' })).toBe(true);
      expect(validate({ channel: C, blocks: JSON.stringify(blocks), text: 'Lead' })).toBe(false);
      expect(validate({ channel: C, blocks: [], text: 'Lead' })).toBe(false);
      expect(validate({ channel: C, blocks: [{ text: 'sin tipo' }], text: 'Lead' })).toBe(false);
      expect(validate({ channel: C, blocks: Array.from({ length: 51 }, () => blocks[0]), text: 'L' })).toBe(false);
      expect(validate({ channel: C, blocks })).toBe(false);
      expect(validate({ channel: '#Ventas Equipo', blocks, text: 'Lead' })).toBe(false);
    });

    it('update_message exige texto o bloques; schedule_message un post_at entero', () => {
      const update = validator('update_message');
      expect(update({ channel: C, ts: TS, text: 'Ganado' })).toBe(true);
      expect(update({ channel: C, ts: TS, blocks: [{ type: 'divider' }] })).toBe(true);
      expect(update({ channel: C, ts: TS })).toBe(false);
      expect(update({ channel: '#ventas', ts: TS, text: 'x' })).toBe(false);

      const schedule = validator('schedule_message');
      expect(schedule({ channel: C, text: 'Recordatorio', post_at: 1893456000 })).toBe(true);
      expect(schedule({ channel: C, text: 'Recordatorio', post_at: '1893456000' })).toBe(false);
      expect(schedule({ channel: C, text: 'Recordatorio', post_at: 1.5 })).toBe(false);
    });

    it('list_channels solo admite los tipos cubiertos por los scopes y un límite < 1000', () => {
      const validate = validator('list_channels');
      expect(validate({})).toBe(true);
      expect(validate({ types: 'public_channel,private_channel', exclude_archived: true, limit: 200 })).toBe(true);
      expect(validate({ types: 'mpim' })).toBe(false);
      expect(validate({ types: 'public_channel&token=x' })).toBe(false);
      expect(validate({ limit: 1000 })).toBe(false);
      expect(validate({ cursor: 'dXNlcjpVMDYxTkZUVDI=' })).toBe(true);
      expect(validate({ cursor: 'a b' })).toBe(false);
    });

    it('usuarios por id estricto o correo válido', () => {
      expect(validator('get_user_info')({ user: 'U012AB3CD' })).toBe(true);
      expect(validator('get_user_info')({ user: 'u012' })).toBe(false);
      expect(validator('open_direct_message')({ user: 'W012AB3CD' })).toBe(true);
      expect(validator('open_direct_message')({ user: 'U1,U2' })).toBe(false);
      expect(validator('lookup_user_by_email')({ email: 'ana@acme.com' })).toBe(true);
      expect(validator('lookup_user_by_email')({ email: 'ana@acme.com\r\nx' })).toBe(false);
    });
  });

  describe('render de definiciones', () => {
    it('omite opcionales ausentes y conserva tipos (bloques como arreglo, post_at como número)', () => {
      expect(wire(renderDef('reply_in_thread', { channel: C, thread_ts: TS, text: 'Hecho' }).body)).toEqual({
        channel: C,
        thread_ts: TS,
        text: 'Hecho',
      });
      expect(
        wire(renderDef('reply_in_thread', { channel: C, thread_ts: TS, text: 'x', reply_broadcast: false }).body),
      ).toEqual({ channel: C, thread_ts: TS, text: 'x', reply_broadcast: false });

      const blocks = [{ type: 'divider' }];
      const posted = renderDef('post_blocks_message', { channel: '#ventas', blocks, text: 'Resumen' });
      expect(wire(posted.body)).toEqual({ channel: '#ventas', blocks, text: 'Resumen' });

      const scheduled = renderDef('schedule_message', { channel: C, text: 'Hola', post_at: 1893456000 });
      expect(wire(scheduled.body)).toEqual({ channel: C, text: 'Hola', post_at: 1893456000 });

      const updated = renderDef('update_message', { channel: C, ts: TS, blocks });
      expect(wire(updated.body)).toEqual({ channel: C, ts: TS, blocks });
    });

    it('las lecturas van por query y los métodos form solo llevan campos obligatorios', () => {
      const history = renderDef('get_channel_history', { channel: C, oldest: '1712000000', limit: 50 });
      expect(history).toMatchObject({ method: 'GET', path: '/conversations.history' });
      expect(history.query).toEqual({
        channel: C,
        oldest: '1712000000',
        latest: undefined,
        limit: 50,
        cursor: undefined,
      });

      expect(renderDef('lookup_user_by_email', { email: 'ana@acme.com' }).query).toEqual({ email: 'ana@acme.com' });
      expect(renderDef('open_direct_message', { user: 'U012AB3CD' })).toMatchObject({
        bodyType: 'form',
        body: { users: 'U012AB3CD' },
      });
      // En form-urlencoded un valor ausente viajaría como "undefined": ningún campo form es opcional.
      for (const key of ['add_reaction', 'open_direct_message', 'join_channel']) {
        const o = op(key);
        expect(o.definition.bodyType).toBe('form');
        const props = Object.keys(o.inputSchema.properties as object);
        expect([...(o.inputSchema.required as string[])].sort()).toEqual(props.sort());
      }
    });
  });

  describe('contra un servidor Slack simulado (RestAdapter real)', () => {
    interface Seen {
      method: string;
      url: string;
      headers: IncomingMessage['headers'];
      body: string;
    }
    let server: Server;
    let base: string;
    const seen: Seen[] = [];

    beforeAll(async () => {
      server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
          const send = (payload: unknown) => {
            // Como Slack: HTTP 200 siempre, el resultado real va en `ok`.
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(payload));
          };
          if (req.headers.authorization !== 'Bearer xoxb-prueba') return send({ ok: false, error: 'not_authed' });
          const url = new URL(req.url!, 'http://x');
          switch (`${req.method} ${url.pathname}`) {
            case 'POST /api/chat.postMessage': {
              const msg = JSON.parse(body) as { channel: string };
              if (msg.channel === 'C0NOEXISTE') return send({ ok: false, error: 'channel_not_found' });
              return send({ ok: true, channel: msg.channel, ts: TS, message: msg });
            }
            case 'POST /api/reactions.add':
              return send({ ok: true });
            case 'GET /api/conversations.history':
              return send({ ok: true, messages: [{ type: 'message', ts: TS, text: 'hola' }], has_more: false });
            case 'GET /api/users.lookupByEmail':
              return url.searchParams.get('email') === 'ana@acme.com'
                ? send({ ok: true, user: { id: 'U012AB3CD', name: 'ana' } })
                : send({ ok: false, error: 'users_not_found' });
            default:
              return send({ ok: false, error: 'unknown_method' });
          }
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
    beforeEach(() => (seen.length = 0));

    const http = new HttpClientService({
      get: (k: string) => (k === 'http.allowPrivateNetworks' ? true : undefined),
    } as never);
    const adapter = new RestAdapter(http, {
      resolve: () => Promise.resolve({ headers: { authorization: 'Bearer xoxb-prueba' }, query: {} }),
    } as never);

    const invoke = (key: string, input: Record<string, unknown>) => {
      const connector: ConnectorRuntime = {
        id: 'c1',
        workspaceId: 'w1',
        type: 'REST',
        // Misma forma que la configuración del catálogo, apuntada al simulador.
        config: { baseUrl: `${base}/api` },
        auth: { type: 'none' },
        secrets: {},
      };
      expect(validator(key)(input)).toBe(true);
      return adapter.invoke(connector, { key, definition: op(key).definition }, input);
    };

    it('post_blocks_message envía JSON con los bloques como arreglo', async () => {
      const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: '*Lead caliente*: Acme' } }];
      const result = await invoke('post_blocks_message', { channel: C, blocks, text: 'Lead caliente: Acme' });
      expect(result).toMatchObject({ ok: true, status: 200, data: { ok: true, ts: TS } });
      expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/chat.postMessage' });
      expect(seen[0].headers['content-type']).toBe('application/json');
      expect(JSON.parse(seen[0].body)).toEqual({ channel: C, blocks, text: 'Lead caliente: Acme' });
    });

    it('post_message conserva el cuerpo de siempre (sin thread_ts si no se indica)', async () => {
      const result = await invoke('post_message', { channel: '#ventas', text: 'Lead caliente' });
      expect(result.ok).toBe(true);
      expect(JSON.parse(seen[0].body)).toEqual({ channel: '#ventas', text: 'Lead caliente' });
    });

    it('add_reaction envía form-urlencoded', async () => {
      const result = await invoke('add_reaction', { channel: C, timestamp: TS, name: 'white_check_mark' });
      expect(result).toMatchObject({ ok: true, status: 200 });
      expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/reactions.add' });
      expect(seen[0].headers['content-type']).toBe('application/x-www-form-urlencoded');
      expect(Object.fromEntries(new URLSearchParams(seen[0].body))).toEqual({
        channel: C,
        timestamp: TS,
        name: 'white_check_mark',
      });
    });

    it('get_channel_history usa GET con query string, sin cuerpo y omitiendo filtros vacíos', async () => {
      const result = await invoke('get_channel_history', { channel: C, oldest: '1712000000.000100', limit: 20 });
      expect(result).toMatchObject({ ok: true, data: { messages: [{ text: 'hola' }] } });
      expect(seen[0].method).toBe('GET');
      expect(seen[0].url).toBe(`/api/conversations.history?channel=${C}&oldest=1712000000.000100&limit=20`);
      expect(seen[0].body).toBe('');
      expect(seen[0].headers['content-type']).toBeUndefined();
    });

    it('lookup_user_by_email codifica el correo en la query', async () => {
      const result = await invoke('lookup_user_by_email', { email: 'ana@acme.com' });
      expect(result).toMatchObject({ ok: true, data: { user: { id: 'U012AB3CD' } } });
      expect(seen[0].url).toBe('/api/users.lookupByEmail?email=ana%40acme.com');
    });

    it('reporta ok:false de Slack como fallo aunque el HTTP sea 200, con el error en data', async () => {
      const notFound = await invoke('lookup_user_by_email', { email: 'nadie@acme.com' });
      expect(notFound).toMatchObject({ ok: false, status: 200, data: { ok: false, error: 'users_not_found' } });

      const noChannel = await invoke('reply_in_thread', { channel: 'C0NOEXISTE', thread_ts: TS, text: 'x' });
      expect(noChannel).toMatchObject({ ok: false, status: 200, data: { error: 'channel_not_found' } });

      const unknown = await invoke('join_channel', { channel: C });
      expect(unknown).toMatchObject({ ok: false, status: 200, data: { error: 'unknown_method' } });
      expect(seen.at(-1)!.headers['content-type']).toBe('application/x-www-form-urlencoded');
      expect(seen.at(-1)!.body).toBe(`channel=${C}`);
    });
  });
});
