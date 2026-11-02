export const EVAL_QUEUE = 'evals';
/** Ejecución de una corrida de evaluación ya creada (estado QUEUED). */
export const JOB_EVAL_RUN = 'run';
/** Casos que se evalúan en paralelo dentro de una corrida (ADR 0004, D2). */
export const EVAL_CASE_CONCURRENCY = 3;

export interface EvalRunJobData {
  runId: string;
  /**
   * Workspace de la corrida (ADR 0017 Inc.3): para el límite de concurrencia por inquilino en el worker. Opcional por
   * compatibilidad: las corridas encoladas antes de este cambio no lo llevan y se procesan sin gate.
   */
  workspaceId?: string;
}
