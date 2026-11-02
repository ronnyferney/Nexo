import {
  ConcurrencyGate,
  DEFAULT_DEFER_MS,
  DEFAULT_PER_WORKSPACE_CONCURRENCY,
  DEFAULT_WORKER_CONCURRENCY,
  PRIORITY,
  priorityFor,
  schedulingConfigFrom,
  workKindForTrigger,
} from './scheduling.policy';

describe('priorityFor / workKindForTrigger (ADR 0017 Inc.3)', () => {
  it('ordena lo interactivo antes que lo programado, el lote y el mantenimiento', () => {
    expect(priorityFor('interactive')).toBeLessThan(priorityFor('scheduled'));
    expect(priorityFor('scheduled')).toBeLessThan(priorityFor('batch'));
    expect(priorityFor('batch')).toBeLessThan(priorityFor('maintenance'));
  });

  it('usa prioridades explícitas > 0 (0 en BullMQ se atendería antes que lo priorizado)', () => {
    for (const p of Object.values(PRIORITY)) expect(p).toBeGreaterThan(0);
  });

  it('clasifica el disparador: SCHEDULE es programado, el resto interactivo', () => {
    expect(workKindForTrigger('SCHEDULE')).toBe('scheduled');
    for (const t of ['MANUAL', 'WEBHOOK', 'AGENT', 'MCP']) {
      expect(workKindForTrigger(t)).toBe('interactive');
    }
  });
});

describe('schedulingConfigFrom', () => {
  it('aplica defaults conservadores sin variables (gate desactivado)', () => {
    const cfg = schedulingConfigFrom({});
    expect(cfg.workerConcurrency).toBe(DEFAULT_WORKER_CONCURRENCY);
    expect(cfg.perWorkspaceConcurrency).toBe(DEFAULT_PER_WORKSPACE_CONCURRENCY);
    expect(cfg.perWorkspaceConcurrency).toBe(0);
    expect(cfg.deferMs).toBe(DEFAULT_DEFER_MS);
  });

  it('lee valores válidos del entorno', () => {
    const cfg = schedulingConfigFrom({
      WORKER_CONCURRENCY: '20',
      WORKER_WORKSPACE_CONCURRENCY: '3',
      WORKER_WORKSPACE_DEFER_MS: '500',
    });
    expect(cfg).toEqual({ workerConcurrency: 20, perWorkspaceConcurrency: 3, deferMs: 500 });
  });

  it('ignora valores inválidos o fuera de rango y cae al default', () => {
    const cfg = schedulingConfigFrom({
      WORKER_CONCURRENCY: '0', // < 1
      WORKER_WORKSPACE_CONCURRENCY: 'x',
      WORKER_WORKSPACE_DEFER_MS: '-5',
    });
    expect(cfg.workerConcurrency).toBe(DEFAULT_WORKER_CONCURRENCY);
    expect(cfg.perWorkspaceConcurrency).toBe(DEFAULT_PER_WORKSPACE_CONCURRENCY);
    expect(cfg.deferMs).toBe(DEFAULT_DEFER_MS);
  });

  it('acepta 0 explícito para la concurrencia por workspace (sin límite)', () => {
    expect(schedulingConfigFrom({ WORKER_WORKSPACE_CONCURRENCY: '0' }).perWorkspaceConcurrency).toBe(0);
  });
});

describe('ConcurrencyGate', () => {
  it('con límite 0 (desactivado) siempre admite y no cuenta', () => {
    const gate = new ConcurrencyGate(() => 0);
    for (let i = 0; i < 100; i++) expect(gate.tryAcquire('ws')).toBe(true);
    expect(gate.current('ws')).toBe(0);
  });

  it('admite hasta el tope por clave y rechaza el excedente', () => {
    const gate = new ConcurrencyGate(() => 2);
    expect(gate.tryAcquire('a')).toBe(true);
    expect(gate.tryAcquire('a')).toBe(true);
    expect(gate.tryAcquire('a')).toBe(false); // en el tope
    expect(gate.current('a')).toBe(2);
  });

  it('aísla el cupo por clave (un inquilino no consume el de otro)', () => {
    const gate = new ConcurrencyGate(() => 1);
    expect(gate.tryAcquire('a')).toBe(true);
    expect(gate.tryAcquire('b')).toBe(true); // otro workspace, cupo propio
    expect(gate.tryAcquire('a')).toBe(false);
  });

  it('libera cupo y permite admitir de nuevo', () => {
    const gate = new ConcurrencyGate(() => 1);
    expect(gate.tryAcquire('a')).toBe(true);
    expect(gate.tryAcquire('a')).toBe(false);
    gate.release('a');
    expect(gate.current('a')).toBe(0);
    expect(gate.tryAcquire('a')).toBe(true);
  });

  it('release nunca baja de cero', () => {
    const gate = new ConcurrencyGate(() => 1);
    gate.release('a');
    gate.release('a');
    expect(gate.current('a')).toBe(0);
  });

  it('respeta un límite dinámico por clave', () => {
    const limits: Record<string, number> = { big: 3, small: 1 };
    const gate = new ConcurrencyGate((k) => limits[k] ?? 0);
    expect(gate.tryAcquire('small')).toBe(true);
    expect(gate.tryAcquire('small')).toBe(false);
    expect(gate.tryAcquire('big')).toBe(true);
    expect(gate.tryAcquire('big')).toBe(true);
    expect(gate.tryAcquire('big')).toBe(true);
    expect(gate.tryAcquire('big')).toBe(false);
  });
});
