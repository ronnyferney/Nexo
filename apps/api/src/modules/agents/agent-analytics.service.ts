import { Injectable } from '@nestjs/common';
import { Prisma, type AgentVisibility, type LaunchStatus } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentAccessService } from '../agent-access/agent-access.service';
import { AgentHealthService } from '../agent-access/agent-health.service';
import type { HealthLevel } from '../agent-access/agent-access.types';
import { isWorkspaceAdmin } from '../agent-access/agent-permissions';

/** Ventana de métricas del tablero y la observabilidad (ADR: tablero de agentes RX-11/RX-12). */
export const DASHBOARD_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Niveles de salud que se consideran "alertas que requieren revisión". */
const ALERT_LEVELS: ReadonlySet<HealthLevel> = new Set<HealthLevel>(['CRITICAL', 'NEEDS_WORK']);

/** Variación porcentual (1 decimal) de un periodo contra el anterior; `null` si no hay base de comparación. */
function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

interface AgentRow {
  id: string;
  name: string;
  description: string | null;
  visibility: AgentVisibility;
  launchStatus: LaunchStatus;
  launchedAt: Date | null;
  costCenter: { name: string } | null;
}

interface UsageAgg {
  calls: number;
  users: number;
  costUsd: number;
}

/**
 * Agregación de métricas del tablero de agentes (solo lectura). Todo se filtra por `workspaceId` y por los agentes
 * que el solicitante puede ver (ADMIN/OWNER: todos los del workspace; el resto: los que puede usar). No expone
 * contenido de conversaciones: las métricas provienen de `UsageRecord`, el ciclo de vida del agente y `RoutineRun`.
 */
@Injectable()
export class AgentAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AgentAccessService,
    private readonly health: AgentHealthService,
  ) {}

  /** Agentes visibles para el solicitante (gobierno para ADMIN/OWNER; uso para el resto). */
  private async visibleAgents(auth: AuthContext): Promise<AgentRow[]> {
    const where = isWorkspaceAdmin(auth) ? { workspaceId: auth.workspaceId } : await this.access.usableWhere(auth);
    return this.prisma.agent.findMany({
      where,
      select: {
        id: true,
        name: true,
        description: true,
        visibility: true,
        launchStatus: true,
        launchedAt: true,
        costCenter: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Consumo por agente en una ventana (`UsageRecord`): nº de llamadas al modelo, usuarios distintos y costo. Una
   * "ejecución" se mide como llamada al modelo imputada al agente (chat, flujo, rutina, MCP…): no hay un registro de
   * corrida a nivel de agente, solo por llamada.
   */
  private async usageByAgent(
    workspaceId: string,
    agentIds: string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, UsageAgg>> {
    const out = new Map<string, UsageAgg>();
    if (!agentIds.length) return out;
    const rows = await this.prisma.$queryRaw<
      { agentId: string; calls: bigint; users: bigint; cost: Prisma.Decimal }[]
    >`SELECT "agentId", COUNT(*) AS calls, COUNT(DISTINCT "userId") AS users, COALESCE(SUM("costUsd"), 0) AS cost
        FROM "UsageRecord"
       WHERE "workspaceId" = ${workspaceId}
         AND "agentId" IN (${Prisma.join(agentIds)})
         AND "createdAt" >= ${from} AND "createdAt" < ${to}
       GROUP BY "agentId"`;
    for (const r of rows) {
      out.set(r.agentId, { calls: Number(r.calls), users: Number(r.users), costUsd: Number(r.cost) });
    }
    return out;
  }

  /** Suma de un mapa de consumo. */
  private totals(usage: Map<string, UsageAgg>): { calls: number; costUsd: number } {
    let calls = 0;
    let costUsd = 0;
    for (const u of usage.values()) {
      calls += u.calls;
      costUsd += u.costUsd;
    }
    return { calls, costUsd };
  }

  /**
   * Tablero del catálogo de agentes (RX-11). KPIs, recuentos por pestaña y métricas por agente de los últimos
   * {@link DASHBOARD_WINDOW_DAYS} días, con variación contra el periodo inmediatamente anterior.
   */
  async dashboard(auth: AuthContext) {
    const now = new Date();
    const curFrom = new Date(now.getTime() - DASHBOARD_WINDOW_DAYS * DAY_MS);
    const prevFrom = new Date(now.getTime() - 2 * DASHBOARD_WINDOW_DAYS * DAY_MS);

    const agents = await this.visibleAgents(auth);
    const ids = agents.map((a) => a.id);

    const [curUsage, prevUsage, healthList] = await Promise.all([
      this.usageByAgent(auth.workspaceId, ids, curFrom, now),
      this.usageByAgent(auth.workspaceId, ids, prevFrom, curFrom),
      this.health.evaluateMany(auth.workspaceId, ids),
    ]);
    const healthById = new Map(healthList.map((h) => [h.agentId, h]));

    const active = agents.filter((a) => a.launchStatus === 'LAUNCHED').length;
    const draft = agents.filter((a) => a.launchStatus === 'DRAFT').length;
    const published = agents.filter((a) => a.visibility === 'WORKSPACE').length;
    // Variación de "activos": agentes lanzados dentro de cada ventana (por `launchedAt`).
    const launchedIn = (from: Date, to: Date) =>
      agents.filter((a) => a.launchedAt && a.launchedAt >= from && a.launchedAt < to).length;
    const curTotals = this.totals(curUsage);
    const prevTotals = this.totals(prevUsage);
    const alerts = healthList.filter((h) => ALERT_LEVELS.has(h.level)).length;

    return {
      window: { from: curFrom.toISOString(), to: now.toISOString(), days: DASHBOARD_WINDOW_DAYS },
      kpis: {
        totalAgents: agents.length,
        // "En pruebas" no existe como estado del agente (ciclo de vida: DRAFT/LAUNCHED). Dato faltante.
        testing: null,
        active,
        activeDelta: launchedIn(curFrom, now) - launchedIn(prevFrom, curFrom),
        published,
        executions: curTotals.calls,
        executionsDeltaPct: deltaPct(curTotals.calls, prevTotals.calls),
        // No se registra éxito/fallo por llamada de agente en `UsageRecord`. Dato faltante.
        successRatePct: null,
        costUsd: curTotals.costUsd,
        costDeltaPct: deltaPct(curTotals.costUsd, prevTotals.costUsd),
        alerts,
      },
      counts: {
        all: agents.length,
        active,
        // No existen estados "en pruebas" ni "archivado" en el modelo. Datos faltantes.
        testing: null,
        draft,
        archived: null,
      },
      agents: agents.map((a) => {
        const u = curUsage.get(a.id);
        const h = healthById.get(a.id);
        return {
          id: a.id,
          name: a.name,
          description: a.description,
          visibility: a.visibility,
          status: a.launchStatus,
          health: h ? { score: h.score, level: h.level } : null,
          executions: u?.calls ?? 0,
          users: u?.users ?? 0,
          costUsd: u?.costUsd ?? 0,
          // "Área" se aproxima con el centro de costo del agente (OrgUnit); `null` si no tiene.
          area: a.costCenter?.name ?? null,
        };
      }),
    };
  }

  /**
   * Observabilidad (RX-12, primer corte). Agrega lo que el modelo de datos permite hoy:
   * - `usage`: llamadas, costo y tokens de `UsageRecord`, con desglose por origen.
   * - `routines`: corridas de rutinas de agentes (`RoutineRun`), único registro con estado y duración reales:
   *   tasa de éxito, reintentos (fallidas) y duración media/percentiles.
   * Latencia al primer token, duración por turno de chat, cancelaciones de chat y eventos de protección de datos
   * NO están instrumentados: no se inventan (ver el informe de datos faltantes).
   */
  async analytics(auth: AuthContext) {
    const now = new Date();
    const from = new Date(now.getTime() - DASHBOARD_WINDOW_DAYS * DAY_MS);
    const workspaceId = auth.workspaceId;
    const agents = await this.visibleAgents(auth);
    const ids = agents.map((a) => a.id);

    const [usageTotal, bySourceRows, routineRuns] = await Promise.all([
      this.prisma.usageRecord.aggregate({
        where: { workspaceId, agentId: { in: ids }, createdAt: { gte: from, lt: now } },
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
        _count: true,
      }),
      this.prisma.usageRecord.groupBy({
        by: ['source'],
        where: { workspaceId, agentId: { in: ids }, createdAt: { gte: from, lt: now } },
        _sum: { costUsd: true },
        _count: true,
      }),
      this.prisma.routineRun.findMany({
        where: { startedAt: { gte: from, lt: now }, routine: { workspaceId, agentId: { in: ids } } },
        select: { status: true, startedAt: true, finishedAt: true },
      }),
    ]);

    const byStatus: Record<string, number> = { RUNNING: 0, SUCCEEDED: 0, FAILED: 0 };
    const durations: number[] = [];
    for (const r of routineRuns) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      if (r.finishedAt) durations.push(r.finishedAt.getTime() - r.startedAt.getTime());
    }
    const finished = byStatus.SUCCEEDED + byStatus.FAILED;

    return {
      window: { from: from.toISOString(), to: now.toISOString(), days: DASHBOARD_WINDOW_DAYS },
      usage: {
        calls: usageTotal._count,
        costUsd: Number(usageTotal._sum.costUsd ?? 0),
        inputTokens: usageTotal._sum.inputTokens ?? 0,
        outputTokens: usageTotal._sum.outputTokens ?? 0,
        bySource: bySourceRows
          .map((r) => ({ source: r.source, calls: r._count, costUsd: Number(r._sum.costUsd ?? 0) }))
          .sort((a, b) => b.calls - a.calls),
      },
      routines: {
        total: routineRuns.length,
        byStatus,
        // Tasa de éxito sobre las corridas terminadas (SUCCEEDED/FAILED); `null` si no hubo ninguna.
        successRatePct: finished ? Math.round((byStatus.SUCCEEDED / finished) * 1000) / 10 : null,
        // RunStatus no tiene CANCELLED; los reintentos no se modelan: se expone solo el nº de fallidas.
        failed: byStatus.FAILED,
        durationMs: percentiles(durations),
      },
    };
  }
}

/** Duración media y percentiles p50/p95 (ms) de una muestra; `null` si está vacía. */
function percentiles(samples: number[]): { avg: number; p50: number; p95: number } | null {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { avg: Math.round(avg), p50: at(50), p95: at(95) };
}
