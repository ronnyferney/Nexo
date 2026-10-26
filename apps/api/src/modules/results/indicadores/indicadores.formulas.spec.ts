import { costoPorResultado, percentil, ratioKpi, resumenCiclo } from './indicadores.formulas';

/**
 * Especificación de las fórmulas puras de los indicadores de resultado (E10). Cada KPI prueba su caso de cálculo y el
 * borde del denominador 0 → `null` (nunca división por cero ni 0 engañoso).
 */
describe('indicadores.formulas', () => {
  describe('ratioKpi (cumplimiento / calidad / excepciones)', () => {
    it('calcula ratio y porcentaje con 4 y 1 decimales', () => {
      const r = ratioKpi(3, 4);
      expect(r.numerador).toBe(3);
      expect(r.denominador).toBe(4);
      expect(r.ratio).toBe(0.75);
      expect(r.pct).toBe(75);
    });

    it('redondea el porcentaje a 1 decimal', () => {
      expect(ratioKpi(1, 3).pct).toBe(33.3);
      expect(ratioKpi(2, 3).ratio).toBe(0.6667);
    });

    it('denominador 0 → null (no divide por cero), conservando los conteos crudos', () => {
      const r = ratioKpi(0, 0);
      expect(r.ratio).toBeNull();
      expect(r.pct).toBeNull();
      expect(r.denominador).toBe(0);
    });

    it('denominador negativo o inválido también devuelve null', () => {
      expect(ratioKpi(5, -1).ratio).toBeNull();
    });
  });

  describe('percentil (nearest-rank)', () => {
    it('devuelve null sobre una muestra vacía', () => {
      expect(percentil([], 50)).toBeNull();
    });

    it('mediana y p95 de una serie conocida', () => {
      const serie = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      expect(percentil(serie, 50)).toBe(60);
      expect(percentil(serie, 95)).toBe(100);
    });

    it('no depende del orden de entrada', () => {
      expect(percentil([30, 10, 20], 50)).toBe(20);
    });
  });

  describe('resumenCiclo (tiempo de ciclo mediana/p95)', () => {
    it('reporta mediana y p95 en ms y horas', () => {
      const unaHora = 3_600_000;
      const muestras = [unaHora, 2 * unaHora, 3 * unaHora, 4 * unaHora]; // 1h,2h,3h,4h
      const r = resumenCiclo(muestras)!;
      expect(r.muestras).toBe(4);
      // nearest-rank: p50 -> índice floor(0.5*4)=2 -> 3h ; p95 -> índice 3 -> 4h
      expect(r.medianaHoras).toBe(3);
      expect(r.p95Horas).toBe(4);
      expect(r.medianaMs).toBe(3 * unaHora);
    });

    it('sin muestras (ningún resultado aceptado) → null', () => {
      expect(resumenCiclo([])).toBeNull();
    });
  });

  describe('costoPorResultado (usa solo resultados aceptados)', () => {
    it('divide el costo por el número de resultados aceptados', () => {
      const r = costoPorResultado(12.5, 5);
      expect(r.resultadosAceptados).toBe(5);
      expect(r.costoPorResultadoUsd).toBe(2.5);
    });

    it('sin resultados aceptados → costoPorResultado null (no divide por cero)', () => {
      const r = costoPorResultado(9.99, 0);
      expect(r.costoTotalUsd).toBe(9.99);
      expect(r.costoPorResultadoUsd).toBeNull();
    });
  });
});
