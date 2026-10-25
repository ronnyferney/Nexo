import { decidirCierreIncumplimiento, type IncumplimientoLimites } from './incumplimientos.sweep';

const base: IncumplimientoLimites = {
  resuelto: false,
  maxReintentos: 0,
  intentos: 0,
  maxCiclos: 0,
  ciclos: 0,
  plazo: null,
};

describe('decidirCierreIncumplimiento (RF31: nunca activo para siempre)', () => {
  const now = new Date('2026-10-25T12:00:00Z');

  it('deja abierto un incumplimiento sin límites agotados ni plazo vencido', () => {
    expect(decidirCierreIncumplimiento(base, now)).toBeNull();
  });

  it('nunca reabre uno ya resuelto', () => {
    expect(decidirCierreIncumplimiento({ ...base, resuelto: true, plazo: new Date(0) }, now)).toBeNull();
  });

  it('declara LIMITE_AGOTADO al alcanzar el máximo de reintentos', () => {
    expect(decidirCierreIncumplimiento({ ...base, maxReintentos: 2, intentos: 2 }, now)).toBe('LIMITE_AGOTADO');
  });

  it('declara LIMITE_AGOTADO al alcanzar el máximo de ciclos de corrección', () => {
    expect(decidirCierreIncumplimiento({ ...base, maxCiclos: 1, ciclos: 1 }, now)).toBe('LIMITE_AGOTADO');
  });

  it('declara PLAZO_VENCIDO cuando el plazo del plan ya pasó', () => {
    expect(decidirCierreIncumplimiento({ ...base, plazo: new Date('2026-10-25T11:59:59Z') }, now)).toBe(
      'PLAZO_VENCIDO',
    );
  });

  it('no declara por plazo si aún no vence', () => {
    expect(decidirCierreIncumplimiento({ ...base, plazo: new Date('2026-10-25T12:00:01Z') }, now)).toBeNull();
  });

  it('maxReintentos=0 significa sin límite por reintentos (no declara)', () => {
    expect(decidirCierreIncumplimiento({ ...base, maxReintentos: 0, intentos: 99 }, now)).toBeNull();
  });
});
