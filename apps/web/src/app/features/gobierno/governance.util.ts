/**
 * Lógica pura del gobierno de acciones (E6 · ADR 0013): mapeo de estados/riesgo/efecto a presentación y las reglas de
 * «¿quién puede decidir?» que replican en la UI lo que el servidor valida (el servidor es el gate real). Sin Angular ni
 * red: se prueba de forma aislada en `governance.util.spec.ts`.
 */
import type {
  ApprovalDecisionKind,
  ApprovalRisk,
  ApprovalStatus,
  DecisionRecord,
  PolicyEffect,
  PolicyStatus,
  SuspensionScope,
} from '../../core/governance.models';

export interface Meta {
  label: string;
  /** Clase del design system para `.badge`/`.callout`. */
  cls: string;
}

export const APPROVAL_STATUS_META: Record<ApprovalStatus, Meta> = {
  PENDIENTE: { label: 'Pendiente', cls: 'warning' },
  APROBADA: { label: 'Aprobada', cls: 'success' },
  RECHAZADA: { label: 'Rechazada', cls: 'danger' },
  AJUSTE: { label: 'Ajuste solicitado', cls: 'info' },
  EJECUTADA: { label: 'Ejecutada', cls: 'primary' },
  CADUCADA: { label: 'Caducada', cls: 'danger' },
  INVALIDADA: { label: 'Invalidada', cls: 'danger' },
};

export const RISK_META: Record<ApprovalRisk, Meta> = {
  BAJO: { label: 'Riesgo bajo', cls: 'success' },
  MEDIO: { label: 'Riesgo medio', cls: 'warning' },
  ALTO: { label: 'Riesgo alto', cls: 'danger' },
};

export const EFFECT_META: Record<PolicyEffect, Meta> = {
  ALLOW: { label: 'Permitir', cls: 'success' },
  REQUIRE_APPROVAL: { label: 'Requiere aprobación', cls: 'warning' },
  DENY: { label: 'Denegar', cls: 'danger' },
};

export const POLICY_STATUS_META: Record<PolicyStatus, Meta> = {
  BORRADOR: { label: 'Borrador', cls: 'info' },
  ACTIVA: { label: 'Activa', cls: 'success' },
  ARCHIVADA: { label: 'Archivada', cls: '' },
};

export const SCOPE_META: Record<SuspensionScope, { label: string; icon: string; hint: string }> = {
  AGENTE: { label: 'Agente', icon: 'bot', hint: 'Bloquea las acciones de un agente concreto.' },
  PROCESO: { label: 'Proceso (flujo)', icon: 'flow', hint: 'Bloquea las acciones originadas por un flujo.' },
  CONECTOR: { label: 'Conector', icon: 'plug', hint: 'Bloquea las acciones sobre un conector o recurso.' },
  ORGANIZACION: { label: 'Organización', icon: 'building', hint: 'Bloquea toda la empresa o el workspace.' },
};

export const DECISION_LABEL: Record<ApprovalDecisionKind, string> = {
  APRUEBA: 'Aprobó',
  RECHAZA: 'Rechazó',
  AJUSTE: 'Pidió ajuste',
};

/** ¿La aprobación caducó? (`expiresAt` en el pasado). */
export function isExpired(expiresAt: string | Date, now: number = Date.now()): boolean {
  return new Date(expiresAt).getTime() <= now;
}

/** ¿El estado es terminal y «negativo» (exige una nueva solicitud) o la aprobación caducó? */
export function isInvalidatedOrExpired(estado: ApprovalStatus, expiresAt: string | Date, now = Date.now()): boolean {
  if (estado === 'INVALIDADA' || estado === 'CADUCADA') return true;
  if ((estado === 'PENDIENTE' || estado === 'AJUSTE') && isExpired(expiresAt, now)) return true;
  return false;
}

/** ¿El estado admite todavía decisiones de los aprobadores? */
export function isDecidable(estado: ApprovalStatus): boolean {
  return estado === 'PENDIENTE' || estado === 'AJUSTE';
}

/** IDs de personas DISTINTAS que han APROBADO (la última decisión de cada actor manda). */
export function distinctApprovers(decisiones: DecisionRecord[]): string[] {
  const last = new Map<string, ApprovalDecisionKind>();
  for (const d of decisiones) last.set(d.actorUserId, d.decision);
  return [...last.entries()].filter(([, kind]) => kind === 'APRUEBA').map(([userId]) => userId);
}

/** Nº de aprobaciones distintas que faltan para alcanzar `requiredApprovals` (nunca negativo). */
export function approvalsRemaining(decisiones: DecisionRecord[], requiredApprovals: number): number {
  return Math.max(0, requiredApprovals - distinctApprovers(decisiones).length);
}

export interface DecideGateInput {
  estado: ApprovalStatus;
  expiresAt: string | Date;
  solicitanteUserId?: string | null;
  allowSelfApproval: boolean;
  decisiones: DecisionRecord[];
  /** Usuario actual (de la sesión). `null` = sin usuario identificado. */
  userId: string | null;
  /** ¿La sesión tiene rol EDITOR o superior? (el servidor revalida). */
  canEdit: boolean;
  decision: ApprovalDecisionKind;
  now?: number;
}

export type DecideGate = { ok: true } | { ok: false; mensaje: string };

/**
 * ¿Puede el usuario actual registrar esta decisión? Replica en la UI las reglas puras del backend
 * (`policy/approval.rules.ts`): estado decidible, no caducada, sin autoaprobación cuando la política lo prohíbe, y una
 * misma persona no cuenta dos veces para la doble aprobación. El servidor es el gate real; esto solo guía la UI.
 */
export function canDecide(input: DecideGateInput): DecideGate {
  const now = input.now ?? Date.now();
  if (!input.canEdit) return { ok: false, mensaje: 'Se necesita rol Editor o superior para decidir.' };
  if (!input.userId) return { ok: false, mensaje: 'Solo un usuario identificado puede decidir.' };
  if (!isDecidable(input.estado)) {
    return { ok: false, mensaje: `La aprobación en estado ${input.estado} no admite más decisiones.` };
  }
  if (isExpired(input.expiresAt, now)) {
    return { ok: false, mensaje: 'La aprobación caducó y exige una nueva solicitud.' };
  }
  if (input.decision === 'APRUEBA') {
    if (!input.allowSelfApproval && input.userId === input.solicitanteUserId) {
      return { ok: false, mensaje: 'El solicitante no puede aprobar su propia acción.' };
    }
    if (distinctApprovers(input.decisiones).includes(input.userId)) {
      return { ok: false, mensaje: 'Ya aprobó esta acción; la doble aprobación exige dos personas distintas.' };
    }
  }
  return { ok: true };
}

/** ¿El usuario actual es el solicitante de la aprobación? (para diferenciarlo en la UI). */
export function isRequester(solicitanteUserId: string | null | undefined, userId: string | null): boolean {
  return !!userId && !!solicitanteUserId && userId === solicitanteUserId;
}
