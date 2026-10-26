import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Dimension } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { OrgService } from '../org.service';
import { validarVigencia } from '../estructura/estructura.rules';
import { DimensionSeedService } from './dimension-seed.service';
import { creariaCiclo, esAsignable, faltantesObligatorias } from './dimensiones.rules';
import type {
  CreateDimensionAssignmentDto,
  CreateDimensionDto,
  CreateDimensionValueDto,
  UpdateDimensionDto,
  UpdateDimensionValueDto,
} from './dto/dimensiones.dto';

const toDate = (v?: string | null): Date | null | undefined =>
  v === undefined ? undefined : v === null ? null : new Date(v);

/** Entidades válidas para `tipoValor = REFERENCIA` y cómo localizarlas (todas filtran por `workspaceId`). */
const REFERENCIA_ENTIDADES: Record<
  string,
  (prisma: PrismaService, workspaceId: string, id: string) => Promise<{ empresaId: string | null } | null>
> = {
  LineaNegocio: (p, ws, id) =>
    p.lineaNegocio.findFirst({ where: { id, workspaceId: ws }, select: { empresaId: true } }),
  Sede: (p, ws, id) => p.sede.findFirst({ where: { id, workspaceId: ws }, select: { empresaId: true } }),
  CentroCosto: (p, ws, id) => p.centroCosto.findFirst({ where: { id, workspaceId: ws }, select: { empresaId: true } }),
  OrgUnit: (p, ws, id) => p.orgUnit.findFirst({ where: { id, workspaceId: ws }, select: { empresaId: true } }),
};

/**
 * Marco de dimensiones configurables (ADR 0011 D8): CRUD de `Dimension`/`DimensionValue`, etiquetado
 * (`DimensionAssignment`) e integridad. El cliente crea sus dimensiones (Proyecto, Cliente, Producto, Campaña) SIN
 * migración. Etiquetar NO concede acceso (D6): aquí no hay ninguna lógica de permisos derivada de dimensiones. Todo
 * filtra por `workspaceId` (multi-tenant) y, cuando aplica, por empresa.
 */
@Injectable()
export class DimensionesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly org: OrgService,
    private readonly seed: DimensionSeedService,
  ) {}

  private assertVigencia(desde?: Date | null, hasta?: Date | null): void {
    const r = validarVigencia(desde ?? undefined, hasta ?? undefined);
    if (!r.ok) throw new BadRequestException(r.mensaje);
  }

  // ---------------------------- Dimensiones ----------------------------

  async listDimensiones(workspaceId: string, empresaId?: string) {
    // Garantiza perezosamente las 3 de sistema (idempotente) antes de listar, como OrgService.ensureRoot.
    await this.seed.ensureForWorkspace(workspaceId);
    return this.prisma.dimension.findMany({
      where: { workspaceId, ...(empresaId ? { empresaId } : {}) },
      orderBy: [{ esSistema: 'desc' }, { codigo: 'asc' }],
    });
  }

  async getDimension(workspaceId: string, id: string): Promise<Dimension> {
    const dim = await this.prisma.dimension.findFirst({ where: { id, workspaceId } });
    if (!dim) throw new NotFoundException('Dimensión no encontrada');
    return dim;
  }

  async createDimension(workspaceId: string, dto: CreateDimensionDto) {
    if (dto.empresaId) await this.org.assertEmpresa(workspaceId, dto.empresaId);
    const tipoValor = dto.tipoValor ?? 'LISTA';
    if (tipoValor === 'REFERENCIA') {
      if (!dto.referenciaEntidad || !(dto.referenciaEntidad in REFERENCIA_ENTIDADES)) {
        throw new BadRequestException(
          `Una dimensión REFERENCIA requiere referenciaEntidad válida (${Object.keys(REFERENCIA_ENTIDADES).join(', ')})`,
        );
      }
    }
    const vigenteDesde = toDate(dto.vigenteDesde);
    const vigenteHasta = toDate(dto.vigenteHasta);
    this.assertVigencia(vigenteDesde, vigenteHasta);
    try {
      return await this.prisma.dimension.create({
        data: {
          workspaceId,
          empresaId: dto.empresaId ?? null,
          codigo: dto.codigo.trim(),
          nombre: dto.nombre.trim(),
          tipoValor,
          referenciaEntidad: tipoValor === 'REFERENCIA' ? dto.referenciaEntidad : null,
          jerarquica: dto.jerarquica ?? undefined,
          obligatoria: dto.obligatoria ?? undefined,
          obligatoriaParaEfectoEconomico: dto.obligatoriaParaEfectoEconomico ?? undefined,
          aplicaA: dto.aplicaA ?? undefined,
          esSistema: false,
          estado: dto.estado ?? undefined,
          vigenteDesde: vigenteDesde ?? undefined,
          vigenteHasta: vigenteHasta ?? undefined,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('Ya existe una dimensión con ese código en este ámbito (workspace/empresa)');
      }
      throw err;
    }
  }

  async updateDimension(workspaceId: string, id: string, dto: UpdateDimensionDto) {
    const dim = await this.getDimension(workspaceId, id);
    if (dim.esSistema) throw new BadRequestException('Las dimensiones de sistema no se editan');
    const vigenteDesde = toDate(dto.vigenteDesde);
    const vigenteHasta = toDate(dto.vigenteHasta);
    if (vigenteDesde !== undefined || vigenteHasta !== undefined) {
      this.assertVigencia(vigenteDesde ?? dim.vigenteDesde, vigenteHasta ?? dim.vigenteHasta);
    }
    return this.prisma.dimension.update({
      where: { id },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
        ...(dto.jerarquica !== undefined ? { jerarquica: dto.jerarquica } : {}),
        ...(dto.obligatoria !== undefined ? { obligatoria: dto.obligatoria } : {}),
        ...(dto.obligatoriaParaEfectoEconomico !== undefined
          ? { obligatoriaParaEfectoEconomico: dto.obligatoriaParaEfectoEconomico }
          : {}),
        ...(dto.aplicaA !== undefined ? { aplicaA: dto.aplicaA } : {}),
        ...(dto.estado !== undefined ? { estado: dto.estado } : {}),
        ...(vigenteDesde !== undefined ? { vigenteDesde } : {}),
        ...(vigenteHasta !== undefined ? { vigenteHasta } : {}),
      },
    });
  }

  async removeDimension(workspaceId: string, id: string) {
    const dim = await this.getDimension(workspaceId, id);
    if (dim.esSistema) throw new BadRequestException('Las dimensiones de sistema no se eliminan');
    await this.prisma.dimension.delete({ where: { id } });
  }

  // ---------------------------- Valores ----------------------------

  async listValores(workspaceId: string, dimensionId: string) {
    await this.getDimension(workspaceId, dimensionId);
    return this.prisma.dimensionValue.findMany({
      where: { workspaceId, dimensionId },
      orderBy: [{ codigo: 'asc' }],
    });
  }

  private async assertDimensionLista(workspaceId: string, dimensionId: string): Promise<Dimension> {
    const dim = await this.getDimension(workspaceId, dimensionId);
    if (dim.tipoValor !== 'LISTA') {
      throw new BadRequestException(
        `Solo las dimensiones LISTA tienen valores propios; esta es ${dim.tipoValor} (sus valores viven en la entidad referida o son literales)`,
      );
    }
    return dim;
  }

  async createValor(workspaceId: string, dimensionId: string, dto: CreateDimensionValueDto) {
    await this.assertDimensionLista(workspaceId, dimensionId);
    const vigenteDesde = toDate(dto.vigenteDesde);
    const vigenteHasta = toDate(dto.vigenteHasta);
    this.assertVigencia(vigenteDesde, vigenteHasta);
    if (dto.padreId) await this.assertPadreValido(workspaceId, dimensionId, 'nuevo', dto.padreId);
    try {
      return await this.prisma.dimensionValue.create({
        data: {
          workspaceId,
          dimensionId,
          codigo: dto.codigo.trim(),
          nombre: dto.nombre.trim(),
          padreId: dto.padreId ?? null,
          estado: dto.estado ?? undefined,
          vigenteDesde: vigenteDesde ?? undefined,
          vigenteHasta: vigenteHasta ?? undefined,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('Ya existe un valor con ese código en esta dimensión');
      }
      throw err;
    }
  }

  async updateValor(workspaceId: string, dimensionId: string, valorId: string, dto: UpdateDimensionValueDto) {
    await this.assertDimensionLista(workspaceId, dimensionId);
    const valor = await this.prisma.dimensionValue.findFirst({ where: { id: valorId, workspaceId, dimensionId } });
    if (!valor) throw new NotFoundException('Valor de dimensión no encontrado');
    const vigenteDesde = toDate(dto.vigenteDesde);
    const vigenteHasta = toDate(dto.vigenteHasta);
    if (vigenteDesde !== undefined || vigenteHasta !== undefined) {
      this.assertVigencia(vigenteDesde ?? valor.vigenteDesde, vigenteHasta ?? valor.vigenteHasta);
    }
    if (dto.padreId !== undefined && dto.padreId !== null) {
      await this.assertPadreValido(workspaceId, dimensionId, valorId, dto.padreId);
    }
    return this.prisma.dimensionValue.update({
      where: { id: valorId },
      data: {
        ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
        ...(dto.padreId !== undefined ? { padreId: dto.padreId } : {}),
        ...(dto.estado !== undefined ? { estado: dto.estado } : {}),
        ...(vigenteDesde !== undefined ? { vigenteDesde } : {}),
        ...(vigenteHasta !== undefined ? { vigenteHasta } : {}),
      },
    });
  }

  async removeValor(workspaceId: string, dimensionId: string, valorId: string) {
    await this.assertDimensionLista(workspaceId, dimensionId);
    const valor = await this.prisma.dimensionValue.findFirst({ where: { id: valorId, workspaceId, dimensionId } });
    if (!valor) throw new NotFoundException('Valor de dimensión no encontrado');
    await this.prisma.dimensionValue.delete({ where: { id: valorId } });
  }

  /** El padre existe en la misma dimensión y colgar de él no crea ciclo (ADR 0011 D8, integridad c). */
  private async assertPadreValido(
    workspaceId: string,
    dimensionId: string,
    valorId: string,
    padreId: string,
  ): Promise<void> {
    const padre = await this.prisma.dimensionValue.findFirst({ where: { id: padreId, workspaceId, dimensionId } });
    if (!padre) throw new BadRequestException('El valor padre no existe en esta dimensión');
    const valores = await this.prisma.dimensionValue.findMany({
      where: { workspaceId, dimensionId },
      select: { id: true, padreId: true },
    });
    if (creariaCiclo(valores, valorId, padreId)) {
      throw new BadRequestException('La jerarquía de valores no puede tener ciclos');
    }
  }

  // ---------------------------- Etiquetado ----------------------------

  listAsignaciones(workspaceId: string, targetType?: string, targetId?: string) {
    return this.prisma.dimensionAssignment.findMany({
      where: { workspaceId, ...(targetType ? { targetType } : {}), ...(targetId ? { targetId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Etiqueta una entidad con un valor de una dimensión (ADR 0011 D8). Valida que el valor sea asignable a trabajo
   * nuevo (ACTIVA y vigente, integridad b) y, para REFERENCIA, que la entidad referida exista y pertenezca a la misma
   * empresa (integridad d). Etiquetar NO concede acceso (D6). Una etiqueta por (dimensión, target): re-etiquetar
   * reemplaza el valor anterior.
   */
  async asignar(workspaceId: string, dimensionId: string, dto: CreateDimensionAssignmentDto) {
    const dim = await this.getDimension(workspaceId, dimensionId);
    let dimensionValueId: string | null = null;
    let valorLiteral: string | null = null;

    if (dim.tipoValor === 'LISTA') {
      if (!dto.dimensionValueId) throw new BadRequestException('Indique el valor (dimensionValueId) de la dimensión');
      const valor = await this.prisma.dimensionValue.findFirst({
        where: { id: dto.dimensionValueId, workspaceId, dimensionId },
      });
      if (!valor) throw new BadRequestException('El valor no existe en esta dimensión');
      if (!esAsignable(valor)) {
        throw new BadRequestException('El valor está inactivo o fuera de vigencia: no es asignable a trabajo nuevo');
      }
      dimensionValueId = valor.id;
    } else if (dim.tipoValor === 'REFERENCIA') {
      if (!dto.dimensionValueId)
        throw new BadRequestException('Indique el id de la entidad referida (dimensionValueId)');
      const buscar = REFERENCIA_ENTIDADES[dim.referenciaEntidad ?? ''];
      if (!buscar) throw new BadRequestException('La dimensión de referencia tiene una entidad no soportada');
      const entidad = await buscar(this.prisma, workspaceId, dto.dimensionValueId);
      if (!entidad) throw new BadRequestException('La entidad referida no existe en este workspace');
      if (dim.empresaId && entidad.empresaId && entidad.empresaId !== dim.empresaId) {
        throw new BadRequestException('La entidad referida pertenece a otra empresa');
      }
      dimensionValueId = dto.dimensionValueId;
    } else {
      // TEXTO / NUMERO
      if (dto.valorLiteral === undefined || dto.valorLiteral === null || dto.valorLiteral === '') {
        throw new BadRequestException('Indique el valor literal (valorLiteral)');
      }
      if (dim.tipoValor === 'NUMERO' && Number.isNaN(Number(dto.valorLiteral))) {
        throw new BadRequestException('El valor literal debe ser numérico');
      }
      valorLiteral = dto.valorLiteral;
    }

    try {
      return await this.prisma.dimensionAssignment.create({
        data: {
          workspaceId,
          dimensionId,
          dimensionValueId,
          valorLiteral,
          targetType: dto.targetType,
          targetId: dto.targetId,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Ya existe una etiqueta de esta dimensión en el target: se reemplaza el valor (una etiqueta por dimensión).
        return this.prisma.dimensionAssignment.update({
          where: {
            workspaceId_dimensionId_targetType_targetId: {
              workspaceId,
              dimensionId,
              targetType: dto.targetType,
              targetId: dto.targetId,
            },
          },
          data: { dimensionValueId, valorLiteral },
        });
      }
      throw err;
    }
  }

  async quitarAsignacion(workspaceId: string, id: string) {
    const a = await this.prisma.dimensionAssignment.findFirst({ where: { id, workspaceId } });
    if (!a) throw new NotFoundException('Etiqueta no encontrada');
    await this.prisma.dimensionAssignment.delete({ where: { id } });
  }

  // ---------------------------- Integridad al despachar trabajo ----------------------------

  /**
   * Valida que un snapshot `{ dimensionCodigo: valor }` cubra las dimensiones obligatorias aplicables a `aplicaA`
   * (ADR 0011 D8, integridad a). Con `efectoEconomico` incluye las `obligatoriaParaEfectoEconomico` (RF11/RF45):
   * sin su valor, la acción NO se despacha. Lanza 400 con los códigos que faltan. Pensada para que E4/E6 la invoquen
   * antes de registrar trabajo con efecto económico.
   */
  async assertSnapshotCompleto(
    workspaceId: string,
    snapshot: Record<string, unknown>,
    opts: { aplicaA: string; empresaId?: string | null; efectoEconomico: boolean },
  ): Promise<void> {
    await this.seed.ensureForWorkspace(workspaceId);
    const dims = await this.prisma.dimension.findMany({
      where: {
        workspaceId,
        estado: 'ACTIVA',
        aplicaA: { has: opts.aplicaA },
        OR: [{ empresaId: null }, ...(opts.empresaId ? [{ empresaId: opts.empresaId }] : [])],
      },
      select: { codigo: true, obligatoria: true, obligatoriaParaEfectoEconomico: true },
    });
    const faltan = faltantesObligatorias(dims, snapshot, { efectoEconomico: opts.efectoEconomico });
    if (faltan.length) {
      throw new ConflictException(
        `Faltan dimensiones obligatorias para despachar trabajo con efecto económico: ${faltan.join(', ')}`,
      );
    }
  }
}
