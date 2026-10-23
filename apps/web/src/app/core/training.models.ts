// ===== Bucle de mejora supervisada de agentes (ADR 0004) =====
import type { AgentProfile } from './studio.models';

// ----- D1. Retroalimentación en el chat -----

export type FeedbackRating = 'UP' | 'DOWN';
export type FeedbackStatus = 'PENDING' | 'APPROVED' | 'DISCARDED';

/** `POST /agents/:id/feedback`. */
export interface FeedbackInput {
  conversationId?: string;
  userMessage: string;
  agentResponse: string;
  rating: FeedbackRating;
  comment?: string;
  correction?: string;
}

/** `GET /agents/:id/feedback` y `GET /feedback` (bandeja del workspace). */
export interface Feedback {
  id: string;
  agentId: string;
  agentName: string;
  userMessage: string;
  agentResponse: string;
  rating: FeedbackRating;
  comment: string | null;
  correction: string | null;
  status: FeedbackStatus;
  createdAt: string;
  reviewedAt: string | null;
}

export type FeedbackReviewAction = 'APPROVE' | 'DISCARD';

/** `POST /feedback/:id/review`. `409` si el agente ya tiene el máximo de ejemplos. */
export interface FeedbackReviewInput {
  action: FeedbackReviewAction;
  correction?: string;
  addAsEvalCase?: boolean;
}

// ----- D2. Casos y corridas de evaluación -----

export interface EvalCase {
  id: string;
  input: string;
  expected: string | null;
  criteria: string | null;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface EvalCaseInput {
  input: string;
  expected?: string;
  criteria?: string;
  tags?: string[];
}

export type EvalRunStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

/** `POST /agents/:id/eval-runs`. `passThreshold` por defecto 0.7 en la API. */
export interface EvalRunInput {
  judgeProviderId: string;
  judgeModel: string;
  passThreshold?: number;
  versionNote?: string;
}

/** Fila de `GET /agents/:id/eval-runs`. */
export interface EvalRun {
  id: string;
  status: EvalRunStatus;
  versionId: string | null;
  version: number | null;
  score: number | null;
  passed: number;
  total: number;
  costUsd: number;
  judgeModel: string;
  createdAt: string;
  finishedAt: string | null;
  /** Campos opcionales que la API puede incluir. */
  judgeProviderId?: string;
  passThreshold?: number;
  error?: string | null;
}

export interface EvalResult {
  id: string;
  caseId: string;
  input: string;
  expected: string | null;
  output: string | null;
  score: number | null;
  passed: boolean;
  reasoning: string | null;
  needsReview: boolean;
  humanScore: number | null;
  humanNote: string | null;
  effectiveScore: number | null;
}

/** `GET /eval-runs/:id`. */
export interface EvalRunDetail extends EvalRun {
  results: EvalResult[];
}

/** `PATCH /eval-results/:id`. */
export interface EvalResultReviewInput {
  humanScore: number;
  humanNote?: string;
}

// ----- D3. Versiones -----

export interface AgentVersion {
  id: string;
  version: number;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
  bestScore: number | null;
}

/** Respuesta de `POST /agents/:id/versions/:versionId/publish`; puede traer advertencias (p. ej. skills eliminadas). */
export interface PublishVersionResult {
  warnings?: string[];
  [key: string]: unknown;
}

// ----- D4. Sugerencias de mejora -----

export type SuggestionStatus = 'PENDING' | 'APPLIED' | 'REJECTED';

export interface PromptSuggestion {
  id: string;
  runId: string;
  status: SuggestionStatus;
  rationale: string;
  proposal: { systemPrompt?: string; profile?: Partial<AgentProfile> };
  createdAt: string;
}

/** `POST /eval-runs/:id/suggestions`. */
export interface SuggestionInput {
  providerId: string;
  model: string;
}

// ----- Resumen del ciclo -----

/** `GET /agents/:id/training-summary`. */
export interface TrainingSummary {
  targetScore: number;
  latestScore: number | null;
  bestScore: number | null;
  /** Número de la mejor versión (la API podría devolver el objeto de la versión). */
  bestVersion: number | { id: string; version: number } | null;
  runs: { id: string; version: number | null; score: number | null; createdAt: string }[];
  pendingFeedback: number;
  evalCases: number;
  examples: number;
}

export const DEFAULT_TARGET_SCORE = 0.85;
export const DEFAULT_PASS_THRESHOLD = 0.7;
