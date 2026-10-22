import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Prisma, TriggerType } from '@prisma/client';
import { Queue, QueueEvents } from 'bullmq';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { WorkflowDefinition } from './engine/workflow.types';
import { validateDefinition } from './engine/workflow.validator';
import { CreateWorkflowDto, UpdateWorkflowDto } from './dto/workflow.dto';
import { JOB_RUN, JOB_SCHEDULED, schedulerId, WORKFLOW_QUEUE, type RunJobData } from './queue/workflow-queue.constants';

const json = (v: unknown) => v as Prisma.InputJsonValue;
const MAX_WAIT_MS = 60_000;

@Injectable()
export class WorkflowsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowsService.name);
  private events?: QueueEvents;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WORKFLOW_QUEUE) private readonly queue: Queue,
  ) {}

  onModuleInit(): void {
    this.events = new QueueEvents(WORKFLOW_QUEUE, { connection: this.queue.opts.connection });
  }

  async onModuleDestroy(): Promise<void> {
    await this.events?.close();
  }

  list(workspaceId: string) {
    return this.prisma.workflow.findMany({
      where: { workspaceId },
      select: {
        id: true,
        name: true,
        description: true,
        active: true,
        schedule: true,
        version: true,
        updatedAt: true,
        _count: { select: { executions: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async get(workspaceId: string, id: string) {
    const wf = await this.prisma.workflow.findFirst({ where: { id, workspaceId } });
    if (!wf) throw new NotFoundException('Flujo no encontrado');
    return wf;
  }

  create(workspaceId: string, dto: CreateWorkflowDto) {
    const definition = dto.definition ?? {
      nodes: [{ id: 'trigger', type: 'trigger', name: 'Inicio', position: { x: 80, y: 160 }, config: {} }],
      edges: [],
    };
    this.assertValid(definition);
    return this.prisma.workflow.create({ data: { ...dto, workspaceId, definition: json(definition) } });
  }

  async update(workspaceId: string, id: string, dto: UpdateWorkflowDto) {
    const current = await this.get(workspaceId, id);
    if (dto.definition) this.assertValid(dto.definition);
    const wf = await this.prisma.workflow.update({
      where: { id },
      data: {
        ...dto,
        definition: dto.definition ? json(dto.definition) : undefined,
        version: dto.definition ? { increment: 1 } : undefined,
      },
    });
    if (current.active && dto.schedule !== undefined) await this.syncSchedule(wf.id, wf.active, wf.schedule);
    return wf;
  }

  async remove(workspaceId: string, id: string) {
    await this.get(workspaceId, id);
    await this.syncSchedule(id, false, null);
    await this.prisma.workflow.delete({ where: { id } });
  }

  async setActive(workspaceId: string, id: string, active: boolean) {
    const wf = await this.get(workspaceId, id);
    if (active) this.assertValid(wf.definition as unknown as WorkflowDefinition);
    const updated = await this.prisma.workflow.update({ where: { id }, data: { active } });
    await this.syncSchedule(id, active, updated.schedule);
    return updated;
  }

  async regenerateWebhook(workspaceId: string, id: string) {
    await this.get(workspaceId, id);
    const { webhookToken } = await this.prisma.workflow.update({
      where: { id },
      data: { webhookToken: `wh_${crypto.randomUUID().replace(/-/g, '')}` },
      select: { webhookToken: true },
    });
    return { webhookToken };
  }

  /** Encola una ejecución. Con `wait` espera el resultado (respuesta síncrona para webhooks / MCP). */
  async run(
    workspaceId: string,
    workflowId: string,
    input: Record<string, unknown>,
    trigger: TriggerType,
    wait = false,
  ) {
    await this.get(workspaceId, workflowId);
    const execution = await this.prisma.execution.create({
      data: { workflowId, workspaceId, trigger, input: json(input) },
    });
    const job = await this.queue.add(JOB_RUN, { executionId: execution.id } satisfies RunJobData, {
      jobId: execution.id,
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
    if (!wait || !this.events) return execution;
    try {
      await job.waitUntilFinished(this.events, MAX_WAIT_MS);
    } catch (err) {
      this.logger.debug(`Espera de ${execution.id} terminó: ${(err as Error).message}`);
    }
    return this.prisma.execution.findUniqueOrThrow({ where: { id: execution.id } });
  }

  async runByWebhook(token: string, input: Record<string, unknown>, wait: boolean) {
    const wf = await this.prisma.workflow.findUnique({ where: { webhookToken: token } });
    if (!wf || !wf.active) throw new NotFoundException('Webhook no encontrado o flujo inactivo');
    const execution = await this.run(wf.workspaceId, wf.id, input, 'WEBHOOK', wait);
    return { executionId: execution.id, status: execution.status, output: execution.output, error: execution.error };
  }

  async cancel(workspaceId: string, executionId: string) {
    const ex = await this.prisma.execution.findFirst({ where: { id: executionId, workspaceId } });
    if (!ex) throw new NotFoundException('Ejecución no encontrada');
    if (!['QUEUED', 'RUNNING'].includes(ex.status)) throw new BadRequestException('La ejecución ya terminó');
    if (ex.status === 'QUEUED') await this.queue.remove(executionId).catch(() => undefined);
    return this.prisma.execution.update({
      where: { id: executionId },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
  }

  async retry(workspaceId: string, executionId: string) {
    const ex = await this.prisma.execution.findFirst({ where: { id: executionId, workspaceId } });
    if (!ex) throw new NotFoundException('Ejecución no encontrada');
    return this.run(workspaceId, ex.workflowId, ex.input as Record<string, unknown>, ex.trigger);
  }

  private assertValid(def: WorkflowDefinition): void {
    const errors = validateDefinition(def);
    if (errors.length) throw new BadRequestException(errors);
  }

  private async syncSchedule(workflowId: string, active: boolean, schedule: string | null): Promise<void> {
    const id = schedulerId(workflowId);
    if (active && schedule) {
      await this.queue.upsertJobScheduler(id, { pattern: schedule }, { name: JOB_SCHEDULED, data: { workflowId } });
    } else {
      await this.queue.removeJobScheduler(id);
    }
  }
}
