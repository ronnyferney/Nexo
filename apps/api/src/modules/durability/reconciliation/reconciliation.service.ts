import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  DURABILITY_SWEEP_PATTERN,
  DURABILITY_SWEEP_SCHEDULER_ID,
  JOB_DURABILITY_SWEEP,
  WORKFLOW_QUEUE,
} from '../../workflows/queue/workflow-queue.constants';
import {
  type AccionDurabilidad,
  type ClaseFallo,
  decidirAccion,
  evaluarFallo,
  type SenalFallo,
} from '../classification/failure-classification';
import { ExcepcionesService } from '../excepciones/excepciones.service';

export interface ContextoFallo {
  procesoId?: string | null;
  tareaId?: string | null;
  executionId?: string | null;
  paso?: string | null;
  empresaId?: string | null;
  idempotencyKeyId?: string | null;
  evidencia?: Record<string, unknown>;
  causa: string;
}

export interface ResultadoManejoFallo {
  clase: ClaseFallo;
  accion: AccionDurabilidad;
  /** Id de la excepción abierta cuando la acción fue CONCILIAR o NO_REINTENTAR. */
  excepcionId?: string;
}

/**
 * Conciliación y clasificación de fallos (E7 · RF20). Aplica las reglas PURAS de clasificación y, cuando el resultado
 * exige intervención (PERMANENTE → no reintentar; INCIERTO/temporal no seguro → conciliar), alimenta la bandeja de
 * excepciones. Se apoya en el motor durable y las colas EXISTENTES (no crea cola nueva): el `schedule-reconciler` y el
 * job de barrido invocan `reconciliarPendientes`. Principio: no se promete exactly-once sobre sistemas externos; una
 * escritura incierta se verifica contra el destino o se envía a la bandeja, nunca se repite a ciegas.
 */
@Injectable()
export class ReconciliationService implements OnModuleInit {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly excepciones: ExcepcionesService,
    @InjectQueue(WORKFLOW_QUEUE) private readonly queue: Queue,
  ) {}

  /** Programa el barrido de conciliación en la cola BullMQ EXISTENTE (no una cola nueva). */
  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        DURABILITY_SWEEP_SCHEDULER_ID,
        { pattern: DURABILITY_SWEEP_PATTERN, tz: 'UTC' },
        { name: JOB_DURABILITY_SWEEP, data: {}, opts: { removeOnComplete: 10, removeOnFail: 50 } },
      );
    } catch (err) {
      this.logger.warn(`No se pudo programar la conciliación de durabilidad: ${(err as Error).message}`);
    }
  }

  /** Clasifica (pura) sin efectos. */
  clasificar(senal: SenalFallo) {
    return evaluarFallo(senal);
  }

  /**
   * Maneja un fallo: clasifica y, salvo que sea TEMPORAL reintentable (operación segura), abre una excepción. Devuelve
   * la decisión para que el llamador reintente (TEMPORAL seguro) o detenga el efecto (PERMANENTE/INCIERTO).
   */
  async manejarFallo(workspaceId: string, senal: SenalFallo, ctx: ContextoFallo): Promise<ResultadoManejoFallo> {
    const { clase, accion } = evaluarFallo(senal);
    if (accion === 'REINTENTAR') return { clase, accion };

    const excepcion = await this.excepciones.abrirUnica(workspaceId, {
      causa: ctx.causa,
      clase,
      procesoId: ctx.procesoId,
      tareaId: ctx.tareaId,
      executionId: ctx.executionId,
      paso: ctx.paso,
      empresaId: ctx.empresaId,
      idempotencyKeyId: ctx.idempotencyKeyId,
      evidencia: ctx.evidencia,
      origen: clase === 'INCIERTO' ? 'ESCRITURA_INCIERTA' : 'MOTOR_DURABLE',
      siguienteAccion:
        accion === 'CONCILIAR'
          ? 'Conciliar: verificar el estado en el destino antes de reintentar'
          : 'Fallo permanente: corregir la causa; no reintentar a ciegas',
    });
    return { clase, accion, excepcionId: excepcion.id };
  }

  /**
   * Concilia una escritura incierta (RF20): el efecto pudo salir pero no se confirmó. NO se reintenta a ciegas; se abre
   * una excepción de tipo ESCRITURA_INCIERTA en la bandeja para verificar el destino.
   */
  async conciliarEscrituraIncierta(workspaceId: string, ctx: ContextoFallo) {
    return this.excepciones.abrirUnica(workspaceId, {
      causa: ctx.causa,
      clase: 'INCIERTO',
      procesoId: ctx.procesoId,
      tareaId: ctx.tareaId,
      executionId: ctx.executionId,
      paso: ctx.paso,
      empresaId: ctx.empresaId,
      idempotencyKeyId: ctx.idempotencyKeyId,
      evidencia: ctx.evidencia,
      origen: 'ESCRITURA_INCIERTA',
      siguienteAccion: 'Conciliar: verificar el estado en el destino antes de reintentar',
    });
  }

  /**
   * Barrido de claves de idempotencia EN_PROGRESO ya caducadas (RF20): su efecto quedó "en el aire" (el proceso que lo
   * reclamó no lo completó ni lo marcó fallido). No se puede asumir que ocurrió ni que no: se CONCILIA abriendo una
   * excepción. Lo invocan el `schedule-reconciler` al arrancar y el job repetible de la cola existente.
   */
  async reconciliarPendientes(now = new Date(), workspaceId?: string): Promise<{ conciliadas: number }> {
    const colgadas = await this.prisma.idempotencyKey.findMany({
      where: {
        estado: 'EN_PROGRESO',
        expiresAt: { lt: now },
        ...(workspaceId ? { workspaceId } : {}),
      },
    });
    let conciliadas = 0;
    for (const key of colgadas) {
      await this.excepciones.abrirUnica(key.workspaceId, {
        causa: 'ESCRITURA_INCIERTA_CADUCADA',
        clase: 'INCIERTO',
        idempotencyKeyId: key.id,
        evidencia: { clave: key.clave, scope: key.scope },
        origen: 'ESCRITURA_INCIERTA',
        siguienteAccion: 'Conciliar: el efecto no se confirmó antes de caducar; verificar el destino',
      });
      // Marca la clave como FALLIDA para no volver a barrerla (la decisión final la toma la conciliación de la bandeja).
      await this.prisma.idempotencyKey.update({ where: { id: key.id }, data: { estado: 'FALLIDA' } });
      conciliadas++;
    }
    if (conciliadas) this.logger.warn(`Conciliación de escrituras inciertas: ${conciliadas} claves caducadas`);
    return { conciliadas };
  }

  /** Reexporta la decisión pura para quien solo necesite decidir sin abrir excepción. */
  decidir(clase: ClaseFallo, operacionSegura: boolean) {
    return decidirAccion(clase, operacionSegura);
  }
}
