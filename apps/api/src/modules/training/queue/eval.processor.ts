import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { EvalRunnerService } from '../eval-runner.service';
import { EVAL_QUEUE, JOB_EVAL_RUN, type EvalRunJobData } from './eval-queue.constants';

/** Worker de evaluaciones: comparte WORKER_ENABLED / WORKER_CONCURRENCY con los de flujos y rutinas. */
@Processor(EVAL_QUEUE, { concurrency: Number(process.env.WORKER_CONCURRENCY ?? 10) })
export class EvalProcessor extends WorkerHost {
  private readonly logger = new Logger(EvalProcessor.name);

  constructor(private readonly runner: EvalRunnerService) {
    super();
  }

  async process(job: Job<EvalRunJobData>): Promise<void> {
    if (job.name === JOB_EVAL_RUN) {
      await this.runner.execute(job.data.runId);
      return;
    }
    this.logger.warn(`Job desconocido: ${job.name}`);
  }
}
