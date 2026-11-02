import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DelayedError, type Job, type Queue } from 'bullmq';
import { ConcurrencyGate, schedulingConfigFrom } from '../../common/queue/scheduling.policy';
import { RoutineRunnerService } from './routine-runner.service';
import {
  JOB_ROUTINE_RUN,
  JOB_ROUTINE_SCHEDULED,
  ROUTINE_QUEUE,
  routineSchedulerId,
  type RoutineRunJobData,
  type RoutineScheduledJobData,
} from './routine-queue.constants';

/** Worker de rutinas: comparte WORKER_ENABLED / WORKER_CONCURRENCY con el de flujos. */
@Processor(ROUTINE_QUEUE, { concurrency: Number(process.env.WORKER_CONCURRENCY ?? 10) })
export class RoutineProcessor extends WorkerHost {
  private readonly logger = new Logger(RoutineProcessor.name);
  private readonly config = schedulingConfigFrom(process.env);
  /** Límite de concurrencia por workspace (ADR 0017 Inc.3). */
  private readonly gate = new ConcurrencyGate(() => this.config.perWorkspaceConcurrency);

  constructor(
    private readonly runner: RoutineRunnerService,
    @InjectQueue(ROUTINE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job<RoutineRunJobData | RoutineScheduledJobData>, token?: string): Promise<void> {
    if (job.name === JOB_ROUTINE_RUN) {
      const { runId, workspaceId } = job.data as RoutineRunJobData;
      if (workspaceId && !this.gate.tryAcquire(workspaceId)) {
        await job.moveToDelayed(Date.now() + this.config.deferMs, token);
        throw new DelayedError();
      }
      try {
        await this.runner.execute(runId);
      } finally {
        if (workspaceId) this.gate.release(workspaceId);
      }
      return;
    }
    if (job.name === JOB_ROUTINE_SCHEDULED) {
      const { routineId } = job.data as RoutineScheduledJobData;
      const runId = await this.runner.runScheduled(routineId);
      if (!runId) {
        // Rutina eliminada (p. ej. en cascada al borrar el agente) o deshabilitada: limpia el scheduler huérfano.
        await this.queue.removeJobScheduler(routineSchedulerId(routineId)).catch(() => undefined);
      }
      return;
    }
    this.logger.warn(`Job desconocido: ${job.name}`);
  }
}
