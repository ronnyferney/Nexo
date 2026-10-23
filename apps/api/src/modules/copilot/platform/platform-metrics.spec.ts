import { median, rankAtRisk } from './platform-metrics.service';

describe('consola de plataforma', () => {
  it('mediana', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('reglas de riesgo: cada señal con su motivo y orden por peso', () => {
    const ranked = rankAtRisk({
      noLaunchIds: ['a', 'b'],
      healthAvg: new Map([
        ['b', 30],
        ['c', 80],
      ]),
      votes: new Map([
        ['c', { up: 1, down: 3 }],
        ['d', { up: 3, down: 3 }],
        ['e', { up: 0, down: 2 }],
      ]),
      copilotSpend: new Map([
        ['f', 2],
        ['g', 1.99],
      ]),
      quotaLimitUsd: 2,
    });
    expect(ranked.map((r) => r.id)).toEqual(['b', 'c', 'f', 'a']);
    expect(ranked[0].reasons).toEqual(['Sin agentes lanzados tras 7 días', 'Salud media baja (30/100)']);
    expect(ranked[1].reasons[0]).toContain('Mucho 👎 al Copilot (3 vs 1');
    expect(ranked[2].reasons).toEqual(['Cupo del Copilot agotado']);
  });
});
