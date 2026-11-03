import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ReglaCumplimiento } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import {
  evaluarCumplimiento,
  resolverReglas,
  type ContextoCumplimiento,
  type EvaluacionCumplimiento,
  type ReglaCumplimientoPlana,
  type ReglaResuelta,
  type ReglaValidacionDeclarativa,
} from './cumplimiento.resolver';
import type { CreateReglaCumplimientoDto, UpdateReglaCumplimientoDto } from './dto/regla-cumplimiento.dto';

/** Banderas auditables de una regla (lo que Cumplimiento/el patrocinador comparan antes/después de un cambio). */
type ReglaBanderas = Pick<
  ReglaCumplimiento,
  | 'jurisdiccion'
  | 'sector'
  | 'proceso'
  | 'nivelRiesgo'
  | 'campoClave'
  | 'tipoDato'
  | 'controlProteccion'
  | 'activa'
  | 'vigenciaDesde'
  | 'vigenciaHasta'
>;

/**
 * Motor de la matriz de cumplimiento configurable y MULTISECTORIAL (P1.3 · ADR 0020). CRUD gobernado de
 * `ReglaCumplimiento` (solo ADMIN+ en el controlador, auditado en E13), resolución del conjunto de reglas aplicables a
 * un contexto (jurisdicción/sector/proceso/riesgo) y evaluación ASESORA (no bloqueante) de un conjunto de valores.
 *
 * Garantías del diseño:
 *  - ASESOR / no bloqueante: la validación nunca lanza por motivos de negocio; devuelve cumple/faltantes.
 *  - Inicio seguro: las reglas NACEN INACTIVAS y la validación solo considera las ACTIVAS; sin reglas activas no exige
 *    nada (no hay bloqueo productivo hasta que el patrocinador apruebe el conjunto).
 *  - Multisectorial: no hay semántica de sector en el código; la lógica pura (`cumplimiento.resolver`) opera sobre datos.
 *  - Multi-tenant: `workspaceId` siempre de `@CurrentAuth()`, nunca del cuerpo.
 */
@Injectable()
export class ReglasCumplimientoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Lista las reglas del workspace, de la más específica a la más general (orden determinista). */
  async list(workspaceId: string): Promise<ReglaCumplimiento[]> {
    return this.prisma.reglaCumplimiento.findMany({
      where: { workspaceId },
      orderBy: [
        { jurisdiccion: 'asc' },
        { sector: 'asc' },
        { proceso: 'asc' },
        { nivelRiesgo: 'asc' },
        { campoClave: 'asc' },
        { createdAt: 'asc' },
      ],
    });
  }

  /** Obtiene una regla del workspace o 404. */
  async get(workspaceId: string, id: string): Promise<ReglaCumplimiento> {
    const regla = await this.prisma.reglaCumplimiento.findFirst({ where: { id, workspaceId } });
    if (!regla) throw new NotFoundException('Regla de cumplimiento no encontrada');
    return regla;
  }

  /** Crea una regla (nace INACTIVA salvo que se indique lo contrario). Audita el alta. */
  async create(a: AuthContext, dto: CreateReglaCumplimientoDto): Promise<ReglaCumplimiento> {
    const creada = await this.prisma.reglaCumplimiento.create({
      data: {
        workspaceId: a.workspaceId,
        jurisdiccion: dto.jurisdiccion ?? null,
        sector: dto.sector ?? null,
        proceso: dto.proceso ?? null,
        nivelRiesgo: dto.nivelRiesgo ?? null,
        campoClave: dto.campoClave,
        tipoDato: dto.tipoDato,
        reglaValidacion: this.toJson(dto.reglaValidacion),
        controlProteccion: dto.controlProteccion ?? null,
        descripcion: dto.descripcion ?? null,
        activa: dto.activa ?? false,
        vigenciaDesde: this.toFecha(dto.vigenciaDesde),
        vigenciaHasta: this.toFecha(dto.vigenciaHasta),
      },
    });
    await this.auditar(a, AUDIT_ACTIONS.REGLA_CUMPLIMIENTO_CREADA, creada, {
      alcance: this.alcance(creada),
      nuevo: this.banderas(creada),
    });
    return creada;
  }

  /** Actualiza una regla del workspace (PATCH parcial). Audita el cambio (anterior/nuevo, incluida `activa`). */
  async update(a: AuthContext, id: string, dto: UpdateReglaCumplimientoDto): Promise<ReglaCumplimiento> {
    const previa = await this.get(a.workspaceId, id);
    const actualizada = await this.prisma.reglaCumplimiento.update({
      where: { id: previa.id },
      data: {
        jurisdiccion: dto.jurisdiccion === undefined ? previa.jurisdiccion : (dto.jurisdiccion ?? null),
        sector: dto.sector === undefined ? previa.sector : (dto.sector ?? null),
        proceso: dto.proceso === undefined ? previa.proceso : (dto.proceso ?? null),
        nivelRiesgo: dto.nivelRiesgo === undefined ? previa.nivelRiesgo : (dto.nivelRiesgo ?? null),
        campoClave: dto.campoClave ?? previa.campoClave,
        tipoDato: dto.tipoDato ?? previa.tipoDato,
        reglaValidacion:
          dto.reglaValidacion === undefined
            ? (previa.reglaValidacion ?? Prisma.JsonNull)
            : this.toJson(dto.reglaValidacion),
        controlProteccion:
          dto.controlProteccion === undefined ? previa.controlProteccion : (dto.controlProteccion ?? null),
        descripcion: dto.descripcion === undefined ? previa.descripcion : (dto.descripcion ?? null),
        activa: dto.activa ?? previa.activa,
        vigenciaDesde: dto.vigenciaDesde === undefined ? previa.vigenciaDesde : this.toFecha(dto.vigenciaDesde),
        vigenciaHasta: dto.vigenciaHasta === undefined ? previa.vigenciaHasta : this.toFecha(dto.vigenciaHasta),
      },
    });
    await this.auditar(a, AUDIT_ACTIONS.REGLA_CUMPLIMIENTO_MODIFICADA, actualizada, {
      alcance: this.alcance(actualizada),
      anterior: this.banderas(previa),
      nuevo: this.banderas(actualizada),
    });
    return actualizada;
  }

  /** Elimina una regla del workspace. Audita el hecho. */
  async remove(a: AuthContext, id: string): Promise<void> {
    const regla = await this.get(a.workspaceId, id);
    await this.prisma.reglaCumplimiento.delete({ where: { id: regla.id } });
    await this.auditar(a, AUDIT_ACTIONS.REGLA_CUMPLIMIENTO_ELIMINADA, regla, {
      alcance: this.alcance(regla),
      anterior: this.banderas(regla),
    });
  }

  /**
   * Resuelve el conjunto de reglas aplicables a un contexto. Por defecto solo considera las ACTIVAS; `incluirInactivas`
   * añade las inactivas para una vista previa de configuración (no deben usarse para validar).
   */
  async resolver(
    workspaceId: string,
    contexto: ContextoCumplimiento,
    incluirInactivas = false,
  ): Promise<ReglaResuelta[]> {
    const planas = await this.planasDe(workspaceId, incluirInactivas);
    return resolverReglas(planas, contexto);
  }

  /**
   * Evalúa de forma ASESORA (no bloqueante) un conjunto de valores contra las reglas ACTIVAS aplicables al contexto.
   * Devuelve cumple/faltantes sin lanzar ni persistir. Sin reglas activas aplicables, `cumple = true` (no exige nada).
   */
  async validar(
    workspaceId: string,
    contexto: ContextoCumplimiento,
    valores: Record<string, unknown>,
  ): Promise<EvaluacionCumplimiento & { contexto: ContextoCumplimiento }> {
    const reglas = await this.resolver(workspaceId, contexto, false);
    return { ...evaluarCumplimiento(reglas, valores ?? {}), contexto };
  }

  // ---------- Internos ----------
  /** Reglas planas del workspace para la lógica pura. Por defecto solo ACTIVAS (las que realmente exigen). */
  private async planasDe(workspaceId: string, incluirInactivas: boolean): Promise<ReglaCumplimientoPlana[]> {
    const rows = await this.prisma.reglaCumplimiento.findMany({
      where: { workspaceId, ...(incluirInactivas ? {} : { activa: true }) },
    });
    return rows.map((r) => this.plana(r));
  }

  private plana(r: ReglaCumplimiento): ReglaCumplimientoPlana {
    return {
      id: r.id,
      jurisdiccion: r.jurisdiccion,
      sector: r.sector,
      proceso: r.proceso,
      nivelRiesgo: r.nivelRiesgo,
      campoClave: r.campoClave,
      tipoDato: r.tipoDato,
      reglaValidacion: (r.reglaValidacion as ReglaValidacionDeclarativa | null) ?? null,
      controlProteccion: r.controlProteccion,
      descripcion: r.descripcion,
      activa: r.activa,
      vigenciaDesde: r.vigenciaDesde,
      vigenciaHasta: r.vigenciaHasta,
    };
  }

  private banderas(r: ReglaCumplimiento): ReglaBanderas {
    return {
      jurisdiccion: r.jurisdiccion,
      sector: r.sector,
      proceso: r.proceso,
      nivelRiesgo: r.nivelRiesgo,
      campoClave: r.campoClave,
      tipoDato: r.tipoDato,
      controlProteccion: r.controlProteccion,
      activa: r.activa,
      vigenciaDesde: r.vigenciaDesde,
      vigenciaHasta: r.vigenciaHasta,
    };
  }

  private alcance(r: ReglaCumplimiento) {
    return {
      jurisdiccion: r.jurisdiccion,
      sector: r.sector,
      proceso: r.proceso,
      nivelRiesgo: r.nivelRiesgo,
      campoClave: r.campoClave,
    };
  }

  private toJson(regla: ReglaValidacionDeclarativa | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    return regla === undefined ? Prisma.JsonNull : (regla as unknown as Prisma.InputJsonValue);
  }

  /** Convierte una fecha ISO (o null/undefined) a `Date` para Prisma; ausencia = null (sin límite de vigencia). */
  private toFecha(fecha: string | null | undefined): Date | null {
    return fecha ? new Date(fecha) : null;
  }

  private async auditar(
    a: AuthContext,
    action: string,
    regla: ReglaCumplimiento,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.append(a.workspaceId, {
      actorType: 'USER',
      actorId: a.userId ?? null,
      action,
      targetType: 'ReglaCumplimiento',
      targetId: regla.id,
      resumen: `Regla de cumplimiento "${regla.campoClave}" ${this.alcanceTexto(regla)}`,
      metadata,
    });
  }

  private alcanceTexto(r: ReglaCumplimiento): string {
    return `(jurisdicción: ${r.jurisdiccion ?? 'todas'}, sector: ${r.sector ?? 'todos'}, proceso: ${
      r.proceso ?? 'todos'
    }, riesgo: ${r.nivelRiesgo ?? 'todos'})`;
  }
}
