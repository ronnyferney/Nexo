import type { ModelTier } from '@prisma/client';
import type { TurnUsage } from './llm-provider';

export interface ModelPricing {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  /** Lectura de caché; si es null se usa el precio de entrada. */
  cacheReadUsdPerMTok: number | null;
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

export function costUsd(usage: TurnUsage, p: ModelPricing): number {
  const cacheRead = p.cacheReadUsdPerMTok ?? p.inputUsdPerMTok;
  return (
    (usage.inputTokens * p.inputUsdPerMTok +
      usage.outputTokens * p.outputUsdPerMTok +
      usage.cacheReadTokens * cacheRead +
      usage.cacheWriteTokens * p.inputUsdPerMTok * CACHE_WRITE_MULTIPLIER) /
    1_000_000
  );
}
