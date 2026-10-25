import type { Stats } from '../../core/models';
import {
  buildKpis,
  DEFAULT_RANGE,
  formatCount,
  formatPct,
  parseRange,
  RANGE_OPTIONS,
  successRate,
} from './dashboard.util';

const stats = (over: Partial<Stats> = {}): Stats => ({
  connectors: 3,
  agents: 5,
  workflows: 2,
  executionsLast7d: 10,
  failedLast7d: 1,
  ...over,
});

describe('parseRange', () => {
  it('acepta los valores válidos del selector', () => {
    expect(parseRange('today')).toBe('today');
    expect(parseRange('7')).toBe('7');
    expect(parseRange('30')).toBe('30');
  });

  it('normaliza basura o nulos al rango por defecto', () => {
    expect(parseRange('otro')).toBe(DEFAULT_RANGE);
    expect(parseRange(null)).toBe(DEFAULT_RANGE);
    expect(parseRange(undefined)).toBe(DEFAULT_RANGE);
    expect(parseRange(7)).toBe(DEFAULT_RANGE);
  });

  it('el rango por defecto es uno de los ofrecidos', () => {
    expect(RANGE_OPTIONS.some((o) => o.value === DEFAULT_RANGE)).toBe(true);
  });
});

describe('formatPct / formatCount', () => {
  it('devuelve «—» cuando no hay dato (no inventa 0)', () => {
    expect(formatPct(null)).toBe('—');
    expect(formatPct(undefined)).toBe('—');
    expect(formatPct(Number.NaN)).toBe('—');
    expect(formatCount(null)).toBe('—');
    expect(formatCount(undefined)).toBe('—');
  });

  it('formatea porcentaje con coma decimal en español', () => {
    expect(formatPct(100)).toBe('100 %');
    expect(formatPct(87.5)).toBe('87,5 %');
    expect(formatPct(0)).toBe('0 %');
  });

  it('formatea enteros con separador de miles', () => {
    expect(formatCount(5)).toBe('5');
    // El carácter separador varía según ICU: se compara con el formateador estándar, no con un literal.
    expect(formatCount(1234)).toBe(new Intl.NumberFormat('es').format(1234));
  });
});

describe('successRate', () => {
  it('devuelve null sin base de cálculo', () => {
    expect(successRate(null, 0)).toBeNull();
    expect(successRate(undefined, 0)).toBeNull();
    expect(successRate(0, 0)).toBeNull();
  });

  it('calcula el porcentaje de éxito', () => {
    expect(successRate(10, 1)).toBe(90);
    expect(successRate(4, 0)).toBe(100);
    expect(successRate(4, 4)).toBe(0);
  });

  it('acota los fallidos al rango [0, total]', () => {
    expect(successRate(10, -5)).toBe(100);
    expect(successRate(10, 20)).toBe(0);
    expect(successRate(10, null)).toBe(100);
  });
});

describe('buildKpis', () => {
  it('degrada todo a «—» y sublíneas neutrales sin stats', () => {
    const [agents, connectors, workflows, executions] = buildKpis(null);
    expect(agents.value).toBe('—');
    expect(connectors.value).toBe('—');
    expect(workflows.value).toBe('—');
    expect(executions.value).toBe('—');
    expect(executions.subline).toBe('Sin ejecuciones en 7 días');
  });

  it('mapea los totales y enlaces correctos', () => {
    const cards = buildKpis(stats());
    expect(cards.map((c) => c.link)).toEqual(['/agents', '/connectors', '/workflows', '/executions']);
    expect(cards[0].value).toBe('5');
    expect(cards[3].value).toBe('10 · 1 fallidas');
  });

  it('muestra la tasa de éxito real en la sublínea de ejecuciones', () => {
    expect(buildKpis(stats({ executionsLast7d: 10, failedLast7d: 1 }))[3].subline).toBe(
      'Tasa de éxito 90 % · últimos 7 días',
    );
  });

  it('degrada la sublínea cuando no hay ejecuciones', () => {
    expect(buildKpis(stats({ executionsLast7d: 0, failedLast7d: 0 }))[3].subline).toBe('Sin ejecuciones en 7 días');
  });
});
