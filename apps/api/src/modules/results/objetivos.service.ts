import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { CreateObjetivoDto, UpdateObjetivoDto } from './dto/objetivo.dto';

/**
 * Objetivos (RF07). Todo filtra por `workspaceId` (multi-tenant). El sistema puede proponer, pero el objetivo y sus
 * metas los autoriza un humano (EDITOR+ en el controlador). Las referencias a OrgUnit/User/Agent son blandas.
 */
@Injectable()
export class ObjetivosService {
  constructor(private readonly prisma: PrismaService) {}

  list(workspaceId: string) {
    return this.prisma.objetivo.findMany({
      where: { workspaceId },
      include: { _count: { select: { tareas: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(workspaceId: string, id: string) {
    const objetivo = await this.prisma.objetivo.findFirst({
      where: { id, workspaceId },
      include: { _count: { select: { tareas: true } } },
    });
    if (!objetivo) throw new NotFoundException('Objetivo no encontrado');
    return objetivo;
  }

  /** Garantiza que el objetivo pertenece al workspace (usado al vincular una tarea). */
  async assertInWorkspace(workspaceId: string, id: string): Promise<void> {
    const found = await this.prisma.objetivo.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!found) throw new NotFoundException('Objetivo no encontrado');
  }

  async create(workspaceId: string, dto: CreateObjetivoDto) {
    try {
      return await this.prisma.objetivo.create({
        data: {
          workspaceId,
          codigo: dto.codigo.trim(),
          nombre: dto.nombre.trim(),
          orgUnitId: dto.orgUnitId ?? null,
          indicador: dto.indicador?.trim() || null,
          lineaBase: dto.lineaBase?.trim() || null,
          meta: dto.meta?.trim() || null,
          plazo: dto.plazo ? new Date(dto.plazo) : null,
          duenoUserId: dto.duenoUserId ?? null,
          responsableAgentId: dto.responsableAgentId ?? null,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Ya existe un objetivo con ese código en el workspace');
      }
      throw err;
    }
  }

  async update(workspaceId: string, id: string, dto: UpdateObjetivoDto) {
    await this.get(workspaceId, id);
    try {
      return await this.prisma.objetivo.update({
        where: { id },
        data: {
          ...(dto.codigo !== undefined ? { codigo: dto.codigo.trim() } : {}),
          ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
          ...(dto.orgUnitId !== undefined ? { orgUnitId: dto.orgUnitId || null } : {}),
          ...(dto.indicador !== undefined ? { indicador: dto.indicador?.trim() || null } : {}),
          ...(dto.lineaBase !== undefined ? { lineaBase: dto.lineaBase?.trim() || null } : {}),
          ...(dto.meta !== undefined ? { meta: dto.meta?.trim() || null } : {}),
          ...(dto.plazo !== undefined ? { plazo: dto.plazo ? new Date(dto.plazo) : null } : {}),
          ...(dto.duenoUserId !== undefined ? { duenoUserId: dto.duenoUserId || null } : {}),
          ...(dto.responsableAgentId !== undefined ? { responsableAgentId: dto.responsableAgentId || null } : {}),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Ya existe un objetivo con ese código en el workspace');
      }
      throw err;
    }
  }

  async remove(workspaceId: string, id: string) {
    await this.get(workspaceId, id);
    // Las tareas vinculadas quedan con `objetivoId = null` (onDelete: SetNull).
    await this.prisma.objetivo.delete({ where: { id } });
  }
}
