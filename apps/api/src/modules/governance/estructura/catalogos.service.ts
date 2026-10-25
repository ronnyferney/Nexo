import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { OrgService } from '../org.service';
import type {
  CreateCentroCostoDto,
  CreateLineaNegocioDto,
  CreateSedeDto,
  UpdateCentroCostoDto,
  UpdateLineaNegocioDto,
  UpdateSedeDto,
} from './dto/estructura.dto';
import { validarVigencia } from './estructura.rules';

const toDate = (v?: string | null): Date | null | undefined =>
  v === undefined ? undefined : v === null ? null : new Date(v);

/** Convierte el choque de código duplicado por empresa (índice único) en un 400 legible. */
function mapUniqueError(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new BadRequestException('Ya existe un registro con ese código en esta empresa');
  }
  throw err as Error;
}

/**
 * Catálogos de dimensiones de la estructura empresarial (ADR 0011 D3): líneas de negocio, sedes y centros de costo.
 * Son ortogonales al árbol de mando y NO conceden acceso (D6). Todo filtra por `workspaceId` (multi-tenant) y cada
 * registro pertenece a una empresa (OrgUnit EMPRESA) del mismo workspace, lo que da el aislamiento por empresa (D1).
 */
@Injectable()
export class CatalogosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly org: OrgService,
  ) {}

  private assertVigencia(vigenteDesde?: Date | null, vigenteHasta?: Date | null): void {
    const r = validarVigencia(vigenteDesde ?? undefined, vigenteHasta ?? undefined);
    if (!r.ok) throw new BadRequestException(r.mensaje);
  }

  // ---------------------------- Líneas de negocio ----------------------------

  listLineas(workspaceId: string, empresaId?: string) {
    return this.prisma.lineaNegocio.findMany({
      where: { workspaceId, ...(empresaId ? { empresaId } : {}) },
      orderBy: [{ empresaId: 'asc' }, { codigo: 'asc' }],
    });
  }

  async getLinea(workspaceId: string, id: string) {
    const linea = await this.prisma.lineaNegocio.findFirst({ where: { id, workspaceId } });
    if (!linea) throw new NotFoundException('Línea de negocio no encontrada');
    return linea;
  }

  async createLinea(workspaceId: string, dto: CreateLineaNegocioDto) {
    await this.org.assertEmpresa(workspaceId, dto.empresaId);
    const vigenteDesde = toDate(dto.vigenteDesde);
    const vigenteHasta = toDate(dto.vigenteHasta);
    this.assertVigencia(vigenteDesde, vigenteHasta);
    try {
      return await this.prisma.lineaNegocio.create({
        data: {
          workspaceId,
          empresaId: dto.empresaId,
          codigo: dto.codigo.trim(),
          nombre: dto.nombre.trim(),
          responsableUserId: dto.responsableUserId ?? undefined,
          metas: (dto.metas ?? {}) as Prisma.InputJsonValue,
          estado: dto.estado ?? undefined,
          vigenteDesde: vigenteDesde ?? undefined,
          vigenteHasta: vigenteHasta ?? undefined,
        },
      });
    } catch (err) {
      mapUniqueError(err);
    }
  }

  async updateLinea(workspaceId: string, id: string, dto: UpdateLineaNegocioDto) {
    await this.getLinea(workspaceId, id);
    const vigenteDesde = toDate(dto.vigenteDesde);
    const vigenteHasta = toDate(dto.vigenteHasta);
    if (vigenteDesde !== undefined || vigenteHasta !== undefined) this.assertVigencia(vigenteDesde, vigenteHasta);
    try {
      return await this.prisma.lineaNegocio.update({
        where: { id },
        data: {
          ...(dto.codigo !== undefined ? { codigo: dto.codigo.trim() } : {}),
          ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
          ...(dto.responsableUserId !== undefined ? { responsableUserId: dto.responsableUserId } : {}),
          ...(dto.metas !== undefined ? { metas: dto.metas as Prisma.InputJsonValue } : {}),
          ...(dto.estado !== undefined ? { estado: dto.estado } : {}),
          ...(vigenteDesde !== undefined ? { vigenteDesde } : {}),
          ...(vigenteHasta !== undefined ? { vigenteHasta } : {}),
        },
      });
    } catch (err) {
      mapUniqueError(err);
    }
  }

  async removeLinea(workspaceId: string, id: string) {
    await this.getLinea(workspaceId, id);
    await this.prisma.lineaNegocio.delete({ where: { id } });
  }

  // ---------------------------- Sedes ----------------------------

  listSedes(workspaceId: string, empresaId?: string) {
    return this.prisma.sede.findMany({
      where: { workspaceId, ...(empresaId ? { empresaId } : {}) },
      orderBy: [{ empresaId: 'asc' }, { codigo: 'asc' }],
    });
  }

  async getSede(workspaceId: string, id: string) {
    const sede = await this.prisma.sede.findFirst({ where: { id, workspaceId } });
    if (!sede) throw new NotFoundException('Sede no encontrada');
    return sede;
  }

  async createSede(workspaceId: string, dto: CreateSedeDto) {
    await this.org.assertEmpresa(workspaceId, dto.empresaId);
    const vigenteDesde = toDate(dto.vigenteDesde);
    const vigenteHasta = toDate(dto.vigenteHasta);
    this.assertVigencia(vigenteDesde, vigenteHasta);
    try {
      return await this.prisma.sede.create({
        data: {
          workspaceId,
          empresaId: dto.empresaId,
          codigo: dto.codigo.trim(),
          nombre: dto.nombre.trim(),
          zonaHoraria: dto.zonaHoraria.trim(),
          alcanceTerritorial: dto.alcanceTerritorial ?? undefined,
          estado: dto.estado ?? undefined,
          vigenteDesde: vigenteDesde ?? undefined,
          vigenteHasta: vigenteHasta ?? undefined,
        },
      });
    } catch (err) {
      mapUniqueError(err);
    }
  }

  async updateSede(workspaceId: string, id: string, dto: UpdateSedeDto) {
    await this.getSede(workspaceId, id);
    const vigenteDesde = toDate(dto.vigenteDesde);
    const vigenteHasta = toDate(dto.vigenteHasta);
    if (vigenteDesde !== undefined || vigenteHasta !== undefined) this.assertVigencia(vigenteDesde, vigenteHasta);
    try {
      return await this.prisma.sede.update({
        where: { id },
        data: {
          ...(dto.codigo !== undefined ? { codigo: dto.codigo.trim() } : {}),
          ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
          ...(dto.zonaHoraria !== undefined ? { zonaHoraria: dto.zonaHoraria.trim() } : {}),
          ...(dto.alcanceTerritorial !== undefined ? { alcanceTerritorial: dto.alcanceTerritorial } : {}),
          ...(dto.estado !== undefined ? { estado: dto.estado } : {}),
          ...(vigenteDesde !== undefined ? { vigenteDesde } : {}),
          ...(vigenteHasta !== undefined ? { vigenteHasta } : {}),
        },
      });
    } catch (err) {
      mapUniqueError(err);
    }
  }

  async removeSede(workspaceId: string, id: string) {
    await this.getSede(workspaceId, id);
    await this.prisma.sede.delete({ where: { id } });
  }

  // ---------------------------- Centros de costo ----------------------------

  listCentros(workspaceId: string, empresaId?: string) {
    return this.prisma.centroCosto.findMany({
      where: { workspaceId, ...(empresaId ? { empresaId } : {}) },
      orderBy: [{ empresaId: 'asc' }, { codigo: 'asc' }],
    });
  }

  async getCentro(workspaceId: string, id: string) {
    const centro = await this.prisma.centroCosto.findFirst({ where: { id, workspaceId } });
    if (!centro) throw new NotFoundException('Centro de costo no encontrado');
    return centro;
  }

  async createCentro(workspaceId: string, dto: CreateCentroCostoDto) {
    await this.org.assertEmpresa(workspaceId, dto.empresaId);
    const vigenteDesde = toDate(dto.vigenteDesde);
    const vigenteHasta = toDate(dto.vigenteHasta);
    this.assertVigencia(vigenteDesde, vigenteHasta);
    try {
      return await this.prisma.centroCosto.create({
        data: {
          workspaceId,
          empresaId: dto.empresaId,
          codigo: dto.codigo.trim(),
          nombre: dto.nombre.trim(),
          orgUnitId: dto.orgUnitId ?? undefined,
          lineaNegocioId: dto.lineaNegocioId ?? undefined,
          estado: dto.estado ?? undefined,
          vigenteDesde: vigenteDesde ?? undefined,
          vigenteHasta: vigenteHasta ?? undefined,
        },
      });
    } catch (err) {
      mapUniqueError(err);
    }
  }

  async updateCentro(workspaceId: string, id: string, dto: UpdateCentroCostoDto) {
    await this.getCentro(workspaceId, id);
    const vigenteDesde = toDate(dto.vigenteDesde);
    const vigenteHasta = toDate(dto.vigenteHasta);
    if (vigenteDesde !== undefined || vigenteHasta !== undefined) this.assertVigencia(vigenteDesde, vigenteHasta);
    try {
      return await this.prisma.centroCosto.update({
        where: { id },
        data: {
          ...(dto.codigo !== undefined ? { codigo: dto.codigo.trim() } : {}),
          ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
          ...(dto.orgUnitId !== undefined ? { orgUnitId: dto.orgUnitId } : {}),
          ...(dto.lineaNegocioId !== undefined ? { lineaNegocioId: dto.lineaNegocioId } : {}),
          ...(dto.estado !== undefined ? { estado: dto.estado } : {}),
          ...(vigenteDesde !== undefined ? { vigenteDesde } : {}),
          ...(vigenteHasta !== undefined ? { vigenteHasta } : {}),
        },
      });
    } catch (err) {
      mapUniqueError(err);
    }
  }

  async removeCentro(workspaceId: string, id: string) {
    await this.getCentro(workspaceId, id);
    await this.prisma.centroCosto.delete({ where: { id } });
  }
}
