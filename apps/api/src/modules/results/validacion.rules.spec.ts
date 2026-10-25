import { evaluarDeterminista, tieneReglaDeterminista } from './validacion.rules';

describe('validacion.rules (RF29/RF30: regla determinista pura, sin eval)', () => {
  it('reconoce cuándo hay una regla determinista evaluable', () => {
    expect(tieneReglaDeterminista({ rules: [{ left: 'a', operator: 'eq', right: 'b' }] })).toBe(true);
    expect(tieneReglaDeterminista({ rules: [] })).toBe(false);
    expect(tieneReglaDeterminista({})).toBe(false);
    expect(tieneReglaDeterminista(null)).toBe(false);
  });

  it('acepta cuando la regla se cumple y está toda la evidencia exigida', () => {
    const res = evaluarDeterminista(
      { rules: [{ left: '{{ pago.confirmado }}', operator: 'eq', right: true }] },
      ['confirmacion_tesoreria'],
      ['confirmacion_tesoreria'],
      { pago: { confirmado: true } },
    );
    expect(res.cumple).toBe(true);
    expect(res.evidenciaFaltante).toEqual([]);
  });

  it('devuelve cuando falta evidencia exigida aunque la regla pase', () => {
    const res = evaluarDeterminista(
      { rules: [{ left: '{{ pago.confirmado }}', operator: 'eq', right: true }] },
      ['confirmacion_tesoreria'],
      [],
      { pago: { confirmado: true } },
    );
    expect(res.cumple).toBe(false);
    expect(res.evidenciaFaltante).toEqual(['confirmacion_tesoreria']);
  });

  it('devuelve cuando la regla no se cumple (resultado no verificado)', () => {
    const res = evaluarDeterminista(
      { rules: [{ left: '{{ pago.confirmado }}', operator: 'eq', right: true }] },
      [],
      [],
      { pago: { confirmado: false } },
    );
    expect(res.cumple).toBe(false);
  });

  it('combinator "or" acepta si al menos una regla pasa', () => {
    const res = evaluarDeterminista(
      {
        combinator: 'or',
        rules: [
          { left: '{{ x }}', operator: 'eq', right: 1 },
          { left: '{{ y }}', operator: 'eq', right: 2 },
        ],
      },
      [],
      [],
      { x: 9, y: 2 },
    );
    expect(res.cumple).toBe(true);
  });
});
