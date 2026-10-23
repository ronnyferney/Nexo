import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { TurnUsage } from '../llm/llm-provider';

export interface CopilotQuota {
  limitUsd: number;
  usedUsd: number;
  remainingUsd: number;
  /** Mes en curso en UTC (`2026-10`). */
  period: string;
}

/** Inicio del mes UTC y su clave de periodo. */
export function quotaPeriod(now = new Date()): { start: Date; end: Date; key: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end, key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}` };
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Cupo mensual: lo usado nunca resta más que el límite (el último turno puede sobrepasarlo). */
export function computeQuota(limitUsd: number, usedUsd: number, now = new Date()): CopilotQuota {
  const used = Math.max(0, usedUsd);
  return {
    limitUsd: round(limitUsd),
    usedUsd: round(used),
    remainingUsd: round(Math.max(0, limitUsd - used)),
    period: quotaPeriod(now).key,
  };
}

export const isQuotaExhausted = (q: CopilotQuota) => q.remainingUsd <= 0;

export const COPILOT_QUOTA_MESSAGE =
  'Se agotó el cupo mensual del Copilot para este workspace. Se renueva el próximo mes; mientras tanto puede usar el puntaje de salud de sus agentes y las plantillas.';

/** Cupo agotado: HTTP 402, distinto del presupuesto del cliente (el Copilot lo paga Nexo). */
export class CopilotQuotaExceededException extends HttpException {
  constructor() {
    super({ message: COPILOT_QUOTA_MESSAGE, code: 'COPILOT_QUOTA_EXCEEDED' }, HttpStatus.PAYMENT_REQUIRED);
  }
}

/**
 * Cupo del Copilot pagado por Nexo (ADR 0006 D2). El consumo se registra en `UsageRecord` con `source: COPILOT`
 * directamente, sin pasar por el libro mayor ni por los presupuestos del cliente.
 */
@Injectable()
export class CopilotQuotaService {
  private readonly limitUsd: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.limitUsd = config.get<number>('copilot.monthlyQuotaUsd') ?? 2;
  }

  get monthlyLimitUsd(): number {
    return this.limitUsd;
  }

  async usedUsd(workspaceId: string, from: Date, to?: Date): Promise<number> {
    const agg = await this.prisma.usageRecord.aggregate({
      where: { workspaceId, source: 'COPILOT', createdAt: { gte: from, ...(to ? { lt: to } : {}) } },
      _sum: { costUsd: true },
    });
    return Number(agg._sum.costUsd ?? 0);
  }

  async status(workspaceId: string, now = new Date()): Promise<CopilotQuota> {
    return computeQuota(this.limitUsd, await this.usedUsd(workspaceId, quotaPeriod(now).start), now);
  }

  /** Antes de cada turno del modelo: corta si el cupo del mes está agotado. */
  async assertAvailable(workspaceId: string): Promise<void> {
    if (isQuotaExhausted(await this.status(workspaceId))) throw new CopilotQuotaExceededException();
  }

  async record(
    ctx: { workspaceId: string; userId: string; agentId?: string | null },
    providerId: string,
    model: string,
    usage: TurnUsage,
    cost: number,
  ): Promise<void> {
    await this.prisma.usageRecord.create({
      data: {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        agentId: ctx.agentId ?? null,
        source: 'COPILOT',
        providerId,
        model,
        ...usage,
        costUsd: new Prisma.Decimal(cost.toFixed(8)),
      },
    });
  }
}
