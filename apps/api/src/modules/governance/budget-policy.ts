import type { BudgetPeriod, BudgetPolicy } from '@prisma/client';

/** Clave de periodo en UTC: MONTHLY → 2026-10, QUARTERLY → 2026-Q4, YEARLY → 2026. */
export function periodKey(period: BudgetPeriod, date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  if (period === 'YEARLY') return `${y}`;
  if (period === 'QUARTERLY') return `${y}-Q${Math.floor(m / 3) + 1}`;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Proveedor del simulador: único permitido en el preset de piloto US$ 0 (P0.1b). */
export const MOCK_PROVIDER_ID = 'mock';

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
    /** P1.1c: proceso crítico (no degrada; al tope bloquea). */
    critico: boolean;
    /** P1.1c: existe registro de validación de impacto que habilita la degradación. */
    impactoValidado: boolean;
    /** P0.1: hay una autorización expresa vigente que permite gastar por encima del tope de este nodo. */
    overrideActive: boolean;
  };
  spentUsd: number;
}

/**
 * ¿La degradación automática está habilitada para esta bolsa? (P1.1c) Solo cuando el proceso es NO crítico y existe un
 * registro de validación de impacto. Pura: la usan `preflight` y la configuración para validar antes de guardar.
 */
export function degradacionHabilitada(b: { critico: boolean; impactoValidado: boolean }): boolean {
  return !b.critico && b.impactoValidado;
}

/** ¿El proveedor está permitido bajo el preset de piloto US$ 0? Solo el simulador no genera gasto externo (P0.1b). */
export function pilotoPermiteProveedor(providerId: string): boolean {
  return providerId === MOCK_PROVIDER_ID;
}

/** ¿Hay un override vigente? No revocado y sin expirar (P0.1). */
export function overrideVigente(o: { expiresAt: Date; revokedAt: Date | null }, now = new Date()): boolean {
  return o.revokedAt === null && o.expiresAt.getTime() > now.getTime();
}

export type PreflightDecision =
  | { action: 'allow'; providerId: string; model: string }
  | { action: 'downgrade'; providerId: string; model: string; unitName: string }
  | { action: 'block'; unitName: string; periodKey: string }
  | { action: 'forbidden-model'; unitName: string };

/** Agotado = sin saldo Y sin override vigente (el override deja pasar el consumo pese a estar al tope). */
const exhausted = (s: UnitBudgetState) => !!s.budget && s.spentUsd >= s.budget.limitUsd && !s.budget.overrideActive;

/**
 * ¿El modelo está permitido? Toda unidad de la cadena (unidad → raíz) que restrinja modelos debe incluirlo:
 * una restricción de una unidad superior aplica a todas sus subunidades.
 */
export function modelAllowed(chain: UnitBudgetState[], ref: string): { ok: true } | { ok: false; unitName: string } {
  const denying = chain.find((u) => u.allowedModels.length > 0 && !u.allowedModels.includes(ref));
  return denying ? { ok: false, unitName: denying.name } : { ok: true };
}

/** ¿Esta bolsa agotada debe bloquear? BLOCK siempre; DOWNGRADE si no puede degradar (sin modelo, o proceso crítico sin
 * validación de impacto → P1.1c: en procesos críticos, al tope se bloquea, no se degrada). */
const bloquea = (u: UnitBudgetState) =>
  exhausted(u) &&
  (u.budget!.policy === 'BLOCK' ||
    (u.budget!.policy === 'DOWNGRADE' && (!u.budget!.downgradeModel || !degradacionHabilitada(u.budget!))));

/**
 * Decide qué hacer antes de ejecutar (ADR 0002 D4/D6; P0.1/P1.1c). `chain` va de la unidad/agente imputado a la raíz.
 * - BLOCK agotado en cualquier nivel → bloquear (salvo override vigente, que lo deja pasar).
 * - DOWNGRADE agotado → degrada SOLO si el proceso es no crítico y tiene validación de impacto (P1.1c) y hay modelo;
 *   si es crítico, sin validación o sin modelo configurado → bloquear.
 * - ALERT_ONLY → permitir.
 */
export function preflight(chain: UnitBudgetState[], providerId: string, model: string): PreflightDecision {
  const allowed = modelAllowed(chain, `${providerId}:${model}`);
  if (!allowed.ok) return { action: 'forbidden-model', unitName: allowed.unitName };

  const blocking = chain.find(bloquea);
  if (blocking) return { action: 'block', unitName: blocking.name, periodKey: blocking.budget!.periodKey };

  const downgrading = chain.find(
    (u) => exhausted(u) && u.budget!.policy === 'DOWNGRADE' && degradacionHabilitada(u.budget!),
  );
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

/** Durante la ejecución solo se corta por presupuestos BLOCK agotados (la degradación se decide al inicio). Un override
 * vigente deja pasar el turno (ya contemplado en `exhausted`). */
export function blockingUnit(chain: UnitBudgetState[]): UnitBudgetState | undefined {
  return chain.find((u) => exhausted(u) && u.budget!.policy === 'BLOCK');
}

/** Umbrales (en %) alcanzados con el gasto actual. */
export function reachedThresholds(spentUsd: number, limitUsd: number, thresholds: number[]): number[] {
  if (limitUsd <= 0) return thresholds;
  return thresholds.filter((t) => spentUsd >= (limitUsd * t) / 100);
}
