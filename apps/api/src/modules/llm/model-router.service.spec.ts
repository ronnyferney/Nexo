import { ModelRouterService } from './model-router.service';
import type { RoutingCandidate, RoutingContext, RoutingPolicy, RoutingSignals } from './routing.types';
import { DEFAULT_MAX_CANDIDATES } from './routing.types';

/** Fábrica de candidatos con valores por defecto razonables; se sobreescribe lo que cada prueba necesita. */
const cand = (
  over: Partial<RoutingCandidate> & Pick<RoutingCandidate, 'providerId' | 'modelId'>,
): RoutingCandidate => ({
  tier: 'STANDARD',
  specialties: ['GENERAL'],
  contextTokens: 200_000,
  inputUsdPerMTok: 1,
  outputUsdPerMTok: 5,
  needsPricing: false,
  ...over,
});

const run = (
  candidates: RoutingCandidate[],
  policy: RoutingPolicy,
  task: RoutingSignals = {},
): ReturnType<ModelRouterService['route']> => {
  const ctx: RoutingContext = { candidates, policy, task };
  return new ModelRouterService().route(ctx);
};

describe('ModelRouterService (ADR 0010, fase 1)', () => {
  describe('filtro por capacidad', () => {
    it('la modalidad con imágenes exige VISION de forma determinista', () => {
      const vision = cand({ providerId: 'p', modelId: 've', specialties: ['VISION'] });
      const code = cand({ providerId: 'p', modelId: 'co', specialties: ['CODE'] });
      const d = run([code, vision], { objective: 'balanced' }, { hasImages: true });
      expect(d.refs).toEqual(['p:ve']);
      expect(d.candidates[0].reasons).toContain('VISION_REQUERIDA');
    });

    it('los documentos adjuntos también exigen VISION', () => {
      const vision = cand({ providerId: 'p', modelId: 've', specialties: ['VISION', 'GENERAL'] });
      const general = cand({ providerId: 'p', modelId: 'ge', specialties: ['GENERAL'] });
      const d = run([general, vision], { objective: 'balanced' }, { hasDocuments: true });
      expect(d.refs).toEqual(['p:ve']);
    });

    it('la capacidad declarada por skill/paso filtra el pool', () => {
      const code = cand({ providerId: 'p', modelId: 'co', specialties: ['CODE'] });
      const general = cand({ providerId: 'p', modelId: 'ge', specialties: ['GENERAL'] });
      const d = run([general, code], { objective: 'balanced' }, { capability: 'CODE' });
      expect(d.refs).toEqual(['p:co']);
      expect(d.candidates[0].reasons).toContain('CAPACIDAD_REQUERIDA');
    });

    it('si ninguno declara la capacidad usa el conjunto GENERAL con aviso (no inventa capacidad)', () => {
      const g1 = cand({ providerId: 'p', modelId: 'g1', specialties: ['GENERAL'] });
      const g2 = cand({ providerId: 'p', modelId: 'g2', specialties: ['GENERAL', 'FAST'] });
      const code = cand({ providerId: 'p', modelId: 'co', specialties: ['CODE'] });
      const d = run([g1, g2, code], { objective: 'balanced' }, { capability: 'REASONING' });
      expect(d.refs.sort()).toEqual(['p:g1', 'p:g2']);
      expect(d.notices.map((n) => n.code)).toContain('CAPACIDAD_NO_DECLARADA');
      expect(d.candidates.every((c) => c.reasons.includes('CAPACIDAD_NO_DECLARADA'))).toBe(true);
    });

    it('sin capacidad ni modalidad no filtra por capacidad', () => {
      const a = cand({ providerId: 'p', modelId: 'a', specialties: ['CODE'] });
      const b = cand({ providerId: 'p', modelId: 'b', specialties: ['VISION'] });
      const d = run([a, b], { objective: 'balanced' }, {});
      expect(d.refs.sort()).toEqual(['p:a', 'p:b']);
    });
  });

  describe('filtro por contexto', () => {
    it('descarta ventanas insuficientes y emite aviso', () => {
      const small = cand({ providerId: 'p', modelId: 's', contextTokens: 8_000 });
      const big = cand({ providerId: 'p', modelId: 'b', contextTokens: 400_000 });
      const d = run([small, big], { objective: 'balanced' }, { estimatedContextTokens: 100_000 });
      expect(d.refs).toEqual(['p:b']);
      expect(d.notices.map((n) => n.code)).toContain('CONTEXTO_INSUFICIENTE');
    });

    it('no descarta modelos con ventana no verificada (null)', () => {
      const unknown = cand({ providerId: 'p', modelId: 'u', contextTokens: null });
      const d = run([unknown], { objective: 'balanced' }, { estimatedContextTokens: 1_000_000 });
      expect(d.refs).toEqual(['p:u']);
    });

    it('si el contexto vacía el pool devuelve lista vacía con aviso SIN_CANDIDATOS', () => {
      const small = cand({ providerId: 'p', modelId: 's', contextTokens: 8_000 });
      const d = run([small], { objective: 'balanced' }, { estimatedContextTokens: 500_000 });
      expect(d.refs).toEqual([]);
      expect(d.candidates).toEqual([]);
      expect(d.notices.map((n) => n.code)).toContain('SIN_CANDIDATOS');
    });
  });

  describe('orden por objetivo', () => {
    const premium = cand({
      providerId: 'p',
      modelId: 'prem',
      tier: 'PREMIUM',
      inputUsdPerMTok: 10,
      outputUsdPerMTok: 50,
    });
    const standard = cand({
      providerId: 'p',
      modelId: 'std',
      tier: 'STANDARD',
      inputUsdPerMTok: 2,
      outputUsdPerMTok: 10,
    });
    const economy = cand({
      providerId: 'p',
      modelId: 'eco',
      tier: 'ECONOMY',
      inputUsdPerMTok: 0.1,
      outputUsdPerMTok: 0.5,
    });

    it('cost: tier económico y menor precio primero', () => {
      const d = run([premium, standard, economy], { objective: 'cost', maxCandidates: 3 });
      expect(d.refs).toEqual(['p:eco', 'p:std', 'p:prem']);
      expect(d.candidates[0].reasons).toContain('OBJETIVO_COSTO');
    });

    it('cost: a igualdad de tier, desempata por menor precio por MTok', () => {
      const cheap = cand({
        providerId: 'p',
        modelId: 'cheap',
        tier: 'STANDARD',
        inputUsdPerMTok: 1,
        outputUsdPerMTok: 2,
      });
      const dear = cand({
        providerId: 'p',
        modelId: 'dear',
        tier: 'STANDARD',
        inputUsdPerMTok: 3,
        outputUsdPerMTok: 9,
      });
      const d = run([dear, cheap], { objective: 'cost' });
      expect(d.refs).toEqual(['p:cheap', 'p:dear']);
    });

    it('quality: tier más alto primero', () => {
      const d = run([economy, standard, premium], { objective: 'quality' });
      expect(d.refs).toEqual(['p:prem', 'p:std', 'p:eco']);
      expect(d.candidates[0].reasons).toContain('OBJETIVO_CALIDAD');
    });

    it('balanced: mejor relación calidad/precio primero', () => {
      // economy tiene mejor valor/precio; premium el peor pese a su tier alto.
      const d = run([premium, standard, economy], { objective: 'balanced' });
      expect(d.refs[0]).toBe('p:eco');
      expect(d.candidates[0].reasons).toContain('OBJETIVO_EQUILIBRADO');
    });

    it('es determinista: desempate estable por referencia', () => {
      const a = cand({ providerId: 'p', modelId: 'a', tier: 'STANDARD' });
      const b = cand({ providerId: 'p', modelId: 'b', tier: 'STANDARD' });
      const first = run([a, b], { objective: 'cost' }).refs;
      const second = run([b, a], { objective: 'cost' }).refs;
      expect(first).toEqual(second);
      expect(first).toEqual(['p:a', 'p:b']);
    });
  });

  describe('reglas de preferencia', () => {
    it('la primera regla aplicable empuja al frente a los candidatos preferidos', () => {
      const a = cand({ providerId: 'p', modelId: 'a', tier: 'ECONOMY', inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 });
      const b = cand({ providerId: 'p', modelId: 'b', tier: 'PREMIUM', inputUsdPerMTok: 10, outputUsdPerMTok: 50 });
      const policy: RoutingPolicy = {
        objective: 'cost',
        rules: [{ when: {}, prefer: { models: ['p:b'] } }],
      };
      const d = run([a, b], policy);
      expect(d.refs).toEqual(['p:b', 'p:a']);
      expect(d.candidates[0].reasons).toContain('REGLA_PREFERENCIA');
      expect(d.candidates[1].reasons).not.toContain('REGLA_PREFERENCIA');
    });

    it('solo aplica la regla cuyo `when` encaja con las señales', () => {
      const fast = cand({ providerId: 'p', modelId: 'fast', specialties: ['FAST', 'GENERAL'], tier: 'ECONOMY' });
      const reason = cand({
        providerId: 'p',
        modelId: 'reason',
        specialties: ['REASONING', 'GENERAL'],
        tier: 'PREMIUM',
      });
      const policy: RoutingPolicy = {
        objective: 'quality',
        rules: [
          { when: { capability: 'CODE' }, prefer: { models: ['p:fast'] } },
          { when: { minContextTokens: 50_000 }, prefer: { specialties: ['FAST'] } },
        ],
      };
      // La primera no encaja (capability != CODE); la segunda sí (contexto >= 50k) y prefiere FAST.
      const d = run([reason, fast], policy, { estimatedContextTokens: 80_000 });
      expect(d.refs).toEqual(['p:fast', 'p:reason']);
    });
  });

  describe('needsPricing', () => {
    it('deja los modelos sin tarifa al final con aviso', () => {
      const priced = cand({ providerId: 'p', modelId: 'priced', tier: 'PREMIUM' });
      const free = cand({
        providerId: 'p',
        modelId: 'free',
        tier: 'ECONOMY',
        needsPricing: true,
        inputUsdPerMTok: 0,
        outputUsdPerMTok: 0,
      });
      const d = run([free, priced], { objective: 'cost' });
      expect(d.refs).toEqual(['p:priced', 'p:free']);
      expect(d.candidates[1].reasons).toContain('PENDIENTE_DE_TARIFA');
      expect(d.notices.map((n) => n.code)).toContain('PENDIENTES_DE_TARIFA');
    });
  });

  describe('recorte a maxCandidates', () => {
    it('recorta a maxCandidates y avisa', () => {
      const list = [1, 2, 3, 4, 5].map((n) =>
        cand({ providerId: 'p', modelId: `m${n}`, inputUsdPerMTok: n, outputUsdPerMTok: n }),
      );
      const d = run(list, { objective: 'cost', maxCandidates: 2 });
      expect(d.refs).toEqual(['p:m1', 'p:m2']);
      expect(d.candidates.map((c) => c.rank)).toEqual([0, 1]);
      expect(d.notices.map((n) => n.code)).toContain('RECORTE_MAX_CANDIDATOS');
    });

    it('por defecto limita a 3 intentos totales', () => {
      const list = [1, 2, 3, 4].map((n) =>
        cand({ providerId: 'p', modelId: `m${n}`, inputUsdPerMTok: n, outputUsdPerMTok: n }),
      );
      const d = run(list, { objective: 'cost' });
      expect(d.refs.length).toBe(DEFAULT_MAX_CANDIDATES);
      expect(d.refs).toEqual(['p:m1', 'p:m2', 'p:m3']);
    });
  });

  it('las referencias usan el formato "<providerId>:<modelId>" (modelo con ":")', () => {
    const c = cand({ providerId: 'ollama', modelId: 'llama3:8b' });
    const d = run([c], { objective: 'balanced' });
    expect(d.refs).toEqual(['ollama:llama3:8b']);
  });
});
