import type { HttpClientService, HttpResponse } from '../../../common/http/http-client.service';
import type { CanalRuntime } from '../domain/channel.types';
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
