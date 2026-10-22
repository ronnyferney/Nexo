import type { BudgetPeriod, BudgetPolicy } from '@prisma/client';

/** Clave de periodo en UTC: MONTHLY → 2026-10, QUARTERLY → 2026-Q4, YEARLY → 2026. */
export function periodKey(period: BudgetPeriod, date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  if (period === 'YEARLY') return `${y}`;
  if (period === 'QUARTERLY') return `${y}-Q${Math.floor(m / 3) + 1}`;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

export interface UnitBudgetState {
  orgUnitId: string;
  name: string;
  allowedModels: string[];
  budget: null | {
    policy: BudgetPolicy;
    limitUsd: number;
    periodKey: string;
    downgradeProviderId: string | null;
    downgradeModel: string | null;
  };
  spentUsd: number;
}

export type PreflightDecision =
  | { action: 'allow'; providerId: string; model: string }
  | { action: 'downgrade'; providerId: string; model: string; unitName: string }
  | { action: 'block'; unitName: string; periodKey: string }
  | { action: 'forbidden-model'; unitName: string };

const exhausted = (s: UnitBudgetState) => !!s.budget && s.spentUsd >= s.budget.limitUsd;

/** ¿El modelo está permitido? La primera unidad de la cadena (unidad → raíz) con restricciones manda. */
export function modelAllowed(chain: UnitBudgetState[], ref: string): { ok: true } | { ok: false; unitName: string } {
  const restricting = chain.find((u) => u.allowedModels.length > 0);
  if (!restricting || restricting.allowedModels.includes(ref)) return { ok: true };
  return { ok: false, unitName: restricting.name };
}

/**
 * Decide qué hacer antes de ejecutar (ADR 0002 D4/D6). `chain` va de la unidad imputada a la raíz.
 * - BLOCK agotado en cualquier nivel → bloquear.
 * - DOWNGRADE agotado → usar el modelo de degradación de la unidad más cercana; sin modelo configurado → bloquear.
 * - ALERT_ONLY → permitir.
 */
export function preflight(chain: UnitBudgetState[], providerId: string, model: string): PreflightDecision {
  const allowed = modelAllowed(chain, `${providerId}:${model}`);
  if (!allowed.ok) return { action: 'forbidden-model', unitName: allowed.unitName };

  const blocking = chain.find(
    (u) =>
      exhausted(u) && (u.budget!.policy === 'BLOCK' || (u.budget!.policy === 'DOWNGRADE' && !u.budget!.downgradeModel)),
  );
  if (blocking) return { action: 'block', unitName: blocking.name, periodKey: blocking.budget!.periodKey };

  const downgrading = chain.find((u) => exhausted(u) && u.budget!.policy === 'DOWNGRADE');
  if (downgrading) {
    const b = downgrading.budget!;
    const target = { providerId: b.downgradeProviderId ?? providerId, model: b.downgradeModel! };
    if (target.providerId === providerId && target.model === model) return { action: 'allow', providerId, model };
    if (!modelAllowed(chain, `${target.providerId}:${target.model}`).ok) {
      return { action: 'block', unitName: downgrading.name, periodKey: b.periodKey };
    }
    return { action: 'downgrade', ...target, unitName: downgrading.name };
  }
  return { action: 'allow', providerId, model };
}

/** Durante la ejecución solo se corta por presupuestos BLOCK agotados (la degradación se decide al inicio). */
export function blockingUnit(chain: UnitBudgetState[]): UnitBudgetState | undefined {
  return chain.find((u) => exhausted(u) && u.budget!.policy === 'BLOCK');
}

/** Umbrales (en %) alcanzados con el gasto actual. */
export function reachedThresholds(spentUsd: number, limitUsd: number, thresholds: number[]): number[] {
  if (limitUsd <= 0) return thresholds;
  return thresholds.filter((t) => spentUsd >= (limitUsd * t) / 100);
}
