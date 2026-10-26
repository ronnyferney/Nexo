/**
 * Reglas PURAS de la bandeja de aprobaciones (E6 · ADR 0013 D3). Sin Nest ni Prisma: la invalidación por hash, la
 * doble aprobación, la prohibición de autoaprobación y la caducidad se prueban de forma aislada. La persistencia y la
 * recomputación del hash viven en el servicio.
 */

export type ResultadoValidacion = { ok: true } | { ok: false; mensaje: string };

export type ApprovalDecisionKind = 'APRUEBA' | 'RECHAZA' | 'AJUSTE';

export type ApprovalStatus =
  'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | 'AJUSTE' | 'EJECUTADA' | 'CADUCADA' | 'INVALIDADA';

export interface DecisionRecord {
  actorUserId: string;
  decision: ApprovalDecisionKind;
  comentario?: string | null;
  at: string;
}

export interface ApprovalState {
  estado: ApprovalStatus;
  requiredApprovals: number;
  allowSelfApproval: boolean;
  solicitanteUserId?: string | null;
  decisiones: DecisionRecord[];
  expiresAt: Date;
  contentHash: string;
}

export function isExpired(state: Pick<ApprovalState, 'expiresAt'>, now = new Date()): boolean {
  return state.expiresAt.getTime() <= now.getTime();
}

/** Nº de personas DISTINTAS que han aprobado (la última decisión de cada actor manda). */
export function distinctApprovers(decisiones: DecisionRecord[]): string[] {
  const last = new Map<string, ApprovalDecisionKind>();
  for (const d of decisiones) last.set(d.actorUserId, d.decision);
  return [...last.entries()].filter(([, kind]) => kind === 'APRUEBA').map(([userId]) => userId);
}

/** Valida si un actor puede registrar una decisión (antes de aplicarla). */
export function canRegisterDecision(
  state: ApprovalState,
  actorUserId: string,
  kind: ApprovalDecisionKind,
  now = new Date(),
): ResultadoValidacion {
  if (state.estado !== 'PENDIENTE' && state.estado !== 'AJUSTE') {
    return { ok: false, mensaje: `La aprobación en estado ${state.estado} no admite más decisiones.` };
  }
  if (isExpired(state, now)) {
    return { ok: false, mensaje: 'La aprobación ha caducado y exige una nueva solicitud.' };
  }
  // Sin autoaprobación cuando la política lo prohíbe (QA13, aplica también al superempleado).
  if (kind === 'APRUEBA' && !state.allowSelfApproval && actorUserId === state.solicitanteUserId) {
    return { ok: false, mensaje: 'El solicitante no puede aprobar su propia acción (autoaprobación prohibida).' };
  }
  // Un mismo actor no cuenta dos veces para la doble aprobación.
  if (kind === 'APRUEBA' && distinctApprovers(state.decisiones).includes(actorUserId)) {
    return {
      ok: false,
      mensaje: 'Este aprobador ya aprobó la acción; la doble aprobación exige dos personas distintas.',
    };
  }
  return { ok: true };
}

/** Aplica una decisión y devuelve el nuevo estado (puro). Supone que `canRegisterDecision` pasó. */
export function applyDecision(
  state: ApprovalState,
  record: DecisionRecord,
): { estado: ApprovalStatus; decisiones: DecisionRecord[] } {
  const decisiones = [...state.decisiones, record];
  if (record.decision === 'RECHAZA') return { estado: 'RECHAZADA', decisiones };
  if (record.decision === 'AJUSTE') return { estado: 'AJUSTE', decisiones };
  const aprobadores = distinctApprovers(decisiones);
  const estado: ApprovalStatus = aprobadores.length >= state.requiredApprovals ? 'APROBADA' : 'PENDIENTE';
  return { estado, decisiones };
}

export interface ExecutionCheckInput {
  state: ApprovalState;
  /** Hash recomputado del contenido/destinatarios/monto/adjuntos/herramienta/versión ACTUALES. */
  recomputedHash: string;
  /** Si todos los aprobadores conservan sus atribuciones (QA07). */
  approversStillAuthorized: boolean;
  now?: Date;
}

export type ExecutionCheck =
  { ok: true } | { ok: false; estado: 'CADUCADA' | 'INVALIDADA' | 'RECHAZADA'; motivo: string };

/** Revalidación justo antes del efecto (ADR 0013 D3): aprobada + vigente + hash intacto + aprobadores con permiso. */
export function executionCheck(input: ExecutionCheckInput): ExecutionCheck {
  const { state, recomputedHash, approversStillAuthorized } = input;
  const now = input.now ?? new Date();
  if (state.estado !== 'APROBADA') {
    return { ok: false, estado: 'RECHAZADA', motivo: `La aprobación no está APROBADA (estado ${state.estado}).` };
  }
  if (isExpired(state, now)) {
    return { ok: false, estado: 'CADUCADA', motivo: 'La aprobación caducó antes de ejecutarse.' };
  }
  if (recomputedHash !== state.contentHash) {
    return { ok: false, estado: 'INVALIDADA', motivo: 'El contenido cambió respecto a lo aprobado (hash distinto).' };
  }
  if (!approversStillAuthorized) {
    return { ok: false, estado: 'INVALIDADA', motivo: 'Un aprobador perdió sus atribuciones.' };
  }
  return { ok: true };
}
