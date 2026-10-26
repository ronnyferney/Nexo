import type { HttpClientService, HttpResponse } from '../../../common/http/http-client.service';
import type { CanalRuntime } from '../domain/channel.types';
import { construirMimeGmail, GmailMailChannelAdapter } from './gmail-mail.adapter';
import { M365MailChannelAdapter } from './m365-mail.adapter';
import { SimuladoChannelAdapter, simuladoMensajeId } from './simulado.adapter';

function runtime(partial: Partial<CanalRuntime> = {}): CanalRuntime {
  return {
    cuentaId: 'cuenta-1',
    workspaceId: 'ws-1',
    empresaId: 'empresa-1',
    tipo: 'CORREO',
    proveedor: 'simulado',
    config: {},
    ...partial,
  };
}

describe('SimuladoChannelAdapter', () => {
  const adapter = new SimuladoChannelAdapter();

  it('envía de forma determinista y sin red (mismo id para la misma clave)', async () => {
    const r1 = await adapter.enviar(runtime(), { destino: 'a@test', cuerpo: 'hola', idempotencyKey: 'k1' });
    const r2 = await adapter.enviar(runtime(), { destino: 'a@test', cuerpo: 'otro', idempotencyKey: 'k1' });
    expect(r1.estado).toBe('SIMULADO');
    expect(r1.proveedorMensajeId).toBe(simuladoMensajeId('cuenta-1', 'k1'));
    expect(r2.proveedorMensajeId).toBe(r1.proveedorMensajeId);
  });

  it('claves distintas producen ids distintos', async () => {
    const a = await adapter.enviar(runtime(), { destino: 'x', cuerpo: 'c', idempotencyKey: 'k1' });
    const b = await adapter.enviar(runtime(), { destino: 'x', cuerpo: 'c', idempotencyKey: 'k2' });
    expect(a.proveedorMensajeId).not.toBe(b.proveedorMensajeId);
  });

  it('declara capacidades y soporta los tres tipos', () => {
    expect(adapter.capabilities).toEqual(expect.arrayContaining(['ENVIAR', 'ESTADO_ENTREGA', 'RECIBIR']));
    expect(adapter.tipos).toEqual(expect.arrayContaining(['CORREO', 'WHATSAPP', 'VOZ']));
  });

  it('recibe un entrante sintético normalizado (webhook simulado)', async () => {
    const entrante = await adapter.recibir(runtime(), {
      headers: {},
      body: { proveedorMensajeId: 'in-1', origen: 'cliente@test', asunto: 'Hola', cuerpo: 'contenido' },
    });
    expect(entrante).toMatchObject({ proveedorMensajeId: 'in-1', origen: 'cliente@test', cuerpo: 'contenido' });
  });
});

describe('M365MailChannelAdapter', () => {
  function fakeHttp(responses: HttpResponse[]): { http: HttpClientService; calls: string[] } {
    const calls: string[] = [];
    const queue = [...responses];
    const http = {
      request: jest.fn(async (req: { url: string }) => {
        calls.push(req.url);
        const res = queue.shift();
        if (!res) throw new Error('llamada HTTP inesperada');
        return res;
      }),
    } as unknown as HttpClientService;
    return { http, calls };
  }

  it('sin credenciales (secretRef vacío) devuelve FALLIDO y NO intenta red', async () => {
    const { http, calls } = fakeHttp([]);
    const adapter = new M365MailChannelAdapter(http);
    const res = await adapter.enviar(runtime({ proveedor: 'm365', secretValue: undefined }), {
      destino: 'a@test',
      cuerpo: 'hola',
      idempotencyKey: 'k1',
    });
    expect(res.estado).toBe('FALLIDO');
    expect(res.error).toContain('sin credenciales');
    expect(calls).toHaveLength(0);
  });

  it('con secreto pero config incompleta devuelve FALLIDO sin red', async () => {
    const { http, calls } = fakeHttp([]);
    const adapter = new M365MailChannelAdapter(http);
    const res = await adapter.enviar(runtime({ proveedor: 'm365', secretValue: 'secreto', config: {} }), {
      destino: 'a@test',
      cuerpo: 'hola',
      idempotencyKey: 'k1',
    });
    expect(res.estado).toBe('FALLIDO');
    expect(res.error).toContain('incompleta');
    expect(calls).toHaveLength(0);
  });

  it('con credenciales obtiene token y envía (202) por HttpClientService', async () => {
    const { http, calls } = fakeHttp([
      { status: 200, ok: true, headers: {}, body: { access_token: 'tok' }, rawBody: '', durationMs: 1 },
      { status: 202, ok: true, headers: {}, body: '', rawBody: '', durationMs: 1 },
    ]);
    const adapter = new M365MailChannelAdapter(http);
    const res = await adapter.enviar(
      runtime({
        proveedor: 'm365',
        secretValue: 'secreto',
        config: { tenantId: 't', clientId: 'c', remitente: 'buzon@empresa.com' },
      }),
      { destino: 'a@test', asunto: 'Asunto', cuerpo: 'hola', idempotencyKey: 'k1' },
    );
    expect(res.estado).toBe('ENVIADO');
    expect(calls[0]).toContain('login.microsoftonline.com');
    expect(calls[1]).toContain('graph.microsoft.com');
    expect(calls[1]).toContain('sendMail');
  });

  it('no filtra el secreto en el error cuando el proveedor rechaza el envío', async () => {
    const { http } = fakeHttp([
      { status: 200, ok: true, headers: {}, body: { access_token: 'tok' }, rawBody: '', durationMs: 1 },
      { status: 400, ok: false, headers: {}, body: { error: 'x' }, rawBody: '', durationMs: 1 },
    ]);
    const adapter = new M365MailChannelAdapter(http);
    const res = await adapter.enviar(
      runtime({
        proveedor: 'm365',
        secretValue: 'secreto-no-debe-aparecer',
        config: { tenantId: 't', clientId: 'c', remitente: 'buzon@empresa.com' },
      }),
      { destino: 'a@test', cuerpo: 'hola', idempotencyKey: 'k1' },
    );
    expect(res.estado).toBe('FALLIDO');
    expect(res.error).toContain('HTTP 400');
    expect(res.error).not.toContain('secreto-no-debe-aparecer');
  });
});

describe('GmailMailChannelAdapter', () => {
  const credenciales = JSON.stringify({ clientId: 'c', clientSecret: 's', refreshToken: 'r' });

  function fakeHttp(responses: HttpResponse[]): {
    http: HttpClientService;
    calls: { url: string; body?: string }[];
  } {
    const calls: { url: string; body?: string }[] = [];
    const queue = [...responses];
    const http = {
      request: jest.fn(async (req: { url: string; body?: string }) => {
        calls.push({ url: req.url, body: req.body });
        const res = queue.shift();
        if (!res) throw new Error('llamada HTTP inesperada');
        return res;
      }),
    } as unknown as HttpClientService;
    return { http, calls };
  }

  it('declara proveedor, alias y capacidades de correo', () => {
    const adapter = new GmailMailChannelAdapter({} as unknown as HttpClientService);
    expect(adapter.proveedor).toBe('gmail');
    expect(adapter.alias).toContain('google_mail');
    expect(adapter.tipos).toEqual(['CORREO']);
    expect(adapter.capabilities).toEqual(expect.arrayContaining(['ENVIAR', 'ESTADO_ENTREGA']));
  });

  it('sin credenciales (secretRef vacío) devuelve FALLIDO y NO intenta red', async () => {
    const { http, calls } = fakeHttp([]);
    const adapter = new GmailMailChannelAdapter(http);
    const res = await adapter.enviar(
      runtime({ proveedor: 'gmail', secretValue: undefined, config: { remitente: 'bot@empresa.com' } }),
      { destino: 'a@test', cuerpo: 'hola', idempotencyKey: 'k1' },
    );
    expect(res.estado).toBe('FALLIDO');
    expect(res.error).toContain('sin credenciales');
    expect(calls).toHaveLength(0);
  });

  it('con secreto incompleto devuelve FALLIDO sin red', async () => {
    const { http, calls } = fakeHttp([]);
    const adapter = new GmailMailChannelAdapter(http);
    const res = await adapter.enviar(
      runtime({
        proveedor: 'gmail',
        secretValue: JSON.stringify({ clientId: 'c' }),
        config: { remitente: 'bot@empresa.com' },
      }),
      { destino: 'a@test', cuerpo: 'hola', idempotencyKey: 'k1' },
    );
    expect(res.estado).toBe('FALLIDO');
    expect(res.error).toContain('incompletas');
    expect(calls).toHaveLength(0);
  });

  it('con credenciales pero sin remitente en config devuelve FALLIDO sin red', async () => {
    const { http, calls } = fakeHttp([]);
    const adapter = new GmailMailChannelAdapter(http);
    const res = await adapter.enviar(runtime({ proveedor: 'gmail', secretValue: credenciales, config: {} }), {
      destino: 'a@test',
      cuerpo: 'hola',
      idempotencyKey: 'k1',
    });
    expect(res.estado).toBe('FALLIDO');
    expect(res.error).toContain('remitente');
    expect(calls).toHaveLength(0);
  });

  it('con credenciales obtiene token y envía (200) por HttpClientService, mapeando el id del proveedor', async () => {
    const { http, calls } = fakeHttp([
      { status: 200, ok: true, headers: {}, body: { access_token: 'tok' }, rawBody: '', durationMs: 1 },
      { status: 200, ok: true, headers: {}, body: { id: 'gmail-msg-123' }, rawBody: '', durationMs: 1 },
    ]);
    const adapter = new GmailMailChannelAdapter(http);
    const res = await adapter.enviar(
      runtime({ proveedor: 'gmail', secretValue: credenciales, config: { remitente: 'bot@empresa.com' } }),
      { destino: 'cliente@externo.test', asunto: 'Asunto', cuerpo: 'hola', idempotencyKey: 'k1' },
    );
    expect(res.estado).toBe('ENVIADO');
    expect(res.proveedorMensajeId).toBe('gmail-msg-123');
    expect(calls[0].url).toContain('oauth2.googleapis.com');
    expect(calls[1].url).toContain('gmail.googleapis.com');
    expect(calls[1].url).toContain('messages/send');
    // El cuerpo lleva el MIME en base64url dentro de `raw`, sin secretos.
    const payload = JSON.parse(calls[1].body as string) as { raw: string };
    expect(payload.raw).toMatch(/^[A-Za-z0-9_-]+$/);
    const mime = Buffer.from(payload.raw, 'base64url').toString('utf8');
    expect(mime).toContain('To: cliente@externo.test');
    expect(mime).toContain('Subject: Asunto');
    expect(mime).toContain('hola');
  });

  it('error de negocio del proveedor → FALLIDO sin filtrar el secreto', async () => {
    const { http } = fakeHttp([
      { status: 200, ok: true, headers: {}, body: { access_token: 'tok' }, rawBody: '', durationMs: 1 },
      { status: 403, ok: false, headers: {}, body: { error: 'x' }, rawBody: '', durationMs: 1 },
    ]);
    const adapter = new GmailMailChannelAdapter(http);
    const secreto = JSON.stringify({ clientId: 'c', clientSecret: 'no-debe-aparecer', refreshToken: 'r' });
    const res = await adapter.enviar(
      runtime({ proveedor: 'gmail', secretValue: secreto, config: { remitente: 'bot@empresa.com' } }),
      { destino: 'a@test', cuerpo: 'hola', idempotencyKey: 'k1' },
    );
    expect(res.estado).toBe('FALLIDO');
    expect(res.error).toContain('HTTP 403');
    expect(res.error).not.toContain('no-debe-aparecer');
  });

  it('test sin credenciales reporta inactivo sin red', async () => {
    const { http, calls } = fakeHttp([]);
    const adapter = new GmailMailChannelAdapter(http);
    const res = await adapter.test(runtime({ proveedor: 'gmail', secretValue: undefined, config: {} }));
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('construirMimeGmail codifica cabeceras no ASCII con encoded-word y mantiene el cuerpo', () => {
    const mime = construirMimeGmail('bot@empresa.com', {
      destino: 'cliente@externo.test',
      asunto: 'Petición de información áéíóú',
      cuerpo: 'Hola, ¿qué tal?',
      idempotencyKey: 'k1',
    });
    expect(mime).toContain('From: bot@empresa.com');
    expect(mime).toContain('Subject: =?UTF-8?B?');
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime).toContain('Hola, ¿qué tal?');
  });
});
