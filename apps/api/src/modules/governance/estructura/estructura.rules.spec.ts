import { CAMPO_DESTINO, validarDestino, validarSujeto, validarVigencia } from './estructura.rules';

describe('Reglas puras de la estructura empresarial (ADR 0011 D4)', () => {
  describe('validarSujeto: exactamente un sujeto (RF42)', () => {
    it('acepta solo agente', () => {
      expect(validarSujeto({ agentId: 'a1' })).toEqual({ ok: true });
    });

    it('acepta solo miembro', () => {
      expect(validarSujeto({ userId: 'u1' })).toEqual({ ok: true });
    });

    it('rechaza ninguno', () => {
      expect(validarSujeto({})).toMatchObject({ ok: false });
      expect(validarSujeto({ agentId: null, userId: null })).toMatchObject({ ok: false });
    });

    it('rechaza ambos (no se duplica el agente en una fila mixta)', () => {
      expect(validarSujeto({ agentId: 'a1', userId: 'u1' })).toMatchObject({ ok: false });
    });
  });

  describe('validarDestino: el destino obligatorio depende del tipo (mapa, sin if dispersos)', () => {
    it('FUNCIONAL_PRINCIPAL y SERVICIO exigen orgUnitId', () => {
      expect(validarDestino('FUNCIONAL_PRINCIPAL', { orgUnitId: 'o1' })).toEqual({ ok: true });
      expect(validarDestino('FUNCIONAL_PRINCIPAL', {})).toMatchObject({ ok: false });
      expect(validarDestino('SERVICIO', { orgUnitId: 'o1' })).toEqual({ ok: true });
    });

    it('LINEA exige lineaNegocioId, SEDE exige sedeId, PROYECTO exige proyectoId', () => {
      expect(validarDestino('LINEA', { lineaNegocioId: 'l1' })).toEqual({ ok: true });
      expect(validarDestino('LINEA', { sedeId: 's1' })).toMatchObject({ ok: false });
      expect(validarDestino('SEDE', { sedeId: 's1' })).toEqual({ ok: true });
      expect(validarDestino('PROYECTO', { proyectoId: 'p1' })).toEqual({ ok: true });
      expect(validarDestino('PROYECTO', {})).toMatchObject({ ok: false });
    });

    it('el mapa cubre todos los tipos de asignación', () => {
      expect(Object.keys(CAMPO_DESTINO).sort()).toEqual(
        ['FUNCIONAL_PRINCIPAL', 'LINEA', 'PROYECTO', 'SEDE', 'SERVICIO'].sort(),
      );
    });
  });

  describe('validarVigencia', () => {
    it('acepta sin fechas o con rango válido', () => {
      expect(validarVigencia()).toEqual({ ok: true });
      expect(validarVigencia(new Date('2026-01-01'), new Date('2026-12-31'))).toEqual({ ok: true });
      expect(validarVigencia(new Date('2026-01-01'), null)).toEqual({ ok: true });
    });

    it('rechaza fin anterior al inicio', () => {
      expect(validarVigencia(new Date('2026-12-31'), new Date('2026-01-01'))).toMatchObject({ ok: false });
    });
  });
});
