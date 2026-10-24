export const ROUTINE_QUEUE = 'routines';
/** Disparo del scheduler cron de una rutina. */
export const JOB_ROUTINE_SCHEDULED = 'scheduled';
/** Ejecución inmediata ("ejecutar ahora") de una corrida ya creada. */
export const JOB_ROUTINE_RUN = 'run';
/** Prefijo de los programadores cron de rutinas (la reconciliación solo toca los que lo llevan). */
export const ROUTINE_SCHEDULER_PREFIX = 'routine:';
export const routineSchedulerId = (routineId: string) => `${ROUTINE_SCHEDULER_PREFIX}${routineId}`;

export interface RoutineScheduledJobData {
  routineId: string;
}

export interface RoutineRunJobData {
  runId: string;
}
