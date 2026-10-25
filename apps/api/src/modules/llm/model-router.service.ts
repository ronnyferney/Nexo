import { Injectable } from '@nestjs/common';
import {
  DEFAULT_MAX_CANDIDATES,
  type ModelSpecialty,
  type ModelTier,
  type RoutedCandidate,
  type RoutingCandidate,
  type RoutingContext,
  type RoutingDecision,
  type RoutingNotice,
  type RoutingObjective,
  type RoutingReasonCode,
  type RoutingRule,
  type RoutingSignals,
} from './routing.types';

/**
 * Selector determinista de modelos (ADR 0010, fase 1). Dado el catálogo habilitado del workspace, una política y las
 * señales deterministas de la tarea, devuelve una **lista ordenada** de referencias `"<providerId>:<modelId>"`
 * (primario + respaldos). **No** resuelve, mide ni llama al proveedor; **no** habilita modelos prohibidos ni evade
 * presupuesto: solo decide y ordena sobre lo ya permitido. El filtrado por presupuesto/permiso/degradación lo hace el
 * runtime después (`budgets.plan` + `gateway.resolve`). Función pura: sin BD, sin fechas, sin aleatoriedad.
 */
@Injectable()
export class ModelRouterService {
  route(ctx: RoutingContext): RoutingDecision {
    const notices: RoutingNotice[] = [];
    const { policy, task } = ctx;

    // Motivo de capacidad común a todos los candidatos del pool filtrado (se adjunta a cada uno al final).
    const capabilityReasons: RoutingReasonCode[] = [];
    let pool = ctx.candidates.slice();

    // 1) Filtro por capacidad. La modalidad (imágenes/documentos) exige VISION de forma determinista; en su defecto,
    //    la capacidad la declara la skill o el paso. Sin necesidad declarada no se filtra por capacidad.
    const required = this.requiredCapability(task);
    if (required) {
      const matched = pool.filter((c) => this.hasSpecialty(c, required));
      if (matched.length > 0) {
        pool = matched;
        capabilityReasons.push(required === 'VISION' ? 'VISION_REQUERIDA' : 'CAPACIDAD_REQUERIDA');
      } else {
        // Ninguno declara la capacidad: se usa el conjunto GENERAL con aviso; no se inventa capacidad (ADR 0010 D3.1).
        const general = pool.filter((c) => this.hasSpecialty(c, 'GENERAL'));
        pool = general.length > 0 ? general : pool;
        capabilityReasons.push('CAPACIDAD_NO_DECLARADA');
        notices.push({
          code: 'CAPACIDAD_NO_DECLARADA',
          message: `Ningún modelo declara la capacidad ${required}; se usa el conjunto de propósito general.`,
        });
      }
    }

    // 2) Filtro por contexto: descarta ventanas insuficientes. Una ventana no verificada (null) no se puede descartar.
    if (task.estimatedContextTokens && task.estimatedContextTokens > 0) {
      const need = task.estimatedContextTokens;
      const enough = pool.filter((c) => c.contextTokens == null || c.contextTokens >= need);
      if (enough.length < pool.length) {
        notices.push({
          code: 'CONTEXTO_INSUFICIENTE',
          message: `Se descartaron modelos con ventana de contexto menor que ${need} tokens.`,
        });
      }
      pool = enough;
    }

    if (pool.length === 0) {
      notices.push({
        code: 'SIN_CANDIDATOS',
        message: 'Ningún modelo del catálogo cumple las condiciones de la tarea.',
      });
      return { candidates: [], refs: [], notices };
    }

    // 3) Modelos con precio 0 (needsPricing): no descuentan presupuesto; se dejan al final del orden (ADR 0010 D3).
    const priced = pool.filter((c) => !c.needsPricing);
    const unpriced = pool.filter((c) => c.needsPricing);
    if (unpriced.length > 0) {
      notices.push({
        code: 'PENDIENTES_DE_TARIFA',
        message: 'Hay modelos sin tarifa verificada; se dejan como último recurso del enrutamiento.',
      });
    }

    // 4) Regla de preferencia aplicable (la primera cuyo `when` encaja) y 5) orden por objetivo dentro de cada grupo.
    const rule = this.firstMatchingRule(policy.rules, task);
    const ordered = [...this.order(priced, rule, policy.objective), ...this.order(unpriced, rule, policy.objective)];

    // 6) Recorte a maxCandidates (por defecto 3 intentos totales).
    const max = policy.maxCandidates && policy.maxCandidates > 0 ? policy.maxCandidates : DEFAULT_MAX_CANDIDATES;
    const trimmed = ordered.slice(0, max);
    if (ordered.length > trimmed.length) {
      notices.push({
        code: 'RECORTE_MAX_CANDIDATOS',
        message: `Se limitó la cadena a ${max} candidato(s) de ${ordered.length}.`,
      });
    }

    const objectiveReason = OBJECTIVE_REASON[policy.objective];
    const candidates: RoutedCandidate[] = trimmed.map((c, rank) => {
      const reasons: RoutingReasonCode[] = [...capabilityReasons];
      if (rule && this.matchesPrefer(c, rule)) reasons.push('REGLA_PREFERENCIA');
      reasons.push(objectiveReason);
      if (c.needsPricing) reasons.push('PENDIENTE_DE_TARIFA');
      return { ref: ref(c), providerId: c.providerId, modelId: c.modelId, rank, reasons };
    });

    return { candidates, refs: candidates.map((c) => c.ref), notices };
  }

  /** Capacidad requerida determinista: VISION si hay imágenes/documentos; si no, la declarada por skill/paso. */
  private requiredCapability(task: RoutingSignals): ModelSpecialty | undefined {
    if (task.hasImages || task.hasDocuments) return 'VISION';
    return task.capability;
  }

  private hasSpecialty(c: RoutingCandidate, specialty: ModelSpecialty): boolean {
    return c.specialties.includes(specialty);
  }

  /** Primera regla cuyo `when` aplica a las señales; `undefined` si ninguna. */
  private firstMatchingRule(rules: RoutingRule[] | undefined, task: RoutingSignals): RoutingRule | undefined {
    return (rules ?? []).find((r) => this.whenMatches(r, task));
  }

  private whenMatches(rule: RoutingRule, task: RoutingSignals): boolean {
    const { when } = rule;
    if (when.capability !== undefined && task.capability !== when.capability) return false;
    if (when.hasImages !== undefined && when.hasImages !== !!(task.hasImages || task.hasDocuments)) return false;
    if (when.minContextTokens !== undefined && (task.estimatedContextTokens ?? 0) < when.minContextTokens) return false;
    return true;
  }

  /** Un candidato cumple `prefer` si satisface **todas** las condiciones declaradas (intersección). */
  private matchesPrefer(c: RoutingCandidate, rule: RoutingRule): boolean {
    const { prefer } = rule;
    const empty = !prefer.models?.length && !prefer.tier && !prefer.specialties?.length;
    if (empty) return false;
    if (prefer.models?.length && !prefer.models.includes(ref(c))) return false;
    if (prefer.tier && c.tier !== prefer.tier) return false;
    if (prefer.specialties?.length && !prefer.specialties.some((s) => this.hasSpecialty(c, s))) return false;
    return true;
  }

  /** Ordena una lista: primero los preferidos por la regla, y dentro de cada grupo por el objetivo. */
  private order(
    list: RoutingCandidate[],
    rule: RoutingRule | undefined,
    objective: RoutingObjective,
  ): RoutingCandidate[] {
    const cmp = this.comparator(objective);
    if (!rule) return list.slice().sort(cmp);
    const preferred = list.filter((c) => this.matchesPrefer(c, rule)).sort(cmp);
    const rest = list.filter((c) => !this.matchesPrefer(c, rule)).sort(cmp);
    return [...preferred, ...rest];
  }

  /** Comparador determinista por objetivo; desempate final estable por referencia. */
  private comparator(objective: RoutingObjective): (a: RoutingCandidate, b: RoutingCandidate) => number {
    switch (objective) {
      case 'cost':
        // Tier más económico primero y, a igualdad, menor precio por MTok (entrada + salida).
        return (a, b) => TIER_RANK_COST[a.tier] - TIER_RANK_COST[b.tier] || price(a) - price(b) || byRef(a, b);
      case 'quality':
        // Tier más alto primero y, a igualdad, mayor precio por MTok (proxy de capacidad).
        return (a, b) => TIER_RANK_QUALITY[a.tier] - TIER_RANK_QUALITY[b.tier] || price(b) - price(a) || byRef(a, b);
      case 'balanced':
      default:
        // Equilibrado: mejor relación calidad/precio = valor del tier dividido por (1 + precio por MTok), descendente.
        // Desempate por tier más alto y luego por referencia. Documentado y determinista.
        return (a, b) =>
          valueScore(b) - valueScore(a) || TIER_RANK_QUALITY[a.tier] - TIER_RANK_QUALITY[b.tier] || byRef(a, b);
    }
  }
}

const ref = (c: RoutingCandidate): string => `${c.providerId}:${c.modelId}`;
const price = (c: RoutingCandidate): number => c.inputUsdPerMTok + c.outputUsdPerMTok;
const byRef = (a: RoutingCandidate, b: RoutingCandidate): number => (ref(a) < ref(b) ? -1 : ref(a) > ref(b) ? 1 : 0);

/** Valor de capacidad por tier para la heurística equilibrada. */
const TIER_VALUE: Record<ModelTier, number> = { PREMIUM: 3, STANDARD: 2, ECONOMY: 1 };
const valueScore = (c: RoutingCandidate): number => TIER_VALUE[c.tier] / (1 + price(c));

/** Orden ascendente: económico primero. */
const TIER_RANK_COST: Record<ModelTier, number> = { ECONOMY: 0, STANDARD: 1, PREMIUM: 2 };
/** Orden ascendente: premium primero. */
const TIER_RANK_QUALITY: Record<ModelTier, number> = { PREMIUM: 0, STANDARD: 1, ECONOMY: 2 };

const OBJECTIVE_REASON: Record<RoutingObjective, RoutingReasonCode> = {
  cost: 'OBJETIVO_COSTO',
  quality: 'OBJETIVO_CALIDAD',
  balanced: 'OBJETIVO_EQUILIBRADO',
};
