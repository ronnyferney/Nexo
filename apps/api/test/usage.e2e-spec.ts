import type { INestApplication } from '@nestjs/common';
import { createTestApp, prismaOf } from './utils/app';
import {
  addMember,
  chat,
  createAgent,
  publishAgent,
  createUnit,
  records,
  registerOwner,
  rootUnit,
  summary,
  type ChatResult,
  type Session,
} from './utils/fixtures';

/** Tarifa simulada de mock-echo: 1 USD/MTok entrada, 2 USD/MTok salida. */
const mockEchoCost = (u: ChatResult['usage']) => (u.inputTokens * 1 + u.outputTokens * 2) / 1_000_000;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const todayUtc = () => new Date().toISOString().slice(0, 10);

describe('Gobierno de IA · medición, centro de costo y modelos permitidos (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('Medición del consumo', () => {
    let owner: Session;
    let editor: Session;
    let unitId: string;
    let agentId: string;
    let results: ChatResult[];

    beforeAll(async () => {
      owner = await registerOwner(app, 'medicion');
      const root = await rootUnit(owner);
      unitId = (await createUnit(owner, 'Ventas', root.id)).id;
      editor = await addMember(app, owner, { role: 'EDITOR', orgUnitId: unitId });
      agentId = (await createAgent(owner, { name: 'Asistente de ventas' })).id;
      await publishAgent(owner, agentId); // el EDITOR conversa con un agente de la empresa (ADR 0007)
      results = [await chat(editor, agentId, 'Hola'), await chat(editor, agentId, 'Necesito una cotización')];
    });

    it('el chat con el agente mock informa modelo, proveedor y costo según la tarifa', () => {
      for (const r of results) {
        expect(r).toMatchObject({ providerId: 'mock', model: 'mock-echo', turns: 1 });
        expect(r.usage.inputTokens).toBeGreaterThan(0);
        expect(r.usage.outputTokens).toBeGreaterThan(0);
        expect(r.usage.costUsd).toBeCloseTo(mockEchoCost(r.usage), 10);
      }
    });

    it('registra cada llamada imputada a la unidad del usuario, sin contenido de la conversación', async () => {
      const items = await records(owner);
      expect(items).toHaveLength(2);
      for (const item of items) {
        expect(item).toMatchObject({
          source: 'CHAT',
          model: 'mock-echo',
          providerId: 'mock',
          orgUnitName: 'Ventas',
          userName: 'Miembro EDITOR',
          agentName: 'Asistente de ventas',
        });
      }
      expect(sum(items.map((i) => i.costUsd))).toBeCloseTo(sum(results.map((r) => r.usage.costUsd)), 8);

      const rows = await prismaOf(app).usageRecord.findMany({ where: { workspaceId: owner.workspaceId } });
      expect(rows.every((r) => r.orgUnitId === unitId && r.userId === editor.userId && r.agentId === agentId)).toBe(
        true,
      );
      expect(rows.every((r) => r.conversationId === null || typeof r.conversationId === 'string')).toBe(true);
      expect(JSON.stringify(rows)).not.toContain('cotización');
    });

    it('expone la traza de enrutamiento (rol/razón) por registro; null sin política (ADR 0010 D5)', async () => {
      const items = await records(owner);
      expect(items).toHaveLength(2);
      // El agente mock no tiene política de enrutamiento: la traza queda en null, retrocompatible.
      for (const item of items) {
        expect(item).toHaveProperty('routingReason', null);
        expect(item).toHaveProperty('role', null);
      }
    });

    it('/admin/usage/summary admite agrupar por role y routingReason sin romper el contrato', async () => {
      const total = sum(results.map((r) => r.usage.costUsd));
      for (const groupBy of ['role', 'routingReason']) {
        const s = await summary(owner, groupBy);
        expect(s.totalCostUsd).toBeCloseTo(total, 8);
        expect(s.calls).toBe(2);
        // Sin enrutamiento todo cae en un único grupo "Sin asignar" (clave null → etiqueta por defecto).
        expect(s.groups).toHaveLength(1);
        expect(s.groups[0]).toMatchObject({ key: '', label: 'Sin asignar', calls: 2 });
      }
    });

    it('/me/usage cuadra con el costo devuelto por el chat', async () => {
      const total = sum(results.map((r) => r.usage.costUsd));
      const me = (await editor.api.get('/me/usage').expect(200)).body as {
        orgUnit: { id: string; name: string };
        budgets: unknown[];
        me: { costUsd: number; calls: number; inputTokens: number; outputTokens: number; since: string };
      };
      expect(me.orgUnit).toEqual({ id: unitId, name: 'Ventas' });
      expect(me.budgets).toEqual([]);
      expect(me.me.calls).toBe(2);
      expect(me.me.costUsd).toBeCloseTo(total, 8);
      expect(me.me.inputTokens).toBe(sum(results.map((r) => r.usage.inputTokens)));
      expect(me.me.outputTokens).toBe(sum(results.map((r) => r.usage.outputTokens)));
      expect(new Date(me.me.since).getUTCDate()).toBe(1);

      const ownerMe = (await owner.api.get('/me/usage').expect(200)).body as { me: { calls: number; costUsd: number } };
      expect(ownerMe.me).toMatchObject({ calls: 0, costUsd: 0 });
    });

    it.each(['orgUnit', 'model', 'agent', 'user', 'day'])(
      '/admin/usage/summary agrupado por %s cuadra con el costo del chat',
      async (groupBy) => {
        const total = sum(results.map((r) => r.usage.costUsd));
        const s = await summary(owner, groupBy);
        expect(s.totalCostUsd).toBeCloseTo(total, 8);
        expect(s.calls).toBe(2);
        expect(s.inputTokens).toBe(sum(results.map((r) => r.usage.inputTokens)));
        expect(s.outputTokens).toBe(sum(results.map((r) => r.usage.outputTokens)));
        expect(s.groups).toHaveLength(1);
        expect(s.groups[0].costUsd).toBeCloseTo(total, 8);
        expect(s.groups[0].calls).toBe(2);
        const expected = {
          orgUnit: { key: unitId, label: 'Ventas' },
          model: { key: 'mock-echo', label: 'mock-echo' },
          agent: { key: agentId, label: 'Asistente de ventas' },
          user: { key: editor.userId, label: 'Miembro EDITOR' },
          day: { key: todayUtc(), label: todayUtc() },
        }[groupBy];
        expect(s.groups[0]).toMatchObject(expected!);
      },
    );

    it('el resumen respeta el rango de fechas y valida groupBy', async () => {
      const past = (
        await owner.api.get('/admin/usage/summary?from=2020-01-01T00:00:00Z&to=2020-02-01T00:00:00Z').expect(200)
      ).body as { totalCostUsd: number; calls: number; groups: unknown[] };
      expect(past).toMatchObject({ totalCostUsd: 0, calls: 0, groups: [] });
      await owner.api.get('/admin/usage/summary?groupBy=planeta').expect(400);
      await owner.api.get('/admin/usage/summary?from=ayer').expect(400);
    });

    it('la paginación de registros devuelve nextCursor', async () => {
      const page1 = (await owner.api.get('/admin/usage/records?take=1').expect(200)).body as {
        items: { id: string }[];
        nextCursor: string | null;
      };
      expect(page1.items).toHaveLength(1);
      expect(page1.nextCursor).toBe(page1.items[0].id);
      const page2 = (await owner.api.get(`/admin/usage/records?take=1&cursor=${page1.nextCursor}`).expect(200))
        .body as { items: { id: string }[]; nextCursor: string | null };
      expect(page2.items).toHaveLength(1);
      expect(page2.items[0].id).not.toBe(page1.items[0].id);
      expect(page2.nextCursor).toBeNull();
    });
  });

  describe('Centro de costo en flujos', () => {
    let owner: Session;
    let rootId: string;

    beforeAll(async () => {
      owner = await registerOwner(app, 'centro-costo');
      rootId = (await rootUnit(owner)).id;
    });

    async function runAgentWorkflow(agentId: string) {
      const wf = await owner.api
        .post('/workflows', {
          name: 'Flujo con agente',
          definition: {
            nodes: [
              { id: 'trigger', type: 'trigger', name: 'Inicio', config: {} },
              { id: 'ia', type: 'agent', name: 'IA', config: { agentId, message: 'Resume {{ input.tema }}' } },
            ],
            edges: [{ id: 'e1', source: 'trigger', target: 'ia' }],
          },
        })
        .expect(201);
      const wfId = (wf.body as { id: string }).id;
      const run = await owner.api.post(`/workflows/${wfId}/run`, { input: { tema: 'ventas' }, wait: true }).expect(202);
      return { workflowId: wfId, execution: run.body as { id: string; status: string; error: string | null } };
    }

    it('un agente con costCenterId ejecutado desde un flujo imputa el consumo a esa unidad con source WORKFLOW', async () => {
      const unit = await createUnit(owner, 'Centro IA', rootId);
      const agent = await createAgent(owner, { name: 'Agente de flujo', costCenterId: unit.id });
      expect(agent.costCenterId).toBe(unit.id);

      const { workflowId, execution } = await runAgentWorkflow(agent.id);
      expect(execution.error).toBeNull();
      expect(execution.status).toBe('SUCCEEDED');

      const items = await records(owner);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        source: 'WORKFLOW',
        orgUnitName: 'Centro IA',
        userName: null,
        agentName: 'Agente de flujo',
        model: 'mock-echo',
      });

      const [row] = await prismaOf(app).usageRecord.findMany({ where: { workspaceId: owner.workspaceId } });
      expect(row).toMatchObject({ orgUnitId: unit.id, workflowId, executionId: execution.id, userId: null });

      const byUnit = await summary(owner, 'orgUnit');
      expect(byUnit.groups).toEqual([expect.objectContaining({ key: unit.id, label: 'Centro IA', calls: 1 })]);
    });

    it('un agente sin centro de costo ejecutado desde un flujo imputa a la raíz', async () => {
      const agent = await createAgent(owner, { name: 'Agente sin centro' });
      const { execution } = await runAgentWorkflow(agent.id);
      expect(execution.status).toBe('SUCCEEDED');
      const rows = await prismaOf(app).usageRecord.findMany({
        where: { workspaceId: owner.workspaceId, agentId: agent.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ orgUnitId: rootId, source: 'WORKFLOW' });
    });

    it('el chat de un usuario imputa a su unidad aunque el agente tenga centro de costo', async () => {
      const unit = await createUnit(owner, 'Centro Chat', rootId);
      const agent = await createAgent(owner, { name: 'Agente con centro', costCenterId: unit.id });
      await chat(owner, agent.id);
      const rows = await prismaOf(app).usageRecord.findMany({
        where: { workspaceId: owner.workspaceId, agentId: agent.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ orgUnitId: rootId, source: 'CHAT', userId: owner.userId });
    });

    it('costCenterId se puede cambiar y quitar; una unidad inexistente responde 404', async () => {
      const unit = await createUnit(owner, 'Centro B', rootId);
      const agent = await createAgent(owner);
      const updated = await owner.api.patch(`/agents/${agent.id}`, { costCenterId: unit.id }).expect(200);
      expect(updated.body).toMatchObject({ costCenterId: unit.id });
      await owner.api.patch(`/agents/${agent.id}`, { costCenterId: 'no-existe' }).expect(404);
      await owner.api
        .post('/agents', { name: 'Mal centro', provider: 'mock', model: 'mock-echo', costCenterId: 'x' })
        .expect(404);
      const cleared = await owner.api.patch(`/agents/${agent.id}`, { costCenterId: null }).expect(200);
      expect(cleared.body).toMatchObject({ costCenterId: null });
    });
  });

  describe('Restricción de modelos', () => {
    let owner: Session;
    let rootId: string;
    let agentId: string;

    beforeAll(async () => {
      owner = await registerOwner(app, 'modelos');
      rootId = (await rootUnit(owner)).id;
      agentId = (await createAgent(owner)).id;
      await publishAgent(owner, agentId); // miembros de otras unidades conversan con él (ADR 0007)
    });

    afterEach(async () => {
      await owner.api.patch(`/admin/org/units/${rootId}`, { allowedModels: [] }).expect(200);
    });

    it('allowedModels en la raíz que no incluye el modelo del agente responde 403; vaciarlo restablece', async () => {
      await owner.api
        .patch(`/admin/org/units/${rootId}`, { allowedModels: ['anthropic:claude-haiku-5-5'] })
        .expect(200);
      const denied = await owner.api.post(`/agents/${agentId}/chat`, { message: 'hola' }).expect(403);
      expect((denied.body as { message: string }).message).toContain('mock-echo');
      expect(await records(owner)).toHaveLength(0);

      await owner.api.patch(`/admin/org/units/${rootId}`, { allowedModels: [] }).expect(200);
      await chat(owner, agentId);
    });

    it('si la lista incluye "<proveedor>:<modelo>" del agente la ejecución se permite', async () => {
      await owner.api
        .patch(`/admin/org/units/${rootId}`, { allowedModels: ['anthropic:claude-haiku-5-5', 'mock:mock-echo'] })
        .expect(200);
      await chat(owner, agentId);
      // El id del modelo sin proveedor no basta.
      await owner.api.patch(`/admin/org/units/${rootId}`, { allowedModels: ['mock-echo'] }).expect(200);
      await owner.api.post(`/agents/${agentId}/chat`, { message: 'hola' }).expect(403);
    });

    it('la restricción de un ancestro se aplica a los usuarios de sus subunidades, no a las unidades hermanas', async () => {
      const a = await createUnit(owner, 'Restringida', rootId);
      const b = await createUnit(owner, 'Equipo restringido', a.id);
      const sibling = await createUnit(owner, 'Libre', rootId);
      const inB = await addMember(app, owner, { role: 'EDITOR', orgUnitId: b.id });
      const inSibling = await addMember(app, owner, { role: 'EDITOR', orgUnitId: sibling.id });
      await owner.api.patch(`/admin/org/units/${a.id}`, { allowedModels: ['anthropic:claude-haiku-5-5'] }).expect(200);

      await inB.api.post(`/agents/${agentId}/chat`, { message: 'hola' }).expect(403);
      await chat(inSibling, agentId);
      await chat(owner, agentId);
    });

    it('la restricción también aplica a ejecuciones desde flujos', async () => {
      await owner.api
        .patch(`/admin/org/units/${rootId}`, { allowedModels: ['anthropic:claude-haiku-5-5'] })
        .expect(200);
      const wf = await owner.api
        .post('/workflows', {
          name: 'Flujo restringido',
          definition: {
            nodes: [
              { id: 'trigger', type: 'trigger', name: 'Inicio', config: {} },
              { id: 'ia', type: 'agent', name: 'IA', config: { agentId } },
            ],
            edges: [{ id: 'e1', source: 'trigger', target: 'ia' }],
          },
        })
        .expect(201);
      const run = await owner.api.post(`/workflows/${(wf.body as { id: string }).id}/run`, { wait: true }).expect(202);
      expect(run.body).toMatchObject({ status: 'FAILED' });
      expect(JSON.stringify(run.body)).toContain('no está permitido');
    });
  });
});
