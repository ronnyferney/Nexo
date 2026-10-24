import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma, type Agent, type AgentVisibility } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { LlmUsageService } from '../llm/llm-usage.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentAccessService } from '../agent-access/agent-access.service';
import { SharePrincipalsService } from '../agent-access/share-principals.service';
import type { AgentPermission, AgentScope } from '../agent-access/agent-access.types';
import { canShare, isWorkspaceAdmin } from '../agent-access/agent-permissions';
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
function agentData<T extends UpdateAgentDto>(input: T & { visibility?: unknown }) {
  // La visibilidad tiene reglas propias (create/setVisibility): nunca se copia tal cual.
  const { visibility, ...dto } = input;
  void visibility;
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
    private readonly access: AgentAccessService,
    private readonly principals: SharePrincipalsService,
    private readonly llmUsage: LlmUsageService,
  ) {}

  /**
   * `GET /agents?scope=` (ADR 0007). Sin ámbito: todos los que el usuario puede usar como miembro (los suyos, los
   * compartidos y los de la empresa). `all` (solo ADMIN/OWNER) incluye los privados de otros, como `ADMIN_VIEW`.
   */
  async list(auth: AuthContext, scope?: AgentScope) {
    const where = scope ? await this.access.scopeWhere(auth, scope) : await this.access.usableWhere(auth);
    if (!where) return [];
    const rows = await this.prisma.agent.findMany({
      where,
      include: { _count: { select: { tools: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    const [permissions, owners, conversations] = await Promise.all([
      this.access.permissions(auth, rows),
      this.ownerNames(rows),
      this.myConversationCounts(
        auth,
        rows.map((r) => r.id),
      ),
    ]);
    return rows
      .filter((r) => permissions.has(r.id))
      .map(({ _count, ...agent }) => ({
        ...agent,
        owner: agent.ownerId ? { id: agent.ownerId, name: owners.get(agent.ownerId) ?? '' } : null,
        myPermission: permissions.get(agent.id)!,
        // `conversations` cuenta solo las conversaciones propias (ADR 0007 D4).
        _count: { tools: _count.tools, conversations: conversations.get(agent.id) ?? 0 },
      }));
  }

  /** Nombres de los dueños (Agent.ownerId no tiene relación en el esquema). */
  async ownerNames(agents: Pick<Agent, 'ownerId'>[]): Promise<Map<string, string>> {
    const ids = [...new Set(agents.map((a) => a.ownerId).filter((x): x is string => !!x))];
    if (!ids.length) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private async myConversationCounts(auth: AuthContext, agentIds: string[]): Promise<Map<string, number>> {
    if (!agentIds.length) return new Map();
    const rows = await this.prisma.conversation.groupBy({
      by: ['agentId'],
      where: { agentId: { in: agentIds }, ...conversationOwnerFilter(auth) },
      _count: true,
    });
    return new Map(rows.map((r) => [r.agentId, r._count]));
  }

  async get(workspaceId: string, id: string): Promise<AgentWithTools> {
    const agent = await this.prisma.agent.findFirst({ where: { id, workspaceId }, include: WITH_TOOLS });
    if (!agent) throw new NotFoundException('Agente no encontrado');
    return agent;
  }

  /**
   * Detalle del agente. Con `viewer` agrega `owner`, `myPermission` y, si el usuario puede editar, `shares`
   * (ADR 0007). Sin `viewer` (usos internos) igualmente incluye `owner`.
   */
  async describe(workspaceId: string, id: string, viewer?: { auth: AuthContext; permission: AgentPermission }) {
    const agent = await this.get(workspaceId, id);
    const [examplesCount, owners] = await Promise.all([
      this.prisma.agentExample.count({ where: { agentId: id } }),
      this.ownerNames([agent]),
    ]);
    const { knowledge, examples, ...rest } = agent;
    void examples;
    const canSeeShares = !!viewer && viewer.permission !== 'USE';
    return {
      ...rest,
      owner: agent.ownerId ? { id: agent.ownerId, name: owners.get(agent.ownerId) ?? '' } : null,
      ...(viewer ? { myPermission: viewer.permission } : {}),
      ...(canSeeShares ? { shares: await this.shares(workspaceId, id) } : {}),
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

  /** Shares con el nombre del principal (usuario, unidad o grupo). */
  async shares(workspaceId: string, agentId: string) {
    const rows = await this.prisma.agentShare.findMany({ where: { agentId }, orderBy: { createdAt: 'asc' } });
    const names = await this.principals.names(workspaceId, rows);
    return rows.map((r) => ({
      id: r.id,
      principalType: r.principalType,
      principalId: r.principalId,
      principalName: this.principals.nameOf(names, r),
      permission: r.permission,
    }));
  }

  /**
   * Crea un agente del usuario (ADR 0007 D3): dueño = usuario, `DRAFT`, `PRIVATE` por defecto. Cualquier miembro
   * (incluido VIEWER) crea agentes PRIVATE si el workspace lo permite (`allowPersonalAgents`); TEAM exige EDITOR+.
   * Si el workspace no permite agentes personales y no se indicó visibilidad, un EDITOR+ lo crea como TEAM (sin
   * shares: solo el dueño y la administración lo ven). Las API keys no pueden crear agentes (no tienen dueño).
   */
  async create(auth: AuthContext, dto: CreateAgentDto) {
    const ownerId = this.requireUser(auth);
    const visibility = await this.initialVisibility(auth, dto.visibility);
    if (dto.costCenterId) await this.org.unit(auth.workspaceId, dto.costCenterId);
    await this.assertModels(auth.workspaceId, dto);
    return this.prisma.agent.create({
      data: { ...agentData(dto), workspaceId: auth.workspaceId, ownerId, visibility, launchStatus: 'DRAFT' },
    });
  }

  /** Visibilidad con la que nace un agente creado o duplicado por el usuario. */
  async initialVisibility(auth: AuthContext, wanted?: 'PRIVATE' | 'TEAM'): Promise<AgentVisibility> {
    if (wanted === 'TEAM') {
      if (!canShare(auth)) throw new ForbiddenException('Crear agentes de equipo requiere rol EDITOR o superior');
      return 'TEAM';
    }
    if (await this.personalAgentsAllowed(auth.workspaceId)) return 'PRIVATE';
    if (!wanted && canShare(auth)) return 'TEAM';
    throw new ForbiddenException('Este workspace no permite agentes personales');
  }

  async personalAgentsAllowed(workspaceId: string): Promise<boolean> {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { allowPersonalAgents: true },
    });
    return ws?.allowPersonalAgents ?? true;
  }

  requireUser(auth: AuthContext): string {
    if (auth.via !== 'jwt' || !auth.userId) {
      throw new ForbiddenException('Esta operación requiere un usuario (no está disponible con API keys)');
    }
    return auth.userId;
  }

  async update(workspaceId: string, id: string, dto: UpdateAgentDto) {
    const current = await this.get(workspaceId, id);
    if (dto.costCenterId) await this.org.unit(workspaceId, dto.costCenterId);
    await this.assertModels(workspaceId, dto, current);
    return this.prisma.agent.update({ where: { id }, data: agentData(dto) });
  }

  /**
   * El modelo y los respaldos deben existir en los proveedores del workspace. Solo se valida lo que cambia: un modelo
   * que el administrador deshabilitó o borró después no impide editar otros campos del agente.
   */
  private async assertModels(
    workspaceId: string,
    dto: UpdateAgentDto,
    current?: { provider: string; model: string; fallbackModels: string[] },
  ) {
    const provider = dto.provider ?? current?.provider;
    const model = dto.model ?? current?.model;
    const changed =
      (dto.provider !== undefined || dto.model !== undefined) &&
      (provider !== current?.provider || model !== current?.model);
    const fallbacks = dto.fallbackModels?.map((f) => f.trim()).filter((f) => !current?.fallbackModels.includes(f));
    if (!changed && !fallbacks?.length) return;
    await this.llmUsage.assertAgentModels(workspaceId, {
      ...(changed ? { provider: provider ?? 'anthropic', model } : {}),
      fallbackModels: fallbacks,
    });
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

  /** Conversaciones propias del usuario con el agente (ADR 0007 D4). */
  conversations(auth: AuthContext, agentId: string) {
    return this.prisma.conversation.findMany({
      where: { agentId, agent: { workspaceId: auth.workspaceId }, ...conversationOwnerFilter(auth) },
      select: { id: true, title: true, userId: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  /** Una conversación propia (404 si es de otro usuario: no se revela su existencia). */
  async conversation(auth: AuthContext, agentId: string, conversationId: string) {
    const c = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        agentId,
        agent: { workspaceId: auth.workspaceId },
        ...conversationOwnerFilter(auth),
      },
    });
    if (!c) throw new NotFoundException('Conversación no encontrada');
    return c;
  }

  /**
   * Ejecuta un turno de chat, aplica el gobierno de costos y persiste el historial nativo del proveedor. La
   * conversación queda a nombre del usuario (`Conversation.userId`) y solo él puede continuarla.
   */
  async chat(
    auth: AuthContext,
    agentId: string,
    input: { message: string; conversationId?: string; approvedTools?: string[] },
    onEvent?: (e: AgentEvent) => void,
    signal?: AbortSignal,
  ) {
    const workspaceId = auth.workspaceId;
    const userId = auth.via === 'jwt' ? auth.userId : undefined;
    const agent = await this.get(workspaceId, agentId);
    let conversation = input.conversationId ? await this.conversation(auth, agentId, input.conversationId) : null;
    // El id de una conversación nueva se fija antes del primer turno: es el ámbito de los marcadores de DataGuard
    // (ADR 0008), que así coinciden desde el primer turno y no rompen la caché de prompts en el segundo.
    const conversationId = conversation?.id ?? newConversationId();

    const result = await this.runtime.run(agent, {
      history: (conversation?.messages as unknown[]) ?? [],
      historyProviderId: conversation?.provider,
      message: input.message,
      approvedTools: input.approvedTools,
      onEvent,
      signal,
      context: { source: 'CHAT', userId, conversationId },
    });
    const messages = result.history as Prisma.InputJsonValue;
    const provider = result.providerId;
    conversation = conversation
      ? await this.prisma.conversation.update({ where: { id: conversation.id }, data: { messages, provider } })
      : await this.prisma.conversation.create({
          data: {
            id: conversationId,
            agentId,
            provider,
            messages,
            title: input.message.slice(0, 60),
            userId: userId ?? null,
          },
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

/** Identificador con la forma de un cuid (`c` + 24 caracteres en base 36), generado antes de crear la fila. */
export function newConversationId(): string {
  const bytes = randomBytes(24);
  let id = 'c';
  for (const b of bytes) id += (b % 36).toString(36);
  return id;
}

/**
 * Conversaciones privadas (ADR 0007 D4): cada usuario ve solo las suyas; las heredadas (sin usuario) solo ADMIN/OWNER.
 * Las API keys no tienen identidad: no listan ni continúan conversaciones (las que crean quedan sin usuario y solo
 * las ve la administración).
 */
export function conversationOwnerFilter(auth: AuthContext): Prisma.ConversationWhereInput {
  if (auth.via !== 'jwt' || !auth.userId) return { id: { in: [] } };
  if (isWorkspaceAdmin(auth)) return { OR: [{ userId: auth.userId }, { userId: null }] };
  return { userId: auth.userId };
}
