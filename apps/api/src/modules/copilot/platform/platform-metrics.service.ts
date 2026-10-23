import { Injectable, Logger } from '@nestjs/common';
import type { FeedbackRating } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AgentHealthService } from '../../agent-access/agent-health.service';
import type { HealthLevel } from '../../agent-access/agent-access.types';
import { CopilotQuotaService, quotaPeriod } from '../copilot-quota.service';
import type { SharedConversation } from '../copilot-feedback.service';

/**
 * Reglas de "workspace en riesgo" (ADR 0006 D6), deliberadamente simples y explicables:
 * - `NO_LAUNCH`: el workspace tiene ≥ 7 días y ningún agente lanzado.
 * - `LOW_HEALTH`: el puntaje de salud medio de sus agentes evaluados es < 50.
 * - `COPILOT_DISSATISFIED`: en el rango hay ≥ 3 calificaciones 👎 al Copilot y superan a las 👍.
 * - `QUOTA_EXHAUSTED`: agotó el cupo del Copilot del mes en curso.
 */
export const RISK_RULES = {
  noLaunchAfterDays: 7,
  lowHealthBelow: 50,
  minDownRatings: 3,
} as const;

/** Prioridad de cada señal al ordenar (las más accionables primero; varias señales suman). */
export const RISK_WEIGHTS = { lowHealth: 3, dissatisfied: 3, quota: 2, noLaunch: 1 } as const;

/** Agentes cuyo puntaje de salud se calcula por consulta (los actualizados más recientemente). */
const MAX_HEALTH_AGENTS = 500;
const HEALTH_CONCURRENCY = 20;
const MAX_AT_RISK = 100;
const LEVELS: HealthLevel[] = ['CRITICAL', 'NEEDS_WORK', 'GOOD', 'EXCELLENT'];

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface RiskInput {
  noLaunchIds: string[];
  healthAvg: Map<string, number>;
  votes: Map<string, { up: number; down: number }>;
  copilotSpend: Map<string, number>;
  quotaLimitUsd: number;
}

/** Aplica las reglas de riesgo y ordena por peso (pura, para pruebas). */
export function rankAtRisk(input: RiskInput): { id: string; reasons: string[]; weight: number }[] {
  const out = new Map<string, { id: string; reasons: string[]; weight: number }>();
  const add = (id: string, reason: string, w: number) => {
    const cur = out.get(id) ?? { id, reasons: [], weight: 0 };
    out.set(id, { id, reasons: [...cur.reasons, reason], weight: cur.weight + w });
  };
  for (const id of input.noLaunchIds) {
    add(id, `Sin agentes lanzados tras ${RISK_RULES.noLaunchAfterDays} días`, RISK_WEIGHTS.noLaunch);
  }
  for (const [ws, avg] of input.healthAvg) {
    if (avg < RISK_RULES.lowHealthBelow) add(ws, `Salud media baja (${Math.round(avg)}/100)`, RISK_WEIGHTS.lowHealth);
  }
  for (const [ws, v] of input.votes) {
    if (v.down >= RISK_RULES.minDownRatings && v.down > v.up) {
      add(ws, `Mucho 👎 al Copilot (${v.down} vs ${v.up} 👍)`, RISK_WEIGHTS.dissatisfied);
    }
  }
  for (const [ws, spent] of input.copilotSpend) {
    if (spent >= input.quotaLimitUsd) add(ws, 'Cupo del Copilot agotado', RISK_WEIGHTS.quota);
  }
  return [...out.values()].sort((a, b) => b.weight - a.weight);
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Consola de plataforma del Copilot: métricas agregadas de éxito de todos los workspaces. Nunca devuelve contenido de
 * conversaciones de clientes, salvo las que el usuario compartió explícitamente al calificar.
 */
@Injectable()
export class PlatformMetricsService {
  private readonly logger = new Logger(PlatformMetricsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly health: AgentHealthService,
    private readonly quota: CopilotQuotaService,
  ) {}

  /** Rango por defecto: últimos 30 días. */
  static range(from?: string, to?: string): { from: Date; to: Date } {
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - 30 * 86_400_000);
    return {
      from: Number.isNaN(start.getTime()) ? new Date(Date.now() - 30 * 86_400_000) : start,
      to: Number.isNaN(end.getTime()) ? new Date() : end,
    };
  }

  async metrics(fromRaw?: string, toRaw?: string) {
    const { from, to } = PlatformMetricsService.range(fromRaw, toRaw);
    const inRange = { gte: from, lte: to };
    const [workspaces, active, agentsCreated, agentsLaunched, evalAvg, ratings, quotaAgg, firstLaunches] =
      await Promise.all([
        this.prisma.workspace.count(),
        this.prisma.usageRecord.groupBy({ by: ['workspaceId'], where: { createdAt: inRange } }),
        this.prisma.agent.count({ where: { createdAt: inRange } }),
        this.prisma.agent.count({ where: { launchStatus: 'LAUNCHED', launchedAt: inRange } }),
        this.prisma.evalRun.aggregate({ where: { status: 'SUCCEEDED', createdAt: inRange }, _avg: { score: true } }),
        this.prisma.copilotFeedback.groupBy({ by: ['rating'], where: { createdAt: inRange }, _count: { _all: true } }),
        this.prisma.usageRecord.aggregate({
          where: { source: 'COPILOT', createdAt: inRange },
          _sum: { costUsd: true },
        }),
        this.prisma.agent.groupBy({
          by: ['workspaceId'],
          where: { launchedAt: { not: null } },
          _min: { launchedAt: true },
        }),
      ]);

    const firstInRange = firstLaunches.filter(
      (f) => f._min.launchedAt && f._min.launchedAt >= from && f._min.launchedAt <= to,
    );
    const created = await this.prisma.workspace.findMany({
      where: { id: { in: firstInRange.map((f) => f.workspaceId) } },
      select: { id: true, createdAt: true },
    });
    const createdAt = new Map(created.map((w) => [w.id, w.createdAt.getTime()]));
    const minutes = firstInRange
      .filter((f) => createdAt.has(f.workspaceId))
      .map((f) => (f._min.launchedAt!.getTime() - createdAt.get(f.workspaceId)!) / 60_000);

    const health = await this.healthSample();
    const count = (r: FeedbackRating) => ratings.find((x) => x.rating === r)?._count._all ?? 0;

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      workspaces,
      activeWorkspaces: active.length,
      agentsCreated,
      agentsLaunched,
      medianMinutesToFirstLaunch: (() => {
        const m = median(minutes);
        return m === null ? null : Math.round(m);
      })(),
      healthDistribution: health.distribution,
      healthSampleSize: health.evaluated,
      avgEvalScore: evalAvg._avg.score === null ? null : round(evalAvg._avg.score),
      copilotSatisfaction: { up: count('UP'), down: count('DOWN') },
      quotaUsageUsd: round(Number(quotaAgg._sum.costUsd ?? 0), 6),
      atRiskWorkspaces: await this.atRisk(from, to, health.avgByWorkspace),
      riskRules: RISK_RULES,
    };
  }

  /** Puntaje de salud de una muestra acotada de agentes; los que fallan al evaluarse se omiten. */
  private async healthSample() {
    const distribution = Object.fromEntries(LEVELS.map((l) => [l, 0])) as Record<HealthLevel, number>;
    const sums = new Map<string, { total: number; n: number }>();
    const agents = await this.prisma.agent.findMany({
      select: { id: true, workspaceId: true },
      orderBy: { updatedAt: 'desc' },
      take: MAX_HEALTH_AGENTS,
    });
    let evaluated = 0;
    let warned = false;
    for (let i = 0; i < agents.length; i += HEALTH_CONCURRENCY) {
      const batch = agents.slice(i, i + HEALTH_CONCURRENCY);
      const results = await Promise.allSettled(batch.map((a) => this.health.evaluate(a.workspaceId, a.id)));
      results.forEach((r, j) => {
        if (r.status !== 'fulfilled') {
          if (!warned) this.logger.warn(`Salud no disponible para la consola: ${(r.reason as Error)?.message}`);
          warned = true;
          return;
        }
        evaluated++;
        distribution[r.value.level] = (distribution[r.value.level] ?? 0) + 1;
        const ws = batch[j].workspaceId;
        const acc = sums.get(ws) ?? { total: 0, n: 0 };
        sums.set(ws, { total: acc.total + r.value.score, n: acc.n + 1 });
      });
      // Si la salud no está implementada/disponible, no tiene sentido seguir consultando.
      if (!evaluated && warned) break;
    }
    const avgByWorkspace = new Map([...sums].map(([ws, s]) => [ws, s.total / s.n]));
    return { distribution, evaluated, avgByWorkspace };
  }

  private async atRisk(from: Date, to: Date, healthAvg: Map<string, number>) {
    const cutoff = new Date(Date.now() - RISK_RULES.noLaunchAfterDays * 86_400_000);
    const [noLaunch, ratings, copilotSpend] = await Promise.all([
      this.prisma.workspace.findMany({
        where: { createdAt: { lte: cutoff }, agents: { none: { launchStatus: 'LAUNCHED' } } },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
        take: MAX_AT_RISK,
      }),
      this.prisma.copilotFeedback.groupBy({
        by: ['workspaceId', 'rating'],
        where: { createdAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
      this.prisma.usageRecord.groupBy({
        by: ['workspaceId'],
        where: { source: 'COPILOT', createdAt: { gte: quotaPeriod().start } },
        _sum: { costUsd: true },
      }),
    ]);
    const votes = new Map<string, { up: number; down: number }>();
    for (const r of ratings) {
      const v = votes.get(r.workspaceId) ?? { up: 0, down: 0 };
      if (r.rating === 'UP') v.up += r._count._all;
      else v.down += r._count._all;
      votes.set(r.workspaceId, v);
    }
    const ranked = rankAtRisk({
      noLaunchIds: noLaunch.map((w) => w.id),
      healthAvg,
      votes,
      copilotSpend: new Map(copilotSpend.map((c) => [c.workspaceId, Number(c._sum.costUsd ?? 0)])),
      quotaLimitUsd: this.quota.monthlyLimitUsd,
    });
    const names = await this.prisma.workspace.findMany({
      where: { id: { in: ranked.map((r) => r.id) } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    return ranked
      .filter((r) => nameOf.has(r.id))
      .slice(0, MAX_AT_RISK)
      .map((r) => ({ id: r.id, name: nameOf.get(r.id)!, reason: r.reasons.join('; ') }));
  }

  /** Calificaciones y comentarios; la conversación (y el texto calificado) solo si el usuario la compartió. */
  async feedback(opts: { rating?: FeedbackRating; take?: number }) {
    const rows = await this.prisma.copilotFeedback.findMany({
      where: opts.rating ? { rating: opts.rating } : {},
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(opts.take ?? 100, 1), 200),
      include: { message: { select: { text: true, session: { select: { mode: true } } } } },
    });
    const names = await this.prisma.workspace.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.workspaceId))] } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    return rows.map((r) => {
      const shared = r.sharedConversation as SharedConversation | null;
      return {
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
        workspaceId: r.workspaceId,
        workspaceName: nameOf.get(r.workspaceId) ?? null,
        mode: r.message.session.mode,
        copilotVersion: shared?.copilotVersion ?? null,
        messageText: shared ? r.message.text : null,
        sharedConversation: shared?.messages ?? null,
      };
    });
  }
}
