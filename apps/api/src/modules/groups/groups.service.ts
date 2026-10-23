import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { CreateGroupDto, UpdateGroupDto } from './dto/group.dto';

export const GROUP_NOT_FOUND = 'Grupo no encontrado';
export const GROUP_NAME_TAKEN = 'Ya existe un grupo con ese nombre en el workspace';

/** Grupo para el diálogo de compartir (`GET /groups`). */
export interface GroupSummary {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
}

/** Grupo con miembros (administración). */
export interface GroupView extends GroupSummary {
  members: { userId: string; name: string; email: string }[];
  createdAt: Date;
}

const WITH_MEMBERS = {
  members: { select: { user: { select: { id: true, name: true, email: true } } } },
} satisfies Prisma.UserGroupInclude;

type GroupWithMembers = Prisma.UserGroupGetPayload<{ include: typeof WITH_MEMBERS }>;

/** Ids sin duplicados ni vacíos, en el orden recibido. */
export function normalizeIds(ids: string[] | undefined): string[] {
  return [...new Set((ids ?? []).map((id) => id.trim()).filter(Boolean))];
}

export function toGroupView(g: GroupWithMembers): GroupView {
  const members = g.members
    .map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    memberCount: members.length,
    members,
    createdAt: g.createdAt,
  };
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Grupos de usuarios transversales a las unidades (ADR 0007 D6), p. ej. "Gerentes de línea". Se usan como destino de
 * shares de agentes (`principalType: GROUP`); la membresía se resuelve en cada decisión de acceso, así que los cambios
 * aplican de inmediato. Todo se filtra por el `workspaceId` del contexto autenticado.
 */
@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Grupos del workspace para compartir: sin miembros, ordenados por nombre. */
  async summaries(workspaceId: string): Promise<GroupSummary[]> {
    const rows = await this.prisma.userGroup.findMany({
      where: { workspaceId },
      select: { id: true, name: true, description: true, _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
    });
    return rows.map((g) => ({ id: g.id, name: g.name, description: g.description, memberCount: g._count.members }));
  }

  /** Grupos con miembros (administración), ordenados por nombre. */
  async list(workspaceId: string): Promise<GroupView[]> {
    const rows = await this.prisma.userGroup.findMany({
      where: { workspaceId },
      include: WITH_MEMBERS,
      orderBy: { name: 'asc' },
    });
    return rows.map(toGroupView);
  }

  async get(workspaceId: string, id: string): Promise<GroupView> {
    return toGroupView(await this.find(workspaceId, id));
  }

  async create(workspaceId: string, dto: CreateGroupDto): Promise<GroupView> {
    await this.assertNameFree(workspaceId, dto.name);
    const userIds = await this.assertMembers(workspaceId, dto.userIds);
    try {
      const group = await this.prisma.userGroup.create({
        data: {
          workspaceId,
          name: dto.name,
          description: dto.description || null,
          members: { create: userIds.map((userId) => ({ userId })) },
        },
        include: WITH_MEMBERS,
      });
      this.logger.log(`Grupo ${group.id} creado en ${workspaceId} con ${userIds.length} miembros`);
      return toGroupView(group);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(GROUP_NAME_TAKEN);
      throw e;
    }
  }

  async update(workspaceId: string, id: string, dto: UpdateGroupDto): Promise<GroupView> {
    await this.find(workspaceId, id);
    if (dto.name !== undefined) await this.assertNameFree(workspaceId, dto.name, id);
    try {
      const group = await this.prisma.userGroup.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description || null } : {}),
        },
        include: WITH_MEMBERS,
      });
      return toGroupView(group);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(GROUP_NAME_TAKEN);
      throw e;
    }
  }

  /** Reemplaza los miembros. Deben ser miembros del workspace (400 indicando cuáles no). */
  async setMembers(workspaceId: string, id: string, ids: string[]): Promise<GroupView> {
    await this.find(workspaceId, id);
    const userIds = await this.assertMembers(workspaceId, ids);
    await this.prisma.$transaction([
      this.prisma.userGroupMember.deleteMany({ where: { groupId: id } }),
      this.prisma.userGroupMember.createMany({ data: userIds.map((userId) => ({ groupId: id, userId })) }),
      this.prisma.userGroup.update({ where: { id }, data: { updatedAt: new Date() } }),
    ]);
    this.logger.log(`Grupo ${id}: miembros reemplazados (${userIds.length})`);
    return this.get(workspaceId, id);
  }

  /**
   * Elimina el grupo y, en la misma transacción, los shares de agentes dirigidos a él (ADR 0007 D6). Devuelve el grupo
   * tal como estaba y cuántos shares se retiraron.
   */
  async remove(workspaceId: string, id: string): Promise<GroupView & { removedShares: number }> {
    const group = toGroupView(await this.find(workspaceId, id));
    const [shares] = await this.prisma.$transaction([
      this.prisma.agentShare.deleteMany({ where: { principalType: 'GROUP', principalId: id, agent: { workspaceId } } }),
      this.prisma.userGroup.delete({ where: { id } }),
    ]);
    this.logger.log(`Grupo ${id} eliminado de ${workspaceId}; shares retirados: ${shares.count}`);
    return { ...group, removedShares: shares.count };
  }

  private async find(workspaceId: string, id: string): Promise<GroupWithMembers> {
    const group = await this.prisma.userGroup.findFirst({ where: { id, workspaceId }, include: WITH_MEMBERS });
    if (!group) throw new NotFoundException(GROUP_NOT_FOUND);
    return group;
  }

  /** Nombre único por workspace, sin distinguir mayúsculas (409). */
  private async assertNameFree(workspaceId: string, name: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.userGroup.findFirst({
      where: {
        workspaceId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw new ConflictException(GROUP_NAME_TAKEN);
  }

  /** Normaliza los ids y verifica que todos sean miembros del workspace (400 con los que no lo son). */
  private async assertMembers(workspaceId: string, ids: string[] | undefined): Promise<string[]> {
    const userIds = normalizeIds(ids);
    if (!userIds.length) return [];
    const found = await this.prisma.membership.findMany({
      where: { workspaceId, userId: { in: userIds } },
      select: { userId: true },
    });
    const ok = new Set(found.map((m) => m.userId));
    const missing = userIds.filter((u) => !ok.has(u));
    if (missing.length) {
      throw new BadRequestException(`Estos usuarios no son miembros del workspace: ${missing.join(', ')}`);
    }
    return userIds;
  }
}
