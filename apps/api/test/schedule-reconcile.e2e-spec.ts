import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { ROUTINE_QUEUE, routineSchedulerId } from '../src/modules/routines/routine-queue.constants';
import { schedulerId, WORKFLOW_QUEUE } from '../src/modules/workflows/queue/workflow-queue.constants';
import { RECONCILE_LOCK_KEY, ScheduleReconcilerService } from '../src/modules/workflows/schedule-reconciler.service';
import { createTestApp, prismaOf } from './utils/app';
import { createAgent, registerOwner, type Session } from './utils/fixtures';

/**
 * P9 — Los programadores cron viven solo en Redis: si Redis se reemplaza o se vacía, la reconciliación al arrancar los
 * reconstruye desde PostgreSQL y elimina los huérfanos.
 */
describe('Reconciliación de programadores cron (E2E)', () => {
  let app: INestApplication;
  let owner: Session;
  let wfQueue: Queue;
  let routineQueue: Queue;
  let reconciler: ScheduleReconcilerService;
  let activeWf: string;
  let inactiveWf: string;
  let routineId: string;
  let disabledRoutineId: string;

  const definition = {
    nodes: [{ id: 'trigger', type: 'trigger', name: 'Inicio', position: { x: 0, y: 0 }, config: {} }],
    edges: [],
  };
  /** Ids de los programadores registrados (getJobScheduler devuelve un esqueleto incluso para ids inexistentes). */
  const registered = async (q: Queue) => (await q.getJobSchedulers(0, -1)).map((s) => s.key);
  // Un patrón que no dispara durante la prueba (29 de febrero a las 03:07).
  const RARE = '7 3 29 2 *';

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'reconcile');
    wfQueue = app.get<Queue>(getQueueToken(WORKFLOW_QUEUE));
    routineQueue = app.get<Queue>(getQueueToken(ROUTINE_QUEUE));
    reconciler = app.get(ScheduleReconcilerService);

    activeWf = (await owner.api.post('/workflows', { name: 'Programado', definition, schedule: RARE }).expect(201)).body
      .id;
    await owner.api.post(`/workflows/${activeWf}/active`, { active: true }).expect(200);
    inactiveWf = (await owner.api.post('/workflows', { name: 'Inactivo', definition, schedule: RARE }).expect(201)).body
      .id;

    const agent = await createAgent(owner, { name: 'Agente reconciliación' });
    const base = { prompt: 'x', schedule: RARE, timezone: 'America/Bogota' };
    routineId = (await owner.api.post(`/agents/${agent.id}/routines`, { name: 'Activa', ...base }).expect(201)).body.id;
    disabledRoutineId = (
      await owner.api.post(`/agents/${agent.id}/routines`, { name: 'Apagada', ...base, enabled: false }).expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await wfQueue.removeJobScheduler(schedulerId(activeWf)).catch(() => undefined);
    await routineQueue.removeJobScheduler(routineSchedulerId(routineId)).catch(() => undefined);
    await app.close();
  });

  it('el alta normal registra los programadores esperados', async () => {
    expect(await registered(wfQueue)).toContain(schedulerId(activeWf));
    expect(await registered(wfQueue)).not.toContain(schedulerId(inactiveWf));
    expect(await registered(routineQueue)).toContain(routineSchedulerId(routineId));
    expect(await registered(routineQueue)).not.toContain(routineSchedulerId(disabledRoutineId));
  });

  it('tras perder Redis los programadores vuelven y los huérfanos se eliminan', async () => {
    // Simula un Redis vaciado para estos programadores.
    await wfQueue.removeJobScheduler(schedulerId(activeWf));
    await routineQueue.removeJobScheduler(routineSchedulerId(routineId));
    // Huérfanos: flujo inexistente, flujo inactivo y rutina deshabilitada con programador residual.
    const ghost = 'flujo-inexistente-p9';
    await wfQueue.upsertJobScheduler(schedulerId(ghost), { pattern: RARE }, { name: 'scheduled', data: {} });
    await wfQueue.upsertJobScheduler(schedulerId(inactiveWf), { pattern: RARE }, { name: 'scheduled', data: {} });
    await routineQueue.upsertJobScheduler(
      routineSchedulerId(disabledRoutineId),
      { pattern: RARE, tz: 'UTC' },
      { name: 'scheduled', data: {} },
    );

    const result = await reconciler.reconcile();
    expect(result.skipped).toBe(false);
    if (result.skipped) return;
    expect(result.workflows.created).toBeGreaterThanOrEqual(1);
    expect(result.workflows.removed).toBeGreaterThanOrEqual(2);
    expect(result.routines.created).toBeGreaterThanOrEqual(1);
    expect(result.routines.removed).toBeGreaterThanOrEqual(1);

    const wf = await wfQueue.getJobScheduler(schedulerId(activeWf));
    expect(wf).toMatchObject({ pattern: RARE, template: { data: { workflowId: activeWf } } });
    const rt = await routineQueue.getJobScheduler(routineSchedulerId(routineId));
    expect(rt).toMatchObject({ pattern: RARE, tz: 'America/Bogota', template: { data: { routineId } } });
    expect(await registered(wfQueue)).not.toContain(schedulerId(ghost));
    expect(await registered(wfQueue)).not.toContain(schedulerId(inactiveWf));
    expect(await registered(routineQueue)).not.toContain(routineSchedulerId(disabledRoutineId));
    // La limpieza de retención no es un programador de flujo: no se toca.
    expect(await registered(wfQueue)).toContain('executions-retention');
  });

  it('actualiza el que difiere de la base (patrón o zona horaria)', async () => {
    await routineQueue.upsertJobScheduler(
      routineSchedulerId(routineId),
      { pattern: '0 0 1 1 *', tz: 'UTC' },
      { name: 'scheduled', data: { routineId } },
    );
    await prismaOf(app).workflow.update({ where: { id: activeWf }, data: { schedule: '8 3 29 2 *' } });
    const result = await reconciler.reconcile();
    if (result.skipped) throw new Error('reconciliación omitida');
    expect(result.routines.updated).toBeGreaterThanOrEqual(1);
    expect(result.workflows.updated).toBeGreaterThanOrEqual(1);
    expect(await routineQueue.getJobScheduler(routineSchedulerId(routineId))).toMatchObject({
      pattern: RARE,
      tz: 'America/Bogota',
    });
    expect(await wfQueue.getJobScheduler(schedulerId(activeWf))).toMatchObject({ pattern: '8 3 29 2 *' });
  });

  it('es idempotente y respeta el candado de otra réplica', async () => {
    const again = await reconciler.reconcile();
    if (again.skipped) throw new Error('reconciliación omitida');
    for (const stats of [again.workflows, again.routines]) {
      expect(stats).toMatchObject({ created: 0, updated: 0, removed: 0 });
    }
    expect(await registered(wfQueue)).toContain(schedulerId(activeWf));
    expect(await registered(routineQueue)).toContain(routineSchedulerId(routineId));

    const client = (await wfQueue.client) as unknown as Redis;
    await client.set(RECONCILE_LOCK_KEY, 'otra-replica', 'PX', 60_000);
    await routineQueue.removeJobScheduler(routineSchedulerId(routineId));
    try {
      expect(await reconciler.reconcile()).toEqual({ skipped: true });
      expect(await registered(routineQueue)).not.toContain(routineSchedulerId(routineId));
      expect(await client.get(RECONCILE_LOCK_KEY)).toBe('otra-replica');
    } finally {
      await client.del(RECONCILE_LOCK_KEY);
    }
    // Liberado el candado, la siguiente reconciliación lo repone.
    expect((await reconciler.reconcile()).skipped).toBe(false);
    expect(await registered(routineQueue)).toContain(routineSchedulerId(routineId));
  });
});
