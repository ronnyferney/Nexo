export const ROUTINE_QUEUE = 'routines';
/** Disparo del scheduler cron de una rutina. */
export const JOB_ROUTINE_SCHEDULED = 'scheduled';
/** Ejecución inmediata ("ejecutar ahora") de una corrida ya creada. */
export const JOB_ROUTINE_RUN = 'run';
export const routineSchedulerId = (routineId: string) => `routine:${routineId}`;

export interface RoutineScheduledJobData {
  routineId: string;
}

export interface RoutineRunJobData {
  runId: string;
}
