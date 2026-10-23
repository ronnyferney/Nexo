import { computeHealth, HEALTH_WEIGHTS, levelOf, type HealthFacts } from './agent-health.rules';
import { isWriteOperation } from './agent-health.service';

/** Agente "perfecto": todos los checks aprobados. */
const perfect = (over: Partial<HealthFacts> = {}): HealthFacts => ({
  profile: {
    role: 'Asistente de soporte de primer nivel',
    goals: ['Resolver dudas', 'Escalar casos complejos'],
    responsibilities: ['Responder preguntas frecuentes'],
    boundaries: ['No prometer reembolsos'],
    tone: 'Cercano',
    outputFormat: 'Viñetas',
  },
  systemPrompt: '',
  tools: [],
  knowledgeBases: 0,
  evalCases: 5,
  latestEvalScore: 0.9,
  targetScore: 0.85,
  pendingNegativeFeedback: 0,
  modelTier: 'STANDARD',
  effort: 'medium',
  failedRoutineRuns: 0,
  fallbackModels: 1,
  ...over,
});

const failed = (f: HealthFacts) =>
  computeHealth(f)
    .checks.filter((c) => !c.passed)
    .map((c) => c.id);

describe('Puntaje de salud del agente (ADR 0006 D3)', () => {
  it('los pesos suman 100 y un agente completo obtiene 100 (EXCELLENT)', () => {
    expect(Object.values(HEALTH_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    const h = computeHealth(perfect());
    expect(h).toMatchObject({ score: 100, level: 'EXCELLENT' });
    expect(h.checks).toHaveLength(Object.keys(HEALTH_WEIGHTS).length);
    expect(h.checks.every((c) => c.recommendation && c.message)).toBe(true);
  });

  it('un agente vacío recién creado obtiene 40 (NEEDS_WORK) de forma determinista', () => {
    const empty = perfect({
      profile: { role: '', goals: [], responsibilities: [], boundaries: [], tone: '', outputFormat: '' },
      evalCases: 0,
      latestEvalScore: null,
      fallbackModels: 0,
    });
    // Aprueban: herramientas (12 + 5), conocimiento (8), feedback (5), costo (5), rutinas (5) = 40.
    expect(computeHealth(empty)).toMatchObject({ score: 40, level: 'NEEDS_WORK' });
    expect(failed(empty)).toEqual([
      'profile.role',
      'profile.goals',
      'profile.boundaries',
      'profile.tone-format',
      'quality.eval-cases',
      'quality.last-eval',
      'operations.fallback',
    ]);
  });

  it('herramienta con efecto sin aprobación humana es un check CRITICAL', () => {
    const f = perfect({
      tools: [
        { name: 'CRM · Crear trato', description: 'Crea un trato en el CRM', write: true, requiresApproval: false },
      ],
    });
    const h = computeHealth(f);
    const check = h.checks.find((c) => c.id === 'tools.write-approval')!;
    expect(check).toMatchObject({ passed: false, severity: 'CRITICAL', action: { type: 'OPEN_TAB', tab: 'tools' } });
    expect(check.message).toContain('CRM · Crear trato');
    expect(h.score).toBe(100 - HEALTH_WEIGHTS['tools.write-approval']);
    expect(computeHealth(perfect({ tools: [{ ...f.tools[0], requiresApproval: true }] })).score).toBe(100);
  });

  it('herramientas sin descripción clara', () => {
    const f = perfect({ tools: [{ name: 'API · get', description: 'x', write: false, requiresApproval: false }] });
    expect(failed(f)).toEqual(['tools.descriptions']);
  });

  it('el rol menciona políticas o procesos y no hay bases de conocimiento', () => {
    const base = perfect();
    const f = perfect({ profile: { ...base.profile, role: 'Experto en la política de devoluciones' } });
    expect(failed(f)).toEqual(['knowledge.policies']);
    expect(failed({ ...f, knowledgeBases: 1 })).toEqual([]);
    expect(failed(perfect({ systemPrompt: 'Sigue el procedimiento interno de compras.' }))).toEqual([
      'knowledge.policies',
    ]);
  });

  it('calidad: casos, última evaluación vs meta y feedback negativo pendiente', () => {
    expect(failed(perfect({ evalCases: 4 }))).toEqual(['quality.eval-cases']);
    const below = computeHealth(perfect({ latestEvalScore: 0.6 }));
    expect(below.checks.find((c) => c.id === 'quality.last-eval')).toMatchObject({
      passed: false,
      message: 'Última evaluación: 60% (meta 85%).',
      action: { type: 'COPILOT' },
    });
    expect(failed(perfect({ pendingNegativeFeedback: 2 }))).toEqual(['quality.pending-feedback']);
  });

  it('costo: modelo PREMIUM con esfuerzo bajo sugiere ECONOMY', () => {
    expect(failed(perfect({ modelTier: 'PREMIUM', effort: 'low' }))).toEqual(['cost.model-tier']);
    expect(failed(perfect({ modelTier: 'PREMIUM', effort: 'high' }))).toEqual([]);
  });

  it('operaciones: rutinas con fallos recientes y sin respaldo de modelo', () => {
    expect(failed(perfect({ failedRoutineRuns: 1, fallbackModels: 0 }))).toEqual([
      'operations.routines',
      'operations.fallback',
    ]);
  });

  it('niveles por umbral', () => {
    expect([39, 40, 69, 70, 84, 85].map(levelOf)).toEqual([
      'CRITICAL',
      'NEEDS_WORK',
      'NEEDS_WORK',
      'GOOD',
      'GOOD',
      'EXCELLENT',
    ]);
  });
});

describe('Detección de operaciones con efecto', () => {
  const rest = { type: 'REST' as const, catalogId: null };
  it('usa la marca del catálogo cuando existe', () => {
    expect(isWriteOperation({ type: 'REST', catalogId: 'hubspot' }, { key: 'nope', definition: {} })).toBe(false);
    const hubspot = { type: 'REST' as const, catalogId: 'hubspot' };
    expect(isWriteOperation(hubspot, { key: 'search_contacts', definition: { method: 'POST' } })).toBe(false);
  });

  it('REST por método HTTP, GraphQL por mutación y bases de datos por mode', () => {
    expect(isWriteOperation(rest, { key: 'a', definition: { method: 'GET' } })).toBe(false);
    expect(isWriteOperation(rest, { key: 'a', definition: { method: 'post' } })).toBe(true);
    expect(isWriteOperation(rest, { key: 'a', definition: { method: 'DELETE' } })).toBe(true);
    const gql = { type: 'GRAPHQL' as const, catalogId: null };
    expect(isWriteOperation(gql, { key: 'a', definition: { query: 'query { a }' } })).toBe(false);
    expect(isWriteOperation(gql, { key: 'a', definition: { query: '  mutation X { a }' } })).toBe(true);
    const db = { type: 'DATABASE' as const, catalogId: null };
    expect(isWriteOperation(db, { key: 'a', definition: { mode: 'write', sql: 'update x' } })).toBe(true);
    expect(isWriteOperation(db, { key: 'a', definition: { mode: 'read', sql: 'select 1' } })).toBe(false);
  });
});
