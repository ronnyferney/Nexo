import type { HealthCheck, HealthLevel } from './agent-access.types';

/**
 * Reglas deterministas del puntaje de salud (ADR 0006 D3). Sin IA ni red: solo hechos ya leídos de la base.
 *
 * Pesos (suman 100; el puntaje es la suma de los pesos de los checks aprobados):
 *
 * | Check                       | Categoría  | Peso | Severidad |
 * |-----------------------------|------------|------|-----------|
 * | profile.role                | PROFILE    | 11   | CRITICAL  |
 * | profile.goals (≥ 2)         | PROFILE    | 8    | WARNING   |
 * | profile.boundaries (≥ 1)    | PROFILE    | 9    | WARNING   |
 * | profile.tone-format         | PROFILE    | 5    | INFO      |
 * | tools.write-approval        | TOOLS      | 12   | CRITICAL  |
 * | tools.descriptions          | TOOLS      | 5    | WARNING   |
 * | knowledge.policies          | KNOWLEDGE  | 8    | WARNING   |
 * | quality.eval-cases (≥ 5)    | QUALITY    | 10   | WARNING   |
 * | quality.last-eval (≥ meta)  | QUALITY    | 12   | WARNING   |
 * | quality.pending-feedback    | QUALITY    | 5    | WARNING   |
 * | cost.model-tier             | COST       | 5    | INFO      |
 * | operations.routines         | OPERATIONS | 5    | WARNING   |
 * | operations.fallback         | OPERATIONS | 5    | INFO      |
 *
 * Niveles: < 40 CRITICAL · 40–69 NEEDS_WORK · 70–84 GOOD · ≥ 85 EXCELLENT. El lanzamiento exige ≥ 70 (`LAUNCH_MIN_SCORE`).
 * Los checks que no aplican (p. ej. herramientas cuando el agente no tiene) se consideran aprobados.
 */
export const HEALTH_WEIGHTS = {
  'profile.role': 11,
  'profile.goals': 8,
  'profile.boundaries': 9,
  'profile.tone-format': 5,
  'tools.write-approval': 12,
  'tools.descriptions': 5,
  'knowledge.policies': 8,
  'quality.eval-cases': 10,
  'quality.last-eval': 12,
  'quality.pending-feedback': 5,
  'cost.model-tier': 5,
  'operations.routines': 5,
  'operations.fallback': 5,
} as const;

export type HealthCheckId = keyof typeof HEALTH_WEIGHTS;

export const LAUNCH_MIN_SCORE = 70;
export const MIN_EVAL_CASES = 5;
export const MIN_GOALS = 2;
/** Descripción mínima para que el modelo sepa cuándo usar una herramienta. */
export const MIN_TOOL_DESCRIPTION = 20;
/** Ventana de corridas de rutinas que se consideran "recientes". */
export const ROUTINE_WINDOW_DAYS = 7;

/** El rol, las responsabilidades o las instrucciones mencionan políticas o procesos de la empresa. */
export const POLICY_PATTERN =
  /\b(pol[ií]ticas?|procesos?|procedimientos?|normas?|normativas?|reglamentos?|manual(es)?|protocolos?|lineamientos?)\b/i;

export interface HealthTool {
  name: string;
  description: string | null;
  /** La operación crea/modifica datos (marca del catálogo, método HTTP, mutación GraphQL o `mode: 'write'`). */
  write: boolean;
  requiresApproval: boolean;
}

export interface HealthFacts {
  profile: {
    role: string;
    goals: string[];
    responsibilities: string[];
    boundaries: string[];
    tone: string;
    outputFormat: string;
  };
  systemPrompt: string;
  tools: HealthTool[];
  knowledgeBases: number;
  evalCases: number;
  /** Puntaje de la última corrida terminada con puntaje (0..1) o null si nunca se evaluó. */
  latestEvalScore: number | null;
  targetScore: number;
  pendingNegativeFeedback: number;
  modelTier: 'PREMIUM' | 'STANDARD' | 'ECONOMY' | null;
  effort: string;
  failedRoutineRuns: number;
  fallbackModels: number;
}

export function levelOf(score: number): HealthLevel {
  if (score >= 85) return 'EXCELLENT';
  if (score >= LAUNCH_MIN_SCORE) return 'GOOD';
  if (score >= 40) return 'NEEDS_WORK';
  return 'CRITICAL';
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const filled = (list: string[]) => list.map((s) => s.trim()).filter(Boolean);

type Rule = Omit<HealthCheck, 'id' | 'category'> & { id: HealthCheckId; category: HealthCheck['category'] };

/** Evalúa todas las reglas. El orden de `checks` es estable (el de la tabla). */
export function computeHealth(f: HealthFacts): { score: number; level: HealthLevel; checks: HealthCheck[] } {
  const goals = filled(f.profile.goals);
  const boundaries = filled(f.profile.boundaries);
  const writeUnapproved = f.tools.filter((t) => t.write && !t.requiresApproval);
  const vague = f.tools.filter((t) => (t.description ?? '').trim().length < MIN_TOOL_DESCRIPTION);
  const roleText = [f.profile.role, ...f.profile.responsibilities, f.systemPrompt].join('\n');
  const needsKnowledge = POLICY_PATTERN.test(roleText);

  const checks: Rule[] = [
    {
      id: 'profile.role',
      category: 'PROFILE',
      severity: 'CRITICAL',
      passed: f.profile.role.trim().length > 0,
      message: f.profile.role.trim() ? 'El rol del agente está definido.' : 'El agente no tiene un rol definido.',
      recommendation: 'Describa en una o dos frases quién es el agente, para quién trabaja y qué problema resuelve.',
      action: { type: 'COPILOT', prompt: 'Ayúdame a definir el rol de este agente a partir de su propósito.' },
    },
    {
      id: 'profile.goals',
      category: 'PROFILE',
      severity: 'WARNING',
      passed: goals.length >= MIN_GOALS,
      message: `El agente tiene ${goals.length} objetivo(s) (mínimo recomendado: ${MIN_GOALS}).`,
      recommendation: 'Liste al menos dos objetivos medibles: qué debe lograr el agente en cada conversación.',
      action: { type: 'OPEN_TAB', tab: 'profile' },
    },
    {
      id: 'profile.boundaries',
      category: 'PROFILE',
      severity: 'WARNING',
      passed: boundaries.length >= 1,
      message: boundaries.length
        ? `El agente tiene ${boundaries.length} límite(s) explícito(s).`
        : 'El agente no tiene límites explícitos (lo que NO debe hacer).',
      recommendation:
        'Agregue límites claros: temas que no debe tratar, datos que no debe revelar, acciones prohibidas.',
      action: { type: 'COPILOT', prompt: 'Propón límites (lo que NO debe hacer) para este agente según su rol.' },
    },
    {
      id: 'profile.tone-format',
      category: 'PROFILE',
      severity: 'INFO',
      passed: !!(f.profile.tone.trim() || f.profile.outputFormat.trim()),
      message:
        f.profile.tone.trim() || f.profile.outputFormat.trim()
          ? 'El tono o el formato de respuesta están definidos.'
          : 'No se definió el tono ni el formato de respuesta.',
      recommendation: 'Indique el tono (formal, cercano…) y el formato esperado (viñetas, tabla, JSON…).',
      action: { type: 'OPEN_TAB', tab: 'profile' },
    },
    {
      id: 'tools.write-approval',
      category: 'TOOLS',
      severity: 'CRITICAL',
      passed: writeUnapproved.length === 0,
      message: writeUnapproved.length
        ? `Herramientas con efecto sin aprobación humana: ${writeUnapproved.map((t) => t.name).join(', ')}.`
        : 'Las herramientas con efecto requieren aprobación humana (o no hay).',
      recommendation:
        'Active "Requiere aprobación" en las operaciones que crean, modifican o envían datos. Las operaciones que aporta una skill no admiten aprobación: vincúlelas directamente al agente.',
      action: { type: 'OPEN_TAB', tab: 'tools' },
    },
    {
      id: 'tools.descriptions',
      category: 'TOOLS',
      severity: 'WARNING',
      passed: vague.length === 0,
      message: vague.length
        ? `Herramientas sin una descripción clara: ${vague.map((t) => t.name).join(', ')}.`
        : 'Las herramientas tienen descripciones claras (o no hay).',
      recommendation: `Describa cada operación (≥ ${MIN_TOOL_DESCRIPTION} caracteres) diciendo cuándo usarla: el modelo decide con ese texto.`,
      action: { type: 'OPEN_TAB', tab: 'tools' },
    },
    {
      id: 'knowledge.policies',
      category: 'KNOWLEDGE',
      severity: 'WARNING',
      passed: !needsKnowledge || f.knowledgeBases > 0,
      message:
        needsKnowledge && !f.knowledgeBases
          ? 'El rol menciona políticas o procesos, pero el agente no tiene bases de conocimiento.'
          : 'El conocimiento del agente es coherente con su rol.',
      recommendation:
        'Cargue las políticas y procesos en una base de conocimiento en vez de copiarlos en las instrucciones.',
      action: { type: 'OPEN_TAB', tab: 'knowledge' },
    },
    {
      id: 'quality.eval-cases',
      category: 'QUALITY',
      severity: 'WARNING',
      passed: f.evalCases >= MIN_EVAL_CASES,
      message: `El agente tiene ${f.evalCases} caso(s) de evaluación (mínimo: ${MIN_EVAL_CASES}).`,
      recommendation: 'Cree casos con preguntas reales y la respuesta esperada para medir la calidad antes de lanzar.',
      action: {
        type: 'COPILOT',
        prompt: `Propón ${MIN_EVAL_CASES} casos de evaluación representativos para este agente.`,
      },
    },
    {
      id: 'quality.last-eval',
      category: 'QUALITY',
      severity: 'WARNING',
      passed: f.latestEvalScore !== null && f.latestEvalScore >= f.targetScore,
      message:
        f.latestEvalScore === null
          ? 'El agente nunca se ha evaluado.'
          : `Última evaluación: ${pct(f.latestEvalScore)} (meta ${pct(f.targetScore)}).`,
      recommendation:
        f.latestEvalScore === null
          ? 'Ejecute una corrida de evaluación con un juez del catálogo.'
          : 'Revise los casos fallidos y aplique sugerencias de mejora hasta alcanzar la meta.',
      action:
        f.latestEvalScore === null
          ? { type: 'OPEN_TAB', tab: 'training' }
          : { type: 'COPILOT', prompt: 'Explica por qué fallan los casos de la última evaluación y cómo mejorarlos.' },
    },
    {
      id: 'quality.pending-feedback',
      category: 'QUALITY',
      severity: 'WARNING',
      passed: f.pendingNegativeFeedback === 0,
      message: f.pendingNegativeFeedback
        ? `Hay ${f.pendingNegativeFeedback} calificación(es) negativa(s) sin revisar.`
        : 'No hay retroalimentación negativa pendiente.',
      recommendation: 'Revise la bandeja de supervisión: apruebe las correcciones como ejemplos o casos de evaluación.',
      action: { type: 'OPEN_TAB', tab: 'training' },
    },
    {
      id: 'cost.model-tier',
      category: 'COST',
      severity: 'INFO',
      passed: !(f.modelTier === 'PREMIUM' && f.effort === 'low'),
      message:
        f.modelTier === 'PREMIUM' && f.effort === 'low'
          ? 'Modelo PREMIUM con esfuerzo bajo: probablemente las tareas son simples.'
          : 'El modelo es adecuado al esfuerzo configurado.',
      recommendation: 'Para tareas simples use un modelo ECONOMY: mismo resultado a una fracción del costo.',
      action: { type: 'OPEN_TAB', tab: 'model' },
    },
    {
      id: 'operations.routines',
      category: 'OPERATIONS',
      severity: 'WARNING',
      passed: f.failedRoutineRuns === 0,
      message: f.failedRoutineRuns
        ? `${f.failedRoutineRuns} corrida(s) de rutinas fallaron en los últimos ${ROUTINE_WINDOW_DAYS} días.`
        : `Sin fallos de rutinas en los últimos ${ROUTINE_WINDOW_DAYS} días.`,
      recommendation: 'Revise el error de las corridas (presupuesto, herramientas o instrucciones de la rutina).',
      action: { type: 'COPILOT', prompt: 'Diagnostica por qué fallan las rutinas de este agente.' },
    },
    {
      id: 'operations.fallback',
      category: 'OPERATIONS',
      severity: 'INFO',
      passed: f.fallbackModels > 0,
      message: f.fallbackModels
        ? `Respaldo configurado (${f.fallbackModels} modelo(s)).`
        : 'Sin modelo de respaldo: si el proveedor falla, el agente no responde.',
      recommendation: 'Configure al menos un modelo de respaldo de otro proveedor.',
      action: { type: 'OPEN_TAB', tab: 'model' },
    },
  ];

  const score = checks.reduce((acc, c) => acc + (c.passed ? HEALTH_WEIGHTS[c.id] : 0), 0);
  return { score, level: levelOf(score), checks };
}
