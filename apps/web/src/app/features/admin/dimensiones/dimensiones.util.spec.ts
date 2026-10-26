import type { DimensionValue, GrupoAnalisis } from '../../../core/dimensiones.models';
import {
  aplicaALabel,
  barraPorcentaje,
  buildValorTree,
  descendientesConsigo,
  porcentajeDelTotal,
  referenciaLabel,
  tipoValorLabel,
  validarVigencia,
} from './dimensiones.util';

function valor(partial: Partial<DimensionValue> & Pick<DimensionValue, 'id' | 'codigo'>): DimensionValue {
  return {
    workspaceId: 'ws',
    dimensionId: 'dim',
    nombre: partial.codigo,
    padreId: null,
    estado: 'ACTIVA',
    vigenteDesde: null,
    vigenteHasta: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('dimensiones.util', () => {
  describe('etiquetas', () => {
    it('traduce tipo de valor, referencia y aplicaA', () => {
      expect(tipoValorLabel('LISTA')).toBe('Lista');
      expect(referenciaLabel('CentroCosto')).toBe('Centro de costo');
      expect(referenciaLabel(null)).toBe('—');
      expect(referenciaLabel('Otro')).toBe('Otro');
      expect(aplicaALabel('ejecucion')).toBe('Ejecuciones');
      expect(aplicaALabel('desconocido')).toBe('desconocido');
    });
  });

  describe('validarVigencia', () => {
    it('acepta rangos abiertos o coherentes', () => {
      expect(validarVigencia(null, null)).toBeNull();
      expect(validarVigencia('2026-01-01', null)).toBeNull();
      expect(validarVigencia('2026-01-01', '2026-02-01')).toBeNull();
    });
    it('rechaza inicio posterior al fin', () => {
      expect(validarVigencia('2026-03-01', '2026-02-01')).toContain('posterior');
    });
    it('rechaza fechas no válidas', () => {
      expect(validarVigencia('no-es-fecha', '2026-02-01')).toContain('no son válidas');
    });
  });

  describe('buildValorTree', () => {
    it('ordena por recorrido en profundidad con la profundidad de cada nodo', () => {
      const valores = [
        valor({ id: 'b', codigo: 'B' }),
        valor({ id: 'a', codigo: 'A' }),
        valor({ id: 'a2', codigo: 'A-2', padreId: 'a' }),
        valor({ id: 'a1', codigo: 'A-1', padreId: 'a' }),
        valor({ id: 'a1x', codigo: 'A-1-X', padreId: 'a1' }),
      ];
      const arbol = buildValorTree(valores);
      expect(arbol.map((n) => `${n.valor.codigo}@${n.depth}`)).toEqual([
        'A@0',
        'A-1@1',
        'A-1-X@2',
        'A-2@1',
        'B@0',
      ]);
    });

    it('trata como raíz los valores con padre inexistente y no pierde ninguno', () => {
      const valores = [valor({ id: 'x', codigo: 'X', padreId: 'fantasma' })];
      const arbol = buildValorTree(valores);
      expect(arbol).toEqual([{ valor: valores[0], depth: 0 }]);
    });

    it('no entra en bucle infinito ante un ciclo y conserva todos los nodos', () => {
      const valores = [
        valor({ id: '1', codigo: 'N1', padreId: '2' }),
        valor({ id: '2', codigo: 'N2', padreId: '1' }),
      ];
      const arbol = buildValorTree(valores);
      expect(arbol.length).toBe(2);
    });
  });

  describe('descendientesConsigo', () => {
    it('incluye el propio valor y todos sus descendientes', () => {
      const valores = [
        valor({ id: 'a', codigo: 'A' }),
        valor({ id: 'a1', codigo: 'A-1', padreId: 'a' }),
        valor({ id: 'a1x', codigo: 'A-1-X', padreId: 'a1' }),
        valor({ id: 'b', codigo: 'B' }),
      ];
      const bloqueados = descendientesConsigo(valores, 'a');
      expect([...bloqueados].sort()).toEqual(['a', 'a1', 'a1x']);
      expect(bloqueados.has('b')).toBe(false);
    });
  });

  describe('porcentajes del gráfico', () => {
    const grupos: GrupoAnalisis[] = [
      { key: 'p1', label: 'Alfa', costUsd: 80, calls: 10 },
      { key: 'p2', label: 'Beta', costUsd: 20, calls: 4 },
    ];
    it('barraPorcentaje es relativo al mayor', () => {
      expect(barraPorcentaje(80, grupos)).toBe(100);
      expect(barraPorcentaje(20, grupos)).toBe(25);
      expect(barraPorcentaje(10, [])).toBe(0);
    });
    it('porcentajeDelTotal usa el total con un decimal', () => {
      expect(porcentajeDelTotal(25, 200)).toBe(12.5);
      expect(porcentajeDelTotal(10, 0)).toBe(0);
    });
  });
});
