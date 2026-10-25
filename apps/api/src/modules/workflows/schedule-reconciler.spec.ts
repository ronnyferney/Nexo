import { Logger } from '@nestjs/common';
import type { JobSchedulerJson } from 'bullmq';
import { reconcileSource, schedulerEntries, type ScheduleEntry, type ScheduleSource } from './schedule-reconciler';
import { RECONCILE_LOCK_KEY, ScheduleReconcilerService } from './schedule-reconciler.service';

/** Origen en memoria: `apply` modifica el estado registrado como lo haría BullMQ. */
function memorySource(desired: ScheduleEntry[], registered: ScheduleEntry[], failFor: string[] = []) {
  const state = new Map(registered.map((e) => [e.ownerId, e]));
  const calls: { ownerId: string; entry: ScheduleEntry | null }[] = [];
  const source: ScheduleSource = {
    kind: 'pruebas',
    desired: async () => desired,
    registered: async () => [...state.values()],
    apply: async (ownerId, entry) => {
      calls.push({ ownerId, entry });
      if (failFor.includes(ownerId)) throw new Error('cron inválido');
      if (entry) state.set(ownerId, entry);
      else state.delete(ownerId);
    },
  };
  return { source, state, calls };
}

const e = (ownerId: string, pattern: string, tz: string | null = null): ScheduleEntry => ({ ownerId, pattern, tz });

describe('reconcileSource', () => {
  it('crea los faltantes, actualiza los que difieren y elimina los huérfanos', async () => {
    const { source, state } = memorySource(
      [e('a', '* * * * *'), e('b', '0 9 * * *', 'America/Bogota'), e('c', '0 0 * * *', 'UTC')],
      [e('b', '0 9 * * *', 'UTC'), e('c', '0 0 * * *', 'UTC'), e('orphan', '*/5 * * * *')],
    );
    const stats = await reconcileSource(source);
    expect(stats).toEqual({ created: 1, updated: 1, removed: 1, failed: 0 });
    expect([...state.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(state.get('b')?.tz).toBe('America/Bogota');
  });

  it('actualiza cuando cambia el patrón', async () => {
    const { source, calls } = memorySource([e('a', '0 8 * * *')], [e('a', '0 7 * * *')]);
    expect(await reconcileSource(source)).toEqual({ created: 0, updated: 1, removed: 0, failed: 0 });
    expect(calls).toEqual([{ ownerId: 'a', entry: e('a', '0 8 * * *') }]);
  });

  it('es idempotente: una segunda pasada no hace cambios', async () => {
    const { source, calls } = memorySource([e('a', '* * * * *'), e('b', '0 1 * * *', 'UTC')], [e('x', '* * * * *')]);
    await reconcileSource(source);
    calls.length = 0;
    expect(await reconcileSource(source)).toEqual({ created: 0, updated: 0, removed: 0, failed: 0 });
    expect(calls).toHaveLength(0);
  });

  it('trata un schedule vacío como sin programación (y elimina su programador)', async () => {
    const { source, state } = memorySource([e('a', '  ')], [e('a', '* * * * *')]);
    expect(await reconcileSource(source)).toEqual({ created: 0, updated: 0, removed: 1, failed: 0 });
    expect(state.size).toBe(0);
  });

  it('un fallo individual no detiene el resto y se informa', async () => {
    const errors: string[] = [];
    const { source, state } = memorySource([e('bad', 'no-es-cron'), e('ok', '* * * * *')], [], ['bad']);
    const stats = await reconcileSource(source, (ownerId) => errors.push(ownerId));
    expect(stats).toEqual({ created: 1, updated: 0, removed: 0, failed: 1 });
    expect(errors).toEqual(['bad']);
    expect(state.has('ok')).toBe(true);
  });
});

describe('schedulerEntries', () => {
  it('solo toma los programadores con el prefijo (ignora la retención)', () => {
    const list = [
      { key: 'wf-schedule:w1', name: 'scheduled', pattern: '* * * * *' },
      { key: 'executions-retention', name: 'retention', pattern: '17 3 * * *', tz: 'UTC' },
      { key: 'wf-schedule:w2', name: 'scheduled', pattern: '0 0 * * *', tz: 'UTC' },
    ] as JobSchedulerJson[];
    expect(schedulerEntries(list, 'wf-schedule:')).toEqual([
      { ownerId: 'w1', pattern: '* * * * *', tz: null },
      { ownerId: 'w2', pattern: '0 0 * * *', tz: 'UTC' },
    ]);
  });
});

describe('ScheduleReconcilerService', () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
  });
  afterAll(() => {
    Logger.overrideLogger(['log', 'error', 'warn', 'debug', 'verbose']);
  });

  function build(setResult: 'OK' | null) {
    const client = { set: jest.fn().mockResolvedValue(setResult), eval: jest.fn().mockResolvedValue(1) };
    const wf = memorySource([e('w1', '* * * * *')], [e('w-old', '* * * * *')]);
    const rt = memorySource([e('r1', '0 9 * * *', 'UTC')], []);
    const workflows = { scheduleSource: () => wf.source };
    const routines = { scheduleSource: () => rt.source };
    const incumplimientos = { barrer: jest.fn().mockResolvedValue({ abiertos: 0, declarados: 0 }) };
    const service = new ScheduleReconcilerService(
      workflows as never,
      routines as never,
      { client: Promise.resolve(client) } as never,
      incumplimientos as never,
    );
    return { service, client, wf, rt };
  }

  it('toma el candado con SET NX + expiración, reconcilia ambos orígenes y libera el candado', async () => {
    const { service, client, wf, rt } = build('OK');
    const result = await service.reconcile();
    expect(client.set).toHaveBeenCalledWith(RECONCILE_LOCK_KEY, expect.any(String), 'PX', expect.any(Number), 'NX');
    expect(result).toEqual({
      skipped: false,
      workflows: { created: 1, updated: 0, removed: 1, failed: 0 },
      routines: { created: 1, updated: 0, removed: 0, failed: 0 },
    });
    expect([...wf.state.keys()]).toEqual(['w1']);
    expect([...rt.state.keys()]).toEqual(['r1']);
    const [[, token]] = client.set.mock.calls as [string, string][];
    expect(client.eval).toHaveBeenCalledWith(expect.any(String), 1, RECONCILE_LOCK_KEY, token);
  });

  it('si otra réplica tiene el candado no toca los programadores', async () => {
    const { service, client, wf, rt } = build(null);
    expect(await service.reconcile()).toEqual({ skipped: true });
    expect(wf.calls).toHaveLength(0);
    expect(rt.calls).toHaveLength(0);
    expect(client.eval).not.toHaveBeenCalled();
  });

  it('un error al arrancar no tumba la aplicación', async () => {
    const client = { set: jest.fn().mockRejectedValue(new Error('redis caído')), eval: jest.fn() };
    const incumplimientos = { barrer: jest.fn().mockResolvedValue({ abiertos: 0, declarados: 0 }) };
    const service = new ScheduleReconcilerService(
      {} as never,
      {} as never,
      { client: Promise.resolve(client) } as never,
      incumplimientos as never,
    );
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
