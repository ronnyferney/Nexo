import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  JOB_RETENTION,
  RETENTION_PATTERN,
  RETENTION_SCHEDULER_ID,
  WORKFLOW_QUEUE,
} from './queue/workflow-queue.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Retención de ejecuciones (práctica n8n): borra a diario las ejecuciones terminadas y el historial de rutinas
 * (`RoutineRun`) con más de EXECUTIONS_RETENTION_DAYS días. Las ejecuciones en cola o en curso nunca se borran.
 */
@Injectable()
export class RetentionService implements OnModuleInit {
  private readonly logger = new Logger(RetentionService.name);
  readonly retentionDays: number;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WORKFLOW_QUEUE) private readonly queue: Queue,
    config: ConfigService,
  ) {
    this.retentionDays = config.get<number>('executions.retentionDays') ?? 30;
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        RETENTION_SCHEDULER_ID,
        { pattern: RETENTION_PATTERN, tz: 'UTC' },
        { name: JOB_RETENTION, data: {}, opts: { removeOnComplete: 10, removeOnFail: 50 } },
      );
    } catch (err) {
      this.logger.warn(`No se pudo programar la limpieza de ejecuciones: ${(err as Error).message}`);
    }
  }

  /** `workspaceId` acota la limpieza a un workspace (pruebas / tareas de soporte); el job diario limpia todos. */
  async purge(
    now = new Date(),
    workspaceId?: string,
  ): Promise<{ executions: number; routineRuns: number; cutoff: Date }> {
    const cutoff = new Date(now.getTime() - this.retentionDays * DAY_MS);
    const executions = await this.prisma.execution.deleteMany({
      where: { status: { in: ['SUCCEEDED', 'FAILED', 'CANCELLED'] }, createdAt: { lt: cutoff }, workspaceId },
    });
    const routineRuns = await this.prisma.routineRun.deleteMany({
      where: { startedAt: { lt: cutoff }, ...(workspaceId ? { routine: { workspaceId } } : {}) },
    });
    this.logger.log(
      `Retención (${this.retentionDays} días): ${executions.count} ejecuciones y ${routineRuns.count} corridas de rutinas eliminadas`,
    );
    return { executions: executions.count, routineRuns: routineRuns.count, cutoff };
  }
}
