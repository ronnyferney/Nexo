import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AgentEvent } from '../llm/llm-provider';
import { AgentRuntimeService, toolName, type AgentWithTools } from './agent-runtime.service';
import { CreateAgentDto, SetAgentToolsDto, UpdateAgentDto } from './dto/agent.dto';

const WITH_TOOLS = { tools: { include: { operation: { include: { connector: true } } } } } as const;

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: AgentRuntimeService,
  ) {}

  list(workspaceId: string) {
    return this.prisma.agent.findMany({
      where: { workspaceId },
      include: { _count: { select: { tools: true, conversations: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async get(workspaceId: string, id: string): Promise<AgentWithTools> {
    const agent = await this.prisma.agent.findFirst({ where: { id, workspaceId }, include: WITH_TOOLS });
    if (!agent) throw new NotFoundException('Agente no encontrado');
    return agent;
  }

  async describe(workspaceId: string, id: string) {
    const agent = await this.get(workspaceId, id);
    return {
      ...agent,
      tools: agent.tools.map((t) => ({
        operationId: t.operationId,
        requiresApproval: t.requiresApproval,
        toolName: toolName(t.operation.connector.name, t.operation.key),
        operation: { id: t.operation.id, key: t.operation.key, name: t.operation.name },
        connector: { id: t.operation.connector.id, name: t.operation.connector.name, type: t.operation.connector.type },
      })),
    };
  }

  create(workspaceId: string, dto: CreateAgentDto) {
    return this.prisma.agent.create({ data: { ...dto, workspaceId } });
  }

  async update(workspaceId: string, id: string, dto: UpdateAgentDto) {
    await this.get(workspaceId, id);
    return this.prisma.agent.update({ where: { id }, data: dto });
  }

  async remove(workspaceId: string, id: string) {
    await this.get(workspaceId, id);
    await this.prisma.agent.delete({ where: { id } });
  }

  async setTools(workspaceId: string, id: string, dto: SetAgentToolsDto) {
    await this.get(workspaceId, id);
    const ids = dto.tools.map((t) => t.operationId);
    const valid = await this.prisma.connectorOperation.findMany({
      where: { id: { in: ids }, connector: { workspaceId } },
      select: { id: true },
    });
    const allowed = new Set(valid.map((v) => v.id));
    await this.prisma.$transaction([
      this.prisma.agentTool.deleteMany({ where: { agentId: id } }),
      this.prisma.agentTool.createMany({
        data: dto.tools
          .filter((t) => allowed.has(t.operationId))
          .map((t) => ({ agentId: id, operationId: t.operationId, requiresApproval: !!t.requiresApproval })),
        skipDuplicates: true,
      }),
    ]);
    return this.describe(workspaceId, id);
  }

  conversations(workspaceId: string, agentId: string) {
    return this.prisma.conversation.findMany({
      where: { agentId, agent: { workspaceId } },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  async conversation(workspaceId: string, agentId: string, conversationId: string) {
    const c = await this.prisma.conversation.findFirst({
      where: { id: conversationId, agentId, agent: { workspaceId } },
    });
    if (!c) throw new NotFoundException('Conversación no encontrada');
    return c;
  }

  /** Ejecuta un turno de chat y persiste el historial nativo del proveedor. */
  async chat(
    workspaceId: string,
    agentId: string,
    input: { message: string; conversationId?: string; approvedTools?: string[] },
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal,
  ) {
    const agent = await this.get(workspaceId, agentId);
    let conversation = input.conversationId
      ? await this.conversation(workspaceId, agentId, input.conversationId)
      : null;
    let history: unknown[] = [];
    if (conversation && conversation.provider === agent.provider) {
      history = conversation.messages as unknown[];
    } else if (conversation) {
      onEvent?.({ type: 'notice', message: 'El proveedor del agente cambió; se inicia un historial nuevo.' });
    }

    const result = await this.runtime.run(agent, {
      history,
      message: input.message,
      approvedTools: input.approvedTools,
      onEvent,
      signal,
    });
    const messages = result.history as Prisma.InputJsonValue;
    conversation = conversation
      ? await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { messages, provider: agent.provider },
        })
      : await this.prisma.conversation.create({
          data: { agentId, provider: agent.provider, messages, title: input.message.slice(0, 60) },
        });

    return {
      conversationId: conversation.id,
      text: result.text,
      stopReason: result.stopReason,
      turns: result.turns,
      usage: result.usage,
    };
  }

  /** Ejecución sin estado (usada por flujos y por el servidor MCP). */
  async runOnce(workspaceId: string, agentId: string, message: string) {
    const agent = await this.get(workspaceId, agentId);
    const r = await this.runtime.run(agent, { message });
    return { text: r.text, stopReason: r.stopReason, turns: r.turns, usage: r.usage };
  }
}
