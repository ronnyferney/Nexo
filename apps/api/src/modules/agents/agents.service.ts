import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AgentEvent } from '../llm/llm-provider';
import { OrgService } from '../governance/org.service';
import { AgentRuntimeService, toolName, type AgentWithTools, type RunContext } from './agent-runtime.service';
import {
  CreateAgentDto,
  CreateAgentExampleDto,
  SetAgentKnowledgeDto,
  SetAgentSkillsDto,
  SetAgentToolsDto,
  UpdateAgentDto,
} from './dto/agent.dto';
import { normalizeProfile } from './prompt-composer';

export const MAX_EXAMPLES = 20;
/** Meta de puntaje por defecto (ADR 0004, D4). */
export const DEFAULT_TARGET_SCORE = 0.85;
/** Meta de puntaje del agente (bucle de mejora, ADR 0004). */
export function targetScoreOf(agent: { targetScore?: number | null }): number {
  return agent.targetScore ?? DEFAULT_TARGET_SCORE;
}

const WITH_TOOLS = {
  tools: { include: { operation: { include: { connector: true } } } },
  skills: { include: { skill: true } },
  knowledge: { include: { knowledgeBase: { select: { id: true, name: true, description: true } } } },
  examples: { orderBy: { createdAt: 'asc' }, take: MAX_EXAMPLES, select: { input: true, output: true } },
} as const satisfies Prisma.AgentInclude;

/** Perfil y cadena de respaldo normalizados para persistir (el perfil se reemplaza completo). */
function agentData<T extends CreateAgentDto | UpdateAgentDto>(dto: T) {
  const { profile, fallbackModels, targetScore, ...rest } = dto;
  return {
    ...rest,
    ...(targetScore !== undefined ? { targetScore } : {}),
    ...(profile !== undefined ? { profile: normalizeProfile(profile) as Prisma.InputJsonValue } : {}),
    ...(fallbackModels !== undefined ? { fallbackModels: [...new Set(fallbackModels.map((f) => f.trim()))] } : {}),
  };
}

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: AgentRuntimeService,
    private readonly org: OrgService,
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
    const examplesCount = await this.prisma.agentExample.count({ where: { agentId: id } });
    const { knowledge, examples, ...rest } = agent;
    void examples;
    return {
      ...rest,
      targetScore: targetScoreOf(agent),
      profile: normalizeProfile(agent.profile),
      skills: (agent.skills ?? [])
        .map((s) => ({ id: s.skill.id, name: s.skill.name, slug: s.skill.slug }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      knowledgeBases: (knowledge ?? [])
        .map((k) => ({ id: k.knowledgeBase.id, name: k.knowledgeBase.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      examplesCount,
      tools: agent.tools.map((t) => ({
        operationId: t.operationId,
        requiresApproval: t.requiresApproval,
        toolName: toolName(t.operation.connector.name, t.operation.key),
        operation: { id: t.operation.id, key: t.operation.key, name: t.operation.name },
        connector: { id: t.operation.connector.id, name: t.operation.connector.name, type: t.operation.connector.type },
      })),
    };
  }

  async create(workspaceId: string, dto: CreateAgentDto) {
    if (dto.costCenterId) await this.org.unit(workspaceId, dto.costCenterId);
    return this.prisma.agent.create({ data: { ...agentData(dto), workspaceId } });
  }

  async update(workspaceId: string, id: string, dto: UpdateAgentDto) {
    await this.get(workspaceId, id);
    if (dto.costCenterId) await this.org.unit(workspaceId, dto.costCenterId);
    return this.prisma.agent.update({ where: { id }, data: agentData(dto) });
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

  /** Reemplaza las skills del agente; todas deben pertenecer al workspace. */
  async setSkills(workspaceId: string, id: string, dto: SetAgentSkillsDto) {
    await this.get(workspaceId, id);
    const ids = [...new Set(dto.skillIds)];
    const found = await this.prisma.skill.findMany({ where: { id: { in: ids }, workspaceId }, select: { id: true } });
    if (found.length !== ids.length) throw new BadRequestException('Alguna habilidad no existe en el workspace');
    await this.prisma.$transaction([
      this.prisma.agentSkill.deleteMany({ where: { agentId: id } }),
      this.prisma.agentSkill.createMany({ data: ids.map((skillId) => ({ agentId: id, skillId })) }),
      this.prisma.agent.update({ where: { id }, data: { updatedAt: new Date() } }),
    ]);
    return this.describe(workspaceId, id);
  }

  /** Reemplaza las bases de conocimiento del agente; todas deben pertenecer al workspace. */
  async setKnowledge(workspaceId: string, id: string, dto: SetAgentKnowledgeDto) {
    await this.get(workspaceId, id);
    const ids = [...new Set(dto.knowledgeBaseIds)];
    const found = await this.prisma.knowledgeBase.findMany({
      where: { id: { in: ids }, workspaceId },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new BadRequestException('Alguna base de conocimiento no existe en el workspace');
    }
    await this.prisma.$transaction([
      this.prisma.agentKnowledge.deleteMany({ where: { agentId: id } }),
      this.prisma.agentKnowledge.createMany({ data: ids.map((knowledgeBaseId) => ({ agentId: id, knowledgeBaseId })) }),
      this.prisma.agent.update({ where: { id }, data: { updatedAt: new Date() } }),
    ]);
    return this.describe(workspaceId, id);
  }

  async examples(workspaceId: string, agentId: string) {
    await this.get(workspaceId, agentId);
    return this.prisma.agentExample.findMany({
      where: { agentId },
      select: { id: true, input: true, output: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addExample(workspaceId: string, agentId: string, dto: CreateAgentExampleDto) {
    await this.get(workspaceId, agentId);
    const count = await this.prisma.agentExample.count({ where: { agentId } });
    if (count >= MAX_EXAMPLES) throw new BadRequestException(`Máximo ${MAX_EXAMPLES} ejemplos por agente`);
    return this.prisma.agentExample.create({
      data: { agentId, input: dto.input, output: dto.output },
      select: { id: true, input: true, output: true, createdAt: true },
    });
  }

  async removeExample(workspaceId: string, agentId: string, exampleId: string) {
    await this.get(workspaceId, agentId);
    const deleted = await this.prisma.agentExample.deleteMany({ where: { id: exampleId, agentId } });
    if (!deleted.count) throw new NotFoundException('Ejemplo no encontrado');
  }

  /** Lo que recibe el modelo: system prompt compuesto y herramientas (conectores, skills e internas). */
  async promptPreview(workspaceId: string, id: string) {
    const agent = await this.get(workspaceId, id);
    const prepared = await this.runtime.prepare(agent);
    return {
      system: prepared.system,
      tools: prepared.tools.map((t) => ({ name: t.name, description: t.description })),
    };
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

  /** Ejecuta un turno de chat, aplica el gobierno de costos y persiste el historial nativo del proveedor. */
  async chat(
    workspaceId: string,
    agentId: string,
    input: { message: string; conversationId?: string; approvedTools?: string[]; userId?: string },
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal,
  ) {
    const agent = await this.get(workspaceId, agentId);
    let conversation = input.conversationId
      ? await this.conversation(workspaceId, agentId, input.conversationId)
      : null;

    const result = await this.runtime.run(agent, {
      history: (conversation?.messages as unknown[]) ?? [],
      historyProviderId: conversation?.provider,
      message: input.message,
      approvedTools: input.approvedTools,
      onEvent,
      signal,
      context: { source: 'CHAT', userId: input.userId, conversationId: conversation?.id },
    });
    const messages = result.history as Prisma.InputJsonValue;
    const provider = result.providerId;
    conversation = conversation
      ? await this.prisma.conversation.update({ where: { id: conversation.id }, data: { messages, provider } })
      : await this.prisma.conversation.create({
          data: { agentId, provider, messages, title: input.message.slice(0, 60) },
        });

    return {
      conversationId: conversation.id,
      text: result.text,
      stopReason: result.stopReason,
      turns: result.turns,
      providerId: result.providerId,
      model: result.model,
      usage: { ...result.usage, costUsd: result.costUsd },
    };
  }

  /** Ejecución sin estado (usada por flujos y por el servidor MCP). */
  async runOnce(workspaceId: string, agentId: string, message: string, context: RunContext) {
    const agent = await this.get(workspaceId, agentId);
    const r = await this.runtime.run(agent, { message, context });
    return {
      text: r.text,
      stopReason: r.stopReason,
      turns: r.turns,
      model: r.model,
      usage: { ...r.usage, costUsd: r.costUsd },
    };
  }
}
