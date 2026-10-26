export const WORKFLOW_QUEUE = 'workflows';
export const JOB_RUN = 'run';
export const JOB_SCHEDULED = 'scheduled';
export const JOB_RETENTION = 'retention';
/** Scheduler diario de limpieza de ejecuciones e historial de rutinas. */
export const RETENTION_SCHEDULER_ID = 'executions-retention';
export const RETENTION_PATTERN = '17 3 * * *';
/** Barrido de vencimientos de tareas/contratos para incumplimientos (E4/RF31). Reutiliza esta misma cola, no una nueva. */
export const JOB_RESULTS_SWEEP = 'results-sweep';
export const RESULTS_SWEEP_SCHEDULER_ID = 'results-incumplimientos-sweep';
/** Cada hora, al minuto 23 (desfasado de la retención para no solaparse). */
export const RESULTS_SWEEP_PATTERN = '23 * * * *';
/** Prefijo de los programadores cron de flujos (la reconciliación solo toca los que lo llevan). */
export const WORKFLOW_SCHEDULER_PREFIX = 'wf-schedule:';
export const schedulerId = (workflowId: string) => `${WORKFLOW_SCHEDULER_PREFIX}${workflowId}`;

/** Despacho de un mensaje entre agentes (E5/RF35): reutiliza esta misma cola, no una nueva. */
export const JOB_MESSAGE = 'message';
/** Barrido de vencimientos de mensajes (confirmación/respuesta) para suplencia/escalamiento (E5/RF35). */
export const JOB_MESSAGES_SWEEP = 'messages-sweep';
export const MESSAGES_SWEEP_SCHEDULER_ID = 'messages-sweep';
/** Cada hora, al minuto 41 (desfasado de retención/incumplimientos para no solaparse). */
export const MESSAGES_SWEEP_PATTERN = '41 * * * *';
/** Despacho del segmento entrante de un handoff tras la aceptación (E5/RF09). */
export const JOB_SEGMENT = 'segment';

/** Conciliación de escrituras inciertas: claves de idempotencia EN_PROGRESO caducadas (E7/RF20). Reutiliza esta cola. */
export const JOB_DURABILITY_SWEEP = 'durability-sweep';
export const DURABILITY_SWEEP_SCHEDULER_ID = 'durability-reconcile';
/** Cada hora, al minuto 53 (desfasado de retención/incumplimientos/mensajes para no solaparse). */
export const DURABILITY_SWEEP_PATTERN = '53 * * * *';

export interface RunJobData {
  executionId: string;
}

export interface ScheduledJobData {
  workflowId: string;
}

export interface MessageJobData {
  mensajeId: string;
}
