export const WORKFLOW_QUEUE = 'workflows';
export const JOB_RUN = 'run';
export const JOB_SCHEDULED = 'scheduled';
export const JOB_RETENTION = 'retention';
/** Scheduler diario de limpieza de ejecuciones e historial de rutinas. */
export const RETENTION_SCHEDULER_ID = 'executions-retention';
export const RETENTION_PATTERN = '17 3 * * *';
/** Prefijo de los programadores cron de flujos (la reconciliación solo toca los que lo llevan). */
export const WORKFLOW_SCHEDULER_PREFIX = 'wf-schedule:';
export const schedulerId = (workflowId: string) => `${WORKFLOW_SCHEDULER_PREFIX}${workflowId}`;

export interface RunJobData {
  executionId: string;
}

export interface ScheduledJobData {
  workflowId: string;
}
