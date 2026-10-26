import { createHmac } from 'node:crypto';
import type { HttpClientService, HttpResponse } from '../../../common/http/http-client.service';
import type { CanalRuntime, WebhookSolicitud } from '../domain/channel.types';
import { WhatsappMetaChannelAdapter } from './whatsapp-meta.adapter';
import { WhatsappTwilioChannelAdapter } from './whatsapp-twilio.adapter';
import {
  estadoDesdeMeta,
  estadoDesdeTwilio,
  firmaMetaValida,
  firmaTwilioValida,
  parseMetaCredenciales,
  parseTwilioCredenciales,
  resolverPlantilla,
  traducirWebhookMeta,
  traducirWebhookTwilio,
} from './whatsapp.shared';

function runtime(partial: Partial<CanalRuntime> = {}): CanalRuntime {
  return {
    cuentaId: 'cuenta-1',
    workspaceId: 'ws-1',
    empresaId: 'empresa-1',
    tipo: 'WHATSAPP',
    proveedor: 'whatsapp_meta',
    config: {},
    ...partial,
  };
}

/** Doble de `HttpClientService` que registra las URLs llamadas y responde de una cola; sin cola → error (red real). */
function fakeHttp(responses: HttpResponse[]): { http: HttpClientService; calls: string[]; bodies: unknown[] } {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const queue = [...responses];
  const http = {
    request: jest.fn(async (req: { url: string; body?: string }) => {
      calls.push(req.url);
      bodies.push(req.body);
      const res = queue.shift();
      if (!res) throw new Error('llamada HTTP inesperada');
      return res;
    }),
  } as unknown as HttpClientService;
  return { http, calls, bodies };
}

const ok = (body: unknown): HttpResponse => ({ status: 200, ok: true, headers: {}, body, rawBody: '', durationMs: 1 });

// ---------------------------------------------------------------------------
describe('whatsapp.shared (funciones puras)', () => {
  describe('parseo de credenciales', () => {
    it('Meta: JSON con accessToken/appSecret', () => {
      expect(parseMetaCredenciales('{"accessToken":"tok","appSecret":"sec"}')).toEqual({
        accessToken: 'tok',
        appSecret: 'sec',
      });
    });
    it('Meta: texto plano = accessToken, sin appSecret', () => {
      expect(parseMetaCredenciales('tok')).toEqual({ accessToken: 'tok', appSecret: undefined });
    });
    it('Meta: sin secreto = vacío', () => {
      expect(parseMetaCredenciales(undefined)).toEqual({ accessToken: undefined });
    });
    it('Twilio: JSON con sid/token', () => {
      expect(parseTwilioCredenciales('{"accountSid":"AC1","authToken":"tk"}', {})).toEqual({
        accountSid: 'AC1',
        authToken: 'tk',
      });
    });
    it('Twilio: texto plano = authToken, sid desde config', () => {
      expect(parseTwilioCredenciales('tk', { accountSid: 'AC9' })).toEqual({ accountSid: 'AC9', authToken: 'tk' });
    });
  });

  describe('resolverPlantilla', () => {
    it('valida y expande parámetros con template.engine (sin eval)', () => {
      const r = resolverPlantilla(
        { nombre: 'confirmacion_cita', idioma: 'es_AR', parametros: ['Hola {{ input.nombre }}', 'mañana'] },
        { input: { nombre: 'Ana' } },
      );
      expect(r).toEqual({ nombre: 'confirmacion_cita', idioma: 'es_AR', parametros: ['Hola Ana', 'mañana'] });
    });
    it('idioma por defecto es', () => {
      expect(resolverPlantilla({ nombre: 'bienvenida' }).idioma).toBe('es');
    });
    it('rechaza nombre inválido', () => {
      expect(() => resolverPlantilla({ nombre: 'Nombre Inválido' })).toThrow(/Nombre de plantilla inválido/);
    });
    it('rechaza idioma inválido', () => {
      expect(() => resolverPlantilla({ nombre: 'ok', idioma: 'español' })).toThrow(/Idioma de plantilla inválido/);
    });
    it('rechaza parámetro que queda vacío tras expandir', () => {
      expect(() => resolverPlantilla({ nombre: 'ok', parametros: ['{{ input.inexistente }}'] }, { input: {} })).toThrow(
        /quedó vacío/,
      );
    });
  });

  describe('mapeo de estados', () => {
    it('Meta', () => {
      expect(estadoDesdeMeta('sent')).toBe('ENVIADO');
      expect(estadoDesdeMeta('delivered')).toBe('ENTREGADO');
      expect(estadoDesdeMeta('read')).toBe('LEIDO');
      expect(estadoDesdeMeta('failed')).toBe('FALLIDO');
    });
    it('Twilio', () => {
      expect(estadoDesdeTwilio('queued')).toBe('PENDIENTE');
      expect(estadoDesdeTwilio('sent')).toBe('ENVIADO');
      expect(estadoDesdeTwilio('delivered')).toBe('ENTREGADO');
      expect(estadoDesdeTwilio('read')).toBe('LEIDO');
      expect(estadoDesdeTwilio('undelivered')).toBe('FALLIDO');
    });
  });

  describe('traducción de webhooks', () => {
    it('Meta: mensaje entrante y estado', () => {
      const eventos = traducirWebhookMeta({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [{ id: 'wamid.1', from: '573001112233', type: 'text', text: { body: 'Hola' } }],
                  statuses: [{ id: 'wamid.0', status: 'read' }],
                },
              },
            ],
          },
        ],
      });
      expect(eventos).toEqual([
        { tipo: 'MENSAJE', proveedorMensajeId: 'wamid.1', origen: '573001112233', cuerpo: 'Hola' },
        { tipo: 'ESTADO', proveedorMensajeId: 'wamid.0', estado: 'LEIDO' },
      ]);
    });
    it('Twilio: entrante vs estado', () => {
      expect(traducirWebhookTwilio({ MessageSid: 'SM1', From: 'whatsapp:+57300', Body: 'Hola' })).toEqual([
        { tipo: 'MENSAJE', proveedorMensajeId: 'SM1', origen: 'whatsapp:+57300', cuerpo: 'Hola' },
      ]);
      expect(traducirWebhookTwilio({ MessageSid: 'SM2', MessageStatus: 'delivered' })).toEqual([
        { tipo: 'ESTADO', proveedorMensajeId: 'SM2', estado: 'ENTREGADO' },
      ]);
    });
  });

  describe('firmas', () => {
    it('Meta: acepta firma válida y rechaza inválida o ausente', () => {
      const raw = '{"a":1}';
      const firma = 'sha256=' + createHmac('sha256', 'sec').update(raw, 'utf8').digest('hex');
      expect(firmaMetaValida('sec', firma, raw)).toBe(true);
      expect(firmaMetaValida('sec', firma, '{"a":2}')).toBe(false);
      expect(firmaMetaValida('sec', 'sha256=deadbeef', raw)).toBe(false);
      expect(firmaMetaValida('sec', undefined, raw)).toBe(false);
      expect(firmaMetaValida(undefined, firma, raw)).toBe(false);
    });
    it('Twilio: acepta firma válida y rechaza inválida', () => {
      const url = 'https://nexo.test/api/canales-externos/webhooks/whatsapp_twilio/c1';
      const params = { To: 'whatsapp:+1', From: 'whatsapp:+2', Body: 'Hola' };
      let data = url;
      for (const k of Object.keys(params).sort()) data += k + (params as Record<string, string>)[k];
      const firma = createHmac('sha1', 'tk').update(Buffer.from(data, 'utf8')).digest('base64');
      expect(firmaTwilioValida('tk', firma, url, params)).toBe(true);
      expect(firmaTwilioValida('tk', firma, url, { ...params, Body: 'otro' })).toBe(false);
      expect(firmaTwilioValida('tk', 'xxx', url, params)).toBe(false);
      expect(firmaTwilioValida(undefined, firma, url, params)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
describe('WhatsappMetaChannelAdapter', () => {
  const cfg = { phoneNumberId: '123456' };
  const secret = '{"accessToken":"tok-no-filtrar","appSecret":"sec"}';

  it('sin credenciales → FALLIDO y NO intenta red', async () => {
    const { http, calls } = fakeHttp([]);
    const adapter = new WhatsappMetaChannelAdapter(http);
    const res = await adapter.enviar(runtime({ secretValue: undefined, config: cfg }), {
      destino: '+57300',
      cuerpo: 'hola',
      idempotencyKey: 'k1',
    });
    expect(res.estado).toBe('FALLIDO');
    expect(res.error).toContain('sin credenciales');
    expect(calls).toHaveLength(0);
  });

  it('con secreto pero sin phoneNumberId → FALLIDO sin red', async () => {
    const { http, calls } = fakeHttp([]);
    const adapter = new WhatsappMetaChannelAdapter(http);
    const res = await adapter.enviar(runtime({ secretValue: secret, config: {} }), {
      destino: '+57300',
      cuerpo: 'hola',
      idempotencyKey: 'k1',
    });
    expect(res.estado).toBe('FALLIDO');
    expect(res.error).toContain('phoneNumberId');
    expect(calls).toHaveLength(0);
  });

  it('envía texto por HttpClientService y devuelve el id del proveedor', async () => {
    const { http, calls, bodies } = fakeHttp([ok({ messages: [{ id: 'wamid.ABC' }] })]);
    const adapter = new WhatsappMetaChannelAdapter(http);
    const res = await adapter.enviar(runtime({ secretValue: secret, config: cfg }), {
      destino: '+57300',
      cuerpo: 'hola',
      idempotencyKey: 'k1',
    });
    expect(res).toEqual({ estado: 'ENVIADO', proveedorMensajeId: 'wamid.ABC' });
    expect(calls[0]).toContain('graph.facebook.com');
    expect(calls[0]).toContain('/123456/messages');
    expect(JSON.parse(bodies[0] as string)).toMatchObject({ type: 'text', text: { body: 'hola' } });
  });

  it('envía plantilla con parámetros (type template)', async () => {
    const { http, bodies } = fakeHttp([ok({ messages: [{ id: 'wamid.T' }] })]);
    const adapter = new WhatsappMetaChannelAdapter(http);
    const res = await adapter.enviar(runtime({ secretValue: secret, config: cfg }), {
      destino: '+57300',
      cuerpo: 'ignorado',
      idempotencyKey: 'k1',
      plantilla: { nombre: 'confirmacion', idioma: 'es', parametros: ['Ana', '10:00'] },
    });
    expect(res.estado).toBe('ENVIADO');
    const body = JSON.parse(bodies[0] as string) as Record<string, unknown>;
    expect(body.type).toBe('template');
    expect(body.template).toMatchObject({
      name: 'confirmacion',
      language: { code: 'es' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Ana' },
            { type: 'text', text: '10:00' },
          ],
        },
      ],
    });
  });

  it('plantilla inválida → FALLIDO sin red', async () => {
    const { http, calls } = fakeHttp([]);
    const adapter = new WhatsappMetaChannelAdapter(http);
    const res = await adapter.enviar(runtime({ secretValue: secret, config: cfg }), {
      destino: '+57300',
      cuerpo: 'x',
      idempotencyKey: 'k1',
      plantilla: { nombre: 'NO VALE' },
    });
    expect(res.estado).toBe('FALLIDO');
    expect(res.error).toContain('Nombre de plantilla inválido');
    expect(calls).toHaveLength(0);
  });

  it('error de negocio (HTTP 400) → FALLIDO sin filtrar el token', async () => {
    const { http } = fakeHttp([
      { status: 400, ok: false, headers: {}, body: { error: {} }, rawBody: '', durationMs: 1 },
    ]);
    const adapter = new WhatsappMetaChannelAdapter(http);
    const res = await adapter.enviar(runtime({ secretValue: secret, config: cfg }), {
      destino: '+57300',
      cuerpo: 'hola',
      idempotencyKey: 'k1',
    });
    expect(res.estado).toBe('FALLIDO');
    expect(res.error).toContain('HTTP 400');
    expect(res.error).not.toContain('tok-no-filtrar');
  });

  it('verificarFirma usa el appSecret del secreto (válida/ inválida)', () => {
    const adapter = new WhatsappMetaChannelAdapter(fakeHttp([]).http);
    const raw = '{"entry":[]}';
    const firma = 'sha256=' + createHmac('sha256', 'sec').update(raw, 'utf8').digest('hex');
    const base: WebhookSolicitud = { headers: {}, body: {}, rawBody: raw, url: 'https://x' };
    expect(
      adapter.verificarFirma(runtime({ secretValue: secret }), { ...base, headers: { 'x-hub-signature-256': firma } }),
    ).toBe(true);
    expect(
      adapter.verificarFirma(runtime({ secretValue: secret }), {
        ...base,
        headers: { 'x-hub-signature-256': 'sha256=bad' },
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('WhatsappTwilioChannelAdapter', () => {
  const cfg = { fromNumber: '+14155238886' };
  const secret = '{"accountSid":"AC123","authToken":"tk-no-filtrar"}';

  it('sin credenciales → FALLIDO y NO intenta red', async () => {
    const { http, calls } = fakeHttp([]);
    const adapter = new WhatsappTwilioChannelAdapter(http);
    const res = await adapter.enviar(runtime({ proveedor: 'whatsapp_twilio', secretValue: undefined, config: cfg }), {
      destino: '+57300',
      cuerpo: 'hola',
      idempotencyKey: 'k1',
    });
    expect(res.estado).toBe('FALLIDO');
    expect(res.error).toContain('sin credenciales');
    expect(calls).toHaveLength(0);
  });

  it('envía texto por HttpClientService y devuelve el sid', async () => {
    const { http, calls, bodies } = fakeHttp([ok({ sid: 'SM999', status: 'queued' })]);
    const adapter = new WhatsappTwilioChannelAdapter(http);
    const res = await adapter.enviar(runtime({ proveedor: 'whatsapp_twilio', secretValue: secret, config: cfg }), {
      destino: '+57300',
      cuerpo: 'hola',
      idempotencyKey: 'k1',
    });
    expect(res).toEqual({ estado: 'ENVIADO', proveedorMensajeId: 'SM999' });
    expect(calls[0]).toContain('api.twilio.com');
    expect(calls[0]).toContain('/Accounts/AC123/Messages.json');
    const params = new URLSearchParams(bodies[0] as string);
    expect(params.get('From')).toBe('whatsapp:+14155238886');
    expect(params.get('To')).toBe('whatsapp:+57300');
    expect(params.get('Body')).toBe('hola');
  });

  it('plantilla → ContentSid + ContentVariables', async () => {
    const { http, bodies } = fakeHttp([ok({ sid: 'SM1', status: 'queued' })]);
    const adapter = new WhatsappTwilioChannelAdapter(http);
    await adapter.enviar(runtime({ proveedor: 'whatsapp_twilio', secretValue: secret, config: cfg }), {
      destino: '+57300',
      cuerpo: 'x',
      idempotencyKey: 'k1',
      plantilla: { nombre: 'HX123', parametros: ['Ana', '10:00'] },
    });
    const params = new URLSearchParams(bodies[0] as string);
    expect(params.get('ContentSid')).toBe('HX123');
    expect(JSON.parse(params.get('ContentVariables') as string)).toEqual({ '1': 'Ana', '2': '10:00' });
  });

  it('error (HTTP 401) → FALLIDO sin filtrar el Auth Token', async () => {
    const { http } = fakeHttp([{ status: 401, ok: false, headers: {}, body: {}, rawBody: '', durationMs: 1 }]);
    const adapter = new WhatsappTwilioChannelAdapter(http);
    const res = await adapter.enviar(runtime({ proveedor: 'whatsapp_twilio', secretValue: secret, config: cfg }), {
      destino: '+57300',
      cuerpo: 'hola',
      idempotencyKey: 'k1',
    });
    expect(res.estado).toBe('FALLIDO');
    expect(res.error).toContain('HTTP 401');
    expect(res.error).not.toContain('tk-no-filtrar');
  });

  it('verificarFirma usa el authToken (válida / inválida)', () => {
    const adapter = new WhatsappTwilioChannelAdapter(fakeHttp([]).http);
    const url = 'https://nexo.test/api/canales-externos/webhooks/whatsapp_twilio/c1';
    const body = { MessageSid: 'SM1', From: 'whatsapp:+1', Body: 'Hola' };
    let data = url;
    for (const k of Object.keys(body).sort()) data += k + (body as Record<string, string>)[k];
    const firma = createHmac('sha1', 'tk-no-filtrar').update(Buffer.from(data, 'utf8')).digest('base64');
    const rt = runtime({ proveedor: 'whatsapp_twilio', secretValue: secret, config: cfg });
    expect(adapter.verificarFirma(rt, { headers: { 'x-twilio-signature': firma }, body, rawBody: '', url })).toBe(true);
    expect(adapter.verificarFirma(rt, { headers: { 'x-twilio-signature': 'mala' }, body, rawBody: '', url })).toBe(
      false,
    );
  });
});
