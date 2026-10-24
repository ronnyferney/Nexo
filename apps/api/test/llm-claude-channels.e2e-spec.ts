import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { createTestApp, prismaOf } from './utils/app';
import { chat, createAgent, registerOwner, type Session } from './utils/fixtures';
import { ClaudeMessagesMock } from './utils/mock-servers';

/** Claude en Microsoft Foundry: clave del recurso (cabecera `api-key`) y la misma Messages API de Claude. */
describe('Claude en Microsoft Foundry (E2E)', () => {
  let app: INestApplication;
  let owner: Session;
  let claude: ClaudeMessagesMock;
  const KEY = 'clave-foundry-e2e-0123456789';

  beforeAll(async () => {
    claude = await new ClaudeMessagesMock().start();
    claude.authorize = (h) => h['api-key'] === KEY || h['x-api-key'] === KEY;
    app = await createTestApp();
    app.get(ConfigService).set('llm.providerUrlOverrides', { 'claude-foundry': `${claude.origin}/anthropic` });
    owner = await registerOwner(app, 'foundry');
  });

  afterAll(async () => {
    await app?.close();
    await claude?.stop();
  });

  it('una clave inválida no crea la conexión y explica el motivo', async () => {
    const res = await owner.api
      .post('/admin/llm/providers/claude-foundry/connect', { fields: { resource: 'mi-recurso', apiKey: 'mala' } })
      .expect(400);
    expect(JSON.stringify(res.body)).not.toContain('mala');
    expect(await prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
  });

  it('conecta con la clave del recurso, guarda el canal y un agente conversa con Claude', async () => {
    const res = await owner.api
      .post('/admin/llm/providers/claude-foundry/connect', {
        fields: { resource: 'mi-recurso', apiKey: KEY },
        models: ['claude-opus-5-5'],
      })
      .expect(201);
    const { connection } = res.body as { connection: { id: string } };
    const row = await prismaOf(app).llmConnection.findUniqueOrThrow({
      where: { id: connection.id },
      include: { models: true },
    });
    expect(row).toMatchObject({
      kind: 'ANTHROPIC',
      credentialType: 'API_KEY',
      providerId: 'claude-foundry',
      driverOptions: { claude: { channel: 'foundry', resource: 'mi-recurso' } },
    });
    expect(app.get(CryptoService).decrypt(row.apiKeyCipher!)).toBe(KEY);
    // Foundry factura con las tarifas de la API de Anthropic.
    expect(row.models[0]).toMatchObject({ modelId: 'claude-opus-5-5', needsPricing: false });
    expect(Number(row.models[0].inputUsdPerMTok)).toBe(4);

    const agent = await createAgent(owner, { provider: connection.id, model: 'claude-opus-5-5' });
    expect((await chat(owner, agent.id, 'Hola Foundry')).text).toBe('Hola desde Claude simulado');
    const sent = claude.messageRequests().at(-1)!;
    expect(sent.path).toBe('/anthropic/v1/messages');
    expect(sent.headers['api-key'] ?? sent.headers['x-api-key']).toBe(KEY);
    expect(sent.body).not.toHaveProperty('fallbacks');
  });
});
