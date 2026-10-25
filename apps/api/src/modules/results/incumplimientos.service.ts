import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  JOB_RESULTS_SWEEP,
  RESULTS_SWEEP_PATTERN,
  RESULTS_SWEEP_SCHEDULER_ID,
  WORKFLOW_QUEUE,
} from '../workflows/queue/workflow-queue.constants';
import type { CrearIncumplimientoDto, RegistrarIntentoDto } from './dto/incumplimiento.dto';
import { decidirCierreIncumplimiento } from './incumplimientos.sweep';

/** Ventana de recuperación por defecto al abrir un incumplimiento por plazo vencido (RF31): 24 h para el plan. */
const RECUPERACION_MS = 24 * 60 * 60 * 1000;
/** Reintentos por defecto del plan auto-abierto: al agotarlos el trabajo se detiene y escala (nunca activo infinito). */
const REINTENTOS_POR_DEFECTO = 3;

export interface BarridoStats {
  abiertos: number;
  declarados: number;
}

/**
 * Incumplimientos y plan de recuperación (RF31). La detección de plazos en riesgo la ejecuta el CRON de reconciliación
 * existente (`schedule-reconciler`) y un job repetible en la cola BullMQ YA existente (no una cola nueva). Al agotar el
 * límite de reintentos/ciclos o el plazo, el incumplimiento se DECLARA: la tarea se bloquea y el resultado se devuelve
 * como incumplido; nunca queda un proceso "activo para siempre" ocultando un resultado no logrado.
 */
@Injectable()
export class IncumplimientosService implements OnModuleInit {
  private readonly logger = new Logger(IncumplimientosService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WORKFLOW_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        RESULTS_SWEEP_SCHEDULER_ID,
        { pattern: RESULTS_SWEEP_PATTERN, tz: 'UTC' },
        { name: JOB_RESULTS_SWEEP, data: {}, opts: { removeOnComplete: 10, removeOnFail: 50 } },
      );
    } catch (err) {
      this.logger.warn(`No se pudo programar el barrido de incumplimientos: ${(err as Error).message}`);
    }
  }

  async crearParaTarea(workspaceId: string, tareaId: string, dto: CrearIncumplimientoDto) {
    const tarea = await this.prisma.tarea.findFirst({ where: { id: tareaId, workspaceId }, select: { id: true } });
    if (!tarea) throw new NotFoundException('Tarea no encontrada');
    return this.prisma.incumplimiento.create({
      data: {
        workspaceId,
        tareaId,
        causa: dto.causa.trim(),
        planRecuperacion: dto.planRecuperacion?.trim() || null,
        responsableUserId: dto.responsableUserId ?? null,
        escalaAgentId: dto.escalaAgentId ?? null,
        plazo: dto.plazo ? new Date(dto.plazo) : null,
        maxReintentos: dto.maxReintentos ?? 0,
        maxCiclos: dto.maxCiclos ?? 0,
        maxCostoUsd: dto.maxCostoUsd ?? null,
      },
    });
  }

  listPorTarea(workspaceId: string, tareaId: string) {
    return this.prisma.incumplimiento.findMany({
      where: { workspaceId, tareaId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Registra un intento/ciclo de corrección (cuenta contra los límites) y, si se agota, declara el incumplimiento. */
  async registrarIntento(workspaceId: string, id: string, dto: RegistrarIntentoDto, now = new Date()) {
    const inc = await this.prisma.incumplimiento.findFirst({ where: { id, workspaceId } });
    if (!inc) throw new NotFoundException('Incumplimiento no encontrado');
    if (inc.resuelto) throw new BadRequestException('El incumplimiento ya está resuelto/declarado');
    const actualizado = await this.prisma.incumplimiento.update({
      where: { id },
      data: {
        intentos: inc.intentos + (dto.reintento === false ? 0 : 1),
        ciclos: inc.ciclos + (dto.ciclo ? 1 : 0),
      },
    });
    const resolucion = decidirCierreIncumplimiento(actualizado, now);
    if (resolucion) return this.declarar(actualizado.id, actualizado.tareaId, resolucion);
    return actualizado;
  }

  /**
   * Barrido de vencimientos (lo invoca el cron de reconciliación y el job repetible): (1) abre un incumplimiento con
   * plan para las tareas vencidas sin incumplimiento abierto; (2) declara los incumplimientos cuyo plazo o límites se
   * agotaron. Idempotente: no abre dos incumplimientos por la misma tarea mientras haya uno activo.
   */
  async barrer(now = new Date(), workspaceId?: string): Promise<BarridoStats> {
    const stats: BarridoStats = { abiertos: 0, declarados: 0 };

    const vencidas = await this.prisma.tarea.findMany({
      where: {
        ...(workspaceId ? { workspaceId } : {}),
        fechaLimite: { lt: now },
        estado: { notIn: ['COMPLETADA', 'FALLIDA_CANCELADA', 'BLOQUEADA'] },
        incumplimientos: { none: { resuelto: false } },
      },
      select: { id: true, workspaceId: true, fechaLimite: true },
    });
    for (const tarea of vencidas) {
      await this.prisma.incumplimiento.create({
        data: {
          workspaceId: tarea.workspaceId,
          tareaId: tarea.id,
          causa: 'PLAZO_VENCIDO',
          planRecuperacion: 'Plan de recuperación automático: revisar y re-presentar antes del nuevo plazo.',
          plazo: new Date(now.getTime() + RECUPERACION_MS),
          maxReintentos: REINTENTOS_POR_DEFECTO,
        },
      });
      stats.abiertos++;
    }

    const abiertos = await this.prisma.incumplimiento.findMany({
      where: { resuelto: false, ...(workspaceId ? { workspaceId } : {}) },
    });
    for (const inc of abiertos) {
      const resolucion = decidirCierreIncumplimiento(inc, now);
      if (resolucion) {
        await this.declarar(inc.id, inc.tareaId, resolucion);
        stats.declarados++;
      }
    }
    if (stats.abiertos || stats.declarados) {
      this.logger.log(`Barrido de incumplimientos: ${stats.abiertos} abiertos, ${stats.declarados} declarados`);
    }
    return stats;
  }

  /**
   * Declara el incumplimiento: lo cierra (resuelto con motivo), BLOQUEA la tarea y DEVUELVE el resultado como
   * incumplido si el contrato no estaba ya ACEPTADO. Así el proceso deja de estar activo (RF31).
   */
  private async declarar(id: string, tareaId: string, resolucion: 'LIMITE_AGOTADO' | 'PLAZO_VENCIDO') {
    const now = new Date();
    const tarea = await this.prisma.tarea.findUnique({
      where: { id: tareaId },
      include: { contratoResultado: { select: { id: true, estado: true } } },
    });
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    ops.push(
      this.prisma.incumplimiento.update({
        where: { id },
        data: { resuelto: true, resolucion, resueltoAt: now },
      }),
    );
    if (tarea && !['COMPLETADA', 'FALLIDA_CANCELADA'].includes(tarea.estado)) {
      ops.push(this.prisma.tarea.update({ where: { id: tareaId }, data: { estado: 'BLOQUEADA' } }));
    }
    const contrato = tarea?.contratoResultado;
    if (contrato && contrato.estado !== 'ACEPTADO' && contrato.estado !== 'DEVUELTO_INCUMPLIDO') {
      ops.push(
        this.prisma.contratoResultado.update({ where: { id: contrato.id }, data: { estado: 'DEVUELTO_INCUMPLIDO' } }),
      );
    }
    const [incumplimiento] = await this.prisma.$transaction(ops);
    return incumplimiento;
  }
}
