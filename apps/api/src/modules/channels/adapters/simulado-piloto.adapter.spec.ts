import type { CanalRuntime } from '../domain/channel.types';
import { pilotoMensajeId, SimuladoPilotoChannelAdapter } from './simulado-piloto.adapter';

function runtime(partial: Partial<CanalRuntime> = {}): CanalRuntime {
  return {
    cuentaId: 'cuenta-piloto',
    workspaceId: 'ws-1',
    empresaId: 'empresa-1',
    tipo: 'CORREO',
    proveedor: 'simulado_piloto',
    config: {},
    ...partial,
  };
}

/**
 * Adaptador del PILOTO INTERNO CONTROLADO (ADR 0015 · controles de correo): sandbox sin red PERO gobernado por E6.
 * Pruebas aisladas, incluyendo la barrera negativa (no admite credenciales reales) y el determinismo del despacho.
 */
describe('SimuladoPilotoChannelAdapter', () => {
  const adapter = new SimuladoPilotoChannelAdapter();

  it('es sandbox (sin red) pero requiere gobierno E6, y solo soporta CORREO', () => {
    expect(adapter.proveedor).toBe('simulado_piloto');
    expect(adapter.alias).toContain('piloto_correo');
    expect(adapter.esSandbox).toBe(true);
    expect(adapter.requiereGobierno).toBe(true);
    expect(adapter.tipos).toEqual(['CORREO']);
  });

  it('despacha de forma determinista y sin red (mismo id para la misma clave)', async () => {
    const r1 = await adapter.enviar(runtime(), { destino: 'a@empresa.test', cuerpo: 'hola', idempotencyKey: 'k1' });
    const r2 = await adapter.enviar(runtime(), { destino: 'a@empresa.test', cuerpo: 'otro', idempotencyKey: 'k1' });
    expect(r1.estado).toBe('SIMULADO');
    expect(r1.proveedorMensajeId).toBe(pilotoMensajeId('cuenta-piloto', 'k1'));
    expect(r2.proveedorMensajeId).toBe(r1.proveedorMensajeId);
  });

  it('PRUEBA NEGATIVA: con credenciales presentes NO despacha (impide credenciales reales por construcción)', async () => {
    const res = await adapter.enviar(runtime({ secretValue: 'CREDENCIAL_REAL' }), {
      destino: 'a@empresa.test',
      cuerpo: 'hola',
      idempotencyKey: 'k1',
    });
    expect(res.estado).toBe('FALLIDO');
    expect(res.error).toContain('no admite credenciales');
    expect(res.proveedorMensajeId).toBeUndefined();
  });

  it('test reporta disponible sin credenciales y rechaza con credenciales', async () => {
    expect((await adapter.test(runtime())).ok).toBe(true);
    expect((await adapter.test(runtime({ secretValue: 'x' }))).ok).toBe(false);
  });
});
