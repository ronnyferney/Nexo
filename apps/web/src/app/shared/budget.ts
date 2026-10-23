import type { BudgetPeriod, BudgetPolicy, LlmKind, ModelTier, Role } from '../core/models';

export type BudgetLevel = 'ok' | 'warn' | 'danger' | 'over';

/** Color de la barra según % consumido: verde < 50, ámbar < 80, rojo ≥ 80, rojo intenso ≥ 100. */
export function budgetLevel(pct: number | null | undefined): BudgetLevel {
  const p = pct ?? 0;
  if (p >= 100) return 'over';
  if (p >= 80) return 'danger';
  if (p >= 50) return 'warn';
  return 'ok';
}

export const PERIOD_LABELS: Record<BudgetPeriod, string> = {
  MONTHLY: 'Mensual',
  QUARTERLY: 'Trimestral',
  YEARLY: 'Anual',
};

export const POLICY_LABELS: Record<BudgetPolicy, string> = {
  BLOCK: 'Bloquear',
  DOWNGRADE: 'Degradar modelo',
  ALERT_ONLY: 'Solo alertar',
};

export const POLICY_HELP: Record<BudgetPolicy, string> = {
  BLOCK: 'Al agotarse el presupuesto se rechazan nuevas llamadas al modelo (HTTP 402) hasta el siguiente periodo.',
  DOWNGRADE:
    'Al agotarse, las nuevas ejecuciones usan el modelo económico configurado. Si no hay modelo de degradación, se bloquea.',
  ALERT_ONLY: 'Nunca bloquea: solo registra alertas al cruzar los umbrales. Útil para observar antes de restringir.',
};

export const TIER_LABELS: Record<ModelTier, string> = {
  PREMIUM: 'Premium',
  STANDARD: 'Estándar',
  ECONOMY: 'Económico',
};

export const KIND_LABELS: Record<LlmKind, string> = {
  ANTHROPIC: 'Anthropic',
  OPENAI_COMPATIBLE: 'Compatible con OpenAI',
  MOCK: 'Simulado (pruebas)',
};

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Propietario',
  ADMIN: 'Administrador',
  EDITOR: 'Editor',
  VIEWER: 'Lector',
};

export function periodLabel(period: string | null | undefined): string {
  return period ? (PERIOD_LABELS[period as BudgetPeriod] ?? period) : '—';
}

/** Ordena elementos de un árbol (id/parentId) en preorden y calcula la profundidad de cada uno. */
export function treeOrder<T>(items: T[], id: (t: T) => string, parentId: (t: T) => string | null): { item: T; depth: number }[] {
  const ids = new Set(items.map(id));
  const children = new Map<string | null, T[]>();
  for (const it of items) {
    const p = parentId(it);
    const key = p && ids.has(p) ? p : null; // huérfanos se tratan como raíces
    children.set(key, [...(children.get(key) ?? []), it]);
  }
  const out: { item: T; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (key: string | null, depth: number) => {
    for (const it of children.get(key) ?? []) {
      if (seen.has(id(it))) continue;
      seen.add(id(it));
      out.push({ item: it, depth });
      walk(id(it), depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
