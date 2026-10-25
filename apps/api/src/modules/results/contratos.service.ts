import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { ActualizarContratoDto, AvanzarContratoDto, CrearContratoDto } from './dto/contrato.dto';
import type { CrearEvidenciaDto } from './dto/evidencia.dto';
import type { ValidarResultadoDto } from './dto/validacion.dto';
import { puedeTransicionarResultado } from './results.constants';
import { ValidacionService } from './validacion.service';

/**
 * Contrato de resultado (RF29) y su ciclo de estado (RF31). Un contrato COMPROMETIDO es inmutable: solo se edita
 * mientras está PROPUESTO. La aceptación/devolución la decide la verificación (verificador ≠ ejecutor, `ValidacionService`).
 */
@Injectable()
export class ContratosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validacion: ValidacionService,
  ) {}

  async get(workspaceId: string, id: string) {
    const contrato = await this.prisma.contratoResultado.findFirst({
      where: { id, workspaceId },
      include: { validaciones: { orderBy: { createdAt: 'desc' } }, evidencias: true, tarea: true },
    });
    if (!contrato) throw new NotFoundException('Contrato de resultado no encontrado');
    return contrato;
  }

  /** Crea el contrato de una tarea (relación 1-1). Falla si la tarea ya tiene uno. */
  async crearParaTarea(workspaceId: string, tareaId: string, dto: CrearContratoDto) {
    const tarea = await this.prisma.tarea.findFirst({
      where: { id: tareaId, workspaceId },
      include: { contratoResultado: true },
    });
    if (!tarea) throw new NotFoundException('Tarea no encontrada');
    if (tarea.contratoResultado) throw new ConflictException('La tarea ya tiene un contrato de resultado');
    return this.prisma.contratoResultado.create({ data: { ...this.datos(dto), workspaceId, tareaId } });
  }

  async actualizar(workspaceId: string, id: string, dto: ActualizarContratoDto) {
    const contrato = await this.get(workspaceId, id);
    if (contrato.estado !== 'PROPUESTO') {
      throw new BadRequestException('Un contrato comprometido es inmutable: cree una versión nueva (RF29)');
    }
    return this.prisma.contratoResultado.update({ where: { id }, data: this.datos(dto) });
  }

  /** Comprometer (PROPUESTO → COMPROMETIDO): fija el compromiso y lo hace inmutable. */
  async comprometer(workspaceId: string, id: string) {
    const contrato = await this.get(workspaceId, id);
    if (!puedeTransicionarResultado(contrato.estado, 'COMPROMETIDO')) {
      throw new BadRequestException(`No se puede comprometer desde ${contrato.estado}`);
    }
    return this.prisma.contratoResultado.update({
      where: { id },
      data: { estado: 'COMPROMETIDO', comprometidoAt: new Date() },
    });
  }

  /** Avance de estado del resultado (COMPROMETIDO → EN_PRODUCCION → PENDIENTE_VALIDACION, y reapertura para corregir). */
  async avanzar(workspaceId: string, id: string, dto: AvanzarContratoDto) {
    const contrato = await this.get(workspaceId, id);
    if (!puedeTransicionarResultado(contrato.estado, dto.estado)) {
      throw new BadRequestException(`Transición de resultado inválida: ${contrato.estado} → ${dto.estado}`);
    }
    return this.prisma.contratoResultado.update({ where: { id }, data: { estado: dto.estado } });
  }

  /** Verificación (RF30): delega en `ValidacionService`, que garantiza verificador ≠ ejecutor. */
  validar(workspaceId: string, id: string, dto: ValidarResultadoDto) {
    return this.validacion.validar(workspaceId, id, dto);
  }

  /** Nueva versión de un contrato comprometido (los contratos comprometidos son inmutables, RF29). */
  async nuevaVersion(workspaceId: string, id: string, dto: CrearContratoDto) {
    const actual = await this.get(workspaceId, id);
    const tareaId = actual.tareaId;
    return this.prisma.$transaction(async (tx) => {
      if (tareaId) await tx.contratoResultado.update({ where: { id }, data: { tareaId: null } });
      return tx.contratoResultado.create({
        data: { ...this.datos(dto), workspaceId, tareaId, version: actual.version + 1 },
      });
    });
  }

  async agregarEvidencia(workspaceId: string, contratoId: string, dto: CrearEvidenciaDto) {
    const contrato = await this.get(workspaceId, contratoId);
    return this.prisma.evidencia.create({
      data: {
        workspaceId,
        contratoResultadoId: contrato.id,
        tareaId: contrato.tareaId,
        tipo: dto.tipo.trim(),
        descripcion: dto.descripcion?.trim() || null,
        referencia: (dto.referencia ?? {}) as Prisma.InputJsonValue,
        hash: dto.hash?.trim() || null,
        propietarioUserId: dto.propietarioUserId ?? null,
        vigenteHasta: dto.vigenteHasta ? new Date(dto.vigenteHasta) : null,
      },
    });
  }

  private datos(dto: CrearContratoDto) {
    return {
      resultadoEsperado: dto.resultadoEsperado.trim(),
      alcance: dto.alcance?.trim() || null,
      entradas: (dto.entradas ?? {}) as Prisma.InputJsonValue,
      responsableAgentId: dto.responsableAgentId ?? null,
      duenoUserId: dto.duenoUserId ?? null,
      fecha: dto.fecha ? new Date(dto.fecha) : null,
      presupuestoUsd: dto.presupuestoUsd ?? null,
      indicador: dto.indicador?.trim() || null,
      reglaValidacion: (dto.reglaValidacion ?? {}) as Prisma.InputJsonValue,
      evidenciaExigida: (dto.evidenciaExigida ?? []) as Prisma.InputJsonValue,
      tipoResultado: dto.tipoResultado ?? 'RESULTADO_NEGOCIO',
      nivelRiesgo: dto.nivelRiesgo ?? 1,
    };
  }
}
