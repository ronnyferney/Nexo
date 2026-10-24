import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type OrgUnit } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import type { WorkspaceRole } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AddMemberDto, CreateOrgUnitDto, UpdateMemberDto, UpdateOrgUnitDto } from './dto/governance.dto';

/** Quien ejecuta la operación sobre los miembros (de `@CurrentAuth()`). */
export interface MemberActor {
  userId?: string;
  role: WorkspaceRole;
}

type Tx = Prisma.TransactionClient;

/**
 * Árbol de unidades corporativas y miembros del workspace.
 * Regla del rol OWNER (M3): solo un OWNER lo otorga, lo retira o retira a otro OWNER, y el workspace nunca se queda
 * sin OWNER (la comprobación y el cambio van en la misma transacción, con el workspace bloqueado).
 */
@Injectable()
export class OrgService {
  constructor(private readonly prisma: PrismaService) {}

  /** Garantiza la unidad raíz (tope global). Seguro ante concurrencia gracias al índice único parcial. */
  async ensureRoot(workspaceId: string): Promise<OrgUnit> {
    const existing = await this.prisma.orgUnit.findFirst({ where: { workspaceId, parentId: null } });
    if (existing) return existing;
    try {
      return await this.prisma.orgUnit.create({ data: { workspaceId, name: 'Organización' } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.prisma.orgUnit.findFirstOrThrow({ where: { workspaceId, parentId: null } });
      }
      throw err;
    }
  }

  async units(workspaceId: string): Promise<OrgUnit[]> {
    await this.ensureRoot(workspaceId);
    return this.prisma.orgUnit.findMany({ where: { workspaceId }, orderBy: [{ createdAt: 'asc' }] });
  }

  /** Cadena desde la unidad hasta la raíz (inclusive). */
  async chain(workspaceId: string, orgUnitId: string): Promise<OrgUnit[]> {
    const units = await this.units(workspaceId);
    const byId = new Map(units.map((u) => [u.id, u]));
    const chain: OrgUnit[] = [];
    let current = byId.get(orgUnitId);
    while (current && chain.length < 64) {
      chain.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    if (!chain.length) throw new NotFoundException('Unidad no encontrada');
    return chain;
  }

  /** Regla de imputación (ADR 0002 D3): usuario → su unidad; sin usuario → centro de costo del agente; si no → raíz. */
  async resolveCostCenter(workspaceId: string, userId?: string, agentCostCenterId?: string | null): Promise<string> {
    if (userId) {
      const m = await this.prisma.membership.findUnique({ where: { userId_workspaceId: { userId, workspaceId } } });
      if (m?.orgUnitId) return m.orgUnitId;
    } else if (agentCostCenterId) {
      return agentCostCenterId;
    }
    return (await this.ensureRoot(workspaceId)).id;
  }

  async list(workspaceId: string) {
    const units = await this.units(workspaceId);
    const counts = await this.prisma.membership.groupBy({ by: ['orgUnitId'], where: { workspaceId }, _count: true });
    const root = units.find((u) => !u.parentId)!;
    const countOf = (id: string) =>
      counts.filter((c) => (c.orgUnitId ?? root.id) === id).reduce((acc, c) => acc + c._count, 0);
    return units.map((u) => ({
      id: u.id,
      name: u.name,
      code: u.code,
      parentId: u.parentId,
      allowedModels: u.allowedModels,
      memberCount: countOf(u.id),
      isRoot: !u.parentId,
    }));
  }

  async create(workspaceId: string, dto: CreateOrgUnitDto) {
    await this.unit(workspaceId, dto.parentId);
    return this.prisma.orgUnit.create({
      data: { workspaceId, name: dto.name, code: dto.code, parentId: dto.parentId },
    });
  }

  async update(workspaceId: string, id: string, dto: UpdateOrgUnitDto) {
    const unit = await this.unit(workspaceId, id);
    if (dto.parentId !== undefined) {
      if (!unit.parentId) throw new BadRequestException('La unidad raíz no puede moverse');
      await this.unit(workspaceId, dto.parentId);
      const ancestors = await this.chain(workspaceId, dto.parentId);
      if (ancestors.some((a) => a.id === id))
        throw new BadRequestException('No puede mover una unidad dentro de sí misma');
    }
    return this.prisma.orgUnit.update({
      where: { id },
      data: { name: dto.name, code: dto.code, parentId: dto.parentId, allowedModels: dto.allowedModels },
    });
  }

  /** Elimina una unidad: sus hijos, miembros y agentes pasan a la unidad padre. */
  async remove(workspaceId: string, id: string) {
    const unit = await this.unit(workspaceId, id);
    if (!unit.parentId) throw new BadRequestException('La unidad raíz no puede eliminarse');
    await this.prisma.$transaction([
      this.prisma.orgUnit.updateMany({ where: { parentId: id }, data: { parentId: unit.parentId } }),
      this.prisma.membership.updateMany({ where: { orgUnitId: id }, data: { orgUnitId: unit.parentId } }),
      this.prisma.agent.updateMany({ where: { costCenterId: id }, data: { costCenterId: unit.parentId } }),
      this.prisma.orgUnit.delete({ where: { id } }),
    ]);
  }

  async members(workspaceId: string) {
    const root = await this.ensureRoot(workspaceId);
    const rows = await this.prisma.membership.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((m) => ({
      membershipId: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      orgUnitId: m.orgUnitId ?? root.id,
      createdAt: m.createdAt,
    }));
  }

  async addMember(workspaceId: string, dto: AddMemberDto, actor: MemberActor) {
    if (dto.role === 'OWNER') this.assertOwnerActor(actor, 'Solo un OWNER puede otorgar el rol OWNER');
    const orgUnitId = dto.orgUnitId
      ? (await this.unit(workspaceId, dto.orgUnitId)).id
      : (await this.ensureRoot(workspaceId)).id;
    const email = dto.email.toLowerCase();
    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      if (!dto.password) throw new BadRequestException('El usuario no existe: indique una contraseña inicial');
      user = await this.prisma.user.create({
        data: { email, name: dto.name, passwordHash: await bcrypt.hash(dto.password, 12) },
      });
    }
    const exists = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId } },
    });
    if (exists) throw new ConflictException('El usuario ya es miembro de este workspace');
    await this.prisma.membership.create({ data: { userId: user.id, workspaceId, role: dto.role, orgUnitId } });
    return (await this.members(workspaceId)).find((m) => m.userId === user.id);
  }

  async updateMember(workspaceId: string, membershipId: string, dto: UpdateMemberDto, actor: MemberActor) {
    const m = await this.membership(workspaceId, membershipId);
    if (dto.orgUnitId) await this.unit(workspaceId, dto.orgUnitId);
    const changesOwner = dto.role !== undefined && dto.role !== m.role && (dto.role === 'OWNER' || m.role === 'OWNER');
    if (changesOwner) this.assertOwnerActor(actor, 'Solo un OWNER puede otorgar o retirar el rol OWNER');
    await this.prisma.$transaction(async (tx) => {
      if (changesOwner && m.role === 'OWNER') await this.assertAnotherOwner(tx, workspaceId, membershipId);
      await tx.membership.update({ where: { id: membershipId }, data: { role: dto.role, orgUnitId: dto.orgUnitId } });
    });
    return (await this.members(workspaceId)).find((x) => x.membershipId === membershipId);
  }

  /**
   * Retira a un miembro. Sus agentes pasan al administrador que lo retira (`actor.userId`), sin cambiar su visibilidad,
   * y sus shares directos se eliminan (ADR 0007 D3); también sale de los grupos de usuarios del workspace (D6). Si el
   * actor no es un usuario (tareas internas) o el miembro se retira a sí mismo, pasan al OWNER más antiguo. La
   * respuesta informa qué agentes se transfirieron y a quién. Retirar a un OWNER exige ser OWNER.
   */
  async removeMember(workspaceId: string, membershipId: string, actor: MemberActor) {
    const m = await this.membership(workspaceId, membershipId);
    if (m.role === 'OWNER') this.assertOwnerActor(actor, 'Solo un OWNER puede retirar a otro OWNER');
    const actorUserId = actor.userId;
    // Si alguien se retira a sí mismo, sus agentes pasan al OWNER más antiguo.
    const newOwnerId =
      actorUserId && actorUserId !== m.userId ? actorUserId : await this.oldestOwner(workspaceId, m.userId);
    const agents = await this.prisma.agent.findMany({
      where: { workspaceId, ownerId: m.userId },
      select: { id: true, name: true, visibility: true },
      orderBy: { name: 'asc' },
    });
    await this.prisma.$transaction(async (tx) => {
      if (m.role === 'OWNER') await this.assertAnotherOwner(tx, workspaceId, membershipId);
      await tx.agent.updateMany({ where: { workspaceId, ownerId: m.userId }, data: { ownerId: newOwnerId } });
      await tx.agentShare.deleteMany({
        where: { principalType: 'USER', principalId: m.userId, agent: { workspaceId } },
      });
      // Sale de los grupos de este workspace (sus grupos en otros workspaces no cambian).
      await tx.userGroupMember.deleteMany({ where: { userId: m.userId, group: { workspaceId } } });
      // El nuevo dueño no necesita un share directo sobre los agentes que recibe.
      await tx.agentShare.deleteMany({
        where: { principalType: 'USER', principalId: newOwnerId ?? '', agentId: { in: agents.map((a) => a.id) } },
      });
      await tx.membership.delete({ where: { id: membershipId } });
    });
    return {
      removed: true,
      userId: m.userId,
      transferredTo: agents.length ? newOwnerId : null,
      transferredAgents: agents,
    };
  }

  private async oldestOwner(workspaceId: string, exceptUserId: string): Promise<string | null> {
    const owner = await this.prisma.membership.findFirst({
      where: { workspaceId, role: 'OWNER', userId: { not: exceptUserId } },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });
    return owner?.userId ?? null;
  }

  async unit(workspaceId: string, id: string): Promise<OrgUnit> {
    const u = await this.prisma.orgUnit.findFirst({ where: { id, workspaceId } });
    if (!u) throw new NotFoundException('Unidad no encontrada');
    return u;
  }

  private async membership(workspaceId: string, id: string) {
    const m = await this.prisma.membership.findFirst({ where: { id, workspaceId } });
    if (!m) throw new NotFoundException('Miembro no encontrado');
    return m;
  }

  private assertOwnerActor(actor: MemberActor, message: string): void {
    if (actor.role !== 'OWNER') throw new ForbiddenException(message);
  }

  /**
   * Dentro de la transacción: bloquea el workspace (serializa altas, bajas y cambios de rol concurrentes) y exige otro
   * OWNER además de `exceptMembershipId`. Sin el bloqueo, dos OWNER que se degradan a la vez dejarían el workspace sin
   * ninguno.
   */
  private async assertAnotherOwner(tx: Tx, workspaceId: string, exceptMembershipId: string) {
    await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;
    const owners = await tx.membership.count({
      where: { workspaceId, role: 'OWNER', id: { not: exceptMembershipId } },
    });
    if (!owners) throw new BadRequestException('El workspace debe conservar al menos un OWNER');
  }
}
