import type { RoutingPolicy } from '../../core/models';
import {
  clampMaxCandidates,
  DEFAULT_MAX_CANDIDATES,
  defaultRoutingPolicy,
  normalizeRoutingPolicy,
  ROUTING_PRESETS,
  routingPreset,
} from './agent-routing.util';

describe('agent-routing.util', () => {
  describe('ROUTING_PRESETS', () => {
    it('cubre los cuatro presets del ADR 0010', () => {
      expect(ROUTING_PRESETS.map((p) => p.id)).toEqual(['balanced', 'cost', 'quality', 'vision']);
    });

    it('cada preset produce una política con objetivo y al menos una regla', () => {
      for (const p of ROUTING_PRESETS) {
        const policy = p.build();
        expect(['balanced', 'cost', 'quality']).toContain(policy.objective);
        expect(policy.rules?.length).toBeGreaterThan(0);
        expect(policy.maxCandidates).toBeDefined();
        expect(clampMaxCandidates(policy.maxCandidates)).toBe(policy.maxCandidates!);
      }
    });

    it('construye copias independientes (sin estado compartido)', () => {
      const a = routingPreset('balanced');
      const b = routingPreset('balanced');
      expect(a).not.toBe(b);
      a.rules!.push({ when: {}, prefer: {} });
      expect(b.rules!.length).toBe(1);
    });

    it('prioriza costo elige nivel económico y objetivo cost', () => {
      const policy = routingPreset('cost');
      expect(policy.objective).toBe('cost');
      expect(policy.rules![0]!.prefer.tier).toBe('ECONOMY');
    });

    it('visión para documentos prefiere VISION cuando hay imágenes', () => {
      const policy = routingPreset('vision');
      const imageRule = policy.rules!.find((r) => r.when.hasImages);
      expect(imageRule?.prefer.specialties).toContain('VISION');
    });

    it('id desconocido cae al preset equilibrado', () => {
      expect(routingPreset('inexistente' as never)).toEqual(defaultRoutingPolicy());
    });
  });

  describe('clampMaxCandidates', () => {
    it('respeta el rango 1..5', () => {
      expect(clampMaxCandidates(0)).toBe(1);
      expect(clampMaxCandidates(99)).toBe(5);
      expect(clampMaxCandidates(3)).toBe(3);
    });

    it('cae al valor por defecto con entradas inválidas', () => {
      expect(clampMaxCandidates('abc')).toBe(DEFAULT_MAX_CANDIDATES);
      expect(clampMaxCandidates(undefined)).toBe(DEFAULT_MAX_CANDIDATES);
    });

    it('redondea valores fraccionarios', () => {
      expect(clampMaxCandidates(2.6)).toBe(3);
    });
  });

  describe('normalizeRoutingPolicy', () => {
    it('devuelve null cuando no hay política (comportamiento actual)', () => {
      expect(normalizeRoutingPolicy(null)).toBeNull();
      expect(normalizeRoutingPolicy(undefined)).toBeNull();
    });

    it('descarta campos vacíos de when/prefer y aplica el rango de maxCandidates', () => {
      const dirty: RoutingPolicy = {
        objective: 'balanced',
        maxCandidates: 42,
        rules: [
          {
            when: { capability: undefined, hasImages: false, minContextTokens: 0 },
            prefer: { specialties: [], tier: undefined, models: [] },
          },
        ],
      };
      const clean = normalizeRoutingPolicy(dirty)!;
      expect(clean.maxCandidates).toBe(5);
      expect(clean.rules![0]!.when).toEqual({});
      expect(clean.rules![0]!.prefer).toEqual({});
    });

    it('conserva la verificación cruzada (verify, Fase 3) sin tocarla', () => {
      const withVerify: RoutingPolicy = {
        objective: 'quality',
        rules: [],
        verify: { enabled: true, verifierModel: 'openai:gpt-x', crossVendor: true },
      };
      const clean = normalizeRoutingPolicy(withVerify)!;
      expect(clean.verify).toEqual(withVerify.verify);
    });

    it('normaliza un objetivo desconocido a balanced', () => {
      const clean = normalizeRoutingPolicy({ objective: 'raro' as never, rules: [] })!;
      expect(clean.objective).toBe('balanced');
    });

    it('conserva los modelos preferidos de una regla', () => {
      const policy: RoutingPolicy = {
        objective: 'balanced',
        rules: [{ when: {}, prefer: { models: ['anthropic:claude-opus-5-5'] } }],
      };
      const clean = normalizeRoutingPolicy(policy)!;
      expect(clean.rules![0]!.prefer.models).toEqual(['anthropic:claude-opus-5-5']);
    });
  });
});
