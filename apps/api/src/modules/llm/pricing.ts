import type { ModelTier } from '@prisma/client';
import type { TurnUsage } from './llm-provider';

export interface ModelPricing {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  /** Lectura de caché; si es null se usa el precio de entrada. */
  cacheReadUsdPerMTok: number | null;
  /** Tarifa escalonada por longitud del prompt (solo en código, ver `LONG_CONTEXT_PRICING`). */
  longContext?: LongContextPricing;
}

/**
 * Tarifa más alta cuando el prompt de **una** petición supera `thresholdTokens`. El prompt cuenta todos los tokens de
 * entrada, incluidas lecturas y escrituras de caché; cada petición se tarifica por separado y, si supera el umbral,
 * todos sus tokens pagan la tarifa alta (también la parte que es acierto de caché).
 */
export interface LongContextPricing {
  thresholdTokens: number;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  cacheReadUsdPerMTok: number;
}

export interface CatalogModel extends ModelPricing {
  id: string;
  label: string;
  description: string;
  tier: ModelTier;
}

/** Escritura en caché de prompts: recargo sobre el precio de entrada (caché de 5 minutos). */
export const CACHE_WRITE_MULTIPLIER = 1.25;

/**
 * Tarifas de referencia de las conexiones de sistema (USD por millón de tokens).
 * Son valores por defecto: verifique las tarifas vigentes de su proveedor y use conexiones propias para ajustarlas.
 */
export const SYSTEM_ANTHROPIC_MODELS: CatalogModel[] = [
  {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    description: 'Recomendado: razonamiento y agentes de propósito general',
    tier: 'PREMIUM',
    inputUsdPerMTok: 4,
    outputUsdPerMTok: 20,
    cacheReadUsdPerMTok: 0.2,
  },
  {
    id: 'claude-fable-5-1',
    label: 'Claude Fable 5.1',
    description: 'Máxima capacidad para tareas largas y complejas',
    tier: 'PREMIUM',
    inputUsdPerMTok: 10,
    outputUsdPerMTok: 50,
    cacheReadUsdPerMTok: 0.25,
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    description: 'Equilibrio velocidad / capacidad',
    tier: 'STANDARD',
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 10,
    // Lectura de caché de Sonnet 5.5: 0,05x de la entrada (platform.claude.com/docs/en/about-claude/pricing).
    cacheReadUsdPerMTok: 0.1,
  },
  {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    description: 'Rápido y económico para alto volumen',
    tier: 'ECONOMY',
    inputUsdPerMTok: 0.1,
    outputUsdPerMTok: 0.5,
    cacheReadUsdPerMTok: 0.01,
  },
];

export const SYSTEM_MOCK_MODELS: CatalogModel[] = [
  {
    id: 'mock-echo',
    label: 'Mock Echo',
    description: 'Respuestas deterministas para pruebas (tarifa simulada)',
    tier: 'ECONOMY',
    inputUsdPerMTok: 1,
    outputUsdPerMTok: 2,
    cacheReadUsdPerMTok: null,
  },
];

/**
 * Tarifas escalonadas por id de modelo (sin columnas en la base de datos). Fuente: platform.claude.com/docs/en/about-
 * claude/pricing (verificada el 2026-10-24): «Claude Haiku 5.5 (for prompts over 100,000 tokens)» cobra 0,50 USD de
 * entrada, 0,625 de escritura de caché de 5 min (= 1,25x), 0,05 de lectura de caché y 2,50 de salida por MTok; «A
 * request's prompt length counts all of its input tokens, including cache reads and cache writes. Each request is priced
 * on its own». `base` son las tarifas estándar de Anthropic del modelo: la tarifa escalonada solo se aplica a las
 * conexiones que cobran esas mismas tarifas base (API de Anthropic, Foundry). Si el administrador fijó otra tarifa (p. ej.
 * Vertex AI factura con precios de Google), se respeta la suya.
 */
export const LONG_CONTEXT_PRICING: Readonly<
  Record<string, { base: Pick<ModelPricing, 'inputUsdPerMTok' | 'outputUsdPerMTok'>; tier: LongContextPricing }>
> = {
  'claude-haiku-5-5': {
    base: { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 },
    tier: { thresholdTokens: 100_000, inputUsdPerMTok: 0.5, outputUsdPerMTok: 2.5, cacheReadUsdPerMTok: 0.05 },
  },
};

/** Tarifa escalonada aplicable a un modelo con estas tarifas base, o `undefined`. */
export function longContextPricing(
  modelId: string,
  base: Pick<ModelPricing, 'inputUsdPerMTok' | 'outputUsdPerMTok'>,
): LongContextPricing | undefined {
  const entry = LONG_CONTEXT_PRICING[modelId];
  if (!entry) return undefined;
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  return same(entry.base.inputUsdPerMTok, base.inputUsdPerMTok) &&
    same(entry.base.outputUsdPerMTok, base.outputUsdPerMTok)
    ? entry.tier
    : undefined;
}

/** Tokens del prompt de una petición: entrada sin caché + lecturas + escrituras de caché. */
export function promptTokens(usage: TurnUsage): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

/** Costo de **una** petición (un turno); aplica la tarifa escalonada si el prompt supera el umbral. */
export function costUsd(usage: TurnUsage, p: ModelPricing): number {
  const tier = p.longContext && promptTokens(usage) > p.longContext.thresholdTokens ? p.longContext : null;
  const input = tier?.inputUsdPerMTok ?? p.inputUsdPerMTok;
  const output = tier?.outputUsdPerMTok ?? p.outputUsdPerMTok;
  const cacheRead = tier?.cacheReadUsdPerMTok ?? p.cacheReadUsdPerMTok ?? p.inputUsdPerMTok;
  return (
    (usage.inputTokens * input +
      usage.outputTokens * output +
      usage.cacheReadTokens * cacheRead +
      usage.cacheWriteTokens * input * CACHE_WRITE_MULTIPLIER) /
    1_000_000
  );
}
