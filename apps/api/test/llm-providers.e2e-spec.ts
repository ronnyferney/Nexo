import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OPENROUTER_STATE_ID } from '../src/modules/llm/openrouter-oauth.service';
import { OAuthStateService } from '../src/modules/oauth/oauth-state.service';
import { Api, createTestApp, prismaOf } from './utils/app';
import { addMember, chat, createAgent, registerOwner, type Session } from './utils/fixtures';
import { OpenAiMock } from './utils/mock-servers';

/**
 * OpenRouter simulado: canje PKCE S256 en `POST /api/v1/auth/keys`, `GET /api/v1/key` (exige la clave emitida) y
 * `GET /api/v1/models`. Registra las cabeceras recibidas.
 */
class OpenRouterMock {
  private server?: Server;
  private port = 0;
  private readonly codes = new Map<string, string>();
  readonly keys = new Set<string>();
  readonly requests: { method: string; path: string; headers: IncomingMessage['headers']; body: unknown }[] = [];

  get origin() {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        const path = new URL(req.url ?? '/', this.origin).pathname;
        const body = raw ? (JSON.parse(raw) as Record<string, string>) : {};
        this.requests.push({ method: req.method ?? 'GET', path, headers: req.headers, body });
        const send = (status: number, payload: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(payload));
        };
        if (path === '/api/v1/auth/keys' && req.method === 'POST') {
          const challenge = this.codes.get(body.code ?? '');
          this.codes.delete(body.code ?? '');
          const computed = createHash('sha256')
            .update(body.code_verifier ?? '')
            .digest('base64url');
          if (!challenge || body.code_challenge_method !== 'S256' || computed !== challenge) {
            return send(400, { error: { message: 'Invalid code or code_verifier' } });
          }
          const key = `sk-or-v1-e2e-${randomBytes(6).toString('hex')}`;
          this.keys.add(key);
          return send(200, { key, user_id: 'user_e2e' });
        }
        const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
        if (path === '/api/v1/key') {
          return this.keys.has(bearer)
            ? send(200, { data: { label: 'Nexo' } })
            : send(401, { error: { message: 'No auth' } });
        }
        if (path === '/api/v1/models') return send(200, { data: [{ id: 'openai/gpt-x' }, { id: 'meta/llama-y' }] });
        return send(404, { error: { message: 'No encontrado' } });
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  async stop() {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  /** Simula el consentimiento: registra el código para el `code_challenge` y devuelve la query del callback. */
  authorize(authorizeUrl: string): { code: string; state: string } {
    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe(`${this.origin}/auth`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const callback = new URL(url.searchParams.get('callback_url')!);
    expect(callback.pathname).toBe('/api/llm/oauth/openrouter/callback');
    const code = `code-${randomBytes(6).toString('hex')}`;
    this.codes.set(code, url.searchParams.get('code_challenge')!);
    return { code, state: callback.searchParams.get('state')! };
  }
}

interface ProviderView {
  id: string;
  name: string;
  kind: string;
  category: string;
  fields: { key: string; secret: boolean }[];
  keySteps: string[];
  connected: { connectionId: string; name: string; modelCount: number; enabled: boolean }[];
  modelCount: number;
  platform: { configured: boolean; models: number } | null;
}

interface ConnectResult {
  connection: { id: string; providerId: string; hasApiKey: boolean; baseUrl: string; kind: string };
  models: { modelId: string; needsPricing: boolean; inputUsdPerMTok: number; enabled: boolean }[];
  discoveredModels: string[];
}

describe('Catálogo de proveedores IA "conectar en un clic" (E2E)', () => {
  let app: INestApplication;
  let llm: OpenAiMock;
  let openrouter: OpenRouterMock;
  let webUrl: string;
  let owner: Session;
  let editor: Session;
  let viewer: Session;
  let other: Session;

  const providers = async (s: Session) =>
    ((await s.api.get('/admin/llm/providers').expect(200)).body as { providers: ProviderView[] }).providers;
  const connectionCount = (workspaceId: string) => prismaOf(app).llmConnection.count({ where: { workspaceId } });
  const callback = (query: Record<string, string>) =>
    new Api(app).get(`/llm/oauth/openrouter/callback?${new URLSearchParams(query).toString()}`).redirects(0);
  const errorTarget = (reason: string) => `${webUrl}/admin/providers?llm=error&provider=openrouter&reason=${reason}`;

  beforeAll(async () => {
    llm = await new OpenAiMock().start();
    openrouter = await new OpenRouterMock().start();
    app = await createTestApp();
    const config = app.get(ConfigService);
    // URL de los proveedores apuntando a los mocks (misma vía que LLM_PROVIDER_URL_OVERRIDES).
    config.set('llm.providerUrlOverrides', {
      openai: llm.baseUrl('catalogo'),
      openrouter: `${openrouter.origin}/api/v1`,
    });
    config.set('llm.openrouterAuthUrl', `${openrouter.origin}/auth`);
    webUrl = config.get<string>('webUrl')!;

    owner = await registerOwner(app, 'proveedores');
    editor = await addMember(app, owner, { role: 'EDITOR' });
    viewer = await addMember(app, owner, { role: 'VIEWER' });
    other = await registerOwner(app, 'proveedores-otro');
  });

  afterAll(async () => {
    await app?.close();
    await llm?.stop();
    await openrouter?.stop();
  });

  describe('GET /admin/llm/providers', () => {
    it('lista el catálogo sin detalles del driver y con la conexión de plataforma de Anthropic', async () => {
      const list = await providers(owner);
      expect(list.length).toBeGreaterThanOrEqual(18);
      const anthropic = list.find((p) => p.id === 'anthropic')!;
      // La suite E2E no tiene ANTHROPIC_API_KEY: la conexión de sistema existe pero no está configurada.
      expect(anthropic).toMatchObject({ kind: 'ANTHROPIC', platform: { configured: false, models: 4 }, modelCount: 4 });
      expect(anthropic.keySteps.length).toBeGreaterThan(0);
      expect(list.filter((p) => p.id !== 'anthropic').every((p) => p.platform === null)).toBe(true);
      expect(list.every((p) => p.connected.length === 0)).toBe(true);
      expect(list[0]).not.toHaveProperty('authHeader');
      expect(list[0]).not.toHaveProperty('verifyPath');
    });

    it('EDITOR y VIEWER reciben 403', async () => {
      await editor.api.get('/admin/llm/providers').expect(403);
      await viewer.api.get('/admin/llm/providers').expect(403);
      await editor.api.post('/admin/llm/providers/openai/connect', { fields: { apiKey: llm.apiKey } }).expect(403);
      await editor.api.post('/admin/llm/providers/openrouter/oauth/start').expect(403);
    });
  });

  describe('POST /admin/llm/providers/:id/connect', () => {
    let connectionId: string;

    it('valida campos: proveedor inexistente 404, campo faltante o desconocido 400', async () => {
      await owner.api.post('/admin/llm/providers/no-existe/connect', { fields: {} }).expect(404);
      const missing = await owner.api.post('/admin/llm/providers/openai/connect', { fields: {} }).expect(400);
      expect(missing.body.message).toMatch(/Falta el campo obligatorio «Clave de API»/);
      const extra = await owner.api
        .post('/admin/llm/providers/openai/connect', { fields: { apiKey: 'x', otro: '1' } })
        .expect(400);
      expect(extra.body.message).toMatch(/no reconocidos/);
    });

    it('clave inválida → 400 claro y no guarda nada', async () => {
      const before = await connectionCount(owner.workspaceId);
      const res = await owner.api
        .post('/admin/llm/providers/openai/connect', { fields: { apiKey: 'sk-incorrecta' } })
        .expect(400);
      expect(res.body.message).toMatch(/OpenAI rechazó la clave de API \(HTTP 401\)/);
      expect(JSON.stringify(res.body)).not.toContain('sk-incorrecta');
      expect(await connectionCount(owner.workspaceId)).toBe(before);
    });

    it('URL no alcanzable (local) → 400 sin guardar', async () => {
      const before = await connectionCount(owner.workspaceId);
      const res = await owner.api
        .post('/admin/llm/providers/ollama/connect', { fields: { baseUrl: 'http://127.0.0.1:1/v1' } })
        .expect(400);
      expect(res.body.message).toMatch(/No se pudo alcanzar 127\.0\.0\.1:1/);
      expect(await connectionCount(owner.workspaceId)).toBe(before);
    });

    it('conecta con éxito: prueba la conexión, cifra la clave e importa los modelos elegidos', async () => {
      const probesBefore = llm.requests.filter((r) => r.path === '/catalogo/v1/models').length;
      const res = await owner.api
        .post('/admin/llm/providers/openai/connect', {
          name: 'OpenAI producción',
          fields: { apiKey: llm.apiKey },
          models: ['gpt-e2e'],
        })
        .expect(201);
      const body = res.body as ConnectResult;
      connectionId = body.connection.id;
      expect(body.connection).toMatchObject({
        providerId: 'openai',
        kind: 'OPENAI_COMPATIBLE',
        hasApiKey: true,
        baseUrl: llm.baseUrl('catalogo'),
      });
      expect(body.discoveredModels).toEqual(['eco-mini', 'gpt-e2e']);
      // Sin tarifa verificada: precio 0 y pendiente de completar.
      expect(body.models).toEqual([
        expect.objectContaining({ modelId: 'gpt-e2e', needsPricing: true, inputUsdPerMTok: 0, enabled: true }),
      ]);
      expect(llm.requests.filter((r) => r.path === '/catalogo/v1/models').length).toBeGreaterThan(probesBefore);
      // Solo Bearer: el catálogo no envía la clave en `api-key` a proveedores que no son Azure.
      const probe = llm.requests.filter((r) => r.path === '/catalogo/v1/models').pop()!;
      expect(probe.headers['api-key']).toBeUndefined();

      const row = await prismaOf(app).llmConnection.findUniqueOrThrow({ where: { id: connectionId } });
      expect(row.apiKeyCipher).toBeTruthy();
      expect(row.apiKeyCipher).not.toContain(llm.apiKey);
      expect(row.driverOptions).toEqual({ authHeader: 'bearer' });

      const openai = (await providers(owner)).find((p) => p.id === 'openai')!;
      expect(openai.connected).toEqual([{ connectionId, name: 'OpenAI producción', modelCount: 1, enabled: true }]);
    });

    it('la conexión creada funciona en un agente y al fijar la tarifa deja de estar pendiente', async () => {
      const agent = await createAgent(owner, { provider: connectionId, model: 'gpt-e2e' });
      const r = await chat(owner, agent.id, 'Hola');
      expect(r).toMatchObject({ providerId: connectionId, model: 'gpt-e2e', text: 'Respuesta simulada' });

      const conn = (await owner.api.get('/admin/llm/connections').expect(200)).body as {
        id: string;
        providerId: string | null;
        models: { id: string; needsPricing: boolean }[];
      }[];
      const mine = conn.find((c) => c.id === connectionId)!;
      expect(mine.providerId).toBe('openai');
      const updated = await owner.api
        .patch(`/admin/llm/models/${mine.models[0].id}`, { inputUsdPerMTok: 2, outputUsdPerMTok: 8 })
        .expect(200);
      expect(updated.body).toMatchObject({ needsPricing: false, inputUsdPerMTok: 2 });
    });

    it('sin modelos elegidos importa solo los sugeridos que el proveedor expone', async () => {
      const res = await owner.api
        .post('/admin/llm/providers/openai/connect', { fields: { apiKey: llm.apiKey } })
        .expect(201);
      const body = res.body as ConnectResult;
      // Los sugeridos de OpenAI (gpt-6.1-sol...) no están en el mock: no se importa ninguno.
      expect(body.models).toEqual([]);
      expect(body.discoveredModels).toEqual(['eco-mini', 'gpt-e2e']);
      await owner.api.delete(`/admin/llm/connections/${body.connection.id}`).expect(200);
    });

    it('aislamiento: otro workspace no ve ni descubre la conexión', async () => {
      const list = await providers(other);
      expect(list.find((p) => p.id === 'openai')!.connected).toEqual([]);
      await other.api.get(`/admin/llm/providers/openai/discover?connectionId=${connectionId}`).expect(404);
      const conns = (await other.api.get('/admin/llm/connections').expect(200)).body as unknown[];
      expect(conns).toEqual([]);
    });

    it('GET /discover devuelve los modelos del proveedor y los ya importados', async () => {
      const res = await owner.api.get(`/admin/llm/providers/openai/discover?connectionId=${connectionId}`).expect(200);
      expect(res.body).toEqual({
        connectionId,
        models: ['eco-mini', 'gpt-e2e'],
        discoveredModels: ['eco-mini', 'gpt-e2e'],
        importedModels: ['gpt-e2e'],
      });
      await owner.api.get('/admin/llm/providers/openai/discover').expect(400);
      await owner.api.get(`/admin/llm/providers/gemini/discover?connectionId=${connectionId}`).expect(400);
      await editor.api.get(`/admin/llm/providers/openai/discover?connectionId=${connectionId}`).expect(403);
    });

    it('los endpoints existentes siguen funcionando', async () => {
      const tested = await owner.api.post(`/admin/llm/connections/${connectionId}/test`).expect(200);
      expect(tested.body).toMatchObject({ ok: true });
      const catalog = (await owner.api.get('/llm/catalog').expect(200)).body as { id: string }[];
      expect(catalog.map((c) => c.id)).toEqual(expect.arrayContaining(['anthropic', 'mock', connectionId]));
    });
  });

  describe('OAuth PKCE de OpenRouter', () => {
    it('autoriza → callback → canjea la clave → guarda la conexión cifrada del workspace del state', async () => {
      const start = await owner.api.post('/admin/llm/providers/openrouter/oauth/start', { limit: 25 }).expect(200);
      const { authorizeUrl } = start.body as { authorizeUrl: string };
      expect(new URL(authorizeUrl).searchParams.get('limit')).toBe('25');
      const { code, state } = openrouter.authorize(authorizeUrl);

      const res = await callback({ code, state }).expect(302);
      const target = new URL(res.headers.location);
      expect(`${target.origin}${target.pathname}`).toBe(`${webUrl}/admin/providers`);
      expect(target.searchParams.get('llm')).toBe('connected');
      const connectionId = target.searchParams.get('connectionId')!;

      const row = await prismaOf(app).llmConnection.findUniqueOrThrow({ where: { id: connectionId } });
      expect(row).toMatchObject({
        workspaceId: owner.workspaceId,
        providerId: 'openrouter',
        kind: 'OPENAI_COMPATIBLE',
      });
      expect(row.baseUrl).toBe(`${openrouter.origin}/api/v1`);
      const issued = [...openrouter.keys];
      expect(issued).toHaveLength(1);
      expect(row.apiKeyCipher).not.toContain(issued[0]);
      // La verificación usó /key con la clave emitida y la cabecera de atribución del catálogo.
      const verify = openrouter.requests.find((r) => r.path === '/api/v1/key')!;
      expect(verify.headers.authorization).toBe(`Bearer ${issued[0]}`);
      expect(verify.headers['x-openrouter-title']).toBe('Nexo');

      const discovered = await owner.api
        .get(`/admin/llm/providers/openrouter/discover?connectionId=${connectionId}`)
        .expect(200);
      expect(discovered.body.discoveredModels).toEqual(['meta/llama-y', 'openai/gpt-x']);

      // El state es de un solo uso.
      const replay = await callback({ code, state }).expect(302);
      expect(replay.headers.location).toBe(errorTarget('invalid_state'));
    });

    it('callback con state inválido, de otro flujo, sin código, denegado o con código incorrecto → redirige con error', async () => {
      const states = app.get(OAuthStateService);
      const base = { workspaceId: owner.workspaceId, userId: owner.userId, codeVerifier: 'v'.repeat(43) };

      expect((await callback({ code: 'x', state: 'no-es-un-jwt' }).expect(302)).headers.location).toBe(
        errorTarget('invalid_state'),
      );
      expect((await callback({ code: 'x' }).expect(302)).headers.location).toBe(errorTarget('invalid_state'));
      // Un state de OAuth de conectores no sirve aquí.
      const foreign = await states.sign({ ...base, connectorId: 'conector-x' });
      expect((await callback({ code: 'x', state: foreign }).expect(302)).headers.location).toBe(
        errorTarget('invalid_state'),
      );
      const expired = await states.sign({ ...base, connectorId: OPENROUTER_STATE_ID }, -5);
      expect((await callback({ code: 'x', state: expired }).expect(302)).headers.location).toBe(
        errorTarget('invalid_state'),
      );
      const s1 = await states.sign({ ...base, connectorId: OPENROUTER_STATE_ID });
      expect((await callback({ state: s1 }).expect(302)).headers.location).toBe(errorTarget('missing_code'));
      const s2 = await states.sign({ ...base, connectorId: OPENROUTER_STATE_ID });
      expect((await callback({ state: s2, error: 'access_denied' }).expect(302)).headers.location).toBe(
        errorTarget('access_denied'),
      );
      const s3 = await states.sign({ ...base, connectorId: OPENROUTER_STATE_ID });
      expect((await callback({ state: s3, code: 'codigo-inexistente' }).expect(302)).headers.location).toBe(
        errorTarget('exchange_failed'),
      );
      // Quien inició el flujo ya no es ADMIN+.
      const s4 = await states.sign({ ...base, userId: editor.userId, connectorId: OPENROUTER_STATE_ID });
      expect((await callback({ state: s4, code: 'x' }).expect(302)).headers.location).toBe(errorTarget('forbidden'));

      const conns = await prismaOf(app).llmConnection.count({
        where: { workspaceId: owner.workspaceId, providerId: 'openrouter' },
      });
      expect(conns).toBe(1);
    });
  });
});
