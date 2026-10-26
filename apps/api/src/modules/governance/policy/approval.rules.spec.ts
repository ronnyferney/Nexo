import {
  applyDecision,
  canRegisterDecision,
  distinctApprovers,
  executionCheck,
  type ApprovalState,
  type DecisionRecord,
} from './approval.rules';
import { contentHash } from './hashing';

/** Especificación viva de la bandeja de aprobaciones (E6 · ADR 0013 D3). */
describe('Reglas de aprobación (puras)', () => {
  const future = new Date(Date.now() + 60 * 60 * 1000);

  function state(partial: Partial<ApprovalState> = {}): ApprovalState {
    return {
      estado: partial.estado ?? 'PENDIENTE',
      requiredApprovals: partial.requiredApprovals ?? 1,
      allowSelfApproval: partial.allowSelfApproval ?? false,
      solicitanteUserId: partial.solicitanteUserId ?? 'solicitante',
      decisiones: partial.decisiones ?? [],
      expiresAt: partial.expiresAt ?? future,
      contentHash: partial.contentHash ?? 'HASH',
    };
  }

  function record(actorUserId: string, decision: DecisionRecord['decision'] = 'APRUEBA'): DecisionRecord {
    return { actorUserId, decision, at: new Date().toISOString() };
  }

  it('prohíbe la autoaprobación cuando la política lo exige (QA13)', () => {
    const r = canRegisterDecision(state(), 'solicitante', 'APRUEBA');
    expect(r.ok).toBe(false);
  });

  it('permite la autoaprobación si la política lo admite', () => {
    const r = canRegisterDecision(state({ allowSelfApproval: true }), 'solicitante', 'APRUEBA');
    expect(r.ok).toBe(true);
  });

  it('exige dos personas distintas para la doble aprobación', () => {
    let s = state({ requiredApprovals: 2 });
    s = { ...s, ...applyDecision(s, record('aprobador1')) };
    expect(s.estado).toBe('PENDIENTE');
    // El mismo aprobador no puede contar dos veces.
    expect(canRegisterDecision(s, 'aprobador1', 'APRUEBA').ok).toBe(false);
    // Una segunda persona distinta completa la doble aprobación.
    expect(canRegisterDecision(s, 'aprobador2', 'APRUEBA').ok).toBe(true);
    s = { ...s, ...applyDecision(s, record('aprobador2')) };
    expect(s.estado).toBe('APROBADA');
    expect(distinctApprovers(s.decisiones).sort()).toEqual(['aprobador1', 'aprobador2']);
  });

  it('un rechazo deja la aprobación RECHAZADA', () => {
    const s = state();
    expect(applyDecision(s, record('aprobador1', 'RECHAZA')).estado).toBe('RECHAZADA');
  });

  it('invalida al ejecutar si el contenido cambió (QA03)', () => {
    const aprobado = contentHash({
      tipoAccion: 'EMAIL_SEND',
      contenido: { cuerpo: 'Hola' },
      destinatarios: ['a@x.com'],
    });
    const modificado = contentHash({
      tipoAccion: 'EMAIL_SEND',
      contenido: { cuerpo: 'Otra cosa' },
      destinatarios: ['a@x.com'],
    });
    const check = executionCheck({
      state: state({ estado: 'APROBADA', contentHash: aprobado }),
      recomputedHash: modificado,
      approversStillAuthorized: true,
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.estado).toBe('INVALIDADA');
  });

  it('invalida al ejecutar si un aprobador perdió atribuciones (QA07)', () => {
    const h = contentHash({ tipoAccion: 'EMAIL_SEND', contenido: {} });
    const check = executionCheck({
      state: state({ estado: 'APROBADA', contentHash: h }),
      recomputedHash: h,
      approversStillAuthorized: false,
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.estado).toBe('INVALIDADA');
  });

  it('caduca al ejecutar si venció el plazo', () => {
    const h = contentHash({ tipoAccion: 'EMAIL_SEND', contenido: {} });
    const check = executionCheck({
      state: state({ estado: 'APROBADA', contentHash: h, expiresAt: new Date(Date.now() - 1000) }),
      recomputedHash: h,
      approversStillAuthorized: true,
    });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.estado).toBe('CADUCADA');
  });

  it('permite ejecutar una aprobación válida, vigente y con hash intacto', () => {
    const h = contentHash({ tipoAccion: 'EMAIL_SEND', contenido: { cuerpo: 'Hola' } });
    const check = executionCheck({
      state: state({ estado: 'APROBADA', contentHash: h }),
      recomputedHash: h,
      approversStillAuthorized: true,
    });
    expect(check.ok).toBe(true);
  });

  it('el hash es estable ante el orden de las claves', () => {
    const a = contentHash({ tipoAccion: 'X', contenido: { b: 1, a: 2 }, destinatarios: ['y', 'x'] });
    const b = contentHash({ tipoAccion: 'X', contenido: { a: 2, b: 1 }, destinatarios: ['x', 'y'] });
    expect(a).toBe(b);
  });
});
