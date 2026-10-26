import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { OrgService } from '../org.service';
import type { CreateServicioInternoDto, SetRepartoDto, UpdateServicioInternoDto } from './dto/imputacion.dto';
import { validarReparto, type DestinoReparto } from './imputacion.rules';

const toDate = (v?: string | null): Date | null | undefined =>
  v === undefined ? undefined : v === null ? null : new Date(v);

/** Convierte el choque de código duplicado por empresa (índice único) en un 400 legible. */
function mapUniqueError(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new BadRequestException('Ya existe un servicio interno con ese código en esta empresa');
  }
  throw err as Error;
}

/**
 * Servicios internos / compartidos (ADR 0011 D5 / E9 · RF44) y su reparto de costo (RF45). El reparto es de REPORTE: no
 * toca `Budget`/`BudgetLedger` (ADR 0002 intacto, sin doble reserva) y suma 100 % por servicio+periodo sin destinos
 * repetidos (invariante pura `validarReparto`). Todo filtra por `workspaceId` (multi-tenant) y por empresa (D1). Estas
 * entidades NO conceden acceso por sí mismas (D6).
 */
@Injectable()
export class ServiciosInternosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly org: OrgService,
  ) {}

  // ---------------------------- CRUD servicio ----------------------------

  listServicios(workspaceId: string, empresaId?: string) {
    return this.prisma.servicioInterno.findMany({
      where: { workspaceId, ...(empresaId ? { empresaId } : {}) },
      orderBy: [{ empresaId: 'asc' }, { codigo: 'asc' }],
    });
  }

  async getServicio(workspaceId: string, id: string) {
    const servicio = await this.prisma.servicioInterno.findFirst({
      where: { id, workspaceId },
      include: { imputaciones: { orderBy: [{ periodoKey: 'asc' }] } },
    });
    if (!servicio) throw new NotFoundException('Servicio interno no encontrado');
    return servicio;
  }

  async createServicio(workspaceId: string, dto: CreateServicioInternoDto) {
    await this.org.assertEmpresa(workspaceId, dto.empresaId);
    await this.assertUnidadEnEmpresa(workspaceId, dto.areaDuenoId, dto.empresaId);
    const vigenteDesde = toDate(dto.vigenteDesde);
    const vigenteHasta = toDate(dto.vigenteHasta);
    this.assertVigencia(vigenteDesde, vigenteHasta);
    try {
      return await this.prisma.servicioInterno.create({
        data: {
          workspaceId,
          empresaId: dto.empresaId,
          areaDuenoId: dto.areaDuenoId,
          codigo: dto.codigo.trim(),
          nombre: dto.nombre.trim(),
          responsableUserId: dto.responsableUserId ?? undefined,
          responsableAgentId: dto.responsableAgentId ?? undefined,
          acuerdoServicio: (dto.acuerdoServicio ?? {}) as Prisma.InputJsonValue,
          clientesInternos: (dto.clientesInternos ?? []) as Prisma.InputJsonValue,
          estado: dto.estado ?? undefined,
          vigenteDesde: vigenteDesde ?? undefined,
          vigenteHasta: vigenteHasta ?? undefined,
        },
      });
    } catch (err) {
      mapUniqueError(err);
    }
  }

  async updateServicio(workspaceId: string, id: string, dto: UpdateServicioInternoDto) {
    const servicio = await this.getServicio(workspaceId, id);
    if (dto.areaDuenoId !== undefined)
      await this.assertUnidadEnEmpresa(workspaceId, dto.areaDuenoId, servicio.empresaId);
    const vigenteDesde = toDate(dto.vigenteDesde);
    const vigenteHasta = toDate(dto.vigenteHasta);
    if (vigenteDesde !== undefined || vigenteHasta !== undefined) this.assertVigencia(vigenteDesde, vigenteHasta);
    try {
      return await this.prisma.servicioInterno.update({
        where: { id },
        data: {
          ...(dto.areaDuenoId !== undefined ? { areaDuenoId: dto.areaDuenoId } : {}),
          ...(dto.codigo !== undefined ? { codigo: dto.codigo.trim() } : {}),
          ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
          ...(dto.responsableUserId !== undefined ? { responsableUserId: dto.responsableUserId } : {}),
          ...(dto.responsableAgentId !== undefined ? { responsableAgentId: dto.responsableAgentId } : {}),
          ...(dto.acuerdoServicio !== undefined
            ? { acuerdoServicio: dto.acuerdoServicio as Prisma.InputJsonValue }
            : {}),
          ...(dto.clientesInternos !== undefined
            ? { clientesInternos: dto.clientesInternos as Prisma.InputJsonValue }
            : {}),
          ...(dto.estado !== undefined ? { estado: dto.estado } : {}),
          ...(vigenteDesde !== undefined ? { vigenteDesde } : {}),
          ...(vigenteHasta !== undefined ? { vigenteHasta } : {}),
        },
      });
    } catch (err) {
      mapUniqueError(err);
    }
  }

  async removeServicio(workspaceId: string, id: string) {
    await this.getServicio(workspaceId, id);
    await this.prisma.servicioInterno.delete({ where: { id } }); // borra en cascada su reparto
  }

  // ---------------------------- Reparto (ImputacionCosto) ----------------------------

  /** Reparto vigente de un servicio (opcionalmente de un solo periodo). */
  async getReparto(workspaceId: string, servicioId: string, periodoKey?: string) {
    await this.getServicio(workspaceId, servicioId);
    return this.prisma.imputacionCosto.findMany({
      where: { workspaceId, servicioInternoId: servicioId, ...(periodoKey ? { periodoKey } : {}) },
      orderBy: [{ periodoKey: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Define el reparto COMPLETO de un servicio para un periodo (RF45). Valida suma 100 % sin destinos repetidos y que
   * cada destino exista en la empresa del servicio; luego reemplaza atómicamente el reparto anterior de ese periodo
   * (idempotente: un mismo gasto nunca genera dos conjuntos de reparto). NO toca presupuestos ni reservas (ADR 0002).
   */
  async setReparto(workspaceId: string, servicioId: string, dto: SetRepartoDto) {
    const servicio = await this.getServicio(workspaceId, servicioId);
    const destinos: DestinoReparto[] = dto.destinos.map((d) => ({
      lineaNegocioId: d.lineaNegocioId ?? null,
      orgUnitId: d.orgUnitId ?? null,
      centroCostoId: d.centroCostoId ?? null,
      porcentaje: d.porcentaje,
    }));
    const r = validarReparto(destinos);
    if (!r.ok) throw new BadRequestException(r.mensaje);
    await this.assertDestinos(workspaceId, servicio.empresaId, destinos);
    const periodoKey = dto.periodoKey.trim();

    await this.prisma.$transaction([
      this.prisma.imputacionCosto.deleteMany({ where: { workspaceId, servicioInternoId: servicioId, periodoKey } }),
      this.prisma.imputacionCosto.createMany({
        data: destinos.map((d) => ({
          workspaceId,
          servicioInternoId: servicioId,
          periodoKey,
          lineaNegocioId: d.lineaNegocioId ?? null,
          orgUnitId: d.orgUnitId ?? null,
          centroCostoId: d.centroCostoId ?? null,
          porcentaje: new Prisma.Decimal(d.porcentaje.toFixed(2)),
        })),
      }),
    ]);
    return this.getReparto(workspaceId, servicioId, periodoKey);
  }

  async removeReparto(workspaceId: string, servicioId: string, periodoKey: string) {
    await this.getServicio(workspaceId, servicioId);
    await this.prisma.imputacionCosto.deleteMany({ where: { workspaceId, servicioInternoId: servicioId, periodoKey } });
  }

  // ---------------------------- Internos ----------------------------

  private assertVigencia(vigenteDesde?: Date | null, vigenteHasta?: Date | null): void {
    if (vigenteDesde && vigenteHasta && vigenteHasta.getTime() < vigenteDesde.getTime()) {
      throw new BadRequestException('La fecha de fin de vigencia no puede ser anterior a la de inicio.');
    }
  }

  /** El área dueña debe ser una unidad del workspace y, si tiene empresa, la misma del servicio (aislamiento D1). */
  private async assertUnidadEnEmpresa(workspaceId: string, orgUnitId: string, empresaId: string): Promise<void> {
    const unit = await this.prisma.orgUnit.findFirst({ where: { id: orgUnitId, workspaceId } });
    if (!unit) throw new BadRequestException('El área indicada no existe en este workspace.');
    const empresaDeUnidad = unit.tipo === 'EMPRESA' ? unit.id : unit.empresaId;
    if (empresaDeUnidad && empresaDeUnidad !== empresaId) {
      throw new BadRequestException('El área indicada pertenece a otra empresa.');
    }
  }

  /** Cada destino del reparto debe existir en el workspace y en la empresa del servicio (sin referencias colgantes). */
  private async assertDestinos(workspaceId: string, empresaId: string, destinos: DestinoReparto[]): Promise<void> {
    const lineaIds = destinos.map((d) => d.lineaNegocioId).filter((v): v is string => !!v);
    const centroIds = destinos.map((d) => d.centroCostoId).filter((v): v is string => !!v);
    const orgIds = destinos.map((d) => d.orgUnitId).filter((v): v is string => !!v);

    if (lineaIds.length) {
      const n = await this.prisma.lineaNegocio.count({ where: { workspaceId, empresaId, id: { in: lineaIds } } });
      if (n !== new Set(lineaIds).size) {
        throw new BadRequestException('Alguna línea de negocio del reparto no existe en la empresa del servicio.');
      }
    }
    if (centroIds.length) {
      const n = await this.prisma.centroCosto.count({ where: { workspaceId, empresaId, id: { in: centroIds } } });
      if (n !== new Set(centroIds).size) {
        throw new BadRequestException('Algún centro de costo del reparto no existe en la empresa del servicio.');
      }
    }
    if (orgIds.length) {
      const unidades = await this.prisma.orgUnit.findMany({
        where: { workspaceId, id: { in: orgIds } },
        select: { id: true, tipo: true, empresaId: true },
      });
      if (unidades.length !== new Set(orgIds).size) {
        throw new BadRequestException('Alguna área del reparto no existe en este workspace.');
      }
      for (const u of unidades) {
        const empresaDeUnidad = u.tipo === 'EMPRESA' ? u.id : u.empresaId;
        if (empresaDeUnidad && empresaDeUnidad !== empresaId) {
          throw new BadRequestException('Alguna área del reparto pertenece a otra empresa.');
        }
      }
    }
  }
}
