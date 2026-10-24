import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { AgentRoutine, RoutineRun } from '@prisma/client';
import { Queue, QueueEvents } from 'bullmq';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { schedulerEntries, type ScheduleSource } from '../workflows/schedule-reconciler';
import { CreateRoutineDto, UpdateRoutineDto } from './dto/routine.dto';
import {
  JOB_ROUTINE_RUN,
  JOB_ROUTINE_SCHEDULED,
  ROUTINE_QUEUE,
  ROUTINE_SCHEDULER_PREFIX,
  routineSchedulerId,
  type RoutineRunJobData,
  type RoutineScheduledJobData,
} from './routine-queue.constants';

const MAX_WAIT_MS = 60_000;
const RUNS_LIMIT = 50;

type RoutineWithAgent = AgentRoutine & { agent: { name: string } };

export interface RoutineView {
  id: string;
  agentId: string;
  agentName: string;
  name: string;
  prompt: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  notifyWebhookUrl: string | null;
  lastRunAt: Date | null;
  lastStatus: string | null;
  nextRunAt: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const runView = (r: RoutineRun) => ({
  id: r.id,
  routineId: r.routineId,
  status: r.status,
  output: r.output,
  error: r.error,
  costUsd: Number(r.costUsd),
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  durationMs: r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
});

const WITH_AGENT = { agent: { select: { name: true } } } as const;

/**
 * ¿Puede ejecutarse una rutina del agente? (ADR 0006 D4 + ADR 0007 D5). Solo si el agente está LAUNCHED o es
 * PRIVATE de un dueño (automatización personal: corre a nombre del dueño y se imputa a su unidad). Un agente de
 * equipo/empresa en borrador no ejecuta rutinas. Devuelve el motivo del bloqueo o null.
 */
export function routineBlockReason(agent: {
  visibility: 'PRIVATE' | 'TEAM' | 'WORKSPACE';
  launchStatus: 'DRAFT' | 'LAUNCHED';
  ownerId: string | null;
}): string | null {
  if (agent.launchStatus === 'LAUNCHED') return null;
  if (agent.visibility === 'PRIVATE' && agent.ownerId) return null;
  return 'El agente no está lanzado: las rutinas de agentes de equipo o empresa solo se ejecutan cuando el agente está lanzado';
}

/** Rutinas programadas por agente (ADR 0003 · D5): CRUD, programación cron en BullMQ e historial. */
@Injectable()
export class RoutinesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoutinesService.name);
  private events?: QueueEvents;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(ROUTINE_QUEUE) private readonly queue: Queue,
  ) {}

  onModuleInit(): void {
    this.events = new QueueEvents(ROUTINE_QUEUE, { connection: this.queue.opts.connection });
  }

  async onModuleDestroy(): Promise<void> {
    await this.events?.close();
  }

  /** `agentIds` (opcional) acota a los agentes autorizados para el usuario. */
  async list(workspaceId: string, agentId?: string, agentIds?: string[]): Promise<RoutineView[]> {
    if (agentId) await this.assertAgent(workspaceId, agentId);
    const rows = await this.prisma.agentRoutine.findMany({
      where: { workspaceId, ...(agentId ? { agentId } : agentIds ? { agentId: { in: agentIds } } : {}) },
      include: WITH_AGENT,
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(rows.map((r) => this.view(r)));
  }

  async get(workspaceId: string, id: string): Promise<RoutineWithAgent> {
    const routine = await this.prisma.agentRoutine.findFirst({ where: { id, workspaceId }, include: WITH_AGENT });
    if (!routine) throw new NotFoundException('Rutina no encontrada');
    return routine;
  }

  async describe(workspaceId: string, id: string): Promise<RoutineView> {
    return this.view(await this.get(workspaceId, id));
  }

  async create(workspaceId: string, agentId: string, dto: CreateRoutineDto): Promise<RoutineView> {
    await this.assertAgent(workspaceId, agentId);
    const routine = await this.prisma.agentRoutine.create({
      data: {
        name: dto.name,
        prompt: dto.prompt,
        schedule: dto.schedule.trim(),
        timezone: dto.timezone ?? 'UTC',
        enabled: dto.enabled ?? true,
        notifyWebhookUrl: dto.notifyWebhookUrl ?? null,
        agentId,
        workspaceId,
      },
      include: WITH_AGENT,
    });
    try {
      await this.syncSchedule(routine);
    } catch (err) {
      await this.prisma.agentRoutine.delete({ where: { id: routine.id } });
      throw new BadRequestException(`No se pudo programar la rutina: ${(err as Error).message}`);
    }
    return this.view(routine);
  }

  async update(workspaceId: string, id: string, dto: UpdateRoutineDto): Promise<RoutineView> {
    const before = await this.get(workspaceId, id);
    const routine = await this.prisma.agentRoutine.update({
      where: { id },
      data: { ...dto, schedule: dto.schedule?.trim() },
      include: WITH_AGENT,
    });
    try {
      await this.syncSchedule(routine);
    } catch (err) {
      await this.prisma.agentRoutine.update({
        where: { id },
        data: { schedule: before.schedule, timezone: before.timezone, enabled: before.enabled },
      });
      throw new BadRequestException(`No se pudo programar la rutina: ${(err as Error).message}`);
    }
    return this.view(routine);
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    await this.get(workspaceId, id);
    await this.queue.removeJobScheduler(routineSchedulerId(id));
    await this.prisma.agentRoutine.delete({ where: { id } });
  }

  /** Ejecución inmediata: encola la corrida y espera su resultado hasta 60 s (si no, devuelve la corrida RUNNING). */
  async runNow(workspaceId: string, id: string) {
    const routine = await this.get(workspaceId, id);
    const agent = await this.prisma.agent.findUniqueOrThrow({
      where: { id: routine.agentId },
      select: { visibility: true, launchStatus: true, ownerId: true },
    });
    const blocked = routineBlockReason(agent);
    if (blocked) throw new ConflictException(blocked);
    const run = await this.prisma.routineRun.create({ data: { routineId: routine.id } });
    const job = await this.queue.add(JOB_ROUTINE_RUN, { runId: run.id } satisfies RoutineRunJobData, {
      jobId: run.id,
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
    if (this.events) {
      try {
        await job.waitUntilFinished(this.events, MAX_WAIT_MS);
      } catch (err) {
        this.logger.debug(`Espera de la corrida ${run.id} terminó: ${(err as Error).message}`);
      }
    }
    return runView(await this.prisma.routineRun.findUniqueOrThrow({ where: { id: run.id } }));
  }

  async runs(workspaceId: string, id: string) {
    await this.get(workspaceId, id);
    const rows = await this.prisma.routineRun.findMany({
      where: { routineId: id },
      orderBy: { startedAt: 'desc' },
      take: RUNS_LIMIT,
    });
    return rows.map(runView);
  }

  private async assertAgent(workspaceId: string, agentId: string): Promise<void> {
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } });
    if (!agent) throw new NotFoundException('Agente no encontrado');
  }

  /**
   * Origen para la reconciliación de programadores al arrancar (P9). Consulta todos los workspaces: es un proceso de
   * sistema, no una petición de usuario, y solo lee id, schedule y zona horaria.
   */
  scheduleSource(): ScheduleSource {
    return {
      kind: 'rutinas',
      desired: async () => {
        const rows = await this.prisma.agentRoutine.findMany({
          where: { enabled: true },
          select: { id: true, schedule: true, timezone: true },
        });
        return rows.map((r) => ({ ownerId: r.id, pattern: r.schedule, tz: r.timezone }));
      },
      registered: async () => schedulerEntries(await this.queue.getJobSchedulers(0, -1), ROUTINE_SCHEDULER_PREFIX),
      apply: (routineId, entry) =>
        this.syncSchedule({
          id: routineId,
          enabled: entry !== null,
          schedule: entry?.pattern ?? '',
          timezone: entry?.tz ?? 'UTC',
        }),
    };
  }

  private async syncSchedule(routine: Pick<AgentRoutine, 'id' | 'enabled' | 'schedule' | 'timezone'>): Promise<void> {
    const id = routineSchedulerId(routine.id);
    if (routine.enabled) {
      await this.queue.upsertJobScheduler(
        id,
        { pattern: routine.schedule, tz: routine.timezone },
        {
          name: JOB_ROUTINE_SCHEDULED,
          data: { routineId: routine.id } satisfies RoutineScheduledJobData,
          opts: { removeOnComplete: 100, removeOnFail: 500 },
        },
      );
    } else {
      await this.queue.removeJobScheduler(id);
    }
  }

  private async nextRunAt(routine: AgentRoutine): Promise<string | null> {
    if (!routine.enabled) return null;
    try {
      const scheduler = await this.queue.getJobScheduler(routineSchedulerId(routine.id));
      return scheduler?.next ? new Date(scheduler.next).toISOString() : null;
    } catch {
      return null;
    }
  }

  private async view(r: RoutineWithAgent): Promise<RoutineView> {
    return {
      id: r.id,
      agentId: r.agentId,
      agentName: r.agent.name,
      name: r.name,
      prompt: r.prompt,
      schedule: r.schedule,
      timezone: r.timezone,
      enabled: r.enabled,
      notifyWebhookUrl: r.notifyWebhookUrl,
      lastRunAt: r.lastRunAt,
      lastStatus: r.lastStatus,
      nextRunAt: await this.nextRunAt(r),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
