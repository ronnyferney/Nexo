export const EVAL_QUEUE = 'evals';
/** Ejecución de una corrida de evaluación ya creada (estado QUEUED). */
export const JOB_EVAL_RUN = 'run';
/** Casos que se evalúan en paralelo dentro de una corrida (ADR 0004, D2). */
export const EVAL_CASE_CONCURRENCY = 3;

export interface EvalRunJobData {
  runId: string;
}
