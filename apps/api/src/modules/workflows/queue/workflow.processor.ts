import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { WorkflowRunnerService } from '../workflow-runner.service';
import { JOB_RUN, JOB_SCHEDULED, type RunJobData, type ScheduledJobData } from './workflow-queue.constants';
import { WORKFLOW_QUEUE } from './workflow-queue.constants';

/** Worker de BullMQ: escala horizontalmente levantando más instancias con WORKER_ENABLED=true. */
@Processor(WORKFLOW_QUEUE, { concurrency: Number(process.env.WORKER_CONCURRENCY ?? 10) })
export class WorkflowProcessor extends WorkerHost {
  private readonly logger = new Logger(WorkflowProcessor.name);

  constructor(
    private readonly runner: WorkflowRunnerService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<RunJobData | ScheduledJobData>): Promise<void> {
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
    this.logger.warn(`Job desconocido: ${job.name}`);
  }
}
