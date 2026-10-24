import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CopilotMode, CopilotProposal, Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentAccessService } from '../agent-access/agent-access.service';
import { LlmGatewayService } from '../llm/llm-gateway.service';
import type { AgentEvent } from '../llm/llm-provider';
import { costUsd } from '../llm/pricing';
import { CopilotQuotaService } from './copilot-quota.service';
import { COPILOT_TOOL_SPECS } from './copilot-tools.definitions';
import { CopilotToolsService, type ProposalEvent } from './copilot-tools.service';
import { buildCopilotSystem, COPILOT_EFFORT, COPILOT_MAX_TURNS } from './definition/copilot.definition';

export type CopilotEvent = AgentEvent | ({ type: 'proposal' } & ProposalEvent);
export type UserAuth = AuthContext & { userId: string };

/** Vista pública de una propuesta (ADR 0006). `REJECTED` del esquema se expone como `DISCARDED`. */
export function proposalView(p: CopilotProposal) {
  return {
    id: p.id,
    sessionId: p.sessionId,
    kind: p.kind,
    status: p.status === 'REJECTED' ? 'DISCARDED' : p.status,
    summary: p.summary,
    payload: p.payload,
    agentId: p.agentId,
    appliedAt: p.appliedAt,
    createdAt: p.createdAt,
  };
}

/** El Copilot es personal: requiere un usuario (no API keys). */
export function requireUser(auth: AuthContext): UserAuth {
  if (!auth.userId) throw new ForbiddenException('El Copilot requiere una sesión de usuario');
  return auth as UserAuth;
}

/**
 * Sesiones y mensajes del Nexo Copilot (ADR 0006 D1/D2). Reutiliza el puerto `LlmClient` (bucle de herramientas del
 * proveedor) con herramientas internas propias; el consumo se mide con `source: COPILOT` contra el cupo pagado por
 * Nexo y nunca pasa por los presupuestos del cliente.
 */
@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);
  private readonly providerId: string;
  private readonly model: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: LlmGatewayService,
    private readonly access: AgentAccessService,
    private readonly tools: CopilotToolsService,
    private readonly quota: CopilotQuotaService,
    config: ConfigService,
  ) {
    this.providerId = config.get<string>('copilot.provider') ?? 'mock';
    this.model = config.get<string>('copilot.model') ?? 'mock-echo';
  }

  async createSession(a: AuthContext, dto: { mode: CopilotMode; agentId?: string; context?: string }) {
    const auth = requireUser(a);
    const needsAgent = dto.mode === 'IMPROVE' || dto.mode === 'DIAGNOSE';
    if (needsAgent && !dto.agentId) throw new BadRequestException(`El modo ${dto.mode} requiere "agentId"`);
    if (dto.agentId) await this.access.assert(auth, dto.agentId, 'USE');
    const session = await this.prisma.copilotSession.create({
      data: {
        workspaceId: auth.workspaceId,
        userId: auth.userId,
        agentId: dto.agentId ?? null,
        mode: dto.mode,
        context: dto.context?.trim() || null,
        providerId: this.providerId,
        model: this.model,
      },
    });
    return { id: session.id, mode: session.mode, agentId: session.agentId };
  }

  /** Solo el usuario dueño accede a su sesión (404 en otro caso, sin revelar su existencia). */
  async ownSession(a: AuthContext, id: string) {
    const auth = requireUser(a);
    const session = await this.prisma.copilotSession.findFirst({
      where: { id, workspaceId: auth.workspaceId, userId: auth.userId },
    });
    if (!session) throw new NotFoundException('Sesión del Copilot no encontrada');
    return session;
  }

  async getSession(a: AuthContext, id: string) {
    const session = await this.ownSession(a, id);
    const [messages, proposals] = await Promise.all([
      this.prisma.copilotMessage.findMany({
        where: { sessionId: id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, text: true, createdAt: true, feedback: { select: { rating: true } } },
      }),
      this.prisma.copilotProposal.findMany({ where: { sessionId: id }, orderBy: { createdAt: 'asc' } }),
    ]);
    return {
      id: session.id,
      mode: session.mode,
      agentId: session.agentId,
      createdAt: session.createdAt,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        text: m.text,
        createdAt: m.createdAt,
        rating: m.feedback?.rating ?? null,
      })),
      proposals: proposals.map(proposalView),
    };
  }

  /**
   * Verificaciones previas al turno (dueño, acceso vigente al agente en foco y cupo). Se separan de `send` para que el
   * controlador responda con el código HTTP correcto antes de abrir el stream SSE.
   */
  async prepareTurn(a: AuthContext, id: string) {
    const session = await this.ownSession(a, id);
    const auth = requireUser(a);
    if (session.agentId) await this.access.assert(auth, session.agentId, 'USE');
    await this.quota.assertAvailable(auth.workspaceId);
    return { auth, session };
  }

  async send(
    a: AuthContext,
    id: string,
    message: string,
    onEvent?: (e: CopilotEvent) => void,
    signal?: AbortSignal,
    prepared?: Awaited<ReturnType<CopilotService['prepareTurn']>>,
  ) {
    const { auth, session } = prepared ?? (await this.prepareTurn(a, id));
    const ws = auth.workspaceId;
    // El Copilot lo paga Nexo con su propio cupo (CopilotQuotaService), no con el de la conexión de plataforma.
    const resolved = await this.gateway.resolve(ws, session.providerId, session.model, { platformQuota: false });
    const [user, workspace] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: auth.userId }, select: { name: true } }),
      this.prisma.workspace.findUnique({ where: { id: ws }, select: { name: true } }),
    ]);
    const system = buildCopilotSystem({
      mode: session.mode,
      agentId: session.agentId,
      context: session.context,
      userName: user?.name,
      workspaceName: workspace?.name,
    });

    const proposals: ProposalEvent[] = [];
    let totalCost = 0;
    const result = await resolved.client.run({
      model: resolved.model,
      system,
      effort: COPILOT_EFFORT,
      history: (session.history as unknown[]) ?? [],
      userMessage: message,
      tools: COPILOT_TOOL_SPECS,
      maxTurns: COPILOT_MAX_TURNS,
      onEvent,
      signal,
      beforeTurn: () => this.quota.assertAvailable(ws),
      onUsage: async (usage) => {
        const cost = costUsd(usage, resolved.pricing);
        totalCost += cost;
        await this.quota.record(
          { workspaceId: ws, userId: auth.userId, agentId: session.agentId },
          resolved.providerId,
          resolved.model,
          usage,
          cost,
        );
      },
      executeTool: (call) =>
        this.tools.execute(
          {
            auth,
            sessionId: session.id,
            agentId: session.agentId,
            onProposal: (p) => {
              proposals.push(p);
              onEvent?.({ type: 'proposal', ...p });
            },
          },
          call,
        ),
    });

    // Historial nativo append-only y mensajes visibles (texto plano) para mostrar y calificar.
    const now = Date.now();
    const [, userMsg, assistantMsg] = await this.prisma.$transaction([
      this.prisma.copilotSession.update({
        where: { id: session.id },
        data: { history: result.history as Prisma.InputJsonValue },
      }),
      this.prisma.copilotMessage.create({
        data: { sessionId: session.id, role: 'user', text: message, createdAt: new Date(now) },
      }),
      this.prisma.copilotMessage.create({
        data: { sessionId: session.id, role: 'assistant', text: result.text, createdAt: new Date(now + 1) },
      }),
    ]);

    return {
      sessionId: session.id,
      userMessageId: userMsg.id,
      messageId: assistantMsg.id,
      text: result.text,
      stopReason: result.stopReason,
      turns: result.turns,
      proposals,
      usage: { ...result.usage, costUsd: Math.round(totalCost * 1e8) / 1e8 },
    };
  }
}
