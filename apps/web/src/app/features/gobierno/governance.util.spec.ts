import type { DecisionRecord } from '../../core/governance.models';
import {
  approvalsRemaining,
  canDecide,
  distinctApprovers,
  isDecidable,
  isExpired,
  isInvalidatedOrExpired,
  isRequester,
} from './governance.util';

const AHORA = new Date('2026-10-26T12:00:00Z').getTime();
const FUTURO = '2026-10-27T12:00:00Z';
const PASADO = '2026-10-25T12:00:00Z';

function dec(actorUserId: string, decision: DecisionRecord['decision']): DecisionRecord {
  return { actorUserId, decision, at: '2026-10-26T10:00:00Z' };
}

describe('isExpired / isInvalidatedOrExpired', () => {
  it('marca caducada cuando expiresAt está en el pasado', () => {
    expect(isExpired(PASADO, AHORA)).toBe(true);
    expect(isExpired(FUTURO, AHORA)).toBe(false);
  });

  it('considera inválida una pendiente caducada y los estados terminales negativos', () => {
    expect(isInvalidatedOrExpired('PENDIENTE', PASADO, AHORA)).toBe(true);
    expect(isInvalidatedOrExpired('AJUSTE', PASADO, AHORA)).toBe(true);
    expect(isInvalidatedOrExpired('PENDIENTE', FUTURO, AHORA)).toBe(false);
    expect(isInvalidatedOrExpired('INVALIDADA', FUTURO, AHORA)).toBe(true);
    expect(isInvalidatedOrExpired('CADUCADA', FUTURO, AHORA)).toBe(true);
    expect(isInvalidatedOrExpired('APROBADA', FUTURO, AHORA)).toBe(false);
    // Una aprobada caducada no se marca aquí (su estado ya es terminal positivo hasta ejecutarse).
    expect(isInvalidatedOrExpired('APROBADA', PASADO, AHORA)).toBe(false);
  });
});

describe('isDecidable', () => {
  it('solo PENDIENTE y AJUSTE admiten decisiones', () => {
    expect(isDecidable('PENDIENTE')).toBe(true);
    expect(isDecidable('AJUSTE')).toBe(true);
    expect(isDecidable('APROBADA')).toBe(false);
    expect(isDecidable('RECHAZADA')).toBe(false);
    expect(isDecidable('EJECUTADA')).toBe(false);
  });
});

describe('distinctApprovers / approvalsRemaining', () => {
  it('cuenta una sola vez por actor y usa su última decisión', () => {
    const d = [dec('u1', 'APRUEBA'), dec('u1', 'APRUEBA'), dec('u2', 'AJUSTE')];
    expect(distinctApprovers(d)).toEqual(['u1']);
  });

  it('si un actor cambia a RECHAZA deja de contar como aprobador', () => {
    const d = [dec('u1', 'APRUEBA'), dec('u1', 'RECHAZA')];
    expect(distinctApprovers(d)).toEqual([]);
  });

  it('calcula las aprobaciones que faltan sin bajar de cero', () => {
    expect(approvalsRemaining([], 2)).toBe(2);
    expect(approvalsRemaining([dec('u1', 'APRUEBA')], 2)).toBe(1);
    expect(approvalsRemaining([dec('u1', 'APRUEBA'), dec('u2', 'APRUEBA')], 2)).toBe(0);
    expect(approvalsRemaining([dec('u1', 'APRUEBA'), dec('u2', 'APRUEBA'), dec('u3', 'APRUEBA')], 2)).toBe(0);
  });
});

describe('isRequester', () => {
  it('reconoce al solicitante y no da falsos positivos con valores vacíos', () => {
    expect(isRequester('u1', 'u1')).toBe(true);
    expect(isRequester('u1', 'u2')).toBe(false);
    expect(isRequester(null, 'u1')).toBe(false);
    expect(isRequester('u1', null)).toBe(false);
  });
});

describe('canDecide', () => {
  const base = {
    estado: 'PENDIENTE' as const,
    expiresAt: FUTURO,
    solicitanteUserId: 'sol',
    allowSelfApproval: false,
    decisiones: [] as DecisionRecord[],
    userId: 'aprob',
    canEdit: true,
    decision: 'APRUEBA' as const,
    now: AHORA,
  };

  it('permite aprobar a un editor distinto del solicitante', () => {
    expect(canDecide(base)).toEqual({ ok: true });
  });

  it('exige rol de edición', () => {
    expect(canDecide({ ...base, canEdit: false })).toEqual({ ok: false, mensaje: jasmine.any(String) });
  });

  it('exige usuario identificado', () => {
    const r = canDecide({ ...base, userId: null });
    expect(r.ok).toBe(false);
  });

  it('bloquea la autoaprobación del solicitante cuando la política lo prohíbe', () => {
    const r = canDecide({ ...base, userId: 'sol' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensaje).toContain('solicitante');
  });

  it('permite la autoaprobación si la política la admite', () => {
    expect(canDecide({ ...base, userId: 'sol', allowSelfApproval: true })).toEqual({ ok: true });
  });

  it('impide que el solicitante RECHACE cuente como autoaprobación (rechazo sí permitido)', () => {
    expect(canDecide({ ...base, userId: 'sol', decision: 'RECHAZA' })).toEqual({ ok: true });
  });

  it('no deja a la misma persona aprobar dos veces', () => {
    const r = canDecide({ ...base, decisiones: [dec('aprob', 'APRUEBA')] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensaje).toContain('dos personas distintas');
  });

  it('rechaza decisiones sobre una aprobación no decidible', () => {
    expect(canDecide({ ...base, estado: 'EJECUTADA' }).ok).toBe(false);
  });

  it('rechaza decisiones sobre una aprobación caducada', () => {
    const r = canDecide({ ...base, expiresAt: PASADO });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensaje).toContain('caducó');
  });
});
