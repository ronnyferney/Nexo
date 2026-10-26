import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { ReconciliationService } from '../durability/reconciliation/reconciliation.service';
import { IncumplimientosService } from '../results/incumplimientos.service';
import { RoutinesService } from '../routines/routines.service';
import { WORKFLOW_QUEUE } from './queue/workflow-queue.constants';
import { reconcileSource, type ReconcileStats, type ScheduleSource } from './schedule-reconciler';
import { WorkflowsService } from './workflows.service';

/** Candado en Redis: con varias réplicas (API y workers) solo una reconcilia en cada arranque. */
export const RECONCILE_LOCK_KEY = 'nexo:schedules:reconcile-lock';
/** Expiración del candado: si la instancia muere a mitad, otra puede reconciliar tras este plazo. */
export const RECONCILE_LOCK_TTL_MS = 5 * 60_000;

/** Libera el candado solo si sigue siendo nuestro (script atómico de Redis, no código JS dinámico). */
const RELEASE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export type ReconcileResult =
  { skipped: true } | { skipped: false; workflows: ReconcileStats; routines: ReconcileStats };

/**
 * P9 — Los programadores cron de flujos y rutinas viven solo en Redis (JobScheduler de BullMQ). Al arrancar se
 * reconcilian desde PostgreSQL para sobrevivir a un Redis reemplazado o vaciado: se crean los que faltan, se
 * actualizan los que difieren (patrón / zona horaria) y se eliminan los huérfanos. Es idempotente.
 */
@Injectable()
export class ScheduleReconcilerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScheduleReconcilerService.name);

  constructor(
    private readonly workflows: WorkflowsService,
    private readonly routines: RoutinesService,
    @InjectQueue(WORKFLOW_QUEUE) private readonly queue: Queue,
    private readonly incumplimientos: IncumplimientosService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.reconcile();
    } catch (err) {
      // No impide el arranque: la API sigue sirviendo y el próximo arranque vuelve a intentarlo.
      this.logger.error(`No se pudieron reconciliar los programadores: ${(err as Error).message}`);
    }
    try {
      // E4/RF31: barrido inicial de vencimientos de tareas/contratos (luego lo repite el job `JOB_RESULTS_SWEEP`).
      await this.incumplimientos.barrer();
    } catch (err) {
      this.logger.error(`No se pudo barrer incumplimientos al arrancar: ${(err as Error).message}`);
    }
    try {
      // E7/RF20: conciliación inicial de escrituras inciertas (claves caducadas); luego lo repite `JOB_DURABILITY_SWEEP`.
      await this.reconciliation.reconciliarPendientes();
    } catch (err) {
      this.logger.error(`No se pudo conciliar escrituras inciertas al arrancar: ${(err as Error).message}`);
    }
  }

  async reconcile(): Promise<ReconcileResult> {
    // Conexión ioredis de la cola (misma instancia y base que BullMQ); el tipo de BullMQ no expone SET NX ni EVAL.
    const client = (await this.queue.client) as unknown as Redis;
    const token = `${process.pid}:${crypto.randomUUID()}`;
    const acquired = await client.set(RECONCILE_LOCK_KEY, token, 'PX', RECONCILE_LOCK_TTL_MS, 'NX');
    if (acquired !== 'OK') {
      this.logger.log('Reconciliación de programadores omitida: otra instancia la está ejecutando');
      return { skipped: true };
    }
    try {
      const workflows = await this.run(this.workflows.scheduleSource());
      const routines = await this.run(this.routines.scheduleSource());
      return { skipped: false, workflows, routines };
    } finally {
      await client.eval(RELEASE_SCRIPT, 1, RECONCILE_LOCK_KEY, token).catch(() => undefined);
    }
  }

  private async run(source: ScheduleSource): Promise<ReconcileStats> {
    const stats = await reconcileSource(source, (ownerId, err) =>
      this.logger.warn(`Programador de ${source.kind} ${ownerId} no reconciliado: ${(err as Error).message}`),
    );
    this.logger.log(
      `Programadores de ${source.kind}: ${stats.created} creados, ${stats.updated} actualizados, ` +
        `${stats.removed} eliminados, ${stats.failed} con error`,
    );
    return stats;
  }
}
