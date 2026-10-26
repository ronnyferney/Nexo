import { evaluate, selectorMatches } from './policy-engine';
import type { ActionContext, PolicyRule } from './policy.types';

/** Especificación viva del álgebra de efectos (E6 · ADR 0013 D1): gana el control más restrictivo. */
describe('PolicyEngine (puro)', () => {
  const baseCtx: ActionContext = { workspaceId: 'ws1', tipoAccion: 'EMAIL_SEND', userId: 'u1' };

  function rule(partial: Partial<PolicyRule>): PolicyRule {
    return {
      id: partial.id ?? 'p1',
      version: partial.version ?? 1,
      tipoAccion: partial.tipoAccion ?? 'EMAIL_SEND',
      empresaId: partial.empresaId ?? null,
      selector: partial.selector ?? {},
      efecto: partial.efecto ?? 'ALLOW',
      requiredApprovals: partial.requiredApprovals ?? 1,
      allowSelfApproval: partial.allowSelfApproval ?? false,
    };
  }

  it('permite una acción no sensible sin política (compatibilidad con el gate de bajo riesgo)', () => {
    const d = evaluate({ ctx: baseCtx, rules: [] });
    expect(d.efecto).toBe('ALLOW');
    expect(d.motivo).toBe('SIN_POLITICA_APLICABLE');
  });

  it('deniega por defecto un tipo sensible sin política', () => {
    const d = evaluate({ ctx: { ...baseCtx, tipoAccion: 'PAYMENT', monto: 10 }, rules: [] });
    expect(d.efecto).toBe('DENY');
    expect(d.motivo).toBe('DENEGACION_POR_DEFECTO');
  });

  it('gana el control más restrictivo: DENY sobre ALLOW y REQUIRE_APPROVAL', () => {
    const rules = [
      rule({ id: 'a', efecto: 'ALLOW' }),
      rule({ id: 'r', efecto: 'REQUIRE_APPROVAL', requiredApprovals: 2 }),
      rule({ id: 'd', efecto: 'DENY' }),
    ];
    const d = evaluate({ ctx: baseCtx, rules });
    expect(d.efecto).toBe('DENY');
    expect(d.matched.map((m) => m.policyId).sort()).toEqual(['a', 'd', 'r']);
  });

  it('REQUIRE_APPROVAL(2) gana a REQUIRE_APPROVAL(1) y ALLOW', () => {
    const rules = [
      rule({ id: 'a', efecto: 'ALLOW' }),
      rule({ id: 'r1', efecto: 'REQUIRE_APPROVAL', requiredApprovals: 1, allowSelfApproval: true }),
      rule({ id: 'r2', efecto: 'REQUIRE_APPROVAL', requiredApprovals: 2, allowSelfApproval: false }),
    ];
    const d = evaluate({ ctx: baseCtx, rules });
    expect(d.efecto).toBe('REQUIRE_APPROVAL');
    expect(d.requiredApprovals).toBe(2);
    // La autoaprobación más restrictiva (false) gana entre las reglas de aprobación.
    expect(d.allowSelfApproval).toBe(false);
  });

  it('una suspensión activa fuerza DENY aunque haya ALLOW', () => {
    const d = evaluate({ ctx: { ...baseCtx, suspendido: true }, rules: [rule({ efecto: 'ALLOW' })] });
    expect(d.efecto).toBe('DENY');
    expect(d.motivo).toBe('SUSPENDIDO');
  });

  it('el presupuesto agotado fuerza DENY', () => {
    const d = evaluate({ ctx: { ...baseCtx, presupuestoBloqueado: true }, rules: [rule({ efecto: 'ALLOW' })] });
    expect(d.efecto).toBe('DENY');
    expect(d.motivo).toBe('PRESUPUESTO_AGOTADO');
  });

  it('la verificación cruzada eleva a REQUIRE_APPROVAL', () => {
    const d = evaluate({ ctx: { ...baseCtx, requiereRevisionCruzada: true }, rules: [rule({ efecto: 'ALLOW' })] });
    expect(d.efecto).toBe('REQUIRE_APPROVAL');
    expect(d.motivo).toBe('VERIFICACION_CRUZADA');
  });

  it('el contexto del modelo no es insumo: solo cuentan los hechos del ActionContext', () => {
    // No existe ningún campo para "el modelo dice que ya está aprobado": la firma de evaluate no lo admite.
    const d = evaluate({ ctx: { ...baseCtx, tipoAccion: 'PAYMENT', monto: 5 }, rules: [] });
    expect(d.efecto).toBe('DENY');
  });

  describe('selector', () => {
    it('coincide por rango de monto', () => {
      const r = rule({ efecto: 'REQUIRE_APPROVAL', selector: { montoMin: 1000 } });
      expect(selectorMatches(r, { ...baseCtx, monto: 2000 })).toBe(true);
      expect(selectorMatches(r, { ...baseCtx, monto: 500 })).toBe(false);
      expect(selectorMatches(r, { ...baseCtx, monto: null })).toBe(false);
    });

    it('coincide por destinatario con comodín de dominio', () => {
      const r = rule({ selector: { destinatarios: ['*@externo.com'] } });
      expect(selectorMatches(r, { ...baseCtx, destinatarios: ['juan@externo.com'] })).toBe(true);
      expect(selectorMatches(r, { ...baseCtx, destinatarios: ['juan@interno.com'] })).toBe(false);
    });

    it('coincide por horario (ventana que cruza la medianoche)', () => {
      const r = rule({ selector: { horario: { desde: 22, hasta: 6 } } });
      expect(selectorMatches(r, { ...baseCtx, horaLocal: 23 })).toBe(true);
      expect(selectorMatches(r, { ...baseCtx, horaLocal: 3 })).toBe(true);
      expect(selectorMatches(r, { ...baseCtx, horaLocal: 12 })).toBe(false);
    });

    it('respeta el alcance de empresa', () => {
      const r = rule({ empresaId: 'emp1' });
      expect(selectorMatches(r, { ...baseCtx, empresaId: 'emp1' })).toBe(true);
      expect(selectorMatches(r, { ...baseCtx, empresaId: 'emp2' })).toBe(false);
    });
  });
});
