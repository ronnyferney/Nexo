import type { INestApplication } from '@nestjs/common';
import { createTestApp, prismaOf } from './utils/app';
import { chat, createAgent, registerOwner, type Session } from './utils/fixtures';

/** Vinculación agente ↔ conexión LLM: validación al guardar, uso, borrado protegido y respaldo si no está disponible. */
describe('Vinculación de agentes con proveedores IA (E2E)', () => {
  let app: INestApplication;
  let owner: Session;
  let other: Session;
  let connectionId: string;
  let otherConnectionId: string;

  async function mockConnection(s: Session, name: string, models: string[]) {
    const c = (await s.api.post('/admin/llm/connections', { name, kind: 'MOCK' }).expect(201)).body as { id: string };
    for (const modelId of models) {
      await s.api
        .post(`/admin/llm/connections/${c.id}/models`, {
          modelId,
          label: modelId,
          tier: 'STANDARD',
          inputUsdPerMTok: 1,
          outputUsdPerMTok: 2,
        })
        .expect(201);
    }
    return c.id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'binding');
    other = await registerOwner(app, 'binding-otro');
    connectionId = await mockConnection(owner, 'Simulado propio', ['mock-echo', 'mock-b']);
    otherConnectionId = await mockConnection(other, 'Simulado ajeno', ['mock-echo']);
  });

  afterAll(async () => {
    await app.close();
  });

  it('al guardar valida proveedor, modelo y respaldos contra el workspace (nunca otro workspace)', async () => {
    const base = { name: 'Agente vinculado' };
    await owner.api.post('/agents', { ...base, provider: 'no-existe', model: 'x' }).expect(400);
    await owner.api.post('/agents', { ...base, provider: otherConnectionId, model: 'mock-echo' }).expect(400);
    await owner.api.post('/agents', { ...base, provider: connectionId, model: 'no-existe' }).expect(400);
    const bad = await owner.api
      .post('/agents', {
        ...base,
        provider: connectionId,
        model: 'mock-echo',
        fallbackModels: [`${otherConnectionId}:mock-echo`],
      })
      .expect(400);
    expect((bad.body as { message: string }).message).toMatch(/modelo de respaldo/);

    const agent = await createAgent(owner, { provider: connectionId, model: 'mock-echo' });
    await owner.api.patch(`/agents/${agent.id}`, { model: 'no-existe' }).expect(400);
    await owner.api
      .patch(`/agents/${agent.id}`, { fallbackModels: ['mock:mock-echo', 'anthropic:no-existe'] })
      .expect(400);
    await owner.api.patch(`/agents/${agent.id}`, { fallbackModels: ['mock:mock-echo'] }).expect(200);
    await prismaOf(app).agent.delete({ where: { id: agent.id } });
  });

  it('un modelo deshabilitado después no impide editar otros campos del agente', async () => {
    const agent = await createAgent(owner, { provider: connectionId, model: 'mock-b' });
    const model = await prismaOf(app).llmModel.findFirstOrThrow({ where: { connectionId, modelId: 'mock-b' } });
    await owner.api.patch(`/admin/llm/models/${model.id}`, { enabled: false }).expect(200);
    await owner.api
      .patch(`/agents/${agent.id}`, { name: 'Renombrado', provider: connectionId, model: 'mock-b' })
      .expect(200);
    await owner.api.patch(`/admin/llm/models/${model.id}`, { enabled: true }).expect(200);
    await prismaOf(app).agent.delete({ where: { id: agent.id } });
  });

  it('lista los agentes que usan la conexión y bloquea borrar la conexión o el modelo en uso (también como respaldo)', async () => {
    const primary = await createAgent(owner, { name: 'Principal', provider: connectionId, model: 'mock-echo' });
    const backup = await createAgent(owner, {
      name: 'Con respaldo',
      provider: 'mock',
      model: 'mock-echo',
      fallbackModels: [`${connectionId}:mock-b`],
    });
    await other.api.get(`/admin/llm/connections/${connectionId}/usage`).expect(404);
    const usage = (await owner.api.get(`/admin/llm/connections/${connectionId}/usage`).expect(200)).body;
    expect(usage).toEqual([
      { agentId: backup.id, agentName: 'Con respaldo', model: 'mock-b', role: 'FALLBACK' },
      { agentId: primary.id, agentName: 'Principal', model: 'mock-echo', role: 'PRIMARY' },
    ]);

    await prismaOf(app).agent.delete({ where: { id: primary.id } });
    const del = await owner.api.delete(`/admin/llm/connections/${connectionId}`).expect(409);
    expect((del.body as { message: string }).message).toMatch(/Con respaldo.*respaldo/);
    const modelB = await prismaOf(app).llmModel.findFirstOrThrow({ where: { connectionId, modelId: 'mock-b' } });
    await owner.api.delete(`/admin/llm/models/${modelB.id}`).expect(409);
    const echo = await prismaOf(app).llmModel.findFirstOrThrow({ where: { connectionId, modelId: 'mock-echo' } });
    await owner.api.delete(`/admin/llm/models/${echo.id}`).expect(200);
    await owner.api.post(`/admin/llm/connections/${connectionId}/models`, {
      modelId: 'mock-echo',
      label: 'mock-echo',
      tier: 'STANDARD',
      inputUsdPerMTok: 1,
      outputUsdPerMTok: 2,
    });
    await prismaOf(app).agent.delete({ where: { id: backup.id } });
  });

  it('si la conexión principal está deshabilitada o con la sesión cerrada, el agente usa su respaldo', async () => {
    const agent = await createAgent(owner, {
      provider: connectionId,
      model: 'mock-echo',
      fallbackModels: ['mock:mock-echo'],
    });
    expect((await chat(owner, agent.id)).providerId).toBe(connectionId);

    await owner.api.patch(`/admin/llm/connections/${connectionId}`, { enabled: false }).expect(200);
    expect(await chat(owner, agent.id)).toMatchObject({ providerId: 'mock', model: 'mock-echo' });
    await owner.api.patch(`/admin/llm/connections/${connectionId}`, { enabled: true }).expect(200);

    // Sesión OAuth cerrada (sin tokens): el respaldo responde y el error no llega al usuario.
    await prismaOf(app).llmConnection.update({
      where: { id: connectionId },
      data: { credentialType: 'OAUTH', apiKeyCipher: null },
    });
    expect(await chat(owner, agent.id)).toMatchObject({ providerId: 'mock' });

    // Sin respaldo, el usuario recibe el motivo claro.
    await owner.api.patch(`/agents/${agent.id}`, { fallbackModels: [] }).expect(200);
    const res = await owner.api.post(`/agents/${agent.id}/chat`, { message: 'Hola' }).expect(400);
    expect((res.body as { message: string }).message).toMatch(/sesión de "Simulado propio" está cerrada/);
    await prismaOf(app).llmConnection.update({ where: { id: connectionId }, data: { credentialType: 'API_KEY' } });
    await prismaOf(app).agent.delete({ where: { id: agent.id } });
  });
});
