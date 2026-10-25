import { formatMs, formatPct } from './supervision.util';

describe('supervision.util', () => {
  describe('formatMs', () => {
    it('muestra guion cuando no hay dato', () => {
      expect(formatMs(null)).toBe('—');
      expect(formatMs(undefined)).toBe('—');
      expect(formatMs(NaN)).toBe('—');
    });

    it('usa ms por debajo de un segundo y redondea', () => {
      expect(formatMs(0)).toBe('0 ms');
      expect(formatMs(12.4)).toBe('12 ms');
      expect(formatMs(999)).toBe('999 ms');
    });

    it('usa segundos con un decimal a partir de un segundo', () => {
      expect(formatMs(1000)).toBe('1.0 s');
      expect(formatMs(1234)).toBe('1.2 s');
      expect(formatMs(95000)).toBe('95.0 s');
    });
  });

  describe('formatPct', () => {
    it('muestra guion cuando no hay dato', () => {
      expect(formatPct(null)).toBe('—');
      expect(formatPct(undefined)).toBe('—');
    });

    it('agrega el signo de porcentaje', () => {
      expect(formatPct(0)).toBe('0 %');
      expect(formatPct(99.5)).toBe('99.5 %');
      expect(formatPct(100)).toBe('100 %');
    });
  });
});
