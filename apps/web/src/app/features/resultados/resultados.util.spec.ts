import type { KpiTiempoCiclo } from '../../core/indicadores.models';
import {
  SIN_DATOS,
  SIN_RESULTADOS,
  formatHoras,
  formatPct,
  fraccion,
  tiempoCicloLabel,
} from './resultados.util';

describe('resultados.util', () => {
  describe('formatPct', () => {
    it('muestra «Sin datos en el período» cuando el backend manda null (no «0 %»)', () => {
      expect(formatPct(null)).toBe(SIN_DATOS);
    });

    it('distingue un 0 real de la ausencia de datos', () => {
      expect(formatPct(0)).toBe('0 %');
    });

    it('formatea con hasta un decimal en español', () => {
      expect(formatPct(100)).toBe('100 %');
      expect(formatPct(87.5)).toBe('87,5 %');
      expect(formatPct(66.666)).toBe('66,7 %');
    });
  });

  describe('formatHoras', () => {
    it('devuelve guion cuando no hay valor', () => {
      expect(formatHoras(null)).toBe('—');
      expect(formatHoras(undefined)).toBe('—');
      expect(formatHoras(Number.NaN)).toBe('—');
    });

    it('formatea horas con un decimal', () => {
      expect(formatHoras(0)).toBe('0 h');
      expect(formatHoras(12)).toBe('12 h');
      expect(formatHoras(3.25)).toBe('3,3 h');
    });
  });

  describe('fraccion', () => {
    it('arma «numerador / denominador»', () => {
      expect(fraccion({ numerador: 7, denominador: 10 })).toBe('7 / 10');
      expect(fraccion({ numerador: 0, denominador: 0 })).toBe('0 / 0');
    });
  });

  describe('tiempoCicloLabel', () => {
    it('avisa cuando no hay muestras aceptadas', () => {
      expect(tiempoCicloLabel(null)).toBe(SIN_RESULTADOS);
    });

    it('muestra mediana y p95 en horas', () => {
      const tc: KpiTiempoCiclo = { muestras: 4, medianaMs: 0, p95Ms: 0, medianaHoras: 2, p95Horas: 9.5 };
      expect(tiempoCicloLabel(tc)).toBe('2 h / 9,5 h');
    });
  });
});
