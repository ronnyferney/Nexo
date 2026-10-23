import { Injectable, Logger } from '@nestjs/common';
import type { RunStatus } from '@prisma/client';
import { HttpClientService } from '../../common/http/http-client.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentsService } from '../agents/agents.service';

const NOTIFY_TIMEOUT_MS = 10_000;

/** Ejecuta una corrida de rutina: invoca al agente (source ROUTINE), guarda el resultado y notifica. */
@Injectable()
export class RoutineRunnerService {
  private readonly logger = new Logger(RoutineRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
    private readonly http: HttpClientService,
  ) {}

  /** Disparo del cron: crea la corrida y la ejecuta. Si la rutina ya no existe o está deshabilitada, no hace nada. */
  async runScheduled(routineId: string): Promise<string | null> {
    const routine = await this.prisma.agentRoutine.findUnique({ where: { id: routineId }, select: { enabled: true } });
    if (!routine?.enabled) return null;
    const run = await this.prisma.routineRun.create({ data: { routineId } });
    await this.execute(run.id);
    return run.id;
  }

  /** Idempotente: solo procesa corridas en estado RUNNING sin `finishedAt`. */
  async execute(runId: string): Promise<void> {
    const run = await this.prisma.routineRun.findUnique({ where: { id: runId }, include: { routine: true } });
    if (!run || run.status !== 'RUNNING' || run.finishedAt) return;
    const { routine } = run;

    let status: RunStatus = 'SUCCEEDED';
    let output: string | null = null;
    let error: string | null = null;
    let costUsd = 0;
    try {
      const result = await this.agents.runOnce(routine.workspaceId, routine.agentId, routine.prompt, {
        source: 'ROUTINE',
      });
      output = result.text;
      costUsd = Number(result.usage?.costUsd ?? 0) || 0;
    } catch (err) {
      // Incluye errores de presupuesto (BLOCK): la corrida queda FAILED con el mensaje del gobierno de costos.
      status = 'FAILED';
      error = (err as Error).message || 'Error desconocido';
    }

    const finishedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.routineRun.update({ where: { id: runId }, data: { status, output, error, costUsd, finishedAt } }),
      this.prisma.agentRoutine.update({
        where: { id: routine.id },
        data: { lastRunAt: finishedAt, lastStatus: status },
      }),
    ]);
    if (status === 'FAILED') this.logger.warn(`Rutina ${routine.id} (corrida ${runId}) falló: ${error}`);

    if (routine.notifyWebhookUrl) {
      await this.notify(routine.notifyWebhookUrl, { routineId: routine.id, runId, status, output, error });
    }
  }

  /** Notificación saliente vía HttpClientService (SSRF, timeout). Un fallo aquí nunca cambia el estado de la corrida. */
  private async notify(url: string, payload: Record<string, unknown>): Promise<void> {
    try {
      const res = await this.http.request({
        url,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'Nexo-Routines/1.0' },
        body: JSON.stringify(payload),
        timeoutMs: NOTIFY_TIMEOUT_MS,
      });
      if (!res.ok) this.logger.warn(`Notificación de rutina respondió HTTP ${res.status}`);
    } catch (err) {
      this.logger.warn(`No se pudo notificar la rutina ${String(payload.routineId)}: ${(err as Error).message}`);
    }
  }
}
