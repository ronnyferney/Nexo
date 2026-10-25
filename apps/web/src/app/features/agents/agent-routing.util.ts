import type {
  RoutingObjective,
  RoutingPolicy,
  RoutingRulePrefer,
  RoutingRuleWhen,
  RoutingSpecialty,
  RoutingTier,
} from '../../core/models';

/** Valores permitidos por el contrato del backend (ADR 0010 D2), para selectores y normalización. */
export const ROUTING_OBJECTIVES: readonly RoutingObjective[] = ['balanced', 'cost', 'quality'] as const;
export const ROUTING_SPECIALTIES: readonly RoutingSpecialty[] = ['CODE', 'REASONING', 'VISION', 'FAST', 'GENERAL'] as const;
export const ROUTING_TIERS: readonly RoutingTier[] = ['PREMIUM', 'STANDARD', 'ECONOMY'] as const;

/** Tope de intentos por tarea (`maxCandidates`); por defecto 3 (ADR 0010 D7). */
export const MIN_CANDIDATES = 1;
export const MAX_CANDIDATES = 5;
export const DEFAULT_MAX_CANDIDATES = 3;

export const OBJECTIVE_LABELS: Record<RoutingObjective, string> = {
  balanced: 'Equilibrado',
  cost: 'Prioriza costo',
  quality: 'Prioriza calidad',
};

export const OBJECTIVE_HINTS: Record<RoutingObjective, string> = {
  balanced: 'Compensa costo y calidad con una heurística de nivel y precio.',
  cost: 'Elige primero el nivel más económico y el menor precio por millón de tokens.',
  quality: 'Elige primero el nivel más alto disponible.',
};

export const SPECIALTY_LABELS: Record<RoutingSpecialty, string> = {
  CODE: 'Código',
  REASONING: 'Razonamiento',
  VISION: 'Visión',
  FAST: 'Rápido',
  GENERAL: 'General',
};

/** Identificadores de los presets de la UI (ADR 0010 D7 / Consecuencias). */
export type RoutingPresetId = 'balanced' | 'cost' | 'quality' | 'vision';

export interface RoutingPreset {
  id: RoutingPresetId;
  label: string;
  /** Qué hace el preset, en una frase, para documentarlo en la UI. */
  description: string;
  icon: string;
  /** Construye una política nueva e independiente (sin estado compartido). */
  build: () => RoutingPolicy;
}

/**
 * Presets de política razonables. Cada uno rellena `objective` + una regla típica.
 * Son funciones puras que devuelven una copia nueva en cada llamada (sin aliasing).
 */
export const ROUTING_PRESETS: readonly RoutingPreset[] = [
  {
    id: 'balanced',
    label: 'Equilibrado',
    description: 'Compensa costo y calidad. Usa un modelo de visión cuando la entrada trae imágenes.',
    icon: 'shuffle',
    build: () => ({
      objective: 'balanced',
      maxCandidates: DEFAULT_MAX_CANDIDATES,
      rules: [{ when: { hasImages: true }, prefer: { specialties: ['VISION'] } }],
    }),
  },
  {
    id: 'cost',
    label: 'Prioriza costo',
    description: 'Favorece los modelos económicos y rápidos; reduce el número de intentos.',
    icon: 'wallet',
    build: () => ({
      objective: 'cost',
      maxCandidates: 2,
      rules: [{ when: {}, prefer: { tier: 'ECONOMY', specialties: ['FAST'] } }],
    }),
  },
  {
    id: 'quality',
    label: 'Prioriza calidad',
    description: 'Favorece los modelos premium y de razonamiento, al mayor costo.',
    icon: 'trophy',
    build: () => ({
      objective: 'quality',
      maxCandidates: DEFAULT_MAX_CANDIDATES,
      rules: [{ when: { capability: 'REASONING' }, prefer: { tier: 'PREMIUM', specialties: ['REASONING'] } }],
    }),
  },
  {
    id: 'vision',
    label: 'Visión para documentos',
    description: 'Cuando la entrada trae imágenes o documentos, usa un modelo de visión premium.',
    icon: 'eye',
    build: () => ({
      objective: 'balanced',
      maxCandidates: DEFAULT_MAX_CANDIDATES,
      rules: [
        { when: { hasImages: true }, prefer: { specialties: ['VISION'], tier: 'PREMIUM' } },
        { when: {}, prefer: { tier: 'STANDARD' } },
      ],
    }),
  },
];

/** Política base por defecto al activar el enrutamiento sin elegir preset (equilibrado, ADR 0010 D7 decisión 3). */
export function defaultRoutingPolicy(): RoutingPolicy {
  return ROUTING_PRESETS[0]!.build();
}

/** Devuelve la política del preset, o `defaultRoutingPolicy` si el id no existe. */
export function routingPreset(id: RoutingPresetId): RoutingPolicy {
  return (ROUTING_PRESETS.find((p) => p.id === id) ?? ROUTING_PRESETS[0]!).build();
}

/** Encaja `maxCandidates` en el rango permitido, cayendo al valor por defecto si no es un entero válido. */
export function clampMaxCandidates(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_MAX_CANDIDATES;
  return Math.min(MAX_CANDIDATES, Math.max(MIN_CANDIDATES, n));
}

/**
 * Normaliza una política antes de guardarla: aplica el rango de `maxCandidates`, descarta `undefined` en `when`/`prefer`
 * y preserva `verify` (Fase 3) sin tocarlo. Devuelve una copia nueva. `null` si no hay política.
 */
export function normalizeRoutingPolicy(policy: RoutingPolicy | null | undefined): RoutingPolicy | null {
  if (!policy) return null;
  const rules = (policy.rules ?? []).map((r) => {
    const when: RoutingRuleWhen = {};
    if (r.when?.capability) when.capability = r.when.capability;
    if (r.when?.hasImages) when.hasImages = true;
    if (typeof r.when?.minContextTokens === 'number' && r.when.minContextTokens > 0)
      when.minContextTokens = Math.round(r.when.minContextTokens);
    const prefer: RoutingRulePrefer = {};
    if (r.prefer?.specialties?.length) prefer.specialties = [...r.prefer.specialties];
    if (r.prefer?.tier) prefer.tier = r.prefer.tier;
    if (r.prefer?.models?.length) prefer.models = [...r.prefer.models];
    return { when, prefer };
  });
  const normalized: RoutingPolicy = {
    objective: ROUTING_OBJECTIVES.includes(policy.objective) ? policy.objective : 'balanced',
    maxCandidates: clampMaxCandidates(policy.maxCandidates),
    rules,
  };
  // Preserva la verificación cruzada (ADR 0010 D4, Fase 3) exactamente como vino del servidor.
  if (policy.verify !== undefined) normalized.verify = policy.verify;
  return normalized;
}
