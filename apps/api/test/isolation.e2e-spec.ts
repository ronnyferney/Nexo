import type { INestApplication } from '@nestjs/common';
import { createTestApp, prismaOf } from './utils/app';
import {
  addMember,
  adminUnits,
  chat,
  createAgent,
  publishAgent,
  createUnit,
  records,
  registerOwner,
  rootUnit,
  summary,
  type Session,
} from './utils/fixtures';
import { OpenAiMock } from './utils/mock-servers';

/**
 * Aislamiento multi-tenant del gobierno de IA: el workspace B nunca ve, modifica ni referencia recursos de A.
 */
describe('Gobierno de IA · aislamiento multi-tenant (E2E)', () => {
  const channel = 'tenant-a';
  let app: INestApplication;
  let llm: OpenAiMock;
  let a: Session;
  let b: Session;
  let aRootId: string;
  let aUnitId: string;
  let aMember: Session;
  let aConnectionId: string;
  let aModelId: string;
  let aAgentId: string;
  let aCost: number;

  beforeAll(async () => {
    llm = await new OpenAiMock().start();
    app = await createTestApp();

    a = await registerOwner(app, 'tenant-a');
    b = await registerOwner(app, 'tenant-b');
    aRootId = (await rootUnit(a)).id;
    aUnitId = (await createUnit(a, 'Unidad de A', aRootId)).id;
    aMember = await addMember(app, a, { role: 'EDITOR', orgUnitId: aUnitId });
    await a.api.put(`/admin/budgets/${aUnitId}`, { period: 'MONTHLY', limitUsd: 0.0001, policy: 'BLOCK' }).expect(200);

    const conn = await a.api
      .post('/admin/llm/connections', {
        name: 'Conexión de A',
        kind: 'OPENAI_COMPATIBLE',
        baseUrl: llm.baseUrl(channel),
        apiKey: llm.apiKey,
      })
      .expect(201);
    aConnectionId = (conn.body as { id: string }).id;
    const model = await a.api
      .post(`/admin/llm/connections/${aConnectionId}/models`, {
        modelId: 'gpt-a',
        label: 'GPT de A',
        tier: 'STANDARD',
        inputUsdPerMTok: 1,
        outputUsdPerMTok: 1,
      })
      .expect(201);
    aModelId = (model.body as { id: string }).id;

    aAgentId = (await createAgent(a, { name: 'Agente de A', provider: aConnectionId, model: 'gpt-a' })).id;
    await publishAgent(a, aAgentId); // el miembro de A conversa con un agente de la empresa (ADR 0007)
    aCost = (await chat(aMember, aAgentId, 'consumo de A')).usage.costUsd;
    expect(aCost).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await app?.close();
    await llm?.stop();
  });

  it('B no ve las unidades de A y recibe 404 al modificarlas, moverlas o colgar unidades de ellas', async () => {
    const ids = (await adminUnits(b)).map((u) => u.id);
    expect(ids).not.toContain(aUnitId);
    expect(ids).not.toContain(aRootId);
    expect(((await b.api.get('/org/units').expect(200)).body as { id: string }[]).map((u) => u.id)).not.toContain(
      aUnitId,
    );

    await b.api.patch(`/admin/org/units/${aUnitId}`, { name: 'Hackeada' }).expect(404);
    await b.api.patch(`/admin/org/units/${aUnitId}`, { allowedModels: ['anthropic:claude-haiku-5-5'] }).expect(404);
    await b.api.delete(`/admin/org/units/${aUnitId}`).expect(404);
    await b.api.post('/admin/org/units', { name: 'Intrusa', parentId: aUnitId }).expect(404);

    const bRoot = await rootUnit(b);
    const bUnit = await createUnit(b, 'Unidad de B', bRoot.id);
    await b.api.patch(`/admin/org/units/${bUnit.id}`, { parentId: aUnitId }).expect(404);

    expect((await adminUnits(a)).find((u) => u.id === aUnitId)).toMatchObject({
      name: 'Unidad de A',
      allowedModels: [],
    });
  });

  it('B recibe 404 al leer/modificar/eliminar presupuestos de A', async () => {
    const rows = (await b.api.get('/admin/budgets').expect(200)).body as { orgUnitId: string }[];
    expect(rows.map((r) => r.orgUnitId)).not.toContain(aUnitId);
    await b.api
      .put(`/admin/budgets/${aUnitId}`, { period: 'MONTHLY', limitUsd: 1_000_000, policy: 'ALERT_ONLY' })
      .expect(404);
    await b.api.delete(`/admin/budgets/${aUnitId}`).expect(404);

    const aRow = (
      (await a.api.get('/admin/budgets').expect(200)).body as {
        orgUnitId: string;
        budget: { limitUsd: number; policy: string } | null;
      }[]
    ).find((r) => r.orgUnitId === aUnitId);
    expect(aRow?.budget).toMatchObject({ limitUsd: 0.0001, policy: 'BLOCK' });
  });

  it('B no ve las alertas de A', async () => {
    expect(((await a.api.get('/admin/alerts').expect(200)).body as unknown[]).length).toBeGreaterThan(0);
    expect((await b.api.get('/admin/alerts').expect(200)).body).toEqual([]);
  });

  it('B recibe 404 al modificar o eliminar miembros de A y no puede asignar sus miembros a unidades de A', async () => {
    const members = (await b.api.get('/admin/org/members').expect(200)).body as { userId: string }[];
    expect(members.map((m) => m.userId)).not.toContain(aMember.userId);
    await b.api.patch(`/admin/org/members/${aMember.membershipId}`, { role: 'VIEWER' }).expect(404);
    await b.api.delete(`/admin/org/members/${aMember.membershipId}`).expect(404);

    const bMember = await addMember(app, b, { role: 'EDITOR' });
    await b.api.patch(`/admin/org/members/${bMember.membershipId}`, { orgUnitId: aUnitId }).expect(404);
    const res = await b.api.post('/admin/org/members', {
      email: `otro-${Date.now()}@nexo.test`,
      name: 'Otro',
      role: 'EDITOR',
      password: 'Clave-Segura-123',
      orgUnitId: aUnitId,
    });
    expect(res.status).toBe(404);

    const aMembers = (await a.api.get('/admin/org/members').expect(200)).body as { userId: string; role: string }[];
    expect(aMembers.find((m) => m.userId === aMember.userId)?.role).toBe('EDITOR');
  });

  it('B recibe 404 al leer/modificar/probar/eliminar conexiones y modelos de A', async () => {
    const list = (await b.api.get('/admin/llm/connections').expect(200)).body as { id: string }[];
    expect(list.map((c) => c.id)).not.toContain(aConnectionId);
    const catalog = (await b.api.get('/llm/catalog').expect(200)).body as { id: string }[];
    expect(catalog.map((c) => c.id)).not.toContain(aConnectionId);

    await b.api.patch(`/admin/llm/connections/${aConnectionId}`, { baseUrl: 'http://127.0.0.1:1/v1' }).expect(404);
    await b.api.post(`/admin/llm/connections/${aConnectionId}/test`).expect(404);
    await b.api.delete(`/admin/llm/connections/${aConnectionId}`).expect(404);
    await b.api
      .post(`/admin/llm/connections/${aConnectionId}/models`, {
        modelId: 'intruso',
        label: 'Intruso',
        tier: 'ECONOMY',
        inputUsdPerMTok: 0,
        outputUsdPerMTok: 0,
      })
      .expect(404);
    await b.api.patch(`/admin/llm/models/${aModelId}`, { inputUsdPerMTok: 0 }).expect(404);
    await b.api.delete(`/admin/llm/models/${aModelId}`).expect(404);

    const aConn = (
      (await a.api.get('/admin/llm/connections').expect(200)).body as {
        id: string;
        baseUrl: string;
        models: { modelId: string; inputUsdPerMTok: number }[];
      }[]
    ).find((c) => c.id === aConnectionId);
    expect(aConn?.baseUrl).toBe(llm.baseUrl(channel));
    expect(aConn?.models).toEqual([expect.objectContaining({ modelId: 'gpt-a', inputUsdPerMTok: 1 })]);
  });

  it('el resumen y los registros de uso de B no incluyen consumo de A', async () => {
    for (const groupBy of ['orgUnit', 'model', 'agent', 'user', 'day']) {
      const s = await summary(b, groupBy);
      expect(s).toMatchObject({ totalCostUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0, groups: [] });
    }
    expect(await records(b)).toEqual([]);
    const me = (await b.api.get('/me/usage').expect(200)).body as { me: { calls: number }; budgets: unknown[] };
    expect(me.me.calls).toBe(0);
    expect(me.budgets).toEqual([]);

    const sa = await summary(a, 'orgUnit');
    expect(sa.totalCostUsd).toBeCloseTo(aCost, 8);
  });

  it('un agente de B no puede usar como costCenterId una unidad de A', async () => {
    await b.api
      .post('/agents', { name: 'Agente B', provider: 'mock', model: 'mock-echo', costCenterId: aUnitId })
      .expect(404);
    const agent = await createAgent(b);
    await b.api.patch(`/agents/${agent.id}`, { costCenterId: aUnitId }).expect(404);
    expect(
      ((await b.api.get(`/agents/${agent.id}`).expect(200)).body as { costCenterId: null }).costCenterId,
    ).toBeNull();
  });

  it('un agente de B no puede ejecutarse con la conexión LLM de A', async () => {
    const before = llm.chatRequests(channel).length;
    // Ni siquiera se puede guardar un agente de B con la conexión de A…
    await b.api.post('/agents', { name: 'Intruso', provider: aConnectionId, model: 'gpt-a' }).expect(400);
    // …y si existiera (datos heredados), tampoco se ejecuta con ella.
    const agent = await createAgent(b);
    await prismaOf(app).agent.update({ where: { id: agent.id }, data: { provider: aConnectionId, model: 'gpt-a' } });
    await b.api.post(`/agents/${agent.id}/chat`, { message: 'usar la clave de A' }).expect(400);
    expect(llm.chatRequests(channel)).toHaveLength(before);
    expect(await records(b)).toEqual([]);
  });

  it('un presupuesto de B no puede degradar hacia la conexión LLM de A', async () => {
    const bRoot = await rootUnit(b);
    const res = await b.api.put(`/admin/budgets/${bRoot.id}`, {
      period: 'MONTHLY',
      limitUsd: 0,
      policy: 'DOWNGRADE',
      downgradeProviderId: aConnectionId,
      downgradeModel: 'gpt-a',
    });
    expect(res.status).toBe(400);
    // Sin presupuesto inválido guardado, el chat de B funciona y nunca toca la conexión de A.
    const agent = await createAgent(b);
    const before = llm.chatRequests(channel).length;
    await b.api.post(`/agents/${agent.id}/chat`, { message: 'hola' }).expect(200);
    expect(llm.chatRequests(channel)).toHaveLength(before);
  });

  it('B no puede leer, ejecutar ni modificar el agente de A', async () => {
    await b.api.get(`/agents/${aAgentId}`).expect(404);
    await b.api.post(`/agents/${aAgentId}/chat`, { message: 'hola' }).expect(404);
    await b.api.patch(`/agents/${aAgentId}`, { costCenterId: null }).expect(404);
  });
});
