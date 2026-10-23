import type { INestApplication } from '@nestjs/common';
import { RetentionService } from '../src/modules/workflows/retention.service';
import { createTestApp, prismaOf } from './utils/app';
import {
  addMember,
  createAgent,
  createUnit,
  LONG_MESSAGE,
  publishAgent,
  records,
  registerOwner,
  rootUnit,
  type Session,
} from './utils/fixtures';
import { RestMock } from './utils/mock-servers';

interface Routine {
  id: string;
  agentId: string;
  agentName: string;
  name: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  notifyWebhookUrl: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  nextRunAt: string | null;
}

interface Run {
  id: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  output: string | null;
  error: string | null;
  costUsd: number;
  startedAt: string;
  finishedAt: string | null;
}

interface Execution {
  id: string;
  status: string;
  trigger: string;
  input: Record<string, unknown>;
  output: unknown;
  error: string | null;
}

type Node = { id: string; type: string; name: string; config: Record<string, unknown> };

const trigger: Node = { id: 'trigger', type: 'trigger', name: 'Inicio', config: {} };

/** Definición lineal: disparador → nodos en orden. */
const chain = (...nodes: Node[]) => ({
  nodes: [trigger, ...nodes],
  edges: nodes.map((n, i) => ({ id: `e${i}`, source: i === 0 ? 'trigger' : nodes[i - 1].id, target: n.id })),
});

const failingNode: Node = {
  id: 'boom',
  type: 'condition',
  name: 'Explota',
  config: { rules: [{ left: 'x', operator: 'regex', right: 'x'.repeat(300) }] },
};

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

describe('Rutinas de agentes y prácticas n8n en flujos (E2E)', () => {
  let app: INestApplication;
  let hooks: RestMock;
  let owner: Session;
  let agentId: string;

  async function createWorkflow(s: Session, name: string, definition: object): Promise<string> {
    const res = await s.api.post('/workflows', { name, definition }).expect(201);
    return (res.body as { id: string }).id;
  }

  async function runWorkflow(s: Session, id: string, input: object = {}): Promise<Execution> {
    const res = await s.api.post(`/workflows/${id}/run`, { input, wait: true }).expect(202);
    return res.body as Execution;
  }

  beforeAll(async () => {
    hooks = await new RestMock().start();
    app = await createTestApp();
    owner = await registerOwner(app, 'rutinas');
    agentId = (await createAgent(owner, { name: 'Agente de rutinas' })).id;
  });

  afterAll(async () => {
    await app?.close();
    await hooks?.stop();
  });

  describe('Rutinas (D5)', () => {
    let routine: Routine;

    it('valida cron de 5 campos y zona horaria IANA', async () => {
      const base = { name: 'Resumen diario', prompt: 'Resume el día' };
      await owner.api.post(`/agents/${agentId}/routines`, { ...base, schedule: '0 8 * *' }).expect(400);
      await owner.api.post(`/agents/${agentId}/routines`, { ...base, schedule: '61 8 * * *' }).expect(400);
      await owner.api
        .post(`/agents/${agentId}/routines`, { ...base, schedule: '0 8 * * *', timezone: 'Marte/Olympus' })
        .expect(400);
      await owner.api.post('/agents/no-existe/routines', { ...base, schedule: '0 8 * * *' }).expect(404);
    });

    it('un VIEWER no puede crear rutinas', async () => {
      const viewer = await addMember(app, owner, { role: 'VIEWER' });
      // Agente privado del OWNER: invisible para el VIEWER (ADR 0007).
      await viewer.api
        .post(`/agents/${agentId}/routines`, { name: 'Prohibida', prompt: 'x', schedule: '0 8 * * *' })
        .expect(404);
      // Agente de la empresa: el VIEWER lo usa, pero gestionar rutinas requiere EDIT.
      const shared = (await createAgent(owner, { name: 'Agente de empresa' })).id;
      await publishAgent(owner, shared);
      await viewer.api.get(`/agents/${shared}/routines`).expect(200);
      await viewer.api
        .post(`/agents/${shared}/routines`, { name: 'Prohibida', prompt: 'x', schedule: '0 8 * * *' })
        .expect(403);
      await viewer.api.get('/routines').expect(200);
    });

    it('crea la rutina programada con su próxima ejecución', async () => {
      const res = await owner.api
        .post(`/agents/${agentId}/routines`, {
          name: 'Resumen diario',
          prompt: 'Resume las ventas del día',
          schedule: '0 8 * * 1-5',
          timezone: 'America/Bogota',
          notifyWebhookUrl: `${hooks.origin}/notify`,
        })
        .expect(201);
      routine = res.body as Routine;
      expect(routine).toMatchObject({
        agentId,
        agentName: 'Agente de rutinas',
        schedule: '0 8 * * 1-5',
        timezone: 'America/Bogota',
        enabled: true,
        lastRunAt: null,
        lastStatus: null,
      });
      expect(routine.nextRunAt).not.toBeNull();
      const next = new Date(routine.nextRunAt!);
      expect(next.getTime()).toBeGreaterThan(Date.now());
      expect(next.getUTCHours()).toBe(13); // 08:00 en Bogotá (UTC-5)
      expect(next.getUTCMinutes()).toBe(0);

      const all = (await owner.api.get('/routines').expect(200)).body as Routine[];
      expect(all.map((r) => r.id)).toContain(routine.id);
      const byAgent = (await owner.api.get(`/agents/${agentId}/routines`).expect(200)).body as Routine[];
      expect(byAgent.map((r) => r.id)).toEqual([routine.id]);
    });

    it('ejecutar ahora devuelve la corrida terminada con salida y costo, y notifica al webhook', async () => {
      const res = await owner.api.post(`/routines/${routine.id}/run`).expect(200);
      const run = res.body as Run;
      expect(run.status).toBe('SUCCEEDED');
      expect(run.error).toBeNull();
      expect(run.output).toBeTruthy();
      expect(run.costUsd).toBeGreaterThan(0);
      expect(run.finishedAt).not.toBeNull();

      const runs = (await owner.api.get(`/routines/${routine.id}/runs`).expect(200)).body as Run[];
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ id: run.id, status: 'SUCCEEDED', costUsd: run.costUsd });

      const updated = (await owner.api.get(`/routines/${routine.id}`).expect(200)).body as Routine;
      expect(updated.lastStatus).toBe('SUCCEEDED');
      expect(updated.lastRunAt).not.toBeNull();

      const notified = hooks.requests.filter((r) => r.path === '/notify');
      expect(notified).toHaveLength(1);
      expect(notified[0].method).toBe('POST');
      expect(notified[0].body).toEqual({
        routineId: routine.id,
        runId: run.id,
        status: 'SUCCEEDED',
        output: run.output,
        error: null,
      });

      const usage = await records(owner);
      expect(usage.find((u) => u.source === 'ROUTINE')).toBeDefined();
    });

    it('deshabilitar quita la programación; eliminar borra la rutina', async () => {
      const res = await owner.api.patch(`/routines/${routine.id}`, { enabled: false }).expect(200);
      expect(res.body).toMatchObject({ enabled: false, nextRunAt: null });
      await owner.api.patch(`/routines/${routine.id}`, { schedule: 'cada día' }).expect(400);
      const reenabled = (await owner.api.patch(`/routines/${routine.id}`, { enabled: true }).expect(200))
        .body as Routine;
      expect(reenabled.nextRunAt).not.toBeNull();

      await owner.api.delete(`/routines/${routine.id}`).expect(200);
      await owner.api.get(`/routines/${routine.id}`).expect(404);
      await owner.api.get(`/routines/${routine.id}/runs`).expect(404);
    });

    it('un presupuesto agotado deja la corrida FAILED con su mensaje', async () => {
      const unit = await createUnit(owner, 'Centro rutinas', (await rootUnit(owner)).id);
      await owner.api
        .put(`/admin/budgets/${unit.id}`, { period: 'MONTHLY', limitUsd: 0.0001, policy: 'BLOCK' })
        .expect(200);
      const agent = await createAgent(owner, { name: 'Agente con presupuesto', costCenterId: unit.id });
      // Las rutinas de un agente PRIVATE se imputan al dueño (ADR 0007 D5); publicado, usan su centro de costo.
      await publishAgent(owner, agent.id);
      const r = (
        await owner.api
          .post(`/agents/${agent.id}/routines`, {
            name: 'Consumo',
            prompt: LONG_MESSAGE,
            schedule: '0 8 * * *',
            enabled: false,
          })
          .expect(201)
      ).body as Routine;
      expect(r.nextRunAt).toBeNull();

      const first = (await owner.api.post(`/routines/${r.id}/run`).expect(200)).body as Run;
      expect(first.status).toBe('SUCCEEDED');
      const second = (await owner.api.post(`/routines/${r.id}/run`).expect(200)).body as Run;
      expect(second.status).toBe('FAILED');
      expect(second.error).toMatch(/Presupuesto/);
      expect(second.costUsd).toBe(0);
      const listed = (await owner.api.get(`/agents/${agent.id}/routines`).expect(200)).body as Routine[];
      expect(listed[0].lastStatus).toBe('FAILED');
    });

    it('aislamiento multi-tenant: otro workspace no ve ni opera rutinas ajenas', async () => {
      const r = (
        await owner.api
          .post(`/agents/${agentId}/routines`, { name: 'Privada', prompt: 'x', schedule: '*/30 * * * *' })
          .expect(201)
      ).body as Routine;
      const other = await registerOwner(app, 'rutinas-b');
      expect(((await other.api.get('/routines').expect(200)).body as Routine[]).map((x) => x.id)).not.toContain(r.id);
      await other.api.get(`/agents/${agentId}/routines`).expect(404);
      await other.api
        .post(`/agents/${agentId}/routines`, { name: 'Intrusa', prompt: 'x', schedule: '0 8 * * *' })
        .expect(404);
      await other.api.get(`/routines/${r.id}`).expect(404);
      await other.api.patch(`/routines/${r.id}`, { enabled: false }).expect(404);
      await other.api.post(`/routines/${r.id}/run`).expect(404);
      await other.api.get(`/routines/${r.id}/runs`).expect(404);
      await other.api.delete(`/routines/${r.id}`).expect(404);
      expect(((await owner.api.get(`/routines/${r.id}`).expect(200)).body as Routine).enabled).toBe(true);
      await owner.api.delete(`/routines/${r.id}`).expect(200);
    });
  });

  describe('Flujos (D6)', () => {
    it('flujo de error: se dispara al fallar, con el contexto del fallo y sin recursión', async () => {
      const handlerId = await createWorkflow(owner, 'Manejador de errores', chain(failingNode));
      const mainId = await createWorkflow(owner, 'Flujo principal', chain(failingNode));

      await owner.api.patch(`/workflows/${mainId}`, { errorWorkflowId: mainId }).expect(400);
      await owner.api.patch(`/workflows/${mainId}`, { errorWorkflowId: 'no-existe' }).expect(400);
      const patched = await owner.api.patch(`/workflows/${mainId}`, { errorWorkflowId: handlerId }).expect(200);
      expect((patched.body as { errorWorkflowId: string }).errorWorkflowId).toBe(handlerId);
      // El manejador apunta de vuelta al principal: un flujo de error nunca dispara otro.
      await owner.api.patch(`/workflows/${handlerId}`, { errorWorkflowId: mainId }).expect(200);

      const failed = await runWorkflow(owner, mainId);
      expect(failed.status).toBe('FAILED');

      const prisma = prismaOf(app);
      let handled: Execution[] = [];
      for (let i = 0; i < 50 && !handled.some((e) => ['SUCCEEDED', 'FAILED'].includes(e.status)); i++) {
        await sleep(100);
        handled = (await prisma.execution.findMany({ where: { workflowId: handlerId } })) as unknown as Execution[];
      }
      expect(handled).toHaveLength(1);
      expect(handled[0].trigger).toBe('MANUAL');
      expect(handled[0].status).toBe('FAILED');
      expect(handled[0].input).toMatchObject({
        workflow: { id: mainId, name: 'Flujo principal' },
        execution: { id: failed.id },
        failedNode: { id: 'boom', name: 'Explota', type: 'condition' },
      });
      expect(String(handled[0].input.error)).toContain('Expresión regular demasiado larga');

      await sleep(500);
      expect(await prisma.execution.count({ where: { workflowId: mainId } })).toBe(1);
      expect(await prisma.execution.count({ where: { workflowId: handlerId } })).toBe(1);

      // Eliminar el manejador limpia la referencia.
      await owner.api.delete(`/workflows/${handlerId}`).expect(200);
      expect(
        ((await owner.api.get(`/workflows/${mainId}`).expect(200)).body as { errorWorkflowId: null }).errorWorkflowId,
      ).toBeNull();
    });

    it('sub-flujo: ejecuta otro flujo en línea y devuelve su salida', async () => {
      const childId = await createWorkflow(
        owner,
        'Hijo',
        chain({ id: 'out', type: 'output', name: 'Salida', config: { output: { saludo: 'Hola {{ input.nombre }}' } } }),
      );
      const parentId = await createWorkflow(
        owner,
        'Padre',
        chain({
          id: 'sub',
          type: 'subworkflow',
          name: 'Llamar hijo',
          config: { workflowId: childId, input: { nombre: '{{ input.usuario }}' } },
        }),
      );
      const ex = await runWorkflow(owner, parentId, { usuario: 'Ana' });
      expect(ex.error).toBeNull();
      expect(ex.status).toBe('SUCCEEDED');
      expect(ex.output).toEqual({ saludo: 'Hola Ana' });

      // Un flujo de otro workspace no es alcanzable como sub-flujo.
      const other = await registerOwner(app, 'sub-b');
      const foreign = await createWorkflow(
        other,
        'Ajeno',
        chain({ id: 'sub', type: 'subworkflow', name: 'Hijo ajeno', config: { workflowId: childId } }),
      );
      const denied = await runWorkflow(other, foreign);
      expect(denied.status).toBe('FAILED');
      expect(denied.error).toContain('Sub-flujo no encontrado');
    });

    it('sub-flujo recursivo se corta en la profundidad máxima', async () => {
      const selfId = await createWorkflow(owner, 'Recursivo', chain());
      await owner.api
        .patch(`/workflows/${selfId}`, {
          definition: chain({ id: 'sub', type: 'subworkflow', name: 'Yo', config: { workflowId: selfId } }),
        })
        .expect(200);
      const ex = await runWorkflow(owner, selfId);
      expect(ex.status).toBe('FAILED');
      expect(ex.error).toContain('profundidad máxima');
    });

    it('bucle con 3 elementos: ejecuta el sub-flujo por elemento y devuelve { results, count }', async () => {
      const itemId = await createWorkflow(
        owner,
        'Por elemento',
        chain({
          id: 'out',
          type: 'output',
          name: 'Salida',
          config: { output: { nombre: '{{ input.item.nombre | upper }}', posicion: '{{ input.index }}' } },
        }),
      );
      const loopId = await createWorkflow(
        owner,
        'Bucle',
        chain({
          id: 'loop',
          type: 'loop',
          name: 'Cada cliente',
          config: { items: '{{ input.clientes }}', workflowId: itemId, concurrency: 2 },
        }),
      );
      const ex = await runWorkflow(owner, loopId, { clientes: [{ nombre: 'a' }, { nombre: 'b' }, { nombre: 'c' }] });
      expect(ex.error).toBeNull();
      expect(ex.output).toEqual({
        results: [
          { nombre: 'A', posicion: 0 },
          { nombre: 'B', posicion: 1 },
          { nombre: 'C', posicion: 2 },
        ],
        count: 3,
      });

      const bad = await runWorkflow(owner, loopId, { clientes: 'no es arreglo' });
      expect(bad.status).toBe('FAILED');
      expect(bad.error).toContain('arreglo');
    });

    it('versiones: guarda la definición anterior y restaurar crea una versión nueva', async () => {
      const v1 = chain({ id: 'out', type: 'output', name: 'Salida', config: { output: 'v1' } });
      const v2 = chain(
        { id: 't2', type: 'transform', name: 'T', config: { output: { x: 1 } } },
        { id: 'out', type: 'output', name: 'Salida', config: { output: 'v2' } },
      );
      const id = await createWorkflow(owner, 'Versionado', v1);
      const updated = await owner.api.patch(`/workflows/${id}`, { definition: v2 }).expect(200);
      expect((updated.body as { version: number }).version).toBe(2);
      // Renombrar o reenviar la misma definición no crea versiones.
      await owner.api.patch(`/workflows/${id}`, { name: 'Versionado bis', definition: v2 }).expect(200);

      let versions = (await owner.api.get(`/workflows/${id}/versions`).expect(200)).body as {
        version: number;
        nodeCount: number;
        current: boolean;
        createdAt: string;
      }[];
      expect(versions.map((v) => [v.version, v.nodeCount, v.current])).toEqual([
        [2, 3, true],
        [1, 2, false],
      ]);
      const old = (await owner.api.get(`/workflows/${id}/versions/1`).expect(200)).body as { definition: unknown };
      expect(old.definition).toEqual(v1);

      await owner.api.post(`/workflows/${id}/versions/2/restore`).expect(400);
      await owner.api.post(`/workflows/${id}/versions/9/restore`).expect(404);
      const restored = (await owner.api.post(`/workflows/${id}/versions/1/restore`).expect(200)).body as {
        version: number;
        definition: unknown;
      };
      expect(restored.version).toBe(3);
      expect(restored.definition).toEqual(v1);
      versions = (await owner.api.get(`/workflows/${id}/versions`).expect(200)).body as typeof versions;
      expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
      expect((await runWorkflow(owner, id)).output).toBe('v1');

      const other = await registerOwner(app, 'versiones-b');
      await other.api.get(`/workflows/${id}/versions`).expect(404);
      await other.api.post(`/workflows/${id}/versions/1/restore`).expect(404);
    });

    it('probar un nodo con datos fijados (pinned)', async () => {
      const id = await createWorkflow(
        owner,
        'Probar nodo',
        chain(
          { id: 'http', type: 'transform', name: 'Origen', config: { output: { total: 1 } } },
          {
            id: 'calc',
            type: 'transform',
            name: 'Cálculo',
            config: { output: { cliente: '{{ input.cliente }}', total: '{{ nodes.http.output.total }}' } },
          },
          failingNode,
        ),
      );
      const ok = await owner.api
        .post(`/workflows/${id}/nodes/calc/test`, { input: { cliente: 'ACME' }, pinned: { http: { total: 99 } } })
        .expect(200);
      expect(ok.body).toMatchObject({ ok: true, output: { cliente: 'ACME', total: 99 }, error: null });
      expect(typeof (ok.body as { durationMs: number }).durationMs).toBe('number');

      const ko = await owner.api.post(`/workflows/${id}/nodes/boom/test`, {}).expect(200);
      expect(ko.body).toMatchObject({ ok: false, output: null });
      expect((ko.body as { error: string }).error).toContain('Expresión regular');

      await owner.api.post(`/workflows/${id}/nodes/no-existe/test`, {}).expect(404);
      expect(await prismaOf(app).execution.count({ where: { workflowId: id } })).toBe(0);
    });

    it('retención: borra ejecuciones terminadas y corridas de rutinas antiguas', async () => {
      const prisma = prismaOf(app);
      const id = await createWorkflow(owner, 'Retención', chain());
      const old = new Date(Date.now() - 40 * 24 * 3600_000);
      const [stale, running, recent] = await Promise.all([
        prisma.execution.create({
          data: {
            workflowId: id,
            workspaceId: owner.workspaceId,
            status: 'SUCCEEDED',
            createdAt: old,
            finishedAt: old,
          },
        }),
        prisma.execution.create({
          data: { workflowId: id, workspaceId: owner.workspaceId, status: 'RUNNING', createdAt: old },
        }),
        prisma.execution.create({ data: { workflowId: id, workspaceId: owner.workspaceId, status: 'FAILED' } }),
      ]);
      const r = (
        await owner.api
          .post(`/agents/${agentId}/routines`, {
            name: 'Retención',
            prompt: 'x',
            schedule: '0 8 * * *',
            enabled: false,
          })
          .expect(201)
      ).body as Routine;
      const [oldRun, newRun] = await Promise.all([
        prisma.routineRun.create({ data: { routineId: r.id, status: 'SUCCEEDED', startedAt: old, finishedAt: old } }),
        prisma.routineRun.create({ data: { routineId: r.id, status: 'SUCCEEDED' } }),
      ]);

      const retention = app.get(RetentionService);
      expect(retention.retentionDays).toBe(30);
      const result = await retention.purge(new Date(), owner.workspaceId);
      expect(result).toMatchObject({ executions: 1, routineRuns: 1 });

      const left = (await prisma.execution.findMany({ where: { workflowId: id }, select: { id: true } })).map(
        (e) => e.id,
      );
      expect(left).not.toContain(stale.id);
      expect(left).toEqual(expect.arrayContaining([running.id, recent.id]));
      const runs = (await prisma.routineRun.findMany({ where: { routineId: r.id }, select: { id: true } })).map(
        (x) => x.id,
      );
      expect(runs).toEqual([newRun.id]);
      expect(runs).not.toContain(oldRun.id);
    });
  });
});
