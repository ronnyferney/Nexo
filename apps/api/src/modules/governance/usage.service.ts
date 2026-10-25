import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { BudgetsService } from './budgets.service';
import type { GroupBy } from './dto/governance.dto';
import { OrgService } from './org.service';

interface Agg {
  key: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/** Reportes de consumo y costo (no exponen contenido de conversaciones). */
@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly org: OrgService,
    private readonly budgets: BudgetsService,
  ) {}

  async summary(workspaceId: string, fromIso?: string, toIso?: string, groupBy: GroupBy = 'orgUnit') {
    const from = fromIso ? new Date(fromIso) : monthStart();
    const to = toIso ? new Date(toIso) : new Date();
    const where: Prisma.UsageRecordWhereInput = { workspaceId, createdAt: { gte: from, lte: to } };

    const total = await this.prisma.usageRecord.aggregate({
      where,
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      _count: true,
    });

    let groups: Agg[];
    if (groupBy === 'day') {
      const rows = await this.prisma.$queryRaw<
        { key: string; cost: Prisma.Decimal; input: bigint; output: bigint; calls: bigint }[]
      >`SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS key, SUM("costUsd") AS cost,
               SUM("inputTokens") AS input, SUM("outputTokens") AS output, COUNT(*) AS calls
          FROM "UsageRecord"
         WHERE "workspaceId" = ${workspaceId} AND "createdAt" >= ${from} AND "createdAt" <= ${to}
         GROUP BY 1 ORDER BY 1`;
      groups = rows.map((r) => ({
        key: r.key,
        costUsd: Number(r.cost),
        inputTokens: Number(r.input),
        outputTokens: Number(r.output),
        calls: Number(r.calls),
      }));
    } else {
      const field = {
        orgUnit: 'orgUnitId',
        model: 'model',
        agent: 'agentId',
        user: 'userId',
        role: 'role',
        routingReason: 'routingReason',
      }[groupBy] as 'orgUnitId' | 'model' | 'agentId' | 'userId' | 'role' | 'routingReason';
      const rows = await this.prisma.usageRecord.groupBy({
        by: [field],
        where,
        _sum: { costUsd: true, inputTokens: true, outputTokens: true },
        _count: true,
      });
      groups = rows
        .map((r) => ({
          key: r[field] ?? '',
          costUsd: Number(r._sum.costUsd ?? 0),
          inputTokens: r._sum.inputTokens ?? 0,
          outputTokens: r._sum.outputTokens ?? 0,
          calls: r._count,
        }))
        .sort((a, b) => b.costUsd - a.costUsd);
    }

    const labels = await this.labels(
      workspaceId,
      groupBy,
      groups.map((g) => g.key),
    );
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totalCostUsd: Number(total._sum.costUsd ?? 0),
      inputTokens: total._sum.inputTokens ?? 0,
      outputTokens: total._sum.outputTokens ?? 0,
      calls: total._count,
      groups: groups.map((g) => ({ ...g, label: labels.get(g.key) ?? (g.key || 'Sin asignar') })),
    };
  }

  async records(workspaceId: string, take = 25, cursor?: string) {
    const limit = Math.min(Math.max(take, 1), 100);
    const rows = await this.prisma.usageRecord.findMany({
      where: { workspaceId },
      include: { orgUnit: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    const [users, agents] = await Promise.all([
      this.labels(
        workspaceId,
        'user',
        page.map((r) => r.userId ?? ''),
      ),
      this.labels(
        workspaceId,
        'agent',
        page.map((r) => r.agentId ?? ''),
      ),
    ]);
    return {
      items: page.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        source: r.source,
        model: r.model,
        providerId: r.providerId,
        orgUnitName: r.orgUnit?.name ?? null,
        userName: r.userId ? (users.get(r.userId) ?? null) : null,
        agentName: r.agentId ? (agents.get(r.agentId) ?? null) : null,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUsd: Number(r.costUsd),
        routingReason: r.routingReason,
        role: r.role,
      })),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  /** Estado de presupuesto de la cadena del usuario y su consumo del mes. */
  async me(workspaceId: string, userId?: string) {
    const unitId = await this.org.resolveCostCenter(workspaceId, userId);
    const unit = await this.org.unit(workspaceId, unitId);
    const chain = await this.budgets.chainState(workspaceId, unitId);
    const periods = await this.prisma.budget.findMany({ where: { orgUnitId: { in: chain.map((c) => c.orgUnitId) } } });
    const periodOf = new Map(periods.map((b) => [b.orgUnitId, b.period]));
    const since = monthStart();
    const mine = userId
      ? await this.prisma.usageRecord.aggregate({
          where: { workspaceId, userId, createdAt: { gte: since } },
          _sum: { costUsd: true, inputTokens: true, outputTokens: true },
          _count: true,
        })
      : null;
    return {
      orgUnit: { id: unit.id, name: unit.name },
      budgets: chain
        .filter((c) => c.budget)
        .map((c) => ({
          orgUnitId: c.orgUnitId,
          orgUnitName: c.name,
          period: periodOf.get(c.orgUnitId)!,
          periodKey: c.budget!.periodKey,
          limitUsd: c.budget!.limitUsd,
          spentUsd: c.spentUsd,
          pct: c.budget!.limitUsd > 0 ? Math.round((c.spentUsd / c.budget!.limitUsd) * 1000) / 10 : 100,
          policy: c.budget!.policy,
        })),
      me: {
        costUsd: Number(mine?._sum.costUsd ?? 0),
        calls: mine?._count ?? 0,
        inputTokens: mine?._sum.inputTokens ?? 0,
        outputTokens: mine?._sum.outputTokens ?? 0,
        since: since.toISOString(),
      },
    };
  }

  private async labels(workspaceId: string, groupBy: GroupBy, keys: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(keys.filter(Boolean))];
    if (!ids.length || groupBy === 'model' || groupBy === 'day' || groupBy === 'role' || groupBy === 'routingReason') {
      // Estos agrupamientos ya son el valor legible (código de motivo, rol, modelo o día): la clave es su propia etiqueta.
      return new Map(ids.map((k) => [k, k]));
    }
    if (groupBy === 'orgUnit') {
      const rows = await this.prisma.orgUnit.findMany({
        where: { workspaceId, id: { in: ids } },
        select: { id: true, name: true },
      });
      return new Map(rows.map((r) => [r.id, r.name]));
    }
    if (groupBy === 'agent') {
      const rows = await this.prisma.agent.findMany({
        where: { workspaceId, id: { in: ids } },
        select: { id: true, name: true },
      });
      return new Map(rows.map((r) => [r.id, r.name]));
    }
    const rows = await this.prisma.user.findMany({
      where: { id: { in: ids }, memberships: { some: { workspaceId } } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
