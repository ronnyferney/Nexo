import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type TipoAsignacion } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { CreateAsignacionDto, UpdateAsignacionDto } from './dto/estructura.dto';
import { validarDestino, validarSujeto, validarVigencia } from './estructura.rules';

const toDate = (v?: string | null): Date | null | undefined =>
  v === undefined ? undefined : v === null ? null : new Date(v);

/**
 * Matriz organizacional (ADR 0011 D4/RF42): relaciona un sujeto (agente o miembro) con una dimensión destino (área,
 * línea, sede o proyecto futuro), con alcance y vigencia. NO duplica agentes ni ejecuciones (es una fila de relación) y
 * NO concede acceso a datos por sí misma (D6). La identidad RF42 —a lo sumo una FUNCIONAL_PRINCIPAL vigente por
 * sujeto— la garantiza el índice parcial único de la migración; aquí se traduce el choque a un 409 legible.
 */
@Injectable()
export class AsignacionesService {
  constructor(private readonly prisma: PrismaService) {}

  list(workspaceId: string, filtro: { agentId?: string; userId?: string; lineaNegocioId?: string } = {}) {
    return this.prisma.asignacionOrganizacional.findMany({
      where: { workspaceId, ...filtro },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(workspaceId: string, id: string) {
    const asignacion = await this.prisma.asignacionOrganizacional.findFirst({ where: { id, workspaceId } });
    if (!asignacion) throw new NotFoundException('Asignación no encontrada');
    return asignacion;
  }

  /** Valida que la entidad destino referida existe dentro del workspace (aislamiento multi-tenant). */
  private async assertDestinoExiste(
    workspaceId: string,
    tipo: TipoAsignacion,
    dto: CreateAsignacionDto,
  ): Promise<void> {
    if (dto.orgUnitId && (tipo === 'FUNCIONAL_PRINCIPAL' || tipo === 'SERVICIO')) {
      const u = await this.prisma.orgUnit.findFirst({ where: { id: dto.orgUnitId, workspaceId } });
      if (!u) throw new BadRequestException('La unidad organizacional destino no existe en este workspace');
    }
    if (dto.lineaNegocioId && tipo === 'LINEA') {
      const l = await this.prisma.lineaNegocio.findFirst({ where: { id: dto.lineaNegocioId, workspaceId } });
      if (!l) throw new BadRequestException('La línea de negocio destino no existe en este workspace');
    }
    if (dto.sedeId && tipo === 'SEDE') {
      const s = await this.prisma.sede.findFirst({ where: { id: dto.sedeId, workspaceId } });
      if (!s) throw new BadRequestException('La sede destino no existe en este workspace');
    }
  }

  async create(workspaceId: string, dto: CreateAsignacionDto, creadaPorUserId?: string) {
    const sujeto = validarSujeto(dto);
    if (!sujeto.ok) throw new BadRequestException(sujeto.mensaje);
    const destino = validarDestino(dto.tipoAsignacion, dto);
    if (!destino.ok) throw new BadRequestException(destino.mensaje);
    const vigenteDesde = toDate(dto.vigenteDesde);
    const vigenteHasta = toDate(dto.vigenteHasta);
    const vigencia = validarVigencia(vigenteDesde ?? undefined, vigenteHasta ?? undefined);
    if (!vigencia.ok) throw new BadRequestException(vigencia.mensaje);
    await this.assertDestinoExiste(workspaceId, dto.tipoAsignacion, dto);

    try {
      return await this.prisma.asignacionOrganizacional.create({
        data: {
          workspaceId,
          agentId: dto.agentId ?? undefined,
          userId: dto.userId ?? undefined,
          tipoAsignacion: dto.tipoAsignacion,
          orgUnitId: dto.orgUnitId ?? undefined,
          lineaNegocioId: dto.lineaNegocioId ?? undefined,
          sedeId: dto.sedeId ?? undefined,
          proyectoId: dto.proyectoId ?? undefined,
          rol: dto.rol ?? undefined,
          alcance: (dto.alcance ?? {}) as Prisma.InputJsonValue,
          vigenteDesde: vigenteDesde ?? undefined,
          vigenteHasta: vigenteHasta ?? undefined,
          creadaPorUserId: creadaPorUserId ?? undefined,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          'Ya existe una asignación funcional principal vigente para este sujeto (RF42): cierre la anterior primero',
        );
      }
      throw err;
    }
  }

  /** Edita rol, alcance, estado y vigencia. Cerrar una asignación (poner `vigenteHasta`) nunca la borra (historial). */
  async update(workspaceId: string, id: string, dto: UpdateAsignacionDto) {
    const actual = await this.get(workspaceId, id);
    const vigenteHasta = toDate(dto.vigenteHasta);
    if (vigenteHasta !== undefined) {
      const vigencia = validarVigencia(actual.vigenteDesde, vigenteHasta ?? undefined);
      if (!vigencia.ok) throw new BadRequestException(vigencia.mensaje);
    }
    try {
      return await this.prisma.asignacionOrganizacional.update({
        where: { id },
        data: {
          ...(dto.rol !== undefined ? { rol: dto.rol } : {}),
          ...(dto.alcance !== undefined ? { alcance: dto.alcance as Prisma.InputJsonValue } : {}),
          ...(dto.estado !== undefined ? { estado: dto.estado } : {}),
          ...(vigenteHasta !== undefined ? { vigenteHasta } : {}),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          'Reabrir esta asignación chocaría con otra funcional principal vigente del mismo sujeto (RF42)',
        );
      }
      throw err;
    }
  }

  async remove(workspaceId: string, id: string) {
    await this.get(workspaceId, id);
    await this.prisma.asignacionOrganizacional.delete({ where: { id } });
  }
}
