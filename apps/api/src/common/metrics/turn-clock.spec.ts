import { TurnClock } from './turn-clock';

describe('TurnClock (ADR 0017 Inc.3)', () => {
  it('mide la latencia entre la marca y la lectura con el instante inyectado', () => {
    const clock = new TurnClock(1_000);
    clock.mark(2_000);
    expect(clock.elapsedMs(2_350)).toBe(350);
  });

  it('nunca devuelve una latencia negativa (reloj hacia atrás)', () => {
    const clock = new TurnClock(5_000);
    clock.mark(5_000);
    expect(clock.elapsedMs(4_000)).toBe(0);
  });

  it('cada marca reinicia la medición (varios turnos en una misma corrida)', () => {
    const clock = new TurnClock(0);
    clock.mark(100);
    expect(clock.elapsedMs(250)).toBe(150);
    clock.mark(1_000);
    expect(clock.elapsedMs(1_120)).toBe(120);
  });
});
