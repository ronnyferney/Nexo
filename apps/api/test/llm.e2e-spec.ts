import type { INestApplication } from '@nestjs/common';
import { createTestApp, prismaOf } from './utils/app';
import { chat, createAgent, records, registerOwner, type Session } from './utils/fixtures';
import { OpenAiMock, RestMock, textReply, toolCallReply } from './utils/mock-servers';

interface Connection {
  id: string;
  name: string;
  kind: string;
  baseUrl: string | null;
  hasApiKey: boolean;
  enabled: boolean;
  models: { id: string; modelId: string; enabled: boolean; cacheReadUsdPerMTok: number | null }[];
}

describe('Gobierno de IA · conexiones LLM y driver OpenAI-compatible (E2E)', () => {
  let app: INestApplication;
  let llm: OpenAiMock;
  let rest: RestMock;

  beforeAll(async () => {
    llm = await new OpenAiMock().start();
    rest = await new RestMock().start();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
    await llm?.stop();
    await rest?.stop();
  });

  async function createConnection(s: Session, channel: string, extra: Record<string, unknown> = {}) {
    const res = await s.api
      .post('/admin/llm/connections', {
        name: `Compatible ${channel}`,
        kind: 'OPENAI_COMPATIBLE',
        baseUrl: llm.baseUrl(channel),
        apiKey: llm.apiKey,
        ...extra,
      })
      .expect(201);
    return res.body as Connection;
  }

  describe('Driver OpenAI-compatible', () => {
    const channel = 'tools';
    let owner: Session;
    let connectionId: string;
    let agentId: string;

    beforeAll(async () => {
      owner = await registerOwner(app, 'driver');
      connectionId = (await createConnection(owner, channel)).id;
      await owner.api
        .post(`/admin/llm/connections/${connectionId}/models`, {
          modelId: 'gpt-e2e',
          label: 'GPT E2E',
          tier: 'STANDARD',
          inputUsdPerMTok: 2,
          outputUsdPerMTok: 8,
          cacheReadUsdPerMTok: 0.5,
        })
        .expect(201);

      const connector = await owner.api
        .post('/connectors', {
          name: 'Clima',
          type: 'REST',
          config: { baseUrl: rest.origin, openApiUrl: `${rest.origin}/openapi.json` },
        })
        .expect(201);
      const connectorId = (connector.body as { id: string }).id;
      const discovered = await owner.api.post(`/connectors/${connectorId}/discover`).expect(200);
      expect(discovered.body).toMatchObject({ imported: 1, operations: ['getWeather'] });
      const detail = (await owner.api.get(`/connectors/${connectorId}`).expect(200)).body as {
        operations: { id: string; key: string }[];
      };

      agentId = (
        await createAgent(owner, {
          name: 'Agente clima',
          provider: connectionId,
          model: 'gpt-e2e',
          systemPrompt: 'Eres un asistente',
        })
      ).id;
      const tools = await owner.api
        .put(`/agents/${agentId}/tools`, { tools: [{ operationId: detail.operations[0].id }] })
        .expect(200);
      expect((tools.body as { tools: { toolName: string }[] }).tools[0].toolName).toBe('clima__getweather');
      // Candado Opción A: para invocar el conector de red hace falta el permiso explícito `sistemasAutorizados`.
      await owner.api.put(`/execution-params/${agentId}`, { sistemasAutorizados: true }).expect(200);
    });

    it('ejecuta el bucle de herramientas (tool_calls y luego texto) contra el mock', async () => {
      const before = llm.chatRequests(channel).length;
      llm.enqueue(
        channel,
        toolCallReply([{ id: 'call_1', name: 'clima__getweather', args: { city: 'Lima' } }], {
          prompt_tokens: 1000,
          completion_tokens: 50,
          cached_tokens: 400,
        }),
        textReply('En Lima hace 21 °C', { prompt_tokens: 1200, completion_tokens: 30, cached_tokens: 1000 }),
      );

      const r = await chat(owner, agentId, '¿Qué clima hace en Lima?');
      expect(r).toMatchObject({ text: 'En Lima hace 21 °C', turns: 2, providerId: connectionId, model: 'gpt-e2e' });

      // La tool llamó al REST real del mock.
      const weatherCall = rest.requests.find((q) => q.path === '/weather');
      expect(weatherCall?.query.get('city')).toBe('Lima');

      const [first, second] = llm.chatRequests(channel).slice(before);
      expect(first.body.model).toBe('gpt-e2e');
      expect(first.body.messages[0]).toEqual({ role: 'system', content: 'Eres un asistente' });
      expect(first.body.tools).toEqual([
        expect.objectContaining({ type: 'function', function: expect.objectContaining({ name: 'clima__getweather' }) }),
      ]);
      type WireMessage = { role: string; content: string | null; tool_call_id?: string; tool_calls?: unknown[] };
      const messages = second.body.messages as WireMessage[];
      const assistant = messages.find((m) => m.role === 'assistant');
      expect(assistant?.tool_calls?.[0]).toMatchObject({ id: 'call_1', function: { name: 'clima__getweather' } });
      const tool = messages.find((m) => m.role === 'tool');
      expect(tool?.tool_call_id).toBe('call_1');
      expect(tool?.content).toContain('"tempC":21');
    });

    it('calcula el costo con tokens cacheados usando cacheReadUsdPerMTok', async () => {
      const rows = await prismaOf(app).usageRecord.findMany({
        where: { workspaceId: owner.workspaceId },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows).toHaveLength(2);
      // Turno 1: 600 entrada no cacheada × 2 + 50 salida × 8 + 400 caché × 0.5 = 1800 / 1e6
      expect(rows[0]).toMatchObject({ inputTokens: 600, outputTokens: 50, cacheReadTokens: 400, model: 'gpt-e2e' });
      expect(Number(rows[0].costUsd)).toBeCloseTo(0.0018, 10);
      // Turno 2: 200 × 2 + 30 × 8 + 1000 × 0.5 = 1140 / 1e6
      expect(rows[1]).toMatchObject({ inputTokens: 200, outputTokens: 30, cacheReadTokens: 1000 });
      expect(Number(rows[1].costUsd)).toBeCloseTo(0.00114, 10);

      const items = await records(owner);
      expect(items.map((i) => i.costUsd).sort()).toEqual([0.00114, 0.0018]);
      const me = (await owner.api.get('/me/usage').expect(200)).body as { me: { costUsd: number; calls: number } };
      expect(me.me.calls).toBe(2);
      expect(me.me.costUsd).toBeCloseTo(0.00294, 8);
    });

    it('la respuesta del chat informa el costo total del bucle', async () => {
      llm.enqueue(
        channel,
        toolCallReply([{ id: 'call_2', name: 'clima__getweather', args: { city: 'Quito' } }], {
          prompt_tokens: 1000,
          completion_tokens: 50,
          cached_tokens: 400,
        }),
        textReply('Quito: 21 °C', { prompt_tokens: 1200, completion_tokens: 30, cached_tokens: 1000 }),
      );
      const r = await chat(owner, agentId, 'Clima en Quito');
      expect(r.usage).toMatchObject({ inputTokens: 800, outputTokens: 80 });
      expect(r.usage.costUsd).toBeCloseTo(0.00294, 10);
    });

    it('sin tarifa de caché los tokens cacheados se cobran al precio de entrada', async () => {
      await owner.api
        .post(`/admin/llm/connections/${connectionId}/models`, {
          modelId: 'gpt-nocache',
          label: 'GPT sin caché',
          tier: 'ECONOMY',
          inputUsdPerMTok: 2,
          outputUsdPerMTok: 8,
        })
        .expect(201);
      const agent = await createAgent(owner, { provider: connectionId, model: 'gpt-nocache' });
      llm.enqueue(channel, textReply('ok', { prompt_tokens: 1000, completion_tokens: 0, cached_tokens: 400 }));
      const r = await chat(owner, agent.id);
      expect(r.usage.costUsd).toBeCloseTo(0.002, 10);
    });

    it('en modo stream emite tool_call, tool_result, text y done en orden', async () => {
      llm.enqueue(
        channel,
        toolCallReply([{ id: 'call_3', name: 'clima__getweather', args: { city: 'Cusco' } }]),
        textReply('Cusco: 21 °C'),
      );
      const { events } = await owner.api.sse(`/agents/${agentId}/chat`, { message: 'Clima en Cusco', stream: true });
      expect(events.map((e) => e.event)).toEqual(['tool_call', 'tool_result', 'text', 'done']);
      expect(events[1].data).toMatchObject({ name: 'clima__getweather', isError: false });
      expect(events[3].data).toMatchObject({ text: 'Cusco: 21 °C', model: 'gpt-e2e', providerId: connectionId });
    });

    it('continúa la conversación enviando el historial nativo previo', async () => {
      const first = await chat(owner, agentId, 'Primera pregunta');
      const before = llm.chatRequests(channel).length;
      const res = await owner.api
        .post(`/agents/${agentId}/chat`, { message: 'Segunda pregunta', conversationId: first.conversationId })
        .expect(200);
      expect((res.body as { conversationId: string }).conversationId).toBe(first.conversationId);
      const [req] = llm.chatRequests(channel).slice(before);
      const contents = (req.body.messages as { content: string }[]).map((m) => m.content);
      expect(contents).toEqual(['Eres un asistente', 'Primera pregunta', 'Respuesta simulada', 'Segunda pregunta']);
    });
  });

  describe('Administración de conexiones', () => {
    let owner: Session;

    beforeAll(async () => {
      owner = await registerOwner(app, 'conexiones');
    });

    it('la API key nunca se devuelve: solo hasApiKey', async () => {
      const created = await createConnection(owner, 'admin');
      expect(created).toMatchObject({ kind: 'OPENAI_COMPATIBLE', hasApiKey: true, enabled: true, models: [] });
      expect(created).not.toHaveProperty('apiKey');
      expect(created).not.toHaveProperty('apiKeyCipher');
      expect(JSON.stringify(created)).not.toContain(llm.apiKey);

      const list = await owner.api.get('/admin/llm/connections').expect(200);
      expect(JSON.stringify(list.body)).not.toContain(llm.apiKey);
      expect((list.body as Connection[]).find((c) => c.id === created.id)).toMatchObject({ hasApiKey: true });

      const patched = await owner.api.patch(`/admin/llm/connections/${created.id}`, { name: 'Renombrada' }).expect(200);
      expect(patched.body).toMatchObject({ name: 'Renombrada', hasApiKey: true });
      expect(JSON.stringify(patched.body)).not.toContain(llm.apiKey);

      const catalog = await owner.api.get('/llm/catalog').expect(200);
      expect(JSON.stringify(catalog.body)).not.toContain(llm.apiKey);

      const row = await prismaOf(app).llmConnection.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.apiKeyCipher).toBeTruthy();
      expect(row.apiKeyCipher).not.toContain(llm.apiKey);

      const noKey = await owner.api
        .post('/admin/llm/connections', {
          name: 'Ollama local',
          kind: 'OPENAI_COMPATIBLE',
          baseUrl: llm.baseUrl('nokey'),
        })
        .expect(201);
      expect(noKey.body).toMatchObject({ hasApiKey: false });
    });

    it('test funciona con la clave correcta e informa el error con una clave incorrecta', async () => {
      const c = await createConnection(owner, 'probar');
      const ok = await owner.api.post(`/admin/llm/connections/${c.id}/test`).expect(200);
      expect(ok.body).toMatchObject({ ok: true });
      expect((ok.body as { message: string }).message).toContain('eco-mini');

      await owner.api.patch(`/admin/llm/connections/${c.id}`, { apiKey: 'sk-incorrecta' }).expect(200);
      const bad = await owner.api.post(`/admin/llm/connections/${c.id}/test`).expect(200);
      expect(bad.body).toMatchObject({ ok: false });
      expect((bad.body as { message: string }).message).toContain('401');

      // Volver a la clave correcta invalida el cliente en caché.
      await owner.api.patch(`/admin/llm/connections/${c.id}`, { apiKey: llm.apiKey }).expect(200);
      await owner.api
        .post(`/admin/llm/connections/${c.id}/test`)
        .expect(200)
        .expect((r) => expect(r.body.ok).toBe(true));

      const sinKey = await owner.api
        .post('/admin/llm/connections', {
          name: 'Sin clave',
          kind: 'OPENAI_COMPATIBLE',
          baseUrl: llm.baseUrl('probar'),
        })
        .expect(201);
      const noAuth = await owner.api.post(`/admin/llm/connections/${(sinKey.body as Connection).id}/test`).expect(200);
      expect(noAuth.body).toMatchObject({ ok: false });

      const down = await owner.api
        .post('/admin/llm/connections', { name: 'Caída', kind: 'OPENAI_COMPATIBLE', baseUrl: 'http://127.0.0.1:1/v1' })
        .expect(201);
      const unreachable = await owner.api
        .post(`/admin/llm/connections/${(down.body as Connection).id}/test`)
        .expect(200);
      expect(unreachable.body).toMatchObject({ ok: false });

      const mock = await owner.api.post('/admin/llm/connections', { name: 'Simulado', kind: 'MOCK' }).expect(201);
      const mockTest = await owner.api.post(`/admin/llm/connections/${(mock.body as Connection).id}/test`).expect(200);
      expect(mockTest.body).toMatchObject({ ok: true });
    });

    it('no se puede borrar una conexión usada por un agente (409)', async () => {
      const c = await createConnection(owner, 'borrar');
      await owner.api
        .post(`/admin/llm/connections/${c.id}/models`, {
          modelId: 'gpt-e2e',
          label: 'GPT',
          tier: 'STANDARD',
          inputUsdPerMTok: 1,
          outputUsdPerMTok: 1,
        })
        .expect(201);
      const agent = await createAgent(owner, { provider: c.id, model: 'gpt-e2e' });
      const conflict = await owner.api.delete(`/admin/llm/connections/${c.id}`).expect(409);
      expect((conflict.body as { message: string }).message).toContain('1 agente');

      await owner.api.delete(`/agents/${agent.id}`).expect(200);
      await owner.api.delete(`/admin/llm/connections/${c.id}`).expect(200);
      const list = (await owner.api.get('/admin/llm/connections').expect(200)).body as Connection[];
      expect(list.some((x) => x.id === c.id)).toBe(false);
      expect(await prismaOf(app).llmModel.count({ where: { connectionId: c.id } })).toBe(0);
      await owner.api.delete(`/admin/llm/connections/${c.id}`).expect(404);
    });

    it('el catálogo solo muestra conexiones y modelos habilitados, sin tarifa de caché', async () => {
      const c = await createConnection(owner, 'catalogo');
      const on = await owner.api
        .post(`/admin/llm/connections/${c.id}/models`, {
          modelId: 'visible',
          label: 'Visible',
          tier: 'STANDARD',
          inputUsdPerMTok: 1,
          outputUsdPerMTok: 2,
          cacheReadUsdPerMTok: 0.1,
        })
        .expect(201);
      expect(on.body).toMatchObject({
        modelId: 'visible',
        inputUsdPerMTok: 1,
        outputUsdPerMTok: 2,
        cacheReadUsdPerMTok: 0.1,
      });
      const off = await owner.api
        .post(`/admin/llm/connections/${c.id}/models`, {
          modelId: 'oculto',
          label: 'Oculto',
          tier: 'PREMIUM',
          inputUsdPerMTok: 1,
          outputUsdPerMTok: 2,
        })
        .expect(201);
      await owner.api.patch(`/admin/llm/models/${(off.body as { id: string }).id}`, { enabled: false }).expect(200);

      type Entry = { id: string; system: boolean; configured: boolean; models: { id: string }[] };
      let catalog = (await owner.api.get('/llm/catalog').expect(200)).body as Entry[];
      const entry = catalog.find((e) => e.id === c.id)!;
      expect(entry).toMatchObject({ system: false, configured: true });
      expect(entry.models.map((m) => m.id)).toEqual(['visible']);
      expect(entry.models[0]).not.toHaveProperty('cacheReadUsdPerMTok');
      expect(catalog.find((e) => e.id === 'mock')).toMatchObject({ system: true, configured: true });

      await owner.api.patch(`/admin/llm/connections/${c.id}`, { enabled: false }).expect(200);
      catalog = (await owner.api.get('/llm/catalog').expect(200)).body as Entry[];
      expect(catalog.some((e) => e.id === c.id)).toBe(false);

      // Un agente sobre una conexión deshabilitada no se ejecuta.
      const agent = await createAgent(owner, { provider: c.id, model: 'visible' });
      await owner.api.post(`/agents/${agent.id}/chat`, { message: 'hola' }).expect(400);
      await owner.api.patch(`/admin/llm/connections/${c.id}`, { enabled: true }).expect(200);
      const hidden = await createAgent(owner, { provider: c.id, model: 'oculto' });
      await owner.api.post(`/agents/${hidden.id}/chat`, { message: 'hola' }).expect(400);

      // Un modelo en uso por un agente no se borra hasta reasignarlo.
      await owner.api.delete(`/admin/llm/models/${(off.body as { id: string }).id}`).expect(409);
      await owner.api.delete(`/agents/${hidden.id}`).expect(200);
      await owner.api.delete(`/admin/llm/models/${(off.body as { id: string }).id}`).expect(200);
      await owner.api.delete(`/admin/llm/models/${(off.body as { id: string }).id}`).expect(404);
    });

    it('valida conexiones y modelos', async () => {
      await owner.api.post('/admin/llm/connections', { name: 'Mala', kind: 'BEDROCK' }).expect(400);
      await owner.api
        .post('/admin/llm/connections', { name: 'Mala', kind: 'OPENAI_COMPATIBLE', baseUrl: 'no es url' })
        .expect(400);
      await owner.api.post('/admin/llm/connections', { name: 'Mala', kind: 'MOCK', workspaceId: 'otro' }).expect(400);
      const c = await createConnection(owner, 'validar');
      const model = { modelId: 'dup', label: 'Dup', tier: 'STANDARD', inputUsdPerMTok: 1, outputUsdPerMTok: 1 };
      await owner.api.post(`/admin/llm/connections/${c.id}/models`, { ...model, inputUsdPerMTok: -1 }).expect(400);
      await owner.api.post(`/admin/llm/connections/${c.id}/models`, { ...model, tier: 'GRATIS' }).expect(400);
      await owner.api.post(`/admin/llm/connections/${c.id}/models`, model).expect(201);
      await owner.api.post(`/admin/llm/connections/${c.id}/models`, model).expect(409);
      await owner.api.post('/admin/llm/connections/no-existe/models', model).expect(404);
    });
  });
});
