import { copilotModelFrom } from '../../config/configuration';
import { computeQuota, isQuotaExhausted, quotaPeriod } from './copilot-quota.service';

describe('cupo del Copilot', () => {
  const now = new Date('2026-10-23T15:00:00Z');

  it('periodo mensual en UTC', () => {
    const p = quotaPeriod(now);
    expect(p.key).toBe('2026-10');
    expect(p.start.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(quotaPeriod(new Date('2026-12-31T23:59:59Z')).end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('calcula lo usado y lo restante', () => {
    expect(computeQuota(2, 0.5, now)).toEqual({ limitUsd: 2, usedUsd: 0.5, remainingUsd: 1.5, period: '2026-10' });
  });

  it('el sobregiro del último turno no da saldo negativo', () => {
    const q = computeQuota(2, 2.3, now);
    expect(q.remainingUsd).toBe(0);
    expect(isQuotaExhausted(q)).toBe(true);
  });

  it('cupo 0 = Copilot deshabilitado', () => {
    expect(isQuotaExhausted(computeQuota(0, 0, now))).toBe(true);
    expect(isQuotaExhausted(computeQuota(2, 1.999999, now))).toBe(false);
  });
});

describe('modelo del Copilot por configuración', () => {
  it('por defecto anthropic/claude-opus-5-5 si hay clave', () => {
    expect(copilotModelFrom({ ANTHROPIC_API_KEY: 'sk' })).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' });
  });
  it('sin clave usa mock', () => {
    expect(copilotModelFrom({})).toEqual({ provider: 'mock', model: 'mock-echo' });
    expect(copilotModelFrom({ COPILOT_PROVIDER: 'anthropic', COPILOT_MODEL: 'claude-sonnet-5-5' })).toEqual({
      provider: 'mock',
      model: 'mock-echo',
    });
  });
  it('respeta COPILOT_PROVIDER/COPILOT_MODEL', () => {
    expect(copilotModelFrom({ ANTHROPIC_API_KEY: 'sk', COPILOT_MODEL: 'claude-sonnet-5-5' })).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
    });
    expect(copilotModelFrom({ COPILOT_PROVIDER: 'mock' })).toEqual({ provider: 'mock', model: 'mock-echo' });
  });
});

describe('proveedores no de sistema', () => {
  it('un id de conexión de workspace no se acepta como modelo del Copilot', () => {
    expect(copilotModelFrom({ ANTHROPIC_API_KEY: 'sk', COPILOT_PROVIDER: 'cl0conexion' }).provider).toBe('mock');
  });
});
