import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentAccessService } from '../agent-access/agent-access.service';
import { isWorkspaceAdmin } from '../agent-access/agent-permissions';
import type { ListAgentRunsQueryDto } from './dto/agent-run.dto';

/** Tope del mensaje de error que se expone en el listado (el detalle completo vive en los logs). */
const ERROR_MAX = 500;
const DEFAULT_TAKE = 25;
const MAX_TAKE = 100;

/**
 * Historial de ejecuciones de agente (RX-14), transversal y de solo lectura. Reutiliza el mismo alcance por rol que
 * el tablero/observabilidad (`AgentAnalyticsService`): ADMIN/OWNER ven todos los agentes del workspace; el resto solo
 * los que pueden usar (`AgentAccessService.usableWhere`). Nunca devuelve runs de agentes que el solicitante no ve, ni
 * de otros workspaces. No expone `userId` ni contenido de conversaciones: solo metadatos de la corrida.
 */
@Injectable()
export class AgentRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AgentAccessService,
  ) {}

  /** Ids de los agentes visibles para el solicitante (gobierno para ADMIN/OWNER; uso para el resto). */
  private async visibleAgentIds(auth: AuthContext): Promise<string[]> {
    const where = isWorkspaceAdmin(auth) ? { workspaceId: auth.workspaceId } : await this.access.usableWhere(auth);
    const rows = await this.prisma.agent.findMany({ where, select: { id: true } });
    return rows.map((r) => r.id);
  }

  /**
   * Página del historial de runs, ordenada por `startedAt` desc (desempate por `id` desc para que el cursor sea
   * estable). `nextCursor` es null cuando no hay más páginas.
   */
  async list(auth: AuthContext, query: ListAgentRunsQueryDto) {
    const limit = Math.min(Math.max(query.take ?? DEFAULT_TAKE, 1), MAX_TAKE);

    const visible = await this.visibleAgentIds(auth);
    // Si se filtra por un agente concreto, debe estar dentro del conjunto visible; si no, página vacía (no 403/404:
    // el histórico transversal no revela la existencia de agentes ajenos).
    const ids = query.agentId ? (visible.includes(query.agentId) ? [query.agentId] : []) : visible;
    if (!ids.length) return { items: [], nextCursor: null, hasMore: false };

    const startedAt: Prisma.DateTimeFilter = {};
    if (query.from) startedAt.gte = new Date(query.from);
    if (query.to) startedAt.lte = new Date(query.to);

    const where: Prisma.AgentRunWhereInput = {
      workspaceId: auth.workspaceId,
      agentId: { in: ids },
      ...(query.status ? { status: query.status } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.from || query.to ? { startedAt } : {}),
    };

    const rows = await this.prisma.agentRun.findMany({
      where,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { agent: { select: { name: true } } },
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    return {
      items: page.map((r) => ({
        id: r.id,
        agentId: r.agentId,
        agentName: r.agent.name,
        source: r.source,
        status: r.status,
        error: r.error ? r.error.slice(0, ERROR_MAX) : null,
        model: r.model,
        providerId: r.providerId,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
        durationMs: r.durationMs,
        ttftMs: r.ttftMs,
        costUsd: r.costUsd === null ? null : Number(r.costUsd),
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        conversationId: r.conversationId,
        executionId: r.executionId,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      hasMore,
    };
  }
}
