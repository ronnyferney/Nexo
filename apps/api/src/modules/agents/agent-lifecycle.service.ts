import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AgentAccessService } from '../agent-access/agent-access.service';
import type { AgentAccess, AgentHealth, HealthLevel } from '../agent-access/agent-access.types';
import { LAUNCH_MIN_SCORE } from '../agent-access/agent-health.rules';
import { AgentHealthService } from '../agent-access/agent-health.service';
import { canShare, isWorkspaceAdmin } from '../agent-access/agent-permissions';
import { SharePrincipalsService } from '../agent-access/share-principals.service';
import { AgentsService, MAX_EXAMPLES, targetScoreOf } from './agents.service';
import type { DuplicateAgentDto, LaunchAgentDto, SetSharesDto } from './dto/agent.dto';

const HEALTH_SUMMARY_LIMIT = 200;
const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Ciclo de vida y gobierno del agente: visibilidad, shares, transferencia, duplicado y exploración (ADR 0007) y
 * salud y lanzamiento (ADR 0006 D3/D4). El acceso (`AgentAccess`) lo resuelve el controlador con `AgentAccessService`.
 */
@Injectable()
export class AgentLifecycleService {
  private readonly logger = new Logger(AgentLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
    private readonly access: AgentAccessService,
    private readonly health: AgentHealthService,
    private readonly principals: SharePrincipalsService,
  ) {}

  /**
   * Cambia la visibilidad (requiere EDIT, verificado por el controlador). Reglas (ADR 0007 D3):
   * - TEAM/WORKSPACE: rol EDITOR+. WORKSPACE exige `LAUNCHED`.
   * - PRIVATE: solo el dueño o la administración (un share EDIT no puede ocultar el agente a los demás) y solo si el
   *   workspace permite agentes personales. Los shares se conservan pero quedan inactivos mientras sea PRIVATE.
   */
  async setVisibility(
    auth: AuthContext,
    { agent, permission }: AgentAccess,
    visibility: 'PRIVATE' | 'TEAM' | 'WORKSPACE',
  ) {
    if (visibility === 'PRIVATE') {
      if (permission !== 'OWNER' && !isWorkspaceAdmin(auth)) {
        throw new ForbiddenException('Solo el dueño o un administrador puede volver privado el agente');
      }
      if (!(await this.agents.personalAgentsAllowed(auth.workspaceId))) {
        throw new ForbiddenException('Este workspace no permite agentes personales');
      }
    } else if (!canShare(auth)) {
      throw new ForbiddenException('Compartir agentes requiere rol EDITOR o superior');
    }
    if (visibility === 'WORKSPACE' && agent.launchStatus !== 'LAUNCHED') {
      throw new ConflictException('Para publicarlo en toda la empresa, primero lance el agente (salud y evaluación)');
    }
    await this.prisma.agent.update({ where: { id: agent.id }, data: { visibility } });
    return this.agents.describe(auth.workspaceId, agent.id, await this.viewerOf(auth, agent.id));
  }

  /**
   * Reemplaza los shares. Requiere EDIT y rol EDITOR+; los principales (usuarios, unidades o grupos) deben ser del
   * workspace (400 si no).
   */
  async setShares(auth: AuthContext, { agent }: AgentAccess, dto: SetSharesDto) {
    if (!canShare(auth)) throw new ForbiddenException('Compartir agentes requiere rol EDITOR o superior');
    const key = (s: { principalType: string; principalId: string }) => `${s.principalType}:${s.principalId}`;
    const unique = new Map<string, SetSharesDto['shares'][number]>();
    for (const s of dto.shares) {
      const prev = unique.get(key(s));
      if (!prev || s.permission === 'EDIT') unique.set(key(s), s);
    }
    const shares = [...unique.values()].filter((s) => !(s.principalType === 'USER' && s.principalId === agent.ownerId));
    await this.principals.assertExist(auth.workspaceId, shares);
    await this.prisma.$transaction([
      this.prisma.agentShare.deleteMany({ where: { agentId: agent.id } }),
      this.prisma.agentShare.createMany({
        data: shares.map((s) => ({
          agentId: agent.id,
          principalType: s.principalType,
          principalId: s.principalId,
          permission: s.permission,
        })),
      }),
      this.prisma.agent.update({ where: { id: agent.id }, data: { updatedAt: new Date() } }),
    ]);
    return this.agents.describe(auth.workspaceId, agent.id, await this.viewerOf(auth, agent.id));
  }

  /** Operaciones reservadas al dueño o a la administración (transferir, eliminar). */
  assertOwnerOrAdmin(auth: AuthContext, { permission }: AgentAccess, action: string): void {
    if (permission !== 'OWNER' && !isWorkspaceAdmin(auth)) {
      throw new ForbiddenException(`Solo el dueño o un administrador puede ${action} el agente`);
    }
  }

  /** Transfiere la propiedad (dueño o ADMIN/OWNER). El nuevo dueño debe ser miembro; la visibilidad no cambia. */
  async transfer(auth: AuthContext, access: AgentAccess, userId: string) {
    this.assertOwnerOrAdmin(auth, access, 'transferir');
    const { agent } = access;
    const member = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: auth.workspaceId } },
      select: { id: true },
    });
    if (!member) throw new BadRequestException('El nuevo dueño debe ser miembro del workspace');
    await this.prisma.$transaction([
      // El nuevo dueño ya no necesita un share directo.
      this.prisma.agentShare.deleteMany({ where: { agentId: agent.id, principalType: 'USER', principalId: userId } }),
      this.prisma.agent.update({ where: { id: agent.id }, data: { ownerId: userId } }),
    ]);
    this.logger.log(`Agente ${agent.id} transferido de ${agent.ownerId ?? '(sin dueño)'} a ${userId}`);
    return this.agents.describe(auth.workspaceId, agent.id, await this.viewerOf(auth, agent.id));
  }

  /**
   * Copia del agente para el usuario (requiere USE): perfil, modelo, herramientas, skills, bases de conocimiento y
   * ejemplos. Sin conversaciones, evaluaciones, versiones, rutinas, shares ni centro de costo. Nace DRAFT y PRIVATE
   * (o TEAM si el workspace no permite agentes personales y el usuario es EDITOR+).
   */
  async duplicate(auth: AuthContext, { agent }: AgentAccess, dto: DuplicateAgentDto) {
    const ownerId = this.agents.requireUser(auth);
    const visibility = await this.agents.initialVisibility(auth);
    const full = await this.prisma.agent.findUniqueOrThrow({
      where: { id: agent.id },
      include: {
        tools: true,
        skills: true,
        knowledge: true,
        examples: { orderBy: { createdAt: 'asc' }, take: MAX_EXAMPLES },
      },
    });
    const name = (dto.name?.trim() || `${full.name} (copia)`).slice(0, 80);
    const copy = await this.prisma.$transaction(async (tx) => {
      const created = await tx.agent.create({
        data: {
          workspaceId: auth.workspaceId,
          name,
          description: full.description,
          provider: full.provider,
          model: full.model,
          systemPrompt: full.systemPrompt,
          effort: full.effort,
          maxTurns: full.maxTurns,
          profile: full.profile as Prisma.InputJsonValue,
          fallbackModels: full.fallbackModels,
          targetScore: full.targetScore,
          ownerId,
          visibility,
          launchStatus: 'DRAFT',
        },
      });
      if (full.tools.length) {
        await tx.agentTool.createMany({
          data: full.tools.map((t) => ({
            agentId: created.id,
            operationId: t.operationId,
            requiresApproval: t.requiresApproval,
          })),
        });
      }
      if (full.skills.length) {
        await tx.agentSkill.createMany({ data: full.skills.map((s) => ({ agentId: created.id, skillId: s.skillId })) });
      }
      if (full.knowledge.length) {
        await tx.agentKnowledge.createMany({
          data: full.knowledge.map((k) => ({ agentId: created.id, knowledgeBaseId: k.knowledgeBaseId })),
        });
      }
      if (full.examples.length) {
        await tx.agentExample.createMany({
          data: full.examples.map((e, i) => ({
            agentId: created.id,
            input: e.input,
            output: e.output,
            // Conserva el orden few-shot (createdAt idéntico en createMany).
            createdAt: new Date(Date.now() + i),
          })),
        });
      }
      return created;
    });
    return this.agents.describe(auth.workspaceId, copy.id, { auth, permission: 'OWNER' });
  }

  /** Agentes TEAM/WORKSPACE que el usuario puede usar y que no son suyos (ADR 0007 "Explorar agentes"). */
  async explore(auth: AuthContext) {
    const [shared, workspace] = await Promise.all([
      this.access.visibleAgentIds(auth, 'shared'),
      this.access.visibleAgentIds(auth, 'workspace'),
    ]);
    const userId = auth.via === 'jwt' ? auth.userId : undefined;
    const ids = [...new Set([...shared, ...workspace])];
    const rows = await this.prisma.agent.findMany({
      where: {
        id: { in: ids },
        workspaceId: auth.workspaceId,
        ...(userId ? { OR: [{ ownerId: null }, { ownerId: { not: userId } }] } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: HEALTH_SUMMARY_LIMIT,
    });
    const [permissions, owners, health] = await Promise.all([
      this.access.permissions(auth, rows),
      this.agents.ownerNames(rows),
      this.health.evaluateMany(
        auth.workspaceId,
        rows.map((r) => r.id),
      ),
    ]);
    const scoreOf = new Map(health.map((h) => [h.agentId, h.score]));
    return rows
      .filter((r) => permissions.has(r.id))
      .map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        visibility: r.visibility,
        launchStatus: r.launchStatus,
        owner: r.ownerId ? { id: r.ownerId, name: owners.get(r.ownerId) ?? '' } : null,
        healthScore: scoreOf.get(r.id) ?? null,
        myPermission: permissions.get(r.id)!,
        updatedAt: r.updatedAt,
      }));
  }

  /**
   * Resumen de salud (para alertas). ADMIN/OWNER: todos los agentes del workspace (gobierno). Resto: los que puede
   * usar. Ordenado del peor al mejor puntaje.
   */
  async healthSummary(auth: AuthContext) {
    const where = isWorkspaceAdmin(auth) ? { workspaceId: auth.workspaceId } : await this.access.usableWhere(auth);
    const rows = await this.prisma.agent.findMany({
      where,
      select: { id: true, name: true, visibility: true, launchStatus: true },
      orderBy: { updatedAt: 'desc' },
      take: HEALTH_SUMMARY_LIMIT,
    });
    const health = new Map(
      (
        await this.health.evaluateMany(
          auth.workspaceId,
          rows.map((r) => r.id),
        )
      ).map((h) => [h.agentId, h]),
    );
    const byLevel: Record<HealthLevel, number> = { CRITICAL: 0, NEEDS_WORK: 0, GOOD: 0, EXCELLENT: 0 };
    const agents = rows
      .filter((r) => health.has(r.id))
      .map((r) => {
        const h = health.get(r.id)!;
        byLevel[h.level] += 1;
        return {
          agentId: r.id,
          name: r.name,
          visibility: r.visibility,
          launchStatus: r.launchStatus,
          score: h.score,
          level: h.level,
          failedChecks: h.checks
            .filter((c) => !c.passed)
            .map((c) => ({ id: c.id, severity: c.severity, message: c.message })),
        };
      })
      .sort((a, b) => a.score - b.score);
    return { total: agents.length, byLevel, agents };
  }

  /**
   * Lanzamiento con garantía de calidad (ADR 0006 D4): salud ≥ 70 y última evaluación ≥ meta. Un ADMIN/OWNER puede
   * forzarlo con `{ override: true, reason }` (la razón queda en `launchOverrideReason` y en el log). Idempotente.
   */
  async launch(auth: AuthContext, { agent }: AgentAccess, dto: LaunchAgentDto) {
    if (agent.launchStatus === 'LAUNCHED') return this.view(auth, agent.id);
    const blockers = await this.launchBlockers(auth.workspaceId, agent.id, targetScoreOf(agent));
    let overrideReason: string | null = null;
    if (blockers.length) {
      if (!dto.override) {
        throw new ConflictException(`El agente aún no cumple los requisitos de lanzamiento: ${blockers.join(' ')}`);
      }
      if (!isWorkspaceAdmin(auth)) throw new ForbiddenException('Solo un administrador puede forzar el lanzamiento');
      overrideReason = dto.reason?.trim() || null;
      if (!overrideReason) throw new BadRequestException('Indique la razón para forzar el lanzamiento');
      this.logger.warn(`Lanzamiento forzado del agente ${agent.id} por ${auth.userId}: ${blockers.join(' ')}`);
    }
    await this.prisma.agent.update({
      where: { id: agent.id },
      data: { launchStatus: 'LAUNCHED', launchedAt: new Date(), launchOverrideReason: overrideReason },
    });
    return this.view(auth, agent.id);
  }

  /**
   * Vuelve a borrador. Si el agente estaba en WORKSPACE pasa a TEAM (conserva sus shares): un agente de empresa
   * siempre está lanzado, y deslanzar debe poder retirarlo de producción de inmediato sin pasos extra.
   */
  async unlaunch(auth: AuthContext, { agent }: AgentAccess) {
    await this.prisma.agent.update({
      where: { id: agent.id },
      data: {
        launchStatus: 'DRAFT',
        launchedAt: null,
        launchOverrideReason: null,
        ...(agent.visibility === 'WORKSPACE' ? { visibility: 'TEAM' as const } : {}),
      },
    });
    return this.view(auth, agent.id);
  }

  async healthOf(auth: AuthContext, agentId: string): Promise<AgentHealth> {
    return this.health.evaluate(auth.workspaceId, agentId);
  }

  /** Requisitos de lanzamiento incumplidos (mensajes en español; vacío = puede lanzarse). */
  async launchBlockers(workspaceId: string, agentId: string, targetScore: number): Promise<string[]> {
    const [h, latest] = await Promise.all([
      this.health.evaluate(workspaceId, agentId),
      this.health.latestEvalScore(workspaceId, agentId),
    ]);
    const out: string[] = [];
    if (h.score < LAUNCH_MIN_SCORE) out.push(`Salud ${h.score}/100 (mínimo ${LAUNCH_MIN_SCORE}).`);
    if (latest === null) out.push('No tiene evaluaciones terminadas.');
    else if (latest < targetScore) out.push(`Última evaluación ${pct(latest)} (meta ${pct(targetScore)}).`);
    return out;
  }

  private async view(auth: AuthContext, agentId: string) {
    return this.agents.describe(auth.workspaceId, agentId, await this.viewerOf(auth, agentId));
  }

  /** Permiso actualizado tras el cambio (p. ej. al transferir, el usuario deja de ser dueño). */
  private async viewerOf(auth: AuthContext, agentId: string) {
    const agent = await this.prisma.agent.findUniqueOrThrow({ where: { id: agentId } });
    const permission = (await this.access.permissions(auth, [agent])).get(agentId);
    return permission ? { auth, permission } : undefined;
  }
}
