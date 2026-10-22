import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type OrgUnit } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AddMemberDto, CreateOrgUnitDto, UpdateMemberDto, UpdateOrgUnitDto } from './dto/governance.dto';

/** Árbol de unidades corporativas y miembros del workspace. */
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

  async addMember(workspaceId: string, dto: AddMemberDto) {
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

  async updateMember(workspaceId: string, membershipId: string, dto: UpdateMemberDto) {
    const m = await this.membership(workspaceId, membershipId);
    if (dto.orgUnitId) await this.unit(workspaceId, dto.orgUnitId);
    if (dto.role && m.role === 'OWNER' && dto.role !== 'OWNER')
      await this.assertAnotherOwner(workspaceId, membershipId);
    await this.prisma.membership.update({
      where: { id: membershipId },
      data: { role: dto.role, orgUnitId: dto.orgUnitId },
    });
    return (await this.members(workspaceId)).find((x) => x.membershipId === membershipId);
  }

  async removeMember(workspaceId: string, membershipId: string) {
    const m = await this.membership(workspaceId, membershipId);
    if (m.role === 'OWNER') await this.assertAnotherOwner(workspaceId, membershipId);
    await this.prisma.membership.delete({ where: { id: membershipId } });
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

  private async assertAnotherOwner(workspaceId: string, exceptMembershipId: string) {
    const owners = await this.prisma.membership.count({
      where: { workspaceId, role: 'OWNER', id: { not: exceptMembershipId } },
    });
    if (!owners) throw new BadRequestException('El workspace debe conservar al menos un OWNER');
  }
}
