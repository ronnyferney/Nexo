import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpClientService } from '../../../common/http/http-client.service';
import { render } from '../../../common/template/template.engine';
import { RestAdapter } from '../adapters/rest.adapter';
import type { ConnectorRuntime } from '../domain/connector.types';
import { findCatalogEntry } from './catalog.index';
import type { CatalogEntry, CatalogOperation } from './catalog.types';
import { GMAIL_MULTIPART_BOUNDARY } from './integrations/gmail';

const ajv = addFormats(new Ajv({ strict: true, strictRequired: false, allowUnionTypes: true, allErrors: true }));

const entry = (id: string): CatalogEntry => findCatalogEntry(id)!;
const op = (id: string, key: string): CatalogOperation => entry(id).operations.find((o) => o.key === key)!;
const validator = (id: string, key: string) => ajv.compile(op(id, key).inputSchema);

interface Def {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: unknown;
}
const renderDef = (id: string, key: string, input: Record<string, unknown>) =>
  render<Def>(op(id, key).definition, { input });
/** Lo que realmente viaja: JSON.stringify descarta las claves con valor ausente. */
const wire = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

const scopes = (id: string) => {
  const auth = entry(id).auth.oauth2_code;
  return auth?.type === 'oauth2_code' ? auth.scopes : [];
};

describe('Google Calendar (catálogo)', () => {
  const start = { dateTime: '2026-11-05T15:00:00', timeZone: 'America/Bogota' };
  const end = { dateTime: '2026-11-05T15:30:00', timeZone: 'America/Bogota' };

  it('pide solo los scopes mínimos de Calendar', () => {
    expect(scopes('google-calendar')).toEqual([
      'openid',
      'email',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.events.freebusy',
    ]);
  });

  it('acepta ids de calendario y evento válidos y rechaza los que alteran la ruta', () => {
    const validate = validator('google-calendar', 'get_event');
    expect(validate({ calendarId: 'primary', eventId: 'abc123' })).toBe(true);
    expect(validate({ calendarId: 'c_1f2e@group.calendar.google.com', eventId: 'abc_20261105T150000Z' })).toBe(true);
    for (const calendarId of ['../users', 'primary/events', 'a?b=1', 'a#b', 'a b', '']) {
      expect(validate({ calendarId, eventId: 'abc' })).toBe(false);
    }
    expect(validate({ calendarId: 'primary', eventId: '../../x' })).toBe(false);
  });

  it('list_events expande recurrentes, ordena por inicio y exige RFC 3339 con zona', () => {
    const validate = validator('google-calendar', 'list_events');
    expect(validate({ calendarId: 'primary', timeMin: '2026-11-01T00:00:00Z', timeMax: '2026-11-08T00:00:00Z' })).toBe(
      true,
    );
    expect(validate({ calendarId: 'primary', timeMin: '2026-11-01T00:00:00', timeMax: '2026-11-08T00:00:00Z' })).toBe(
      false,
    );
    const def = renderDef('google-calendar', 'list_events', {
      calendarId: 'primary',
      timeMin: '2026-11-01T00:00:00Z',
      timeMax: '2026-11-08T00:00:00Z',
      q: 'demo',
    });
    expect(def.path).toBe('/calendars/primary/events');
    expect(def.query).toMatchObject({ singleEvents: true, orderBy: 'startTime', q: 'demo' });
  });

  it('create_event_with_meet exige un requestId estricto y pide la conferencia hangoutsMeet', () => {
    const validate = validator('google-calendar', 'create_event_with_meet');
    const base = { calendarId: 'primary', summary: 'Demo', start, end };
    expect(validate({ ...base, meetRequestId: 'nexo-20261105-1500-ab' })).toBe(true);
    expect(validate(base)).toBe(false);
    for (const meetRequestId of ['corto', 'con espacios 123', 'x'.repeat(65), 'a"}],"x":"1', 'id\r\nX: 1']) {
      expect(validate({ ...base, meetRequestId })).toBe(false);
    }

    const def = renderDef('google-calendar', 'create_event_with_meet', {
      ...base,
      meetRequestId: 'nexo-20261105-1500-ab',
      attendees: [{ email: 'ana@acme.com' }],
      sendUpdates: 'all',
    });
    expect(def.query).toEqual({ conferenceDataVersion: 1, sendUpdates: 'all' });
    expect(wire(def.body)).toEqual({
      summary: 'Demo',
      start,
      end,
      attendees: [{ email: 'ana@acme.com' }],
      conferenceData: {
        createRequest: { requestId: 'nexo-20261105-1500-ab', conferenceSolutionKey: { type: 'hangoutsMeet' } },
      },
    });
  });

  it('create_event no crea conferencia y update_event solo envía los campos indicados', () => {
    const created = renderDef('google-calendar', 'create_event', { calendarId: 'primary', summary: 'X', start, end });
    expect(wire(created.body)).toEqual({ summary: 'X', start, end });
    expect(created.query?.conferenceDataVersion).toBeUndefined();

    const validate = validator('google-calendar', 'update_event');
    expect(validate({ calendarId: 'primary', eventId: 'abc' })).toBe(false);
    expect(validate({ calendarId: 'primary', eventId: 'abc', start: {} })).toBe(false);
    expect(validate({ calendarId: 'primary', eventId: 'abc', start: { date: '2026-11-05', extra: 1 } })).toBe(false);
    const patched = renderDef('google-calendar', 'update_event', { calendarId: 'primary', eventId: 'abc', end });
    expect(patched.method).toBe('PATCH');
    expect(wire(patched.body)).toEqual({ end });
  });
});

describe('Google Meet (catálogo)', () => {
  it('pide los scopes de Meet y documenta requisitos de verificación', () => {
    expect(scopes('google-meet')).toEqual([
      'openid',
      'email',
      'https://www.googleapis.com/auth/meetings.space.created',
      'https://www.googleapis.com/auth/meetings.space.readonly',
    ]);
    expect(entry('google-meet').verificationNotes).toMatch(/restringido/);
    expect(entry('google-meet').verificationNotes).toMatch(/Workspace/);
  });

  it('interpola en la ruta solo ids sin "/" (no se puede saltar a otro recurso)', () => {
    const validate = validator('google-meet', 'list_transcript_entries');
    expect(validate({ conferenceRecordId: 'abc-123', transcriptId: 'tr_1' })).toBe(true);
    expect(validate({ conferenceRecordId: 'conferenceRecords/abc', transcriptId: 'tr_1' })).toBe(false);
    expect(validate({ conferenceRecordId: 'abc', transcriptId: '../participants' })).toBe(false);
    const def = renderDef('google-meet', 'list_transcript_entries', { conferenceRecordId: 'abc', transcriptId: 't1' });
    expect(def.path).toBe('/conferenceRecords/abc/transcripts/t1/entries');
  });

  it('create_space envía config.accessType solo si se indica', () => {
    expect(wire(renderDef('google-meet', 'create_space', {}).body)).toEqual({ config: {} });
    expect(wire(renderDef('google-meet', 'create_space', { accessType: 'TRUSTED' }).body)).toEqual({
      config: { accessType: 'TRUSTED' },
    });
  });
});

describe('Gmail (envío) y Gmail (bandeja y respuestas)', () => {
  it('mantiene intacta send_email y separa los scopes restringidos en Gmail (bandeja y respuestas)', () => {
    const send = entry('gmail-inbox').operations[0];
    expect(send.key).toBe('send_email');
    expect(entry('gmail-inbox').slug).toBe('GMAIL_INBOX');
    expect(send.definition).toEqual({
      method: 'POST',
      path: '/upload/gmail/v1/users/me/messages/send',
      query: { uploadType: 'media' },
      headers: { 'content-type': 'message/rfc822' },
      bodyType: 'text',
      body:
        'To: {{ input.to }}\r\nSubject: {{ input.subject }}\r\nMIME-Version: 1.0\r\n' +
        "Content-Type: {{ input.contentType | default:'text/plain' }}; charset=UTF-8\r\n" +
        'Content-Transfer-Encoding: 8bit\r\n\r\n{{ input.body }}',
    });
    expect(scopes('gmail-inbox')).toEqual([
      'openid',
      'email',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
    ]);
    // Gmail (envío) sigue pidiendo solo gmail.send: quien solo envía no concede acceso a su correo.
    expect(entry('gmail').slug).toBe('GMAIL');
    expect(entry('gmail').operations.map((o) => o.key)).toEqual(['send_email']);
    expect(entry('gmail').operations[0]).toBe(send);
    expect(scopes('gmail')).toEqual(['openid', 'email', 'https://www.googleapis.com/auth/gmail.send']);
  });

  it('create_draft usa la carga simple RFC 822 y no admite saltos de línea en cabeceras', () => {
    const validate = validator('gmail-inbox', 'create_draft');
    expect(validate({ to: 'ana@acme.com', subject: 'Hola', body: 'Línea 1\r\nLínea 2' })).toBe(true);
    expect(validate({ to: 'ana@acme.com\r\nBcc: x@evil.com', subject: 'Hola', body: 'x' })).toBe(false);
    expect(validate({ to: 'ana@acme.com', subject: 'Hola\nBcc: x@evil.com', body: 'x' })).toBe(false);

    const def = renderDef('gmail-inbox', 'create_draft', { to: 'ana@acme.com', subject: 'Hola', body: 'Texto' });
    expect(def.path).toBe('/upload/gmail/v1/users/me/drafts');
    expect(def.query).toEqual({ uploadType: 'media' });
    expect(def.body).toBe(
      'To: ana@acme.com\r\nSubject: Hola\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n' +
        'Content-Transfer-Encoding: 8bit\r\n\r\nTexto',
    );
  });

  describe.each(['reply_in_thread', 'create_reply_draft'])('%s', (key) => {
    const valid = {
      threadId: '18c2f0a1b2c3d4e5',
      inReplyTo: '<CAF1x@mail.gmail.com>',
      to: 'ana@acme.com',
      subject: 'Re: Propuesta',
      body: 'Gracias, lo reviso.',
    };

    it('rechaza inyección de cabeceras, ids inválidos y el separador multipart en el cuerpo', () => {
      const validate = validator('gmail-inbox', key);
      expect(validate(valid)).toBe(true);
      expect(validate({ ...valid, references: '<a@x.com> <b@y.com>' })).toBe(true);
      expect(validate({ ...valid, inReplyTo: '<a@x.com>\r\nBcc: x@evil.com' })).toBe(false);
      expect(validate({ ...valid, inReplyTo: 'a@x.com' })).toBe(false);
      expect(validate({ ...valid, references: '<a@x.com>\r\nBcc: <x@evil.com>' })).toBe(false);
      expect(validate({ ...valid, threadId: '18c2","labelIds":["TRASH' })).toBe(false);
      expect(validate({ ...valid, subject: 'Re: x\r\nBcc: x@evil.com' })).toBe(false);
      expect(validate({ ...valid, body: `hola\r\n--${GMAIL_MULTIPART_BOUNDARY}--\r\nextra` })).toBe(false);
    });

    it('arma un multipart/related con threadId y las cabeceras de respuesta', () => {
      const def = renderDef('gmail-inbox', key, { ...valid, references: '<a@x.com>' });
      expect(def.query).toEqual({ uploadType: 'multipart' });
      expect(def.headers).toEqual({ 'content-type': `multipart/related; boundary=${GMAIL_MULTIPART_BOUNDARY}` });
      const parts = String(def.body).split(`--${GMAIL_MULTIPART_BOUNDARY}`);
      expect(parts).toHaveLength(4);
      expect(parts[3]).toBe('--');
      const [jsonHead, json] = parts[1].trim().split('\r\n\r\n');
      expect(jsonHead).toBe('Content-Type: application/json; charset=UTF-8');
      const metadata = JSON.parse(json) as Record<string, unknown>;
      expect(metadata).toEqual(
        key === 'reply_in_thread' ? { threadId: valid.threadId } : { message: { threadId: valid.threadId } },
      );
      const rfc822 = parts[2].replace(/^\r\nContent-Type: message\/rfc822\r\n\r\n/, '').replace(/\r\n$/, '');
      const [headers, text] = rfc822.split('\r\n\r\n');
      expect(headers.split('\r\n')).toEqual([
        'To: ana@acme.com',
        'Subject: Re: Propuesta',
        'In-Reply-To: <CAF1x@mail.gmail.com>',
        'References: <a@x.com> <CAF1x@mail.gmail.com>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
      ]);
      expect(text).toBe('Gracias, lo reviso.');
    });
  });
});

/**
 * Verificación contra un servidor HTTP local que simula las APIs de Google: invoca las operaciones con el
 * `RestAdapter` y el `HttpClientService` reales (red privada permitida solo en esta prueba) y comprueba lo que llega.
 */
describe('operaciones de Google Workspace contra un servidor simulado', () => {
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
        if (req.headers.authorization !== 'Bearer token-de-prueba') {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 401, status: 'UNAUTHENTICATED' } }));
          return;
        }
        if (req.url?.includes('/events') && req.method === 'POST') {
          const event = JSON.parse(body) as Record<string, unknown>;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: 'evt1', ...event, hangoutLink: 'https://meet.google.com/abc-mnop-xyz' }));
          return;
        }
        if (req.url?.startsWith('/upload/gmail/v1/users/me/drafts') && req.method === 'POST') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ id: 'r-1', message: { id: 'm1', threadId: '18c2f0a1b2c3d4e5' } }));
          return;
        }
        if (req.url === '/v2/conferenceRecords/abc/participants?pageSize=5') {
          res.writeHead(403, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED' } }));
          return;
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{}');
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
    resolve: () => Promise.resolve({ headers: { authorization: 'Bearer token-de-prueba' }, query: {} }),
  } as never);

  const invoke = (id: string, key: string, input: Record<string, unknown>, basePath = '') => {
    const e = entry(id);
    const connector: ConnectorRuntime = {
      id: 'c1',
      workspaceId: 'w1',
      type: 'REST',
      config: { baseUrl: `${base}${basePath}` },
      auth: { type: 'none' },
      secrets: {},
    };
    expect(validator(id, key)(input)).toBe(true);
    return adapter.invoke(connector, { key, definition: op(e.id, key).definition }, input);
  };

  it('Calendar: crea un evento con Meet y llega conferenceDataVersion=1 con el requestId', async () => {
    const result = await invoke(
      'google-calendar',
      'create_event_with_meet',
      {
        calendarId: 'c_1@group.calendar.google.com',
        summary: 'Demo',
        start: { dateTime: '2026-11-05T15:00:00-05:00' },
        end: { dateTime: '2026-11-05T15:30:00-05:00' },
        meetRequestId: 'nexo-req-0001',
      },
      '/calendar/v3',
    );
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      data: { hangoutLink: 'https://meet.google.com/abc-mnop-xyz' },
    });
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url).toBe('/calendar/v3/calendars/c_1@group.calendar.google.com/events?conferenceDataVersion=1');
    expect(seen[0].headers['content-type']).toBe('application/json');
    expect(JSON.parse(seen[0].body)).toMatchObject({
      conferenceData: { createRequest: { requestId: 'nexo-req-0001' } },
    });
  });

  it('Gmail: el borrador de respuesta llega como multipart/related bien formado', async () => {
    const result = await invoke('gmail-inbox', 'create_reply_draft', {
      threadId: '18c2f0a1b2c3d4e5',
      inReplyTo: '<CAF1x@mail.gmail.com>',
      to: 'ana@acme.com',
      subject: 'Re: Propuesta',
      body: 'Gracias',
    });
    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(seen[0].url).toBe('/upload/gmail/v1/users/me/drafts?uploadType=multipart');
    expect(seen[0].headers['content-type']).toBe(`multipart/related; boundary=${GMAIL_MULTIPART_BOUNDARY}`);
    expect(seen[0].body).toContain('{"message":{"threadId":"18c2f0a1b2c3d4e5"}}');
    expect(seen[0].body.endsWith(`--${GMAIL_MULTIPART_BOUNDARY}--`)).toBe(true);
  });

  it('Meet: un error del sistema remoto se devuelve como ok=false con el detalle', async () => {
    const result = await invoke('google-meet', 'list_participants', { conferenceRecordId: 'abc', pageSize: 5 }, '/v2');
    expect(result).toMatchObject({ ok: false, status: 403, data: { error: { status: 'PERMISSION_DENIED' } } });
  });
});
