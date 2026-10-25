import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { CrearEvidenciaDto } from './dto/evidencia.dto';
import type { CambiarEstadoTareaDto, CreateTareaDto, EstadoTareaDto, UpdateTareaDto } from './dto/tarea.dto';
import { ObjetivosService } from './objetivos.service';
import { ESTADOS_TAREA_TERMINALES, puedeTransicionarTarea } from './results.constants';

/**
 * Tareas (RF08). El estado OPERATIVO y el estado del RESULTADO son ortogonales. Guarda dura (HU15/QA09): una tarea
 * solo pasa a COMPLETADA si su `ContratoResultado` está ACEPTADO (resultado verificado, no solo "ejecutado").
 */
@Injectable()
export class TareasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly objetivos: ObjetivosService,
  ) {}

  list(workspaceId: string, filtro: { estado?: EstadoTareaDto; objetivoId?: string } = {}) {
    return this.prisma.tarea.findMany({
      where: {
        workspaceId,
        ...(filtro.estado ? { estado: filtro.estado } : {}),
        ...(filtro.objetivoId ? { objetivoId: filtro.objetivoId } : {}),
      },
      include: {
        contratoResultado: { select: { id: true, estado: true, tipoResultado: true } },
        _count: { select: { executions: true, incumplimientos: true, evidencias: true } },
      },
      orderBy: [{ prioridad: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async get(workspaceId: string, id: string) {
    const tarea = await this.prisma.tarea.findFirst({
      where: { id, workspaceId },
      include: {
        contratoResultado: { include: { validaciones: { orderBy: { createdAt: 'desc' } }, evidencias: true } },
        evidencias: true,
        incumplimientos: { orderBy: { createdAt: 'desc' } },
        objetivo: { select: { id: true, codigo: true, nombre: true } },
        _count: { select: { executions: true } },
      },
    });
    if (!tarea) throw new NotFoundException('Tarea no encontrada');
    return tarea;
  }

  async create(workspaceId: string, dto: CreateTareaDto) {
    if (dto.objetivoId) await this.objetivos.assertInWorkspace(workspaceId, dto.objetivoId);
    let profundidad = 0;
    if (dto.parentTareaId) {
      const padre = await this.prisma.tarea.findFirst({
        where: { id: dto.parentTareaId, workspaceId },
        select: { id: true, profundidadDelegacion: true },
      });
      if (!padre) throw new NotFoundException('Tarea padre no encontrada');
      profundidad = padre.profundidadDelegacion + 1;
    }
    return this.prisma.tarea.create({
      data: {
        workspaceId,
        titulo: dto.titulo.trim(),
        descripcion: dto.descripcion?.trim() || null,
        objetivoId: dto.objetivoId ?? null,
        orgUnitId: dto.orgUnitId ?? null,
        criterioAceptacion: dto.criterioAceptacion?.trim() || null,
        entradas: (dto.entradas ?? {}) as Prisma.InputJsonValue,
        responsableAgentId: dto.responsableAgentId ?? null,
        equipoId: dto.equipoId ?? null,
        duenoUserId: dto.duenoUserId ?? null,
        prioridad: dto.prioridad ?? 3,
        fechaLimite: dto.fechaLimite ? new Date(dto.fechaLimite) : null,
        tipoResultado: dto.tipoResultado ?? 'PRODUCTO_INTERMEDIO',
        parentTareaId: dto.parentTareaId ?? null,
        profundidadDelegacion: profundidad,
        correlationId: dto.correlationId ?? null,
      },
    });
  }

  async update(workspaceId: string, id: string, dto: UpdateTareaDto) {
    const tarea = await this.get(workspaceId, id);
    if (ESTADOS_TAREA_TERMINALES.includes(tarea.estado)) {
      throw new BadRequestException('Una tarea en estado terminal no se puede editar');
    }
    if (dto.objetivoId) await this.objetivos.assertInWorkspace(workspaceId, dto.objetivoId);
    return this.prisma.tarea.update({
      where: { id },
      data: {
        ...(dto.titulo !== undefined ? { titulo: dto.titulo.trim() } : {}),
        ...(dto.descripcion !== undefined ? { descripcion: dto.descripcion?.trim() || null } : {}),
        ...(dto.objetivoId !== undefined ? { objetivoId: dto.objetivoId || null } : {}),
        ...(dto.orgUnitId !== undefined ? { orgUnitId: dto.orgUnitId || null } : {}),
        ...(dto.criterioAceptacion !== undefined ? { criterioAceptacion: dto.criterioAceptacion?.trim() || null } : {}),
        ...(dto.entradas !== undefined ? { entradas: dto.entradas as Prisma.InputJsonValue } : {}),
        ...(dto.responsableAgentId !== undefined ? { responsableAgentId: dto.responsableAgentId || null } : {}),
        ...(dto.equipoId !== undefined ? { equipoId: dto.equipoId || null } : {}),
        ...(dto.duenoUserId !== undefined ? { duenoUserId: dto.duenoUserId || null } : {}),
        ...(dto.prioridad !== undefined ? { prioridad: dto.prioridad } : {}),
        ...(dto.fechaLimite !== undefined ? { fechaLimite: dto.fechaLimite ? new Date(dto.fechaLimite) : null } : {}),
        ...(dto.tipoResultado !== undefined ? { tipoResultado: dto.tipoResultado } : {}),
        ...(dto.correlationId !== undefined ? { correlationId: dto.correlationId || null } : {}),
      },
    });
  }

  async remove(workspaceId: string, id: string) {
    await this.get(workspaceId, id);
    await this.prisma.tarea.delete({ where: { id } });
  }

  /**
   * Cambia el estado OPERATIVO respetando las transiciones permitidas. La guarda dura (HU15/QA09): COMPLETADA exige
   * que exista un `ContratoResultado` y que esté ACEPTADO. Distinguir "resultado generado" de "resultado aceptado".
   */
  async cambiarEstado(workspaceId: string, id: string, dto: CambiarEstadoTareaDto) {
    const tarea = await this.prisma.tarea.findFirst({
      where: { id, workspaceId },
      include: { contratoResultado: { select: { estado: true } } },
    });
    if (!tarea) throw new NotFoundException('Tarea no encontrada');
    const destino = dto.estado;
    if (tarea.estado === destino) return tarea;
    if (!puedeTransicionarTarea(tarea.estado, destino)) {
      throw new BadRequestException(`Transición de tarea inválida: ${tarea.estado} → ${destino}`);
    }
    if (destino === 'COMPLETADA') {
      if (!tarea.contratoResultado) {
        throw new BadRequestException('No se puede completar una tarea sin contrato de resultado (RF29/HU15)');
      }
      if (tarea.contratoResultado.estado !== 'ACEPTADO') {
        throw new BadRequestException(
          'No se puede completar: el resultado no está ACEPTADO (verificado), solo ejecutado (HU15/QA09)',
        );
      }
    }
    return this.prisma.tarea.update({ where: { id }, data: { estado: destino } });
  }

  async agregarEvidencia(workspaceId: string, tareaId: string, dto: CrearEvidenciaDto) {
    await this.get(workspaceId, tareaId);
    return this.prisma.evidencia.create({
      data: {
        workspaceId,
        tareaId,
        tipo: dto.tipo.trim(),
        descripcion: dto.descripcion?.trim() || null,
        referencia: (dto.referencia ?? {}) as Prisma.InputJsonValue,
        hash: dto.hash?.trim() || null,
        propietarioUserId: dto.propietarioUserId ?? null,
        vigenteHasta: dto.vigenteHasta ? new Date(dto.vigenteHasta) : null,
      },
    });
  }
}
