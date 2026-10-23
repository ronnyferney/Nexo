import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AgentVersion } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentsService, MAX_EXAMPLES, targetScoreOf } from '../agents/agents.service';
import { normalizeProfile, type AgentProfile } from '../agents/prompt-composer';
import { stableStringify } from './eval-protocol';

/** Instantánea de la configuración de un agente (ADR 0004, D3). */
export interface AgentSnapshot {
  provider: string;
  model: string;
  effort: string;
  maxTurns: number;
  systemPrompt: string;
  profile: AgentProfile;
  fallbackModels: string[];
  targetScore: number;
  skillIds: string[];
  knowledgeBaseIds: string[];
  examples: { input: string; output: string }[];
}

/** Versiones recientes que se comparan para reutilizar una instantánea idéntica. */
const REUSE_WINDOW = 50;
const MAX_CREATE_ATTEMPTS = 3;

@Injectable()
export class VersionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
  ) {}

  /** Configuración actual del agente como instantánea (skills y bases ordenadas; ejemplos en su orden). */
  async snapshot(workspaceId: string, agentId: string): Promise<AgentSnapshot> {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, workspaceId },
      include: {
        skills: { select: { skillId: true } },
        knowledge: { select: { knowledgeBaseId: true } },
        examples: { orderBy: { createdAt: 'asc' }, take: MAX_EXAMPLES, select: { input: true, output: true } },
      },
    });
    if (!agent) throw new NotFoundException('Agente no encontrado');
    return {
      provider: agent.provider,
      model: agent.model,
      effort: agent.effort,
      maxTurns: agent.maxTurns,
      systemPrompt: agent.systemPrompt,
      profile: normalizeProfile(agent.profile),
      fallbackModels: agent.fallbackModels,
      targetScore: targetScoreOf(agent),
      skillIds: agent.skills.map((s) => s.skillId).sort(),
      knowledgeBaseIds: agent.knowledge.map((k) => k.knowledgeBaseId).sort(),
      examples: agent.examples.map((e) => ({ input: e.input, output: e.output })),
    };
  }

  /**
   * Versión que representa la configuración actual: reutiliza la más reciente con instantánea idéntica (entre las
   * últimas versiones) o crea una nueva. `created` indica si se creó.
   */
  async ensureCurrent(
    workspaceId: string,
    agentId: string,
    userId: string | undefined,
    note: string | undefined,
  ): Promise<{ version: AgentVersion; created: boolean }> {
    const snap = await this.snapshot(workspaceId, agentId);
    const key = stableStringify(snap);
    const recent = await this.prisma.agentVersion.findMany({
      where: { agentId },
      orderBy: { version: 'desc' },
      take: REUSE_WINDOW,
    });
    const same = recent.find((v) => stableStringify(v.snapshot) === key);
    if (same) return { version: same, created: false };
    return { version: await this.insert(agentId, snap, userId, note), created: true };
  }

  /** "Guardar versión": siempre crea una versión nueva con la configuración actual. */
  async create(workspaceId: string, agentId: string, userId: string | undefined, note?: string) {
    const snap = await this.snapshot(workspaceId, agentId);
    const v = await this.insert(agentId, snap, userId, note);
    return (await this.list(workspaceId, agentId)).find((x) => x.id === v.id)!;
  }

  async list(workspaceId: string, agentId: string) {
    await this.agents.get(workspaceId, agentId);
    const versions = await this.prisma.agentVersion.findMany({ where: { agentId }, orderBy: { version: 'desc' } });
    const best = await this.prisma.evalRun.groupBy({
      by: ['versionId'],
      where: { agentId, workspaceId, status: 'SUCCEEDED', versionId: { not: null } },
      _max: { score: true },
    });
    const bestBy = new Map(best.map((b) => [b.versionId, b._max.score]));
    const names = await this.userNames(versions.map((v) => v.createdById));
    return versions.map((v) => ({
      id: v.id,
      version: v.version,
      note: v.note,
      createdAt: v.createdAt,
      createdById: v.createdById,
      createdByName: v.createdById ? (names.get(v.createdById) ?? null) : null,
      bestScore: bestBy.get(v.id) ?? null,
      snapshot: v.snapshot as unknown as AgentSnapshot,
    }));
  }

  /**
   * Publica (restaura) una versión: antes guarda la configuración actual si no está versionada, y en una transacción
   * restaura campos, skills, bases de conocimiento y ejemplos. Skills o bases que ya no existen se omiten y se informan.
   */
  async publish(workspaceId: string, agentId: string, versionId: string, userId: string | undefined) {
    await this.agents.get(workspaceId, agentId);
    const target = await this.prisma.agentVersion.findFirst({ where: { id: versionId, agentId } });
    if (!target) throw new NotFoundException('Versión no encontrada');
    const backup = await this.ensureCurrent(
      workspaceId,
      agentId,
      userId,
      `Respaldo automático antes de publicar la versión ${target.version}`,
    );

    const snap = target.snapshot as unknown as AgentSnapshot;
    const skillIds = [...new Set(snap.skillIds ?? [])];
    const kbIds = [...new Set(snap.knowledgeBaseIds ?? [])];
    const [skills, bases] = await Promise.all([
      this.prisma.skill.findMany({ where: { id: { in: skillIds }, workspaceId }, select: { id: true } }),
      this.prisma.knowledgeBase.findMany({ where: { id: { in: kbIds }, workspaceId }, select: { id: true } }),
    ]);
    const okSkills = new Set(skills.map((s) => s.id));
    const okBases = new Set(bases.map((b) => b.id));
    const examples = (snap.examples ?? []).slice(0, MAX_EXAMPLES);
    const base = Date.now() - examples.length;

    await this.prisma.$transaction([
      this.prisma.agent.update({
        where: { id: agentId },
        data: {
          provider: snap.provider,
          model: snap.model,
          effort: snap.effort,
          maxTurns: snap.maxTurns,
          systemPrompt: snap.systemPrompt ?? '',
          profile: normalizeProfile(snap.profile) as Prisma.InputJsonValue,
          fallbackModels: snap.fallbackModels ?? [],
          ...(typeof snap.targetScore === 'number' ? { targetScore: snap.targetScore } : {}),
        },
      }),
      this.prisma.agentSkill.deleteMany({ where: { agentId } }),
      this.prisma.agentSkill.createMany({
        data: skillIds.filter((id) => okSkills.has(id)).map((skillId) => ({ agentId, skillId })),
      }),
      this.prisma.agentKnowledge.deleteMany({ where: { agentId } }),
      this.prisma.agentKnowledge.createMany({
        data: kbIds.filter((id) => okBases.has(id)).map((knowledgeBaseId) => ({ agentId, knowledgeBaseId })),
      }),
      this.prisma.agentExample.deleteMany({ where: { agentId } }),
      // Fechas crecientes explícitas: conservan el orden de los ejemplos (se listan por createdAt).
      this.prisma.agentExample.createMany({
        data: examples.map((e, i) => ({ agentId, input: e.input, output: e.output, createdAt: new Date(base + i) })),
      }),
    ]);

    const missingSkillIds = skillIds.filter((id) => !okSkills.has(id));
    const missingKnowledgeBaseIds = kbIds.filter((id) => !okBases.has(id));
    const warnings = [
      missingSkillIds.length
        ? `${missingSkillIds.length} habilidad(es) de la versión ya no existen y se omitieron.`
        : '',
      missingKnowledgeBaseIds.length
        ? `${missingKnowledgeBaseIds.length} base(s) de conocimiento de la versión ya no existen y se omitieron.`
        : '',
    ].filter(Boolean);
    return {
      published: { id: target.id, version: target.version },
      backupVersion: backup.created ? { id: backup.version.id, version: backup.version.version } : null,
      missingSkillIds,
      missingKnowledgeBaseIds,
      warnings,
      agent: await this.agents.describe(workspaceId, agentId),
    };
  }

  /** Numeración consecutiva por agente; reintenta si otra petición tomó el mismo número. */
  private async insert(agentId: string, snap: AgentSnapshot, userId: string | undefined, note?: string) {
    for (let attempt = 1; ; attempt++) {
      const last = await this.prisma.agentVersion.findFirst({ where: { agentId }, orderBy: { version: 'desc' } });
      try {
        return await this.prisma.agentVersion.create({
          data: {
            agentId,
            version: (last?.version ?? 0) + 1,
            snapshot: snap as unknown as Prisma.InputJsonValue,
            note: note?.trim() || null,
            createdById: userId ?? null,
          },
        });
      } catch (err) {
        const conflict = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        if (!conflict || attempt >= MAX_CREATE_ATTEMPTS) throw err;
      }
    }
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (!unique.length) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }
}
