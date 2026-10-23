import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Agent, Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OrgService } from '../governance/org.service';
import type { AgentAccess, AgentNeed, AgentPermission, AgentScope } from './agent-access.types';
import {
  bestShare,
  canEdit,
  decide,
  effectivePermission,
  isWorkspaceAdmin,
  type AccessFacts,
} from './agent-permissions';

export const AGENT_NOT_FOUND = 'Agente no encontrado';
export const AGENT_FORBIDDEN = 'No tiene permiso sobre este agente';

/** Identidad del usuario para resolver shares: su id y la cadena de unidades (su unidad y ancestros). */
interface Subject {
  auth: AuthContext;
  userId: string | null;
  unitIds: string[];
}

/**
 * Punto único de autorización sobre agentes (ADR 0007). Lo usan agentes, entrenamiento, rutinas, flujos, MCP y el
 * Copilot. La decisión vive en `agent-permissions.ts` (pura); aquí solo se reúnen los hechos desde la base.
 *
 * Unidades (TEAM): un share a la unidad X alcanza a los miembros de X y de todas sus subunidades. Se resuelve
 * comparando los shares UNIT con la cadena de ancestros de la unidad del usuario (`OrgService.chain`).
 */
@Injectable()
export class AgentAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly org: OrgService,
  ) {}

  /** Lanza 404 si el agente no es visible para el usuario y 403 si es visible pero falta el permiso. */
  async assert(auth: AuthContext, agentId: string, need: AgentNeed): Promise<AgentAccess> {
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, workspaceId: auth.workspaceId } });
    if (!agent) throw new NotFoundException(AGENT_NOT_FOUND);
    const subject = await this.subject(auth);
    const facts = await this.facts(subject, agent);
    const { outcome, permission } = decide(facts, need);
    if (outcome === 'NOT_FOUND') throw new NotFoundException(AGENT_NOT_FOUND);
    if (outcome === 'FORBIDDEN') throw new ForbiddenException(AGENT_FORBIDDEN);
    return { agent, permission: permission! };
  }

  /**
   * Ids de los agentes que el usuario puede USAR en el ámbito indicado (mismos ámbitos que `GET /agents?scope=`):
   * - `mine`: los suyos (dueño).
   * - `shared`: ajenos compartidos con él (share USER o UNIT de su cadena; solo TEAM/WORKSPACE).
   * - `workspace`: visibilidad WORKSPACE (Empresa).
   * - `all`: todos los del workspace (solo ADMIN/OWNER; 403 para el resto).
   * Para "todos los que puede usar" (unión de mine + shared + workspace) use `usableAgentIds`.
   */
  async visibleAgentIds(auth: AuthContext, scope: AgentScope = 'workspace'): Promise<string[]> {
    const where = await this.scopeWhere(auth, scope);
    if (!where) return [];
    const rows = await this.prisma.agent.findMany({ where, select: { id: true }, orderBy: { updatedAt: 'desc' } });
    return rows.map((r) => r.id);
  }

  /** Ids de todos los agentes que el usuario puede usar como miembro (mine ∪ shared ∪ workspace). */
  async usableAgentIds(auth: AuthContext): Promise<string[]> {
    const where = await this.usableWhere(auth);
    const rows = await this.prisma.agent.findMany({ where, select: { id: true }, orderBy: { updatedAt: 'desc' } });
    return rows.map((r) => r.id);
  }

  /** Filtro Prisma del ámbito (null = vacío). */
  async scopeWhere(auth: AuthContext, scope: AgentScope): Promise<Prisma.AgentWhereInput | null> {
    const base = { workspaceId: auth.workspaceId };
    if (scope === 'all') {
      if (!isWorkspaceAdmin(auth)) throw new ForbiddenException('Solo un administrador puede ver todos los agentes');
      return base;
    }
    if (scope === 'workspace') return { ...base, visibility: 'WORKSPACE' };
    const subject = await this.subject(auth);
    if (!subject.userId) return null;
    if (scope === 'mine') return { ...base, ownerId: subject.userId };
    return { ...base, ...this.notMine(subject.userId), ...this.sharedWith(subject) };
  }

  /** Filtro de "todo lo que puede usar como miembro" (sin el acceso de gobierno de ADMIN). */
  async usableWhere(auth: AuthContext): Promise<Prisma.AgentWhereInput> {
    const subject = await this.subject(auth);
    const or: Prisma.AgentWhereInput[] = [{ visibility: 'WORKSPACE' }];
    if (subject.userId) or.push({ ownerId: subject.userId }, this.sharedWith(subject));
    return { workspaceId: auth.workspaceId, OR: or };
  }

  /** Permiso efectivo sobre varios agentes a la vez (listados). Los no visibles quedan fuera del mapa. */
  async permissions(auth: AuthContext, agents: Agent[]): Promise<Map<string, AgentPermission>> {
    const out = new Map<string, AgentPermission>();
    if (!agents.length) return out;
    const subject = await this.subject(auth);
    const shares = await this.matchingShares(
      subject,
      agents.map((a) => a.id),
    );
    for (const agent of agents) {
      const p = effectivePermission(this.toFacts(subject, agent, shares.get(agent.id) ?? []));
      if (p) out.set(agent.id, p);
    }
    return out;
  }

  /** ¿El acceso ya resuelto permite escribir? (mismo criterio que `assert(..., 'EDIT')`, sin volver a consultar). */
  canEdit(auth: AuthContext, access: AgentAccess): boolean {
    const facts: AccessFacts = {
      isOwner: access.permission === 'OWNER',
      role: auth.role,
      via: auth.via,
      visibility: access.agent.visibility,
      share: null,
    };
    return canEdit(facts, access.permission);
  }

  /** Ids de los agentes sobre los que el usuario puede escribir (bandeja de supervisión, gestión de rutinas). */
  async editableAgentIds(auth: AuthContext): Promise<string[]> {
    const where = isWorkspaceAdmin(auth) ? { workspaceId: auth.workspaceId } : await this.usableWhere(auth);
    const agents = await this.prisma.agent.findMany({ where });
    const perms = await this.permissions(auth, agents);
    return agents
      .filter((a) => {
        const permission = perms.get(a.id);
        return !!permission && this.canEdit(auth, { agent: a, permission });
      })
      .map((a) => a.id);
  }

  /** Hechos de la matriz para un agente (también útil para decisiones que no son USE/EDIT, p. ej. visibilidad). */
  async factsFor(auth: AuthContext, agent: Agent): Promise<AccessFacts> {
    return this.facts(await this.subject(auth), agent);
  }

  /** Unidades que alcanzan al usuario: la suya (o la raíz) y todos sus ancestros. */
  async unitChainOf(workspaceId: string, userId: string): Promise<string[]> {
    const m = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { orgUnitId: true },
    });
    if (!m) return [];
    const unitId = m.orgUnitId ?? (await this.org.ensureRoot(workspaceId)).id;
    try {
      return (await this.org.chain(workspaceId, unitId)).map((u) => u.id);
    } catch {
      return [];
    }
  }

  private async subject(auth: AuthContext): Promise<Subject> {
    const userId = auth.via === 'jwt' && auth.userId ? auth.userId : null;
    const unitIds = userId ? await this.unitChainOf(auth.workspaceId, userId) : [];
    return { auth, userId, unitIds };
  }

  private async facts(subject: Subject, agent: Agent): Promise<AccessFacts> {
    const shares = await this.matchingShares(subject, [agent.id]);
    return this.toFacts(subject, agent, shares.get(agent.id) ?? []);
  }

  private toFacts(subject: Subject, agent: Agent, perms: ('USE' | 'EDIT')[]): AccessFacts {
    return {
      isOwner: !!subject.userId && agent.ownerId === subject.userId,
      role: subject.auth.role,
      via: subject.auth.via,
      visibility: agent.visibility,
      share: bestShare(perms),
    };
  }

  private async matchingShares(subject: Subject, agentIds: string[]): Promise<Map<string, ('USE' | 'EDIT')[]>> {
    const map = new Map<string, ('USE' | 'EDIT')[]>();
    if (!subject.userId) return map;
    const rows = await this.prisma.agentShare.findMany({
      where: { agentId: { in: agentIds }, OR: this.principalMatch(subject) },
      select: { agentId: true, permission: true },
    });
    for (const r of rows) map.set(r.agentId, [...(map.get(r.agentId) ?? []), r.permission]);
    return map;
  }

  private principalMatch(subject: Subject): Prisma.AgentShareWhereInput[] {
    const or: Prisma.AgentShareWhereInput[] = [{ principalType: 'USER', principalId: subject.userId ?? '' }];
    if (subject.unitIds.length) or.push({ principalType: 'UNIT', principalId: { in: subject.unitIds } });
    return or;
  }

  private sharedWith(subject: Subject): Prisma.AgentWhereInput {
    return {
      visibility: { in: ['TEAM', 'WORKSPACE'] },
      shares: { some: { OR: this.principalMatch(subject) } },
    };
  }

  private notMine(userId: string): Prisma.AgentWhereInput {
    // `ownerId <> x` excluye los NULL en SQL: se incluyen explícitamente (agentes sin dueño).
    return { OR: [{ ownerId: null }, { ownerId: { not: userId } }] };
  }
}
