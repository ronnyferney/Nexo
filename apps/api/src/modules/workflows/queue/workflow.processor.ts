import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ReconciliationService } from '../../durability/reconciliation/reconciliation.service';
import { MensajesService } from '../../messaging/mensajes.service';
import { IncumplimientosService } from '../../results/incumplimientos.service';
import { RetentionService } from '../retention.service';
import { WorkflowRunnerService } from '../workflow-runner.service';
import {
  JOB_DURABILITY_SWEEP,
  JOB_MESSAGE,
  JOB_MESSAGES_SWEEP,
  JOB_RESULTS_SWEEP,
  JOB_RETENTION,
  JOB_RUN,
  JOB_SCHEDULED,
  type MessageJobData,
  type RunJobData,
  type ScheduledJobData,
} from './workflow-queue.constants';
import { WORKFLOW_QUEUE } from './workflow-queue.constants';

/** Worker de BullMQ: escala horizontalmente levantando más instancias con WORKER_ENABLED=true. */
@Processor(WORKFLOW_QUEUE, { concurrency: Number(process.env.WORKER_CONCURRENCY ?? 10) })
export class WorkflowProcessor extends WorkerHost {
  private readonly logger = new Logger(WorkflowProcessor.name);

  constructor(
    private readonly runner: WorkflowRunnerService,
    private readonly prisma: PrismaService,
    private readonly retention: RetentionService,
    private readonly incumplimientos: IncumplimientosService,
    private readonly mensajes: MensajesService,
    private readonly reconciliation: ReconciliationService,
  ) {
    super();
  }

  async process(job: Job<RunJobData | ScheduledJobData | MessageJobData>): Promise<void> {
    if (job.name === JOB_RUN) {
      await this.runner.execute((job.data as RunJobData).executionId);
      return;
    }
    if (job.name === JOB_SCHEDULED) {
      const { workflowId } = job.data as ScheduledJobData;
      const wf = await this.prisma.workflow.findUnique({ where: { id: workflowId } });
      if (!wf?.active) return;
      const ex = await this.prisma.execution.create({
        data: {
          workflowId,
          workspaceId: wf.workspaceId,
          trigger: 'SCHEDULE',
          input: { scheduledAt: new Date().toISOString() },
        },
      });
      await this.runner.execute(ex.id);
      return;
    }
    if (job.name === JOB_RETENTION) {
      await this.retention.purge();
      return;
    }
    if (job.name === JOB_RESULTS_SWEEP) {
      await this.incumplimientos.barrer();
      return;
    }
    if (job.name === JOB_MESSAGES_SWEEP) {
      await this.mensajes.barrerVencidos();
      return;
    }
    if (job.name === JOB_MESSAGE) {
      await this.mensajes.despachar((job.data as MessageJobData).mensajeId);
      return;
    }
    if (job.name === JOB_DURABILITY_SWEEP) {
      await this.reconciliation.reconciliarPendientes();
      return;
    }
    this.logger.warn(`Job desconocido: ${job.name}`);
  }
}
