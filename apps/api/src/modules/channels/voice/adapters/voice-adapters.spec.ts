import type { HttpClientService } from '../../../../common/http/http-client.service';
import type { VoiceProvider } from '../domain/voice-provider';
import type { VoiceRuntime } from '../domain/voice.types';
import { AmazonConnectVoiceAdapter } from './amazon-connect-voice.adapter';
import { GoogleCloudVoiceAdapter } from './google-cloud-voice.adapter';
import { SimuladoVoiceAdapter, detectarAccionSensibleSimulada, simuladoVoiceCallId } from './simulado-voice.adapter';

function runtime(partial: Partial<VoiceRuntime> = {}): VoiceRuntime {
  return {
    cuentaId: 'cuenta-1',
    workspaceId: 'ws-1',
    empresaId: 'empresa-1',
    proveedor: 'simulado',
    config: {},
    ...partial,
  };
}

/**
 * Doble de `HttpClientService` que PROHÍBE cualquier salida de red: si algún adaptador intentara llamar, el test falla.
 * Garantiza el requisito de no-gasto/no-red de los stubs (ADR 0015, sandbox).
 */
function httpQueCuentaLlamadas(): { http: HttpClientService; contador: { n: number } } {
  const contador = { n: 0 };
  const http = {
    request: jest.fn(() => {
      contador.n += 1;
      throw new Error('llamada de red inesperada: los adaptadores de voz NO deben salir a la red en sandbox');
    }),
    assertPublicHost: jest.fn(() => {
      contador.n += 1;
      throw new Error('resolución de host inesperada: los stubs no deben contactar al proveedor');
    }),
  } as unknown as HttpClientService;
  return { http, contador };
}

describe('SimuladoVoiceAdapter', () => {
  const adapter = new SimuladoVoiceAdapter();

  it('está siempre activo y sin credenciales (sin red)', () => {
    expect(adapter.estadoActivacion()).toBeNull();
    expect(adapter.capabilities.procesos).toContain('actionGateway');
  });

  it('inicia con id determinista por (cuenta, idempotencyKey) y estado SIMULADA', async () => {
    const r1 = await adapter.iniciar(runtime(), {
      direccion: 'SALIENTE',
      numero: '+100',
      idempotencyKey: 'k1',
      requisitos: { direccion: 'SALIENTE' },
    });
    const r2 = await adapter.iniciar(runtime(), {
      direccion: 'SALIENTE',
      numero: '+100',
      idempotencyKey: 'k1',
      requisitos: { direccion: 'SALIENTE' },
    });
    expect(r1.estado).toBe('SIMULADA');
    expect(r1.proveedorCallId).toBe(simuladoVoiceCallId('cuenta-1', 'k1'));
    expect(r2.proveedorCallId).toBe(r1.proveedorCallId);
  });

  it('recorre turno → transferir → finalizar de forma determinista', async () => {
    const callId = simuladoVoiceCallId('cuenta-1', 'k1');
    const turno = await adapter.turno(runtime(), { proveedorCallId: callId, entrada: 'hola', bargeIn: true });
    expect(turno.estado).toBe('EN_CURSO');
    expect(turno.transcripcion).toBe('hola');
    expect(turno.bargeIn).toBe(true);
    expect(turno.accionSensible).toBeUndefined();

    const transferida = await adapter.transferir(runtime(), { proveedorCallId: callId, destino: 'cola-soporte' });
    expect(transferida.estado).toBe('TRANSFERIDA');

    const fin = await adapter.finalizar(runtime(), { proveedorCallId: callId });
    expect(fin.estado).toBe('FINALIZADA');
    expect(fin.duracionSeg).toBe((await adapter.finalizar(runtime(), { proveedorCallId: callId })).duracionSeg);
  });

  it('detecta una acción sensible (capa d) por el texto del usuario', async () => {
    const turno = await adapter.turno(runtime(), { proveedorCallId: 'c', entrada: 'quiero hacer un pago' });
    expect(turno.accionSensible?.tipoAccion).toBe('VOICE_PAYMENT');
    expect(detectarAccionSensibleSimulada('consultar mi saldo')?.tipoAccion).toBe('VOICE_DATA_ACCESS');
    expect(detectarAccionSensibleSimulada('solo saludar')).toBeUndefined();
  });
});

describe.each([
  [
    'AmazonConnectVoiceAdapter',
    (h: HttpClientService): VoiceProvider => new AmazonConnectVoiceAdapter(h),
    'Amazon Connect',
  ],
  ['GoogleCloudVoiceAdapter', (h: HttpClientService): VoiceProvider => new GoogleCloudVoiceAdapter(h), 'Google Cloud'],
] as const)('%s (stub gated, sin red)', (_nombre, crear, legible) => {
  it('sin credenciales → inactivo, operaciones FALLIDA, 0 llamadas de red', async () => {
    const { http, contador } = httpQueCuentaLlamadas();
    const adapter = crear(http);
    const rt = runtime({ proveedor: adapter.proveedor, secretValue: undefined });

    const inactividad = adapter.estadoActivacion(rt);
    expect(inactividad?.causa).toContain('sin credenciales');

    const ini = await adapter.iniciar(rt, {
      direccion: 'SALIENTE',
      numero: '+1',
      idempotencyKey: 'k',
      requisitos: { direccion: 'SALIENTE' },
    });
    expect(ini.estado).toBe('FALLIDA');
    const turno = await adapter.turno(rt, { proveedorCallId: 'c', entrada: 'x' });
    expect(turno.estado).toBe('FALLIDA');
    await adapter.transferir(rt, { proveedorCallId: 'c', destino: 'd' });
    await adapter.finalizar(rt, { proveedorCallId: 'c' });

    expect(contador.n).toBe(0);
  });

  it('con credenciales sigue gated → inactivo sin tocar la red', async () => {
    const { http, contador } = httpQueCuentaLlamadas();
    const adapter = crear(http);
    const rt = runtime({ proveedor: adapter.proveedor, secretValue: 'creds-de-prueba' });
    expect(adapter.estadoActivacion(rt)?.causa).toContain('gated');
    expect(
      (
        await adapter.iniciar(rt, {
          direccion: 'SALIENTE',
          numero: '+1',
          idempotencyKey: 'k',
          requisitos: { direccion: 'SALIENTE' },
        })
      ).estado,
    ).toBe('FALLIDA');
    expect(contador.n).toBe(0);
  });

  it('declara requisitos de activación por capa (insumo de presupuesto) para las 4 capas', () => {
    const { http } = httpQueCuentaLlamadas();
    const adapter = crear(http);
    const capas = adapter.requisitosActivacion.map((r) => r.capa);
    expect(capas).toEqual(expect.arrayContaining(['TELEFONIA', 'VOZ', 'DIALOGO', 'PROCESOS']));
    expect(adapter.requisitosActivacion.every((r) => r.recursos.length > 0 && r.faltaCotizar.length > 0)).toBe(true);
    expect(legible.length).toBeGreaterThan(0);
  });
});
