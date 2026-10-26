import type {
  ActionContext,
  EvaluateInput,
  MatchedPolicy,
  PolicyDecision,
  PolicyEffect,
  PolicyRule,
  PolicySelector,
} from './policy.types';
import { SENSITIVE_ACTION_TYPES } from './policy.types';

/**
 * Motor de políticas PURO (E6 · ADR 0013 D1). Evalúa todas las reglas que aplican y **gana el control más
 * restrictivo**: DENY > REQUIRE_APPROVAL(2) > REQUIRE_APPROVAL(1) > ALLOW. Además de las reglas de BD incorpora
 * controles de plataforma como contribuciones sintéticas (suspensión, presupuesto agotado, verificación cruzada y
 * denegación por defecto de acciones sensibles sin política). Determinista y sin efectos secundarios.
 */

/** Contribución a la decisión (de una regla de BD o de un control de plataforma). */
interface Contribution {
  efecto: PolicyEffect;
  requiredApprovals: number;
  allowSelfApproval: boolean;
  motivo: string;
  matched?: MatchedPolicy;
}

/** Severidad: a mayor número, más restrictivo. REQUIRE_APPROVAL incorpora el nº de aprobaciones. */
function severity(efecto: PolicyEffect, requiredApprovals: number): number {
  switch (efecto) {
    case 'DENY':
      return 1000;
    case 'REQUIRE_APPROVAL':
      return 10 + Math.max(1, requiredApprovals);
    default:
      return 0;
  }
}

function inList(value: string | null | undefined, list?: string[]): boolean {
  if (!list || list.length === 0) return true;
  return value != null && list.includes(value);
}

/** Coincidencia de destinatario: exacta, o por sufijo si el patrón empieza con `*` (p. ej. `*@dominio.com`). */
function recipientMatches(destinatarios: string[] | undefined, patterns?: string[]): boolean {
  if (!patterns || patterns.length === 0) return true;
  if (!destinatarios || destinatarios.length === 0) return false;
  return destinatarios.some((d) =>
    patterns.some((p) => (p.startsWith('*') ? d.toLowerCase().endsWith(p.slice(1).toLowerCase()) : d === p)),
  );
}

function amountMatches(monto: number | null | undefined, selector: PolicySelector): boolean {
  if (selector.montoMin != null) {
    if (monto == null || monto < selector.montoMin) return false;
  }
  if (selector.montoMax != null) {
    if (monto != null && monto > selector.montoMax) return false;
  }
  return true;
}

function scheduleMatches(ctx: ActionContext, selector: PolicySelector): boolean {
  const h = selector.horario;
  if (!h) return true;
  if (h.dias && h.dias.length > 0) {
    if (ctx.diaSemana == null || !h.dias.includes(ctx.diaSemana)) return false;
  }
  if (h.desde != null || h.hasta != null) {
    if (ctx.horaLocal == null) return false;
    const desde = h.desde ?? 0;
    const hasta = h.hasta ?? 24;
    // Ventana normal [desde, hasta); si desde > hasta la ventana cruza la medianoche (p. ej. 22→6).
    const dentro =
      desde <= hasta
        ? ctx.horaLocal >= desde && ctx.horaLocal < hasta
        : ctx.horaLocal >= desde || ctx.horaLocal < hasta;
    if (!dentro) return false;
  }
  return true;
}

/** Una regla aplica si coincide el tipo de acción, el alcance de empresa y todos los campos informados del selector. */
export function selectorMatches(rule: PolicyRule, ctx: ActionContext): boolean {
  if (rule.tipoAccion !== ctx.tipoAccion) return false;
  if (rule.empresaId != null && rule.empresaId !== ctx.empresaId) return false;
  const s = rule.selector ?? {};
  if (!inList(ctx.agentId, s.agentIds)) return false;
  if (!inList(ctx.userId, s.userIds)) return false;
  if (!inList(ctx.orgUnitId, s.orgUnitIds)) return false;
  if (!inList(ctx.conectorId, s.conectorIds)) return false;
  if (!inList(ctx.recurso, s.recursos)) return false;
  if (!inList(ctx.operacion, s.operaciones)) return false;
  if (!inList(ctx.clasificacionDato, s.clasificaciones)) return false;
  if (!recipientMatches(ctx.destinatarios, s.destinatarios)) return false;
  if (!amountMatches(ctx.monto, s)) return false;
  if (!scheduleMatches(ctx, s)) return false;
  return true;
}

function platformContributions(ctx: ActionContext, matchedCount: number, sensitive: readonly string[]): Contribution[] {
  const out: Contribution[] = [];
  if (ctx.suspendido) {
    out.push({ efecto: 'DENY', requiredApprovals: 0, allowSelfApproval: false, motivo: 'SUSPENDIDO' });
  }
  if (ctx.presupuestoBloqueado) {
    out.push({ efecto: 'DENY', requiredApprovals: 0, allowSelfApproval: false, motivo: 'PRESUPUESTO_AGOTADO' });
  }
  if (ctx.requiereRevisionCruzada) {
    out.push({
      efecto: 'REQUIRE_APPROVAL',
      requiredApprovals: 1,
      allowSelfApproval: false,
      motivo: 'VERIFICACION_CRUZADA',
    });
  }
  // Denegación por defecto: tipo sensible sin ninguna política de BD que lo contemple.
  if (matchedCount === 0 && sensitive.includes(ctx.tipoAccion)) {
    out.push({ efecto: 'DENY', requiredApprovals: 0, allowSelfApproval: false, motivo: 'DENEGACION_POR_DEFECTO' });
  }
  return out;
}

export function evaluate(input: EvaluateInput): PolicyDecision {
  const { ctx } = input;
  const sensitive = input.sensitiveActionTypes ?? SENSITIVE_ACTION_TYPES;

  const matchedRules = input.rules.filter((r) => selectorMatches(r, ctx));
  const ruleContribs: Contribution[] = matchedRules.map((r) => ({
    efecto: r.efecto,
    requiredApprovals: r.requiredApprovals,
    allowSelfApproval: r.allowSelfApproval,
    motivo: `POLITICA:${r.id}`,
    matched: { policyId: r.id, version: r.version, efecto: r.efecto, requiredApprovals: r.requiredApprovals },
  }));

  const contribs = [...ruleContribs, ...platformContributions(ctx, matchedRules.length, sensitive)];

  const matched: MatchedPolicy[] = ruleContribs.map((c) => c.matched!).filter(Boolean);

  // Sin ninguna contribución: acción no sensible sin política → ALLOW (compatibilidad con el gate de bajo riesgo).
  if (contribs.length === 0) {
    return {
      efecto: 'ALLOW',
      requiredApprovals: 0,
      allowSelfApproval: true,
      motivo: 'SIN_POLITICA_APLICABLE',
      matched,
    };
  }

  // Gana el control más restrictivo.
  let winner = contribs[0];
  let max = severity(winner.efecto, winner.requiredApprovals);
  for (const c of contribs.slice(1)) {
    const sev = severity(c.efecto, c.requiredApprovals);
    if (sev > max) {
      max = sev;
      winner = c;
    }
  }

  if (winner.efecto === 'REQUIRE_APPROVAL') {
    // El nº de aprobaciones y la autoaprobación toman también el valor más restrictivo entre las reglas ganadoras.
    const approvalContribs = contribs.filter((c) => c.efecto === 'REQUIRE_APPROVAL');
    const requiredApprovals = Math.max(...approvalContribs.map((c) => Math.max(1, c.requiredApprovals)));
    const allowSelfApproval = approvalContribs.every((c) => c.allowSelfApproval);
    return { efecto: 'REQUIRE_APPROVAL', requiredApprovals, allowSelfApproval, motivo: winner.motivo, matched };
  }

  return {
    efecto: winner.efecto,
    requiredApprovals: 0,
    allowSelfApproval: winner.efecto === 'ALLOW',
    motivo: winner.motivo,
    matched,
  };
}
