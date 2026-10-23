import type { INestApplication } from '@nestjs/common';
import { createTestApp, prismaOf } from './utils/app';
import {
  addMember,
  chat,
  createAgent,
  publishAgent,
  createUnit,
  LONG_MESSAGE,
  records,
  registerOwner,
  rootUnit,
  summary,
  type Session,
} from './utils/fixtures';
import { DEFAULT_REPLY_USAGE, OpenAiMock } from './utils/mock-servers';

const monthKey = () => new Date().toISOString().slice(0, 7);
const quarterKey = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
};

interface Alert {
  orgUnitId: string;
  orgUnitName: string;
  periodKey: string;
  threshold: number;
  spentUsd: number;
  limitUsd: number;
}

interface BudgetRow {
  orgUnitId: string;
  orgUnitName: string;
  parentId: string | null;
  budget: null | {
    period: string;
    limitUsd: number;
    policy: string;
    alertThresholds: number[];
    downgradeProviderId: string | null;
    downgradeModel: string | null;
  };
  periodKey: string | null;
  spentUsd: number;
  pct: number | null;
}

async function alertsOf(s: Session, orgUnitId?: string): Promise<Alert[]> {
  const all = (await s.api.get('/admin/alerts').expect(200)).body as Alert[];
  return orgUnitId ? all.filter((a) => a.orgUnitId === orgUnitId) : all;
}

async function budgetRow(s: Session, orgUnitId: string): Promise<BudgetRow> {
  const rows = (await s.api.get('/admin/budgets').expect(200)).body as BudgetRow[];
  return rows.find((r) => r.orgUnitId === orgUnitId)!;
}

describe('Gobierno de IA · presupuestos jerárquicos y políticas (E2E)', () => {
  let app: INestApplication;
  let llm: OpenAiMock;

  beforeAll(async () => {
    llm = await new OpenAiMock().start();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
    await llm?.stop();
  });

  describe('Política BLOCK en un ancestro', () => {
    let owner: Session;
    let editor: Session;
    let rootId: string;
    let directionId: string;
    let teamId: string;
    let agentId: string;
    let firstCost: number;

    beforeAll(async () => {
      owner = await registerOwner(app, 'block');
      rootId = (await rootUnit(owner)).id;
      directionId = (await createUnit(owner, 'Dirección', rootId)).id;
      teamId = (await createUnit(owner, 'Equipo', directionId)).id;
      editor = await addMember(app, owner, { role: 'EDITOR', orgUnitId: teamId });
      agentId = (await createAgent(owner)).id;
      await publishAgent(owner, agentId); // el EDITOR conversa con un agente de la empresa (ADR 0007)
    });

    it('crea el presupuesto con umbrales por defecto y sin gasto', async () => {
      const res = await owner.api
        .put(`/admin/budgets/${directionId}`, { period: 'MONTHLY', limitUsd: 0.0001, policy: 'BLOCK' })
        .expect(200);
      expect(res.body).toMatchObject({
        orgUnitId: directionId,
        orgUnitName: 'Dirección',
        parentId: rootId,
        budget: { period: 'MONTHLY', limitUsd: 0.0001, policy: 'BLOCK', alertThresholds: [50, 80, 100] },
        periodKey: monthKey(),
        spentUsd: 0,
        pct: 0,
      });
      expect(await budgetRow(owner, teamId)).toMatchObject({ budget: null, periodKey: null, pct: null });
    });

    it('con saldo en la cadena el chat se ejecuta y descuenta de la unidad y de todos sus ancestros', async () => {
      const r = await chat(editor, agentId, LONG_MESSAGE);
      firstCost = r.usage.costUsd;
      expect(firstCost).toBeGreaterThan(0.0001);

      const direction = await budgetRow(owner, directionId);
      expect(direction.spentUsd).toBeCloseTo(firstCost, 8);
      expect(direction.pct).toBeGreaterThanOrEqual(100);

      const ledger = await prismaOf(app).budgetLedger.findMany({
        where: { orgUnitId: { in: [rootId, directionId, teamId] }, periodKey: monthKey() },
      });
      expect(ledger).toHaveLength(3);
      for (const row of ledger) expect(Number(row.spentUsd)).toBeCloseTo(firstCost, 8);
    });

    it('agotado el presupuesto del ancestro, el chat responde 402 y no registra consumo', async () => {
      const res = await editor.api.post(`/agents/${agentId}/chat`, { message: 'otra pregunta' }).expect(402);
      expect(res.body).toMatchObject({ statusCode: 402 });
      expect((res.body as { message: string }).message).toContain('Dirección');
      expect((res.body as { message: string }).message).toContain(monthKey());
      expect(await records(owner)).toHaveLength(1);
    });

    it('en modo stream llega un evento SSE error en lugar de done', async () => {
      const { status, events } = await editor.api.sse(`/agents/${agentId}/chat`, { message: 'hola', stream: true });
      expect(status).toBe(200);
      const names = events.map((e) => e.event);
      expect(names).toContain('error');
      expect(names).not.toContain('done');
      const error = events.find((e) => e.event === 'error')!;
      expect(String(error.data.message)).toMatch(/Presupuesto de IA agotado/);
      expect(await records(owner)).toHaveLength(1);
    });

    it('se generan alertas únicas por umbral para la unidad presupuestada', async () => {
      const alerts = await alertsOf(owner, directionId);
      expect(alerts.map((a) => a.threshold).sort((a, b) => a - b)).toEqual([50, 80, 100]);
      for (const a of alerts) {
        expect(a).toMatchObject({ orgUnitName: 'Dirección', periodKey: monthKey(), limitUsd: 0.0001 });
        expect(a.spentUsd).toBeCloseTo(firstCost, 8);
      }
      expect(await alertsOf(owner, teamId)).toEqual([]);
    });

    it('/me/usage muestra la cadena con el presupuesto agotado', async () => {
      const me = (await editor.api.get('/me/usage').expect(200)).body as {
        orgUnit: { id: string };
        budgets: {
          orgUnitId: string;
          policy: string;
          pct: number;
          spentUsd: number;
          limitUsd: number;
          period: string;
        }[];
      };
      expect(me.orgUnit.id).toBe(teamId);
      expect(me.budgets).toHaveLength(1);
      expect(me.budgets[0]).toMatchObject({
        orgUnitId: directionId,
        policy: 'BLOCK',
        limitUsd: 0.0001,
        period: 'MONTHLY',
      });
      expect(me.budgets[0].pct).toBeGreaterThanOrEqual(100);
    });

    it('un usuario de la raíz (fuera de la rama) no queda bloqueado por el presupuesto de la subunidad', async () => {
      await chat(owner, agentId);
    });

    it('un presupuesto creado sobre gasto existente genera alertas de inmediato', async () => {
      expect(await alertsOf(owner, rootId)).toEqual([]);
      const res = await owner.api
        .put(`/admin/budgets/${rootId}`, {
          period: 'MONTHLY',
          limitUsd: 0.0002,
          policy: 'ALERT_ONLY',
          alertThresholds: [100, 50, 50],
        })
        .expect(200);
      expect((res.body as BudgetRow).budget?.alertThresholds).toEqual([50, 100]);
      const alerts = await alertsOf(owner, rootId);
      expect(alerts.map((a) => a.threshold).sort((a, b) => a - b)).toEqual([50, 100]);
    });

    it('un presupuesto trimestral creado a mitad de periodo ve el gasto ya acumulado', async () => {
      const res = await owner.api
        .put(`/admin/budgets/${teamId}`, { period: 'QUARTERLY', limitUsd: 1, policy: 'BLOCK' })
        .expect(200);
      expect(res.body).toMatchObject({ periodKey: quarterKey() });
      expect((res.body as BudgetRow).spentUsd).toBeCloseTo(firstCost, 8);
      await owner.api.delete(`/admin/budgets/${teamId}`).expect(200);
    });

    it('subir el límite o eliminar el presupuesto restablece la ejecución sin duplicar alertas', async () => {
      await owner.api
        .put(`/admin/budgets/${directionId}`, { period: 'MONTHLY', limitUsd: 50, policy: 'BLOCK' })
        .expect(200);
      await chat(editor, agentId);
      await owner.api
        .put(`/admin/budgets/${directionId}`, { period: 'MONTHLY', limitUsd: 0, policy: 'BLOCK' })
        .expect(200);
      await editor.api.post(`/agents/${agentId}/chat`, { message: 'hola' }).expect(402);
      await owner.api.delete(`/admin/budgets/${directionId}`).expect(200);
      await chat(editor, agentId);
      expect(await budgetRow(owner, directionId)).toMatchObject({ budget: null });
      expect((await alertsOf(owner, directionId)).length).toBe(3);
    });

    it('valida el cuerpo del presupuesto', async () => {
      await owner.api.put(`/admin/budgets/${teamId}`, { period: 'WEEKLY', limitUsd: 1, policy: 'BLOCK' }).expect(400);
      await owner.api.put(`/admin/budgets/${teamId}`, { period: 'MONTHLY', limitUsd: -1, policy: 'BLOCK' }).expect(400);
      await owner.api.put(`/admin/budgets/${teamId}`, { period: 'MONTHLY', limitUsd: 1, policy: 'PANIC' }).expect(400);
      await owner.api
        .put(`/admin/budgets/${teamId}`, { period: 'MONTHLY', limitUsd: 1, policy: 'BLOCK', alertThresholds: [0] })
        .expect(400);
      await owner.api.put('/admin/budgets/no-existe', { period: 'MONTHLY', limitUsd: 1, policy: 'BLOCK' }).expect(404);
    });

    it('el límite se conserva con la precisión enviada', async () => {
      const res = await owner.api
        .put(`/admin/budgets/${teamId}`, { period: 'MONTHLY', limitUsd: 0.00005, policy: 'BLOCK' })
        .expect(200);
      await owner.api.delete(`/admin/budgets/${teamId}`).expect(200);
      expect((res.body as BudgetRow).budget?.limitUsd).toBe(0.00005);
    });
  });

  describe('Política DOWNGRADE y ALERT_ONLY', () => {
    const channel = 'downgrade';
    let owner: Session;
    let editor: Session;
    let rootId: string;
    let unitId: string;
    let agentId: string;
    let connectionId: string;

    beforeAll(async () => {
      owner = await registerOwner(app, 'downgrade');
      rootId = (await rootUnit(owner)).id;
      unitId = (await createUnit(owner, 'Soporte', rootId)).id;
      editor = await addMember(app, owner, { role: 'EDITOR', orgUnitId: unitId });
      agentId = (await createAgent(owner, { name: 'Agente premium' })).id;
      await publishAgent(owner, agentId);
      const conn = await owner.api
        .post('/admin/llm/connections', {
          name: 'Económico local',
          kind: 'OPENAI_COMPATIBLE',
          baseUrl: llm.baseUrl(channel),
          apiKey: llm.apiKey,
        })
        .expect(201);
      connectionId = (conn.body as { id: string }).id;
      await owner.api
        .post(`/admin/llm/connections/${connectionId}/models`, {
          modelId: 'eco-mini',
          label: 'Eco Mini',
          tier: 'ECONOMY',
          inputUsdPerMTok: 0.5,
          outputUsdPerMTok: 1.5,
        })
        .expect(201);
      await owner.api
        .put(`/admin/budgets/${unitId}`, {
          period: 'MONTHLY',
          limitUsd: 0.0001,
          policy: 'DOWNGRADE',
          downgradeProviderId: connectionId,
          downgradeModel: 'eco-mini',
        })
        .expect(200);
    });

    it('con saldo usa el modelo original', async () => {
      const r = await chat(editor, agentId, LONG_MESSAGE);
      expect(r).toMatchObject({ providerId: 'mock', model: 'mock-echo' });
      expect(llm.chatRequests(channel)).toHaveLength(0);
    });

    it('agotado el presupuesto la ejecución usa el modelo degradado y registra su tarifa', async () => {
      const r = await chat(editor, agentId, 'Pregunta tras agotar');
      expect(r).toMatchObject({ providerId: connectionId, model: 'eco-mini', text: 'Respuesta simulada' });
      const expectedCost =
        (DEFAULT_REPLY_USAGE.prompt_tokens * 0.5 + DEFAULT_REPLY_USAGE.completion_tokens * 1.5) / 1e6;
      expect(r.usage).toMatchObject({
        inputTokens: DEFAULT_REPLY_USAGE.prompt_tokens,
        outputTokens: DEFAULT_REPLY_USAGE.completion_tokens,
      });
      expect(r.usage.costUsd).toBeCloseTo(expectedCost, 10);

      const [req] = llm.chatRequests(channel);
      expect(req.headers.authorization).toBe(`Bearer ${llm.apiKey}`);
      expect(req.body).toMatchObject({ model: 'eco-mini' });
      expect((req.body.messages as unknown[]).at(-1)).toEqual({ role: 'user', content: 'Pregunta tras agotar' });

      const [latest] = await records(owner);
      expect(latest).toMatchObject({ model: 'eco-mini', providerId: connectionId, orgUnitName: 'Soporte' });
      expect(latest.costUsd).toBeCloseTo(expectedCost, 8);

      const byModel = await summary(owner, 'model');
      expect(byModel.groups.map((g) => g.key).sort()).toEqual(['eco-mini', 'mock-echo']);
      expect(byModel.groups.find((g) => g.key === 'eco-mini')?.costUsd).toBeCloseTo(expectedCost, 8);
    });

    it('en modo stream emite notice con la degradación y done con el modelo económico', async () => {
      const { events } = await editor.api.sse(`/agents/${agentId}/chat`, { message: 'hola', stream: true });
      const notice = events.find((e) => e.event === 'notice');
      expect(String(notice?.data.message)).toContain('eco-mini');
      const done = events.find((e) => e.event === 'done');
      expect(done?.data).toMatchObject({ model: 'eco-mini', providerId: connectionId });
      expect(done?.data.usage.costUsd).toBeGreaterThan(0);
    });

    it('DOWNGRADE sin modelo configurado responde 402', async () => {
      const unit = await createUnit(owner, 'Sin degradación', rootId);
      const m = await addMember(app, owner, { role: 'EDITOR', orgUnitId: unit.id });
      await owner.api
        .put(`/admin/budgets/${unit.id}`, { period: 'MONTHLY', limitUsd: 0, policy: 'DOWNGRADE' })
        .expect(200);
      const res = await m.api.post(`/agents/${agentId}/chat`, { message: 'hola' }).expect(402);
      expect((res.body as { message: string }).message).toContain('Sin degradación');
    });

    it('ALERT_ONLY nunca bloquea, aunque el presupuesto esté agotado, y genera alertas', async () => {
      const unit = await createUnit(owner, 'Solo alertas', rootId);
      const m = await addMember(app, owner, { role: 'EDITOR', orgUnitId: unit.id });
      await owner.api
        .put(`/admin/budgets/${unit.id}`, { period: 'MONTHLY', limitUsd: 0.0001, policy: 'ALERT_ONLY' })
        .expect(200);
      for (let i = 0; i < 3; i++) {
        const r = await chat(m, agentId, LONG_MESSAGE);
        expect(r.model).toBe('mock-echo');
      }
      const row = await budgetRow(owner, unit.id);
      expect(row.pct).toBeGreaterThan(100);
      const alerts = await alertsOf(owner, unit.id);
      expect(alerts.map((a) => a.threshold).sort((a, b) => a - b)).toEqual([50, 80, 100]);
    });

    it('si el modelo de degradación no está permitido en la cadena se bloquea con 402', async () => {
      const unit = await createUnit(owner, 'Degradación prohibida', rootId);
      const m = await addMember(app, owner, { role: 'EDITOR', orgUnitId: unit.id });
      await owner.api.patch(`/admin/org/units/${unit.id}`, { allowedModels: ['mock:mock-echo'] }).expect(200);
      await owner.api
        .put(`/admin/budgets/${unit.id}`, {
          period: 'MONTHLY',
          limitUsd: 0,
          policy: 'DOWNGRADE',
          downgradeProviderId: connectionId,
          downgradeModel: 'eco-mini',
        })
        .expect(200);
      await m.api.post(`/agents/${agentId}/chat`, { message: 'hola' }).expect(402);
    });

    it('la política deja de degradar al cambiar a BLOCK y limpia el modelo de degradación', async () => {
      const res = await owner.api
        .put(`/admin/budgets/${unitId}`, {
          period: 'MONTHLY',
          limitUsd: 0.0001,
          policy: 'BLOCK',
          downgradeProviderId: connectionId,
          downgradeModel: 'eco-mini',
        })
        .expect(200);
      expect((res.body as BudgetRow).budget).toMatchObject({ downgradeProviderId: null, downgradeModel: null });
      await editor.api.post(`/agents/${agentId}/chat`, { message: 'hola' }).expect(402);
    });
  });
});
