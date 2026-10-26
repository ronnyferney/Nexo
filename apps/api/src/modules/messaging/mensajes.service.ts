import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, type MensajeAgente } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  JOB_MESSAGE,
  JOB_MESSAGES_SWEEP,
  MESSAGES_SWEEP_PATTERN,
  MESSAGES_SWEEP_SCHEDULER_ID,
  WORKFLOW_QUEUE,
  type MessageJobData,
} from '../workflows/queue/workflow-queue.constants';
import { detectarAmpliacionAtribuciones, evaluarDelegacion, LIMITES_DELEGACION_DEFECTO } from './delegacion.rules';
import type { EnviarMensajeDto, HechoMensajeDto } from './dto/mensaje.dto';

export interface BarridoMensajesStats {
  vencidos: number;
  escalados: number;
}

/**
 * Protocolo de comunicación entre agentes (RF35). Mensajes persistentes e IDEMPOTENTES: `@@unique([workspaceId,
 * messageId])` garantiza que una redelivery del mismo `messageId` devuelve el mensaje existente SIN crear otra tarea
 * ni otro efecto (QA11). Los hechos de ciclo de vida (enviado/recibido/aceptado/resuelto) son registros distintos.
 * Un mensaje NO autoriza efectos ni amplía atribuciones (RF09/QA02): un `permisos` que pretenda crear agentes,
 * autoaprobar o ampliar presupuesto se RECHAZA y audita. La delegación derivada respeta profundidad/ciclos (RF10).
 * El despacho reutiliza la cola BullMQ existente; el disparo del runtime del agente destinatario es un seam de ai.
 */
@Injectable()
export class MensajesService implements OnModuleInit {
  private readonly logger = new Logger(MensajesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WORKFLOW_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        MESSAGES_SWEEP_SCHEDULER_ID,
        { pattern: MESSAGES_SWEEP_PATTERN, tz: 'UTC' },
        { name: JOB_MESSAGES_SWEEP, data: {}, opts: { removeOnComplete: 10, removeOnFail: 50 } },
      );
    } catch (err) {
      this.logger.warn(`No se pudo programar el barrido de mensajes: ${(err as Error).message}`);
    }
  }

  list(workspaceId: string, filtro: { correlationId?: string; tareaId?: string; destinatarioAgentId?: string } = {}) {
    return this.prisma.mensajeAgente.findMany({
      where: {
        workspaceId,
        ...(filtro.correlationId ? { correlationId: filtro.correlationId } : {}),
        ...(filtro.tareaId ? { tareaId: filtro.tareaId } : {}),
        ...(filtro.destinatarioAgentId ? { destinatarioAgentId: filtro.destinatarioAgentId } : {}),
      },
      orderBy: { enviadoAt: 'desc' },
    });
  }

  async get(workspaceId: string, id: string): Promise<MensajeAgente> {
    const m = await this.prisma.mensajeAgente.findFirst({ where: { id, workspaceId } });
    if (!m) throw new NotFoundException('Mensaje no encontrado');
    return m;
  }

  /**
   * Envía un mensaje (idempotente por `messageId`). Si es una ASIGNACION con datos de tarea y sin `tareaId`, crea la
   * tarea asignada UNA SOLA VEZ dentro de la misma operación: la clave única del mensaje la protege (QA11). Un
   * `permisos` que intente ampliar atribuciones se rechaza (RF09/QA02). La delegación respeta profundidad/ciclos (RF10).
   */
  async enviar(workspaceId: string, dto: EnviarMensajeDto): Promise<MensajeAgente & { yaExistia?: boolean }> {
    // Idempotencia: una redelivery devuelve el mensaje existente sin efecto nuevo.
    const existente = await this.prisma.mensajeAgente.findUnique({
      where: { workspaceId_messageId: { workspaceId, messageId: dto.messageId } },
    });
    if (existente) return { ...existente, yaExistia: true };

    // Regla dura (RF10/QA02): un mensaje no amplía atribuciones.
    const ampliacion = detectarAmpliacionAtribuciones(dto.permisos);
    if (ampliacion) {
      this.logger.warn(`Mensaje rechazado (${ampliacion}) ws=${workspaceId} tipo=${dto.tipo}`);
      throw new ForbiddenException(`Un mensaje no puede ampliar atribuciones: ${ampliacion} (RF09/QA02)`);
    }

    // Si corresponde, prepara la tarea derivada (ASIGNACION sin tareaId, con datos de tarea).
    const creaTarea = dto.tipo === 'ASIGNACION' && !dto.tareaId && !!dto.tarea;
    const datosTarea = creaTarea ? dto.tarea! : null;
    let profundidad = 0;
    if (datosTarea?.parentTareaId) {
      const cadena = await this.cadenaDelegacion(workspaceId, datosTarea.parentTareaId);
      const concurrencia = await this.prisma.tarea.count({
        where: {
          workspaceId,
          parentTareaId: datosTarea.parentTareaId,
          estado: { notIn: ['COMPLETADA', 'FALLIDA_CANCELADA'] },
        },
      });
      const pasos = dto.correlationId
        ? await this.prisma.mensajeAgente.count({ where: { workspaceId, correlationId: dto.correlationId } })
        : 0;
      const decision = evaluarDelegacion(
        {
          profundidadPadre: cadena.profundidadPadre,
          cadenaAgentes: cadena.cadenaAgentes,
          nuevoAgenteId: dto.destinatarioAgentId ?? null,
          concurrenciaActual: concurrencia,
          pasosActuales: pasos,
        },
        LIMITES_DELEGACION_DEFECTO,
      );
      if (!decision.permitido) {
        throw new BadRequestException(`Delegación detenida: ${decision.motivo} (RF10)`);
      }
      profundidad = decision.profundidadResultante;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        let tareaId = dto.tareaId ?? null;
        if (datosTarea) {
          const tarea = await tx.tarea.create({
            data: {
              workspaceId,
              titulo: datosTarea.titulo.trim(),
              criterioAceptacion: datosTarea.criterioAceptacion?.trim() || null,
              entradas: (datosTarea.entradas ?? {}) as Prisma.InputJsonValue,
              responsableAgentId: dto.destinatarioAgentId ?? null,
              duenoUserId: null,
              fechaLimite: datosTarea.fechaLimite ? new Date(datosTarea.fechaLimite) : null,
              parentTareaId: datosTarea.parentTareaId ?? null,
              profundidadDelegacion: profundidad,
              correlationId: dto.correlationId ?? null,
            },
          });
          tareaId = tarea.id;
        }
        return tx.mensajeAgente.create({
          data: {
            workspaceId,
            messageId: dto.messageId,
            tipo: dto.tipo,
            correlationId: dto.correlationId ?? null,
            empresaId: dto.empresaId ?? null,
            emisorAgentId: dto.emisorAgentId ?? null,
            destinatarioAgentId: dto.destinatarioAgentId ?? null,
            destinatarioEquipoId: dto.destinatarioEquipoId ?? null,
            canalId: dto.canalId ?? null,
            misionId: dto.misionId ?? null,
            tareaId,
            prioridad: dto.prioridad ?? 3,
            version: dto.version ?? 1,
            fechaLimite: dto.fechaLimite ? new Date(dto.fechaLimite) : null,
            referencias: (dto.referencias ?? []) as Prisma.InputJsonValue,
            permisos: (dto.permisos ?? {}) as Prisma.InputJsonValue,
          },
        });
      });
    } catch (err) {
      // Carrera de redelivery: el unique saltó entre el SELECT y el INSERT. Devuelve el existente (sin efecto nuevo).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const ya = await this.prisma.mensajeAgente.findUnique({
          where: { workspaceId_messageId: { workspaceId, messageId: dto.messageId } },
        });
        if (ya) return { ...ya, yaExistia: true };
      }
      throw err;
    }
  }

  /** Despacha el mensaje por la cola (jobId = mensajeId: idempotente). El disparo del agente destinatario es seam de ai. */
  async encolarDespacho(mensajeId: string): Promise<void> {
    await this.queue.add(JOB_MESSAGE, { mensajeId } satisfies MessageJobData, {
      jobId: `msg:${mensajeId}`,
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  /**
   * Seam de despacho que corre en el worker (JOB_MESSAGE): marca el hecho de RECEPCIÓN del destinatario. Aquí
   * nexo-backend-ai enganchará el disparo del runtime del agente destinatario (un turno de agente / una rutina) bajo
   * sus propias políticas, presupuesto y aprobaciones; este seam NO ejecuta herramientas por sí mismo (RF09).
   */
  async despachar(mensajeId: string): Promise<void> {
    const m = await this.prisma.mensajeAgente.findUnique({ where: { id: mensajeId } });
    if (!m || m.recibidoAt) return;
    if (m.destinatarioAgentId) {
      await this.prisma.mensajeAgente.update({
        where: { id: mensajeId },
        data: { recibidoAt: new Date(), recibidoPorAgentId: m.destinatarioAgentId },
      });
    }
  }

  /** Marca el hecho de RECEPCIÓN (distinto del envío, RF35). */
  recibir(workspaceId: string, id: string, dto: HechoMensajeDto) {
    return this.marcarHecho(workspaceId, id, 'recibidoAt', { recibidoPorAgentId: dto.agentId ?? null });
  }

  /** Marca el hecho de ACEPTACIÓN (distinto de recepción, RF35). */
  aceptar(workspaceId: string, id: string, dto: HechoMensajeDto) {
    return this.marcarHecho(workspaceId, id, 'aceptadoAt', { aceptadoPorAgentId: dto.agentId ?? null });
  }

  /** Marca el hecho de RESOLUCIÓN (cierre/entrega/devolución). Una devolución exige motivo auditable. */
  async resolver(workspaceId: string, id: string, dto: HechoMensajeDto) {
    const m = await this.get(workspaceId, id);
    if (m.tipo === 'DEVOLUCION' && !dto.motivo?.trim()) {
      throw new BadRequestException('Una devolución debe conservar el motivo (RF35/HU14)');
    }
    return this.prisma.mensajeAgente.update({
      where: { id },
      data: { resueltoAt: m.resueltoAt ?? new Date(), ...(dto.motivo ? { motivo: dto.motivo.trim() } : {}) },
    });
  }

  private async marcarHecho(
    workspaceId: string,
    id: string,
    campo: 'recibidoAt' | 'aceptadoAt',
    extra: Record<string, unknown>,
  ) {
    const m = await this.get(workspaceId, id);
    // Idempotente: si el hecho ya ocurrió, no se reescribe la marca original.
    if (m[campo]) return m;
    return this.prisma.mensajeAgente.update({ where: { id }, data: { [campo]: new Date(), ...extra } });
  }

  /**
   * Barrido de vencimientos (lo invoca el job repetible y el cron de reconciliación): un mensaje con `fechaLimite`
   * vencida que no fue recibido ni aceptado se ESCALA — se enruta al suplente/superior con un mensaje de ESCALAMIENTO
   * correlacionado y el original se marca resuelto por timeout (evita re-escalar en bucle, RF35/HU17). Aislado por
   * workspace. No escala los mensajes que ya son ESCALAMIENTO (no genera ruido/ciclos).
   */
  async barrerVencidos(now = new Date(), workspaceId?: string): Promise<BarridoMensajesStats> {
    const stats: BarridoMensajesStats = { vencidos: 0, escalados: 0 };
    const vencidos = await this.prisma.mensajeAgente.findMany({
      where: {
        ...(workspaceId ? { workspaceId } : {}),
        fechaLimite: { lt: now },
        aceptadoAt: null,
        resueltoAt: null,
        tipo: { notIn: ['ESCALAMIENTO', 'CIERRE', 'ACEPTACION'] },
      },
    });
    for (const m of vencidos) {
      stats.vencidos++;
      const escalMessageId = `${m.messageId}:escalado`;
      const yaEscalado = await this.prisma.mensajeAgente.findUnique({
        where: { workspaceId_messageId: { workspaceId: m.workspaceId, messageId: escalMessageId } },
      });
      await this.prisma.$transaction(async (tx) => {
        if (!yaEscalado) {
          await tx.mensajeAgente.create({
            data: {
              workspaceId: m.workspaceId,
              messageId: escalMessageId,
              tipo: 'ESCALAMIENTO',
              correlationId: m.correlationId,
              empresaId: m.empresaId,
              emisorAgentId: m.emisorAgentId,
              // Suplencia/escalamiento: se enruta al suplente si se conoce, y si no, al superior (lo resuelve ai/E3).
              destinatarioAgentId: null,
              misionId: m.misionId,
              tareaId: m.tareaId,
              prioridad: Math.max(1, m.prioridad - 1),
              referencias: [{ mensajeId: m.id, motivo: 'SIN_RESPUESTA_A_TIEMPO' }] as Prisma.InputJsonValue,
            },
          });
          stats.escalados++;
        }
        await tx.mensajeAgente.update({
          where: { id: m.id },
          data: { resueltoAt: now, motivo: m.motivo ?? 'ESCALADO_POR_TIMEOUT' },
        });
      });
    }
    if (stats.vencidos) {
      this.logger.log(`Barrido de mensajes: ${stats.vencidos} vencidos, ${stats.escalados} escalados`);
    }
    return stats;
  }

  /**
   * Cadena de delegación ascendente de una tarea: profundidad del padre y los agentes responsables de la cadena
   * (para detectar ciclos, RF10). Acotada por `profundidadDelegacion` para no recorrer en bucle.
   */
  private async cadenaDelegacion(
    workspaceId: string,
    parentTareaId: string,
  ): Promise<{ profundidadPadre: number; cadenaAgentes: string[] }> {
    const cadenaAgentes: string[] = [];
    let actualId: string | null = parentTareaId;
    let profundidadPadre = 0;
    let guardia = 0;
    while (actualId && guardia < 64) {
      guardia++;
      const t: {
        id: string;
        parentTareaId: string | null;
        responsableAgentId: string | null;
        profundidadDelegacion: number;
      } | null = await this.prisma.tarea.findFirst({
        where: { id: actualId, workspaceId },
        select: { id: true, parentTareaId: true, responsableAgentId: true, profundidadDelegacion: true },
      });
      if (!t) break;
      if (actualId === parentTareaId) profundidadPadre = t.profundidadDelegacion;
      if (t.responsableAgentId) cadenaAgentes.push(t.responsableAgentId);
      actualId = t.parentTareaId;
    }
    return { profundidadPadre, cadenaAgentes };
  }
}
