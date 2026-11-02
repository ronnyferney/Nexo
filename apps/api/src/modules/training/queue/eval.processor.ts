import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DelayedError, type Job } from 'bullmq';
import { ConcurrencyGate, schedulingConfigFrom } from '../../../common/queue/scheduling.policy';
import { EvalRunnerService } from '../eval-runner.service';
import { EVAL_QUEUE, JOB_EVAL_RUN, type EvalRunJobData } from './eval-queue.constants';

/** Worker de evaluaciones: comparte WORKER_ENABLED / WORKER_CONCURRENCY con los de flujos y rutinas. */
@Processor(EVAL_QUEUE, { concurrency: Number(process.env.WORKER_CONCURRENCY ?? 10) })
export class EvalProcessor extends WorkerHost {
  private readonly logger = new Logger(EvalProcessor.name);
  private readonly config = schedulingConfigFrom(process.env);
  /** Límite de concurrencia por workspace (ADR 0017 Inc.3). */
  private readonly gate = new ConcurrencyGate(() => this.config.perWorkspaceConcurrency);

  constructor(private readonly runner: EvalRunnerService) {
    super();
  }

  async process(job: Job<EvalRunJobData>, token?: string): Promise<void> {
    if (job.name === JOB_EVAL_RUN) {
      const { runId, workspaceId } = job.data;
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
    this.logger.warn(`Job desconocido: ${job.name}`);
  }
}
