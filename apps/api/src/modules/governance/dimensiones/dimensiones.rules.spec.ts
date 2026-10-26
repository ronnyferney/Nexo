import { creariaCiclo, esAsignable, faltantesObligatorias, type NodoValor } from './dimensiones.rules';

describe('Reglas puras del marco de dimensiones configurables (ADR 0011 D8)', () => {
  describe('creariaCiclo: sin ciclos en la jerarquía de valores', () => {
    const valores: NodoValor[] = [
      { id: 'a', padreId: null },
      { id: 'b', padreId: 'a' },
      { id: 'c', padreId: 'b' },
    ];

    it('no hay ciclo al colgar de un ancestro que no desciende de uno mismo', () => {
      expect(creariaCiclo(valores, 'd', 'c')).toBe(false);
      expect(creariaCiclo(valores, 'b', null)).toBe(false);
    });

    it('un valor no puede ser su propio padre', () => {
      expect(creariaCiclo(valores, 'a', 'a')).toBe(true);
    });

    it('colgar un ancestro de su propio descendiente crea ciclo', () => {
      // a -> b -> c; poner el padre de "a" en "c" cerraría el ciclo a->c->b->a.
      expect(creariaCiclo(valores, 'a', 'c')).toBe(true);
      expect(creariaCiclo(valores, 'a', 'b')).toBe(true);
    });
  });

  describe('esAsignable: inactivo o fuera de vigencia no se asigna a trabajo nuevo', () => {
    const ahora = new Date('2026-06-15T00:00:00Z');

    it('ACTIVA y dentro de vigencia es asignable', () => {
      expect(esAsignable({ estado: 'ACTIVA' }, ahora)).toBe(true);
      expect(
        esAsignable(
          { estado: 'ACTIVA', vigenteDesde: new Date('2026-01-01'), vigenteHasta: new Date('2026-12-31') },
          ahora,
        ),
      ).toBe(true);
    });

    it('no ACTIVA no es asignable', () => {
      expect(esAsignable({ estado: 'SUSPENDIDA' }, ahora)).toBe(false);
      expect(esAsignable({ estado: 'CERRADA' }, ahora)).toBe(false);
    });

    it('fuera de vigencia no es asignable', () => {
      expect(esAsignable({ estado: 'ACTIVA', vigenteDesde: new Date('2026-07-01') }, ahora)).toBe(false);
      expect(esAsignable({ estado: 'ACTIVA', vigenteHasta: new Date('2026-05-01') }, ahora)).toBe(false);
    });
  });

  describe('faltantesObligatorias: obligatorias sin valor bloquean el etiquetado', () => {
    const dims = [
      { codigo: 'proyecto', obligatoria: false, obligatoriaParaEfectoEconomico: true },
      { codigo: 'cliente', obligatoria: true, obligatoriaParaEfectoEconomico: false },
      { codigo: 'campania', obligatoria: false, obligatoriaParaEfectoEconomico: false },
    ];

    it('con efecto económico exige las obligatorias para efecto económico', () => {
      expect(faltantesObligatorias(dims, {}, { efectoEconomico: true }).sort()).toEqual(['cliente', 'proyecto']);
      expect(faltantesObligatorias(dims, { proyecto: 'P1', cliente: 'C1' }, { efectoEconomico: true })).toEqual([]);
    });

    it('sin efecto económico solo exige las obligatorias generales', () => {
      expect(faltantesObligatorias(dims, {}, { efectoEconomico: false })).toEqual(['cliente']);
    });

    it('un valor vacío o null cuenta como faltante', () => {
      expect(faltantesObligatorias(dims, { cliente: '' }, { efectoEconomico: false })).toEqual(['cliente']);
      expect(faltantesObligatorias(dims, { cliente: null }, { efectoEconomico: false })).toEqual(['cliente']);
    });
  });
});
