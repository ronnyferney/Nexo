import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
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

  constructor(
    private readonly runner: RoutineRunnerService,
    @InjectQueue(ROUTINE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job<RoutineRunJobData | RoutineScheduledJobData>): Promise<void> {
    if (job.name === JOB_ROUTINE_RUN) {
      await this.runner.execute((job.data as RoutineRunJobData).runId);
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
