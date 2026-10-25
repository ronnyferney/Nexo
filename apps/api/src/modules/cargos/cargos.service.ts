import { Injectable, NotFoundException } from '@nestjs/common';
import type { Cargo } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { CreateCargoDto, UpdateCargoDto } from './dto/cargo.dto';

/** Normaliza una lista de textos: recorta, descarta vacíos y limita el tamaño. */
function cleanList(values: string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined;
  return values.map((v) => v.trim()).filter((v) => v.length > 0);
}

/**
 * Catálogo de cargos (RF03): perfil reutilizable del empleado digital (propósito, funciones, entregables,
 * indicadores, límites y nivel jerárquico). Todo filtra por `workspaceId` (multi-tenant). El catálogo nace vacío:
 * los perfiles de ejemplo quedan sujetos a validación del cliente y no se siembran.
 */
@Injectable()
export class CargosService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string) {
    const cargos = await this.prisma.cargo.findMany({
      where: { workspaceId },
      include: { _count: { select: { agents: true } } },
      orderBy: [{ nivel: 'desc' }, { nombre: 'asc' }],
    });
    return cargos.map(({ _count, ...cargo }) => ({ ...cargo, agentsCount: _count.agents }));
  }

  async get(workspaceId: string, id: string) {
    const cargo = await this.prisma.cargo.findFirst({
      where: { id, workspaceId },
      include: { _count: { select: { agents: true } } },
    });
    if (!cargo) throw new NotFoundException('Cargo no encontrado');
    const { _count, ...rest } = cargo;
    return { ...rest, agentsCount: _count.agents };
  }

  /** Garantiza que el cargo pertenece al workspace (usado al asignar un cargo a un agente). */
  async assertInWorkspace(workspaceId: string, id: string): Promise<Cargo> {
    const cargo = await this.prisma.cargo.findFirst({ where: { id, workspaceId } });
    if (!cargo) throw new NotFoundException('Cargo no encontrado');
    return cargo;
  }

  async create(workspaceId: string, dto: CreateCargoDto) {
    const cargo = await this.prisma.cargo.create({
      data: {
        workspaceId,
        nombre: dto.nombre.trim(),
        proposito: dto.proposito?.trim() || null,
        funciones: cleanList(dto.funciones) ?? [],
        entregables: cleanList(dto.entregables) ?? [],
        indicadores: cleanList(dto.indicadores) ?? [],
        limites: cleanList(dto.limites) ?? [],
        nivel: dto.nivel ?? 'EMPLEADO',
        activo: dto.activo ?? true,
      },
    });
    return this.get(workspaceId, cargo.id);
  }

  async update(workspaceId: string, id: string, dto: UpdateCargoDto) {
    await this.assertInWorkspace(workspaceId, id);
    await this.prisma.cargo.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
        ...(dto.proposito !== undefined ? { proposito: dto.proposito?.trim() || null } : {}),
        ...(dto.funciones !== undefined ? { funciones: cleanList(dto.funciones) } : {}),
        ...(dto.entregables !== undefined ? { entregables: cleanList(dto.entregables) } : {}),
        ...(dto.indicadores !== undefined ? { indicadores: cleanList(dto.indicadores) } : {}),
        ...(dto.limites !== undefined ? { limites: cleanList(dto.limites) } : {}),
        ...(dto.nivel !== undefined ? { nivel: dto.nivel } : {}),
        ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
      },
    });
    return this.get(workspaceId, id);
  }

  async remove(workspaceId: string, id: string) {
    await this.assertInWorkspace(workspaceId, id);
    // Al borrar el cargo, los agentes que lo tenían quedan con `cargoId = null` (onDelete: SetNull).
    await this.prisma.cargo.delete({ where: { id } });
  }
}
