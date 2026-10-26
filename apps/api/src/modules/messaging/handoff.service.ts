import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ContratoTransferencia } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JOB_RUN, WORKFLOW_QUEUE, type RunJobData } from '../workflows/queue/workflow-queue.constants';
import { evaluarDelegacion, LIMITES_DELEGACION_DEFECTO } from './delegacion.rules';
import type { AceptarHandoffDto, ProponerHandoffDto, RechazarHandoffDto } from './dto/handoff.dto';
import { MensajesService } from './mensajes.service';

/**
 * Continuidad de tarea / handoff (RF09). Orquestación a nivel de `Tarea`, NO dentro del motor puro: una tarea se
 * compone de varios `Execution` (segmentos) vía `Execution.tareaId` + `secuenciaSegmento`. Un punto de corte cierra
 * un segmento con un `ContratoTransferencia` (estado alcanzado + entregable parcial + contexto autorizado + criterio
 * del siguiente paso + responsable entrante). El receptor ACEPTA (encola el siguiente segmento con el estado
 * persistido como entrada, SIN rehacer lo confirmado) o RECHAZA (devuelve al emisor). La unicidad `(tareaId,
 * secuenciaSegmento)` y el estado PROPUESTO→ACEPTADO/RECHAZADO evitan duplicar acciones confirmadas (QA06/QA11).
 */
@Injectable()
export class HandoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mensajes: MensajesService,
    @InjectQueue(WORKFLOW_QUEUE) private readonly queue: Queue,
  ) {}

  listPorTarea(workspaceId: string, tareaId: string) {
    return this.prisma.contratoTransferencia.findMany({
      where: { workspaceId, tareaId },
      orderBy: { secuenciaSegmento: 'asc' },
    });
  }

  async get(workspaceId: string, id: string): Promise<ContratoTransferencia> {
    const t = await this.prisma.contratoTransferencia.findFirst({ where: { id, workspaceId } });
    if (!t) throw new NotFoundException('Contrato de transferencia no encontrado');
    return t;
  }

  /**
   * Propone un handoff en un punto de corte: calcula el siguiente nº de segmento, valida los límites de delegación
   * (profundidad/ciclo, RF10) y persiste el contrato + un `MensajeAgente` de tipo HANDOFF (idempotente por messageId).
   */
  async proponer(workspaceId: string, tareaId: string, dto: ProponerHandoffDto): Promise<ContratoTransferencia> {
    const tarea = await this.prisma.tarea.findFirst({
      where: { id: tareaId, workspaceId },
      select: { id: true, profundidadDelegacion: true, responsableAgentId: true, correlationId: true },
    });
    if (!tarea) throw new NotFoundException('Tarea no encontrada');

    const agg = await this.prisma.contratoTransferencia.aggregate({
      where: { workspaceId, tareaId },
      _max: { secuenciaSegmento: true },
    });
    const secuenciaSegmento = (agg._max.secuenciaSegmento ?? 0) + 1;

    // Control de delegación (RF10): el handoff no puede exceder profundidad ni crear un ciclo de responsables.
    const cadenaAgentes = [tarea.responsableAgentId, dto.fromAgentId].filter((x): x is string => !!x);
    const decision = evaluarDelegacion(
      {
        profundidadPadre: tarea.profundidadDelegacion,
        cadenaAgentes,
        nuevoAgenteId: dto.toAgentId ?? null,
        concurrenciaActual: 0,
        pasosActuales: secuenciaSegmento - 1,
      },
      LIMITES_DELEGACION_DEFECTO,
    );
    if (!decision.permitido) {
      throw new BadRequestException(`Handoff detenido: ${decision.motivo} (RF10)`);
    }

    const mensaje = await this.mensajes.enviar(workspaceId, {
      messageId: dto.messageId,
      tipo: 'HANDOFF',
      correlationId: tarea.correlationId ?? undefined,
      emisorAgentId: dto.fromAgentId,
      destinatarioAgentId: dto.toAgentId,
      destinatarioEquipoId: dto.toEquipoId,
      tareaId,
      permisos: dto.permisos,
      referencias: dto.contextoAutorizado,
    });

    return this.prisma.contratoTransferencia.create({
      data: {
        workspaceId,
        tareaId,
        secuenciaSegmento,
        fromAgentId: dto.fromAgentId ?? null,
        toAgentId: dto.toAgentId ?? null,
        toEquipoId: dto.toEquipoId ?? null,
        estadoAlcanzado: (dto.estadoAlcanzado ?? {}) as Prisma.InputJsonValue,
        entregableParcial: (dto.entregableParcial ?? undefined) as Prisma.InputJsonValue,
        contextoAutorizado: (dto.contextoAutorizado ?? []) as Prisma.InputJsonValue,
        criterioSiguiente: dto.criterioSiguiente?.trim() || null,
        permisos: (dto.permisos ?? {}) as Prisma.InputJsonValue,
        responsableEntranteUserId: dto.responsableEntranteUserId ?? null,
        workflowId: dto.workflowId ?? null,
        mensajeId: mensaje.id,
        profundidadDelegacion: decision.profundidadResultante,
      },
    });
  }

  /**
   * El receptor ACEPTA (RF33): el contrato pasa a ACEPTADO y se ENCOLA el siguiente segmento como un `Execution` con
   * el estado alcanzado como entrada — continúa desde el estado persistido, sin rehacer. Idempotente: solo se acepta
   * una transferencia PROPUESTA; un segundo intento no crea otro segmento ni duplica acciones confirmadas (QA11).
   */
  async aceptar(workspaceId: string, id: string, dto: AceptarHandoffDto): Promise<ContratoTransferencia> {
    const t = await this.get(workspaceId, id);
    if (t.estado !== 'PROPUESTO') {
      throw new BadRequestException(`La transferencia ya fue ${t.estado.toLowerCase()} (no se duplica, QA11)`);
    }
    const workflowId = dto.workflowId ?? t.workflowId;

    let executionId: string | null = null;
    if (workflowId) {
      const wf = await this.prisma.workflow.findFirst({ where: { id: workflowId, workspaceId }, select: { id: true } });
      if (!wf) throw new BadRequestException('El flujo del segmento entrante no existe en este workspace');
      const estadoAlcanzado = (t.estadoAlcanzado ?? {}) as Record<string, unknown>;
      const execution = await this.prisma.execution.create({
        data: {
          workflowId,
          workspaceId,
          trigger: 'MANUAL',
          tareaId: t.tareaId,
          secuenciaSegmento: t.secuenciaSegmento,
          // El estado persistido ES la entrada del segmento entrante: no se rehace el trabajo ya confirmado.
          input: { estadoAlcanzado, segmento: t.secuenciaSegmento } as Prisma.InputJsonValue,
        },
      });
      executionId = execution.id;
      await this.queue.add(JOB_RUN, { executionId: execution.id } satisfies RunJobData, {
        jobId: execution.id,
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    }

    const actualizado = await this.prisma.contratoTransferencia.update({
      where: { id },
      data: { estado: 'ACEPTADO', decididoAt: new Date(), executionId },
    });
    // Trazabilidad de quién continúa: el responsable entrante toma la tarea.
    if (t.toAgentId) {
      await this.prisma.tarea.update({ where: { id: t.tareaId }, data: { responsableAgentId: t.toAgentId } });
    }
    await this.mensajes.enviar(workspaceId, {
      messageId: dto.messageId,
      tipo: 'ACEPTACION',
      tareaId: t.tareaId,
      emisorAgentId: dto.aceptaAgentId ?? t.toAgentId ?? undefined,
      destinatarioAgentId: t.fromAgentId ?? undefined,
      referencias: [{ transferenciaId: t.id, segmento: t.secuenciaSegmento }],
    });
    return actualizado;
  }

  /**
   * El receptor RECHAZA (RF33): el contrato pasa a RECHAZADO con motivo y se devuelve al emisor (mensaje de DEVOLUCION).
   * No se encola ningún segmento: la tarea no avanza y se conserva la trazabilidad del rechazo.
   */
  async rechazar(workspaceId: string, id: string, dto: RechazarHandoffDto): Promise<ContratoTransferencia> {
    const t = await this.get(workspaceId, id);
    if (t.estado !== 'PROPUESTO') {
      throw new BadRequestException(`La transferencia ya fue ${t.estado.toLowerCase()} (no se duplica, QA11)`);
    }
    const actualizado = await this.prisma.contratoTransferencia.update({
      where: { id },
      data: { estado: 'RECHAZADO', decididoAt: new Date(), motivoRechazo: dto.motivo.trim() },
    });
    await this.mensajes.enviar(workspaceId, {
      messageId: dto.messageId,
      tipo: 'DEVOLUCION',
      tareaId: t.tareaId,
      emisorAgentId: t.toAgentId ?? undefined,
      destinatarioAgentId: t.fromAgentId ?? undefined,
      referencias: [{ transferenciaId: t.id, motivo: dto.motivo.trim() }],
    });
    return actualizado;
  }
}
