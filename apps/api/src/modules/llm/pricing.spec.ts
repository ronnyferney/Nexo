import { withLongContext } from './llm-gateway.service';
import { costUsd, longContextPricing, promptTokens, SYSTEM_ANTHROPIC_MODELS, type ModelPricing } from './pricing';

const haiku = SYSTEM_ANTHROPIC_MODELS.find((m) => m.id === 'claude-haiku-5-5')!;
const usage = (input: number, output = 0, cacheRead = 0, cacheWrite = 0) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: cacheRead,
  cacheWriteTokens: cacheWrite,
});

/**
 * Tarifa escalonada de Claude Haiku 5.5 (platform.claude.com/docs/en/about-claude/pricing, «Long context pricing»):
 * más de 100.000 tokens de prompt (entrada + lecturas + escrituras de caché) por petición → 0,50 / 2,50 USD por MTok,
 * 0,05 la lectura de caché y 0,625 la escritura de 5 minutos.
 */
describe('Tarifa escalonada por longitud del prompt (L15)', () => {
  const pricing = withLongContext('claude-haiku-5-5', haiku);

  it('el gateway adjunta la tarifa escalonada solo a Haiku 5.5 con sus tarifas base de Anthropic', () => {
    expect(pricing.longContext).toEqual({
      thresholdTokens: 100_000,
      inputUsdPerMTok: 0.5,
      outputUsdPerMTok: 2.5,
      cacheReadUsdPerMTok: 0.05,
    });
    const opus = SYSTEM_ANTHROPIC_MODELS.find((m) => m.id === 'claude-opus-5-5')!;
    expect(withLongContext('claude-opus-5-5', opus).longContext).toBeUndefined();
    // Tarifas propias del administrador (p. ej. Vertex AI factura con precios de Google): se respetan.
    const custom: ModelPricing = { inputUsdPerMTok: 0.2, outputUsdPerMTok: 1, cacheReadUsdPerMTok: null };
    expect(longContextPricing('claude-haiku-5-5', custom)).toBeUndefined();
    expect(withLongContext('claude-haiku-5-5', custom)).toBe(custom);
  });

  it('hasta 100.000 tokens de prompt cobra la tarifa base', () => {
    expect(costUsd(usage(100_000, 1_000), pricing)).toBeCloseTo((100_000 * 0.1 + 1_000 * 0.5) / 1e6, 10);
  });

  it('por encima del umbral cobra la tarifa alta a todos los tokens de la petición', () => {
    // Antes se aplicaba la tarifa base (0,10/0,50) aunque el prompt superara 100.000 tokens.
    expect(costUsd(usage(100_001, 1_000), pricing)).toBeCloseTo((100_001 * 0.5 + 1_000 * 2.5) / 1e6, 10);
  });

  it('el umbral cuenta lecturas y escrituras de caché, que también pagan la tarifa alta', () => {
    const u = usage(10_000, 2_000, 80_000, 20_000);
    expect(promptTokens(u)).toBe(110_000);
    const expected = (10_000 * 0.5 + 2_000 * 2.5 + 80_000 * 0.05 + 20_000 * 0.5 * 1.25) / 1e6;
    expect(costUsd(u, pricing)).toBeCloseTo(expected, 10);
    // La escritura de caché de 5 minutos queda en 0,625 USD/MTok, como publica Anthropic.
    expect(costUsd(usage(0, 0, 0, 1_000_000), pricing)).toBeCloseTo(0.625, 10);
  });

  it('cada petición se tarifica por separado', () => {
    const small = costUsd(usage(60_000), pricing);
    expect(small).toBeCloseTo(0.006, 10);
    expect(small + small).toBeLessThan(costUsd(usage(120_000), pricing));
  });

  it('sin tarifa escalonada el cálculo no cambia', () => {
    expect(costUsd(usage(1_000_000, 0, 0, 0), haiku)).toBeCloseTo(0.1, 10);
  });
});
