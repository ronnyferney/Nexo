import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DelayedError, type Job } from 'bullmq';
import { ConcurrencyGate, schedulingConfigFrom } from '../../../common/queue/scheduling.policy';
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
  private readonly config = schedulingConfigFrom(process.env);
  /** Límite de concurrencia por workspace (ADR 0017 Inc.3): un inquilino no acapara los slots del worker. */
  private readonly gate = new ConcurrencyGate(() => this.config.perWorkspaceConcurrency);

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

  /**
   * Admite el trabajo si el workspace tiene cupo; si está en el tope, lo reencola diferido (cede turno a otros
   * inquilinos) lanzando `DelayedError` para que BullMQ no lo marque como fallido. Sin `workspaceId` (trabajos
   * antiguos o de sistema) o con el gate desactivado, corre sin límite.
   */
  private async withGate(
    job: Job,
    token: string | undefined,
    workspaceId: string | undefined,
    work: () => Promise<void>,
  ): Promise<void> {
    if (!workspaceId || this.gate.tryAcquire(workspaceId)) {
      try {
        await work();
      } finally {
        if (workspaceId) this.gate.release(workspaceId);
      }
      return;
    }
    await job.moveToDelayed(Date.now() + this.config.deferMs, token);
    throw new DelayedError();
  }

  async process(job: Job<RunJobData | ScheduledJobData | MessageJobData>, token?: string): Promise<void> {
    if (job.name === JOB_RUN) {
      const { executionId, workspaceId } = job.data as RunJobData;
      await this.withGate(job, token, workspaceId, () => this.runner.execute(executionId));
      return;
    }
    if (job.name === JOB_SCHEDULED) {
      const { workflowId } = job.data as ScheduledJobData;
      const wf = await this.prisma.workflow.findUnique({ where: { id: workflowId } });
      if (!wf?.active) return;
      await this.withGate(job, token, wf.workspaceId, async () => {
        const ex = await this.prisma.execution.create({
          data: {
            workflowId,
            workspaceId: wf.workspaceId,
            trigger: 'SCHEDULE',
            input: { scheduledAt: new Date().toISOString() },
          },
        });
        await this.runner.execute(ex.id);
      });
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
