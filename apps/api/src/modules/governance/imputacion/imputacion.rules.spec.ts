import { contarDestinos, destinoKey, repartirCosto, validarReparto, type DestinoReparto } from './imputacion.rules';

/**
 * Invariantes puras del reparto de servicios compartidos (ADR 0011 D5 / E9 · RF45): suma 100 %, un destino por fila,
 * sin destinos repetidos, y reparto exacto del costo medido (un mismo gasto no se cuenta dos veces).
 */
describe('imputacion.rules', () => {
  const linea = (id: string, porcentaje: number): DestinoReparto => ({ lineaNegocioId: id, porcentaje });

  describe('contarDestinos / destinoKey', () => {
    it('exige exactamente un destino por fila', () => {
      expect(contarDestinos({ porcentaje: 10 })).toBe(0);
      expect(contarDestinos({ lineaNegocioId: 'l1', porcentaje: 10 })).toBe(1);
      expect(contarDestinos({ lineaNegocioId: 'l1', orgUnitId: 'a1', porcentaje: 10 })).toBe(2);
    });

    it('la clave lleva prefijo por tipo (línea/área/centro no colisionan)', () => {
      expect(destinoKey({ lineaNegocioId: 'x', porcentaje: 1 })).toBe('linea:x');
      expect(destinoKey({ orgUnitId: 'x', porcentaje: 1 })).toBe('area:x');
      expect(destinoKey({ centroCostoId: 'x', porcentaje: 1 })).toBe('centro:x');
    });
  });

  describe('validarReparto', () => {
    it('acepta un reparto que suma 100 %', () => {
      expect(validarReparto([linea('l1', 60), linea('l2', 40)])).toEqual({ ok: true });
    });

    it('acepta decimales con tolerancia (33.33 + 33.33 + 33.34)', () => {
      const r = validarReparto([linea('l1', 33.33), linea('l2', 33.33), { orgUnitId: 'a1', porcentaje: 33.34 }]);
      expect(r.ok).toBe(true);
    });

    it('rechaza si la suma no es 100 %', () => {
      const r = validarReparto([linea('l1', 60), linea('l2', 30)]);
      expect(r.ok).toBe(false);
    });

    it('rechaza una fila sin destino o con dos destinos', () => {
      expect(validarReparto([{ porcentaje: 100 }]).ok).toBe(false);
      expect(validarReparto([{ lineaNegocioId: 'l1', orgUnitId: 'a1', porcentaje: 100 }]).ok).toBe(false);
    });

    it('rechaza un porcentaje no positivo o mayor que 100', () => {
      expect(validarReparto([linea('l1', 0), linea('l2', 100)]).ok).toBe(false);
      expect(validarReparto([linea('l1', 150)]).ok).toBe(false);
    });

    it('rechaza destinos repetidos (sin doble conteo)', () => {
      expect(validarReparto([linea('l1', 50), linea('l1', 50)]).ok).toBe(false);
    });

    it('rechaza un reparto vacío', () => {
      expect(validarReparto([]).ok).toBe(false);
    });
  });

  describe('repartirCosto', () => {
    it('reparte el total exacto (la suma de montos = total medido)', () => {
      const montos = repartirCosto(100, [
        { key: 'linea:l1', porcentaje: 60 },
        { key: 'linea:l2', porcentaje: 40 },
      ]);
      expect(montos).toEqual([
        { key: 'linea:l1', montoUsd: 60 },
        { key: 'linea:l2', montoUsd: 40 },
      ]);
      const total = montos.reduce((s, m) => s + m.montoUsd, 0);
      expect(total).toBe(100);
    });

    it('el último destino absorbe el resto del redondeo (sin pérdida ni doble conteo)', () => {
      const costo = 10;
      const montos = repartirCosto(costo, [
        { key: 'a', porcentaje: 33.33 },
        { key: 'b', porcentaje: 33.33 },
        { key: 'c', porcentaje: 33.34 },
      ]);
      const total = montos.reduce((s, m) => s + m.montoUsd, 0);
      // La suma es EXACTAMENTE el costo medido: el gasto se reparte una sola vez.
      expect(total).toBeCloseTo(costo, 8);
      expect(total).toBe(10);
    });

    it('un solo destino recibe el 100 % del costo medido', () => {
      expect(repartirCosto(7.5, [{ key: 'linea:l1', porcentaje: 100 }])).toEqual([{ key: 'linea:l1', montoUsd: 7.5 }]);
    });

    it('sin destinos no reparte nada', () => {
      expect(repartirCosto(100, [])).toEqual([]);
    });
  });
});
