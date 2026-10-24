import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CopilotProposal, Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentAccessService } from '../agent-access/agent-access.service';
import { canShare } from '../agent-access/agent-permissions';
import { AgentsService } from '../agents/agents.service';
import { normalizeProfile } from '../agents/prompt-composer';
import { slugify } from '../skills/skills.service';
import type { AgentSnapshot } from '../training/versions.service';
import { isWriteOperation, CopilotToolsService } from './copilot-tools.service';
import { proposalView, requireUser, type UserAuth } from './copilot.service';
import {
  isNewSkill,
  MAX_EXAMPLES,
  validateAgentDraft,
  validateChangeProposal,
  type DraftEvalCase,
  type DraftExample,
  type DraftOperation,
  type DraftRoutine,
  type DraftSkill,
  type WorkspaceRefs,
} from './proposal.schema';

type Tx = Prisma.TransactionClient;
const json = (v: unknown) => v as Prisma.InputJsonValue;

export interface ApplyResult {
  agentId: string;
  /** Recursos nuevos creados (skills nuevas, ejemplos, casos de evaluación y rutinas deshabilitadas). */
  created: { skills: number; examples: number; evalCases: number; routines: number };
  /** Recursos existentes vinculados al agente. */
  linked: { operations: number; skills: number; knowledgeBases: number };
  /** Integraciones del catálogo que el usuario debe instalar y luego vincular. */
  pendingIntegrations: string[];
  /** Referencias omitidas (recursos que ya no existen) u otros avisos. */
  warnings: string[];
}

/**
 * Aplicación de propuestas del Copilot (ADR 0006 D1 + ADR 0007). Todo ocurre en una transacción: si algo falla, no
 * queda nada a medias. Lo creado pertenece al cliente: el agente nuevo nace PRIVATE del usuario (dueño) y en DRAFT, y las
 * rutinas sugeridas se crean deshabilitadas (no se programan hasta que el usuario las habilite).
 */
@Injectable()
export class CopilotProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AgentAccessService,
    private readonly tools: CopilotToolsService,
    private readonly agents: AgentsService,
  ) {}

  /** Solo el dueño de la sesión ve y decide sus propuestas. */
  private async own(auth: UserAuth, id: string): Promise<CopilotProposal> {
    const proposal = await this.prisma.copilotProposal.findFirst({
      where: { id, workspaceId: auth.workspaceId, session: { userId: auth.userId } },
    });
    if (!proposal) throw new NotFoundException('Propuesta no encontrada');
    return proposal;
  }

  async get(a: AuthContext, id: string) {
    return proposalView(await this.own(requireUser(a), id));
  }

  async discard(a: AuthContext, id: string) {
    const auth = requireUser(a);
    const proposal = await this.own(auth, id);
    const { count } = await this.prisma.copilotProposal.updateMany({
      where: { id: proposal.id, status: 'PENDING' },
      data: { status: 'REJECTED', appliedById: auth.userId, appliedAt: new Date() },
    });
    if (!count) throw new ConflictException('La propuesta ya fue aplicada o descartada');
    return this.get(a, id);
  }

  async apply(a: AuthContext, id: string): Promise<ApplyResult> {
    const auth = requireUser(a);
    const proposal = await this.own(auth, id);
    if (proposal.status !== 'PENDING') throw new ConflictException('La propuesta ya fue aplicada o descartada');
    return proposal.kind === 'CREATE_AGENT' ? this.applyCreate(auth, proposal) : this.applyUpdate(auth, proposal);
  }

  private async applyCreate(auth: UserAuth, proposal: CopilotProposal): Promise<ApplyResult> {
    const parsed = validateAgentDraft(proposal.payload);
    if (!parsed.ok) throw new BadRequestException(`La propuesta no es válida: ${parsed.errors.join('; ')}`);
    // ADR 0007 D3 con la misma regla que POST /agents: PRIVATE si el workspace permite agentes personales (cualquier
    // miembro); si no, un EDITOR+ lo crea como TEAM sin shares y el resto recibe 403.
    const visibility = await this.agents.initialVisibility(auth);
    const draft = parsed.value;
    const ws = auth.workspaceId;
    const refs = await this.tools.workspaceRefs(ws);
    const warnings: string[] = [];
    // Nunca se guarda un modelo fuera de los proveedores del workspace (multi-tenant): se usa uno disponible.
    let { provider, model } = draft;
    if (!refs.models.has(`${provider}:${model}`)) {
      const fallback = fallbackModel(refs.models);
      if (!fallback)
        throw new BadRequestException('No hay modelos de IA disponibles: conecte un proveedor en Proveedores IA');
      warnings.push(
        `El modelo "${draft.provider}:${draft.model}" no está disponible; se usó "${fallback.provider}:${fallback.model}".`,
      );
      ({ provider, model } = fallback);
    }
    const operations = await this.approvalAwareOperations(ws, draft.operations ?? [], refs, warnings);
    const skills = this.filterSkills(auth, draft.skills ?? [], refs, warnings);
    const knowledgeBaseIds = this.filterIds(draft.knowledgeBaseIds ?? [], refs.knowledgeBaseIds, 'Base', warnings);

    return this.prisma.$transaction(async (tx) => {
      await this.claim(tx, proposal.id, auth.userId);
      const agent = await tx.agent.create({
        data: {
          workspaceId: ws,
          name: draft.name,
          description: draft.description ?? null,
          provider,
          model,
          effort: draft.effort,
          systemPrompt: draft.systemPrompt ?? '',
          profile: json(normalizeProfile(draft.profile)),
          ...(draft.targetScore !== undefined ? { targetScore: draft.targetScore } : {}),
          visibility,
          ownerId: auth.userId,
          launchStatus: 'DRAFT',
        },
      });
      const result = await this.attach(tx, ws, agent.id, {
        operations,
        skills,
        knowledgeBaseIds,
        examples: (draft.examples ?? []).slice(0, MAX_EXAMPLES),
        evalCases: draft.evalCases,
        routines: draft.routines ?? [],
        refs,
      });
      await tx.copilotProposal.update({ where: { id: proposal.id }, data: { agentId: agent.id } });
      return {
        agentId: agent.id,
        ...result,
        pendingIntegrations: await this.pendingIntegrations(
          tx,
          ws,
          draft.integrations?.map((i) => i.catalogId),
        ),
        warnings,
      };
    });
  }

  private async applyUpdate(auth: UserAuth, proposal: CopilotProposal): Promise<ApplyResult> {
    if (!proposal.agentId) throw new BadRequestException('La propuesta no indica el agente');
    const parsed = validateChangeProposal({
      agentId: proposal.agentId,
      summary: proposal.summary,
      changes: proposal.payload,
    });
    if (!parsed.ok) throw new BadRequestException(`La propuesta no es válida: ${parsed.errors.join('; ')}`);
    // Proponer requería USE; aplicar sobre el agente exige EDIT (ADR 0007 D2).
    await this.access.assert(auth, proposal.agentId, 'EDIT');
    const c = parsed.value.changes;
    const ws = auth.workspaceId;
    const agentId = proposal.agentId;
    const refs = await this.tools.workspaceRefs(ws);
    const warnings: string[] = [];
    // Un modelo fuera de los proveedores del workspace no se aplica (el agente conserva el suyo).
    const modelOk = c.provider !== undefined && c.model !== undefined && refs.models.has(`${c.provider}:${c.model}`);
    if (c.provider && c.model && !modelOk) {
      warnings.push(`El modelo "${c.provider}:${c.model}" no está disponible; el agente conserva su modelo actual.`);
    }
    const operations = await this.approvalAwareOperations(ws, c.addOperations ?? [], refs, warnings);
    const skills = this.filterSkills(auth, c.addSkills ?? [], refs, warnings);
    const knowledgeBaseIds = this.filterIds(c.addKnowledgeBaseIds ?? [], refs.knowledgeBaseIds, 'Base', warnings);

    return this.prisma.$transaction(async (tx) => {
      await this.claim(tx, proposal.id, auth.userId);
      await this.saveVersion(tx, ws, agentId, auth.userId);
      await tx.agent.update({
        where: { id: agentId },
        data: {
          ...(c.name !== undefined ? { name: c.name } : {}),
          ...(c.description !== undefined ? { description: c.description } : {}),
          ...(c.systemPrompt !== undefined ? { systemPrompt: c.systemPrompt } : {}),
          ...(c.profile !== undefined ? { profile: json(normalizeProfile(c.profile)) } : {}),
          ...(modelOk ? { provider: c.provider, model: c.model } : {}),
          ...(c.effort !== undefined ? { effort: c.effort } : {}),
          ...(c.targetScore !== undefined ? { targetScore: c.targetScore } : {}),
        },
      });
      if (c.removeOperationIds?.length) {
        await tx.agentTool.deleteMany({ where: { agentId, operationId: { in: c.removeOperationIds } } });
      }
      if (c.removeSkillIds?.length) {
        await tx.agentSkill.deleteMany({ where: { agentId, skillId: { in: c.removeSkillIds } } });
      }
      if (c.removeKnowledgeBaseIds?.length) {
        await tx.agentKnowledge.deleteMany({ where: { agentId, knowledgeBaseId: { in: c.removeKnowledgeBaseIds } } });
      }
      const existingExamples = await tx.agentExample.count({ where: { agentId } });
      const room = Math.max(0, MAX_EXAMPLES - existingExamples);
      const examples = c.examples ?? [];
      if (examples.length > room)
        warnings.push(`Se omitieron ${examples.length - room} ejemplo(s): máximo ${MAX_EXAMPLES}.`);
      const result = await this.attach(tx, ws, agentId, {
        operations,
        skills,
        knowledgeBaseIds,
        examples: examples.slice(0, room),
        evalCases: c.evalCases ?? [],
        routines: c.routines ?? [],
        refs,
      });
      return {
        agentId,
        ...result,
        pendingIntegrations: await this.pendingIntegrations(
          tx,
          ws,
          c.integrations?.map((i) => i.catalogId),
        ),
        warnings,
      };
    });
  }

  /** Marca la propuesta como aplicada solo si sigue pendiente (evita aplicar dos veces en paralelo). */
  private async claim(tx: Tx, id: string, userId: string) {
    const { count } = await tx.copilotProposal.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'APPLIED', appliedById: userId, appliedAt: new Date() },
    });
    if (!count) throw new ConflictException('La propuesta ya fue aplicada o descartada');
  }

  /** Instantánea previa (ADR 0004 D3) para poder volver atrás desde el historial de versiones del agente. */
  private async saveVersion(tx: Tx, ws: string, agentId: string, userId: string) {
    const agent = await tx.agent.findFirst({
      where: { id: agentId, workspaceId: ws },
      include: {
        skills: { select: { skillId: true } },
        knowledge: { select: { knowledgeBaseId: true } },
        examples: { orderBy: { createdAt: 'asc' }, take: MAX_EXAMPLES, select: { input: true, output: true } },
      },
    });
    if (!agent) throw new NotFoundException('Agente no encontrado');
    const snapshot: AgentSnapshot = {
      provider: agent.provider,
      model: agent.model,
      effort: agent.effort,
      maxTurns: agent.maxTurns,
      systemPrompt: agent.systemPrompt,
      profile: normalizeProfile(agent.profile),
      fallbackModels: agent.fallbackModels,
      targetScore: agent.targetScore,
      skillIds: agent.skills.map((s) => s.skillId).sort(),
      knowledgeBaseIds: agent.knowledge.map((k) => k.knowledgeBaseId).sort(),
      examples: agent.examples,
    };
    const last = await tx.agentVersion.findFirst({ where: { agentId }, orderBy: { version: 'desc' } });
    await tx.agentVersion.create({
      data: {
        agentId,
        version: (last?.version ?? 0) + 1,
        snapshot: json(snapshot),
        note: 'Antes de aplicar una propuesta del Copilot',
        createdById: userId,
      },
    });
  }

  /** Vincula recursos al agente y crea los nuevos. */
  private async attach(
    tx: Tx,
    ws: string,
    agentId: string,
    input: {
      operations: DraftOperation[];
      skills: DraftSkill[];
      knowledgeBaseIds: string[];
      examples: DraftExample[];
      evalCases: DraftEvalCase[];
      routines: DraftRoutine[];
      refs: WorkspaceRefs;
    },
  ) {
    for (const op of input.operations) {
      await tx.agentTool.upsert({
        where: { agentId_operationId: { agentId, operationId: op.operationId } },
        create: { agentId, operationId: op.operationId, requiresApproval: op.requiresApproval },
        update: { requiresApproval: op.requiresApproval },
      });
    }

    const skillIds: string[] = [];
    let newSkills = 0;
    for (const skill of input.skills) {
      if (!isNewSkill(skill)) {
        skillIds.push(skill.skillId);
        continue;
      }
      const created = await tx.skill.create({
        data: {
          workspaceId: ws,
          name: skill.name.trim(),
          slug: await this.uniqueSlug(tx, ws, skill.name),
          description: skill.description.trim(),
          instructions: skill.instructions,
          operationIds: [...new Set(skill.operationIds ?? [])].filter((id) => input.refs.operationIds.has(id)),
        },
      });
      newSkills++;
      skillIds.push(created.id);
    }
    if (skillIds.length) {
      await tx.agentSkill.createMany({ data: skillIds.map((skillId) => ({ agentId, skillId })), skipDuplicates: true });
    }
    if (input.knowledgeBaseIds.length) {
      await tx.agentKnowledge.createMany({
        data: input.knowledgeBaseIds.map((knowledgeBaseId) => ({ agentId, knowledgeBaseId })),
        skipDuplicates: true,
      });
    }
    if (input.examples.length) {
      await tx.agentExample.createMany({
        data: input.examples.map((e) => ({ agentId, input: e.input, output: e.output })),
      });
    }
    if (input.evalCases.length) {
      await tx.evalCase.createMany({
        data: input.evalCases.map((e) => ({
          agentId,
          input: e.input,
          expected: e.expected ?? null,
          criteria: e.criteria ?? null,
          tags: [...new Set([...(e.tags ?? []), 'copilot'])],
        })),
      });
    }
    if (input.routines.length) {
      // Deshabilitadas: no se programan en la cola hasta que el usuario las habilite desde Rutinas.
      await tx.agentRoutine.createMany({
        data: input.routines.map((r) => ({
          agentId,
          workspaceId: ws,
          name: r.name,
          prompt: r.prompt,
          schedule: r.schedule.trim(),
          timezone: r.timezone ?? 'UTC',
          enabled: false,
        })),
      });
    }
    await tx.agent.update({ where: { id: agentId }, data: { updatedAt: new Date() } });
    return {
      created: {
        skills: newSkills,
        examples: input.examples.length,
        evalCases: input.evalCases.length,
        routines: input.routines.length,
      },
      linked: {
        operations: input.operations.length,
        skills: skillIds.length - newSkills,
        knowledgeBases: input.knowledgeBaseIds.length,
      },
    };
  }

  /** Operaciones existentes del workspace; las que tienen efecto quedan siempre con aprobación humana. */
  private async approvalAwareOperations(
    ws: string,
    ops: DraftOperation[],
    refs: WorkspaceRefs,
    warnings: string[],
  ): Promise<DraftOperation[]> {
    const valid = ops.filter((o) => refs.operationIds.has(o.operationId));
    if (valid.length < ops.length)
      warnings.push(`Se omitieron ${ops.length - valid.length} operación(es) que ya no existen.`);
    if (!valid.length) return [];
    const rows = await this.prisma.connectorOperation.findMany({
      where: { id: { in: valid.map((o) => o.operationId) }, connector: { workspaceId: ws } },
      include: { connector: { select: { type: true, catalogId: true } } },
    });
    const write = new Set(rows.filter((r) => isWriteOperation(r.connector, r)).map((r) => r.id));
    const seen = new Set<string>();
    return valid
      .filter((o) => !seen.has(o.operationId) && seen.add(o.operationId))
      .map((o) => {
        if (write.has(o.operationId) && !o.requiresApproval) {
          warnings.push(`La operación ${o.operationId} tiene efecto: se activó la aprobación humana.`);
          return { ...o, requiresApproval: true };
        }
        return o;
      });
  }

  /**
   * Skills existentes que siguen vigentes y skills nuevas. Las skills son recursos del workspace: crearlas exige el
   * mismo rol que `POST /skills` (EDITOR+). Con un rol menor se omiten las nuevas (el resto de la propuesta se aplica)
   * y se avisa; vincular skills existentes a un agente propio sí está permitido.
   */
  private filterSkills(auth: UserAuth, skills: DraftSkill[], refs: WorkspaceRefs, warnings: string[]): DraftSkill[] {
    const mayCreate = canShare(auth);
    const blocked: string[] = [];
    const kept = skills.filter((s) => {
      if (isNewSkill(s)) {
        if (mayCreate) return true;
        blocked.push(s.name.trim());
        return false;
      }
      if (refs.skillIds.has(s.skillId)) return true;
      warnings.push(`Se omitió la skill ${s.skillId}: ya no existe.`);
      return false;
    });
    if (blocked.length) {
      warnings.push(
        `Las skills nuevas requieren rol EDITOR; pídale a un editor que las cree: ${blocked.map((n) => `"${n}"`).join(', ')}.`,
      );
    }
    return kept;
  }

  private filterIds(ids: string[], valid: Set<string>, label: string, warnings: string[]): string[] {
    const unique = [...new Set(ids)];
    const kept = unique.filter((id) => valid.has(id));
    if (kept.length < unique.length)
      warnings.push(`${label}(s) omitida(s) porque ya no existen: ${unique.length - kept.length}.`);
    return kept;
  }

  private async uniqueSlug(tx: Tx, ws: string, name: string): Promise<string> {
    const base = slugify(name);
    const taken = new Set(
      (await tx.skill.findMany({ where: { workspaceId: ws, slug: { startsWith: base } }, select: { slug: true } })).map(
        (s) => s.slug,
      ),
    );
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) {
      const candidate = `${base.slice(0, 44)}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  private async pendingIntegrations(tx: Tx, ws: string, catalogIds: string[] = []): Promise<string[]> {
    const wanted = [...new Set(catalogIds)];
    if (!wanted.length) return [];
    const installed = await tx.connector.findMany({
      where: { workspaceId: ws, catalogId: { in: wanted } },
      select: { catalogId: true },
    });
    const have = new Set(installed.map((c) => c.catalogId));
    return wanted.filter((id) => !have.has(id));
  }
}

/**
 * Modelo disponible para un agente del Copilot cuando el propuesto no existe en el workspace: el modelo por defecto
 * de Nexo (Claude Opus 5.5) en el primer proveedor que lo tenga, si no el primer modelo real y el simulado al final.
 */
export function fallbackModel(models: ReadonlySet<string>): { provider: string; model: string } | null {
  const list = [...models];
  const real = list.filter((r) => !r.startsWith('mock:'));
  const pick = real.find((r) => r.endsWith(':claude-opus-5-5')) ?? real[0] ?? list[0];
  if (!pick) return null;
  const i = pick.indexOf(':');
  return { provider: pick.slice(0, i), model: pick.slice(i + 1) };
}
