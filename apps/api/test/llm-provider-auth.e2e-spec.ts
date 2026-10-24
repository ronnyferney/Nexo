import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CipherContexts } from '../src/common/crypto/cipher-context';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { bindingTag } from '../src/modules/llm/llm-browser-binding';
import { OAuthStateService } from '../src/modules/oauth/oauth-state.service';
import { Api, createTestApp, llmOAuthCookie, prismaOf } from './utils/app';
import { addMember, chat, createAgent, registerOwner, type Session } from './utils/fixtures';
import { ClaudeMessagesMock } from './utils/mock-servers';

interface Recorded {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  form: Record<string, string>;
}

type DeviceStep = 'authorization_pending' | 'slow_down' | 'expired_token' | 'access_denied' | 'approve';

/**
 * Proveedor de identidad y API de inferencia simulados en un solo servidor:
 * - `/{tenant}/oauth2/v2.0/authorize|token` (Entra ID), `/google/token`, `/google/revoke`, `/hf/oauth/token|device`:
 *   authorization code con PKCE S256 (valida client_id, client_secret o Basic, redirect_uri y scope), refresh token y
 *   código de dispositivo guionizado.
 * - `/vertex/...`, `/azure/openai/v1`, `/hf/v1`, `/ollama/v1`: Chat Completions que exige un access token vigente.
 */
class IdpMock {
  private server?: Server;
  private port = 0;
  readonly requests: Recorded[] = [];
  private readonly codes = new Map<string, { challenge: string; clientId: string; redirectUri: string }>();
  private readonly refreshTokens = new Map<string, string>();
  /** access token → expiración (ms); los revocados o expirados reciben 401. */
  readonly accessTokens = new Map<string, number>();
  readonly revoked: string[] = [];
  readonly devices = new Map<string, DeviceStep[]>();
  /** Proyectos de Vertex sin permiso (responden 403). */
  readonly forbiddenProjects = new Set<string>(['sin-permiso-123']);
  readonly issueRefresh = true;
  deviceInterval = 1;
  /** Claims del `id_token` que acompaña al token del código de dispositivo (null = el proveedor no lo entrega). */
  deviceIdToken: Record<string, unknown> | null = null;

  get origin() {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        const url = new URL(req.url ?? '/', this.origin);
        const form = Object.fromEntries(new URLSearchParams(raw));
        this.requests.push({ method: req.method ?? 'GET', path: url.pathname, headers: req.headers, form });
        const [status, payload] = this.handle(req, url.pathname, form);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
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

  tokenRequests(path: string) {
    return this.requests.filter((r) => r.path === path && r.method === 'POST');
  }

  private issue(expiresIn = 3600, refresh = this.issueRefresh): Record<string, unknown> {
    const access = `at-${randomBytes(6).toString('hex')}`;
    this.accessTokens.set(access, Date.now() + expiresIn * 1000);
    const body: Record<string, unknown> = { access_token: access, token_type: 'Bearer', expires_in: expiresIn };
    if (refresh) {
      const refresh = `rt-${randomBytes(6).toString('hex')}`;
      this.refreshTokens.set(refresh, access);
      body.refresh_token = refresh;
    }
    return body;
  }

  /** Expira todos los access tokens emitidos (simula el paso de una hora). */
  expireAll() {
    for (const k of this.accessTokens.keys()) this.accessTokens.set(k, 0);
  }

  private clientId(req: IncomingMessage, form: Record<string, string>): { id?: string; secret?: string } {
    const auth = req.headers.authorization ?? '';
    if (auth.startsWith('Basic ')) {
      const [id, secret] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
      return { id: decodeURIComponent(id), secret: decodeURIComponent(secret) };
    }
    return { id: form.client_id, secret: form.client_secret };
  }

  private handle(req: IncomingMessage, path: string, form: Record<string, string>): [number, unknown] {
    // ---- Endpoints de token ----
    const tokenPath = /^\/(google|hf\/oauth|[^/]+\/oauth2\/v2\.0)\/token$/.exec(path);
    if (tokenPath && req.method === 'POST') {
      const client = this.clientId(req, form);
      if (!client.id) return [401, { error: 'invalid_client' }];
      if (form.grant_type === 'authorization_code') {
        const c = this.codes.get(form.code);
        this.codes.delete(form.code);
        const verifier = createHash('sha256')
          .update(form.code_verifier ?? '')
          .digest('base64url');
        if (!c || c.challenge !== verifier || c.clientId !== client.id || c.redirectUri !== form.redirect_uri) {
          return [400, { error: 'invalid_grant' }];
        }
        // Hugging Face no documenta refresh token.
        return [200, this.issue(3600, tokenPath[1] !== 'hf/oauth')];
      }
      if (form.grant_type === 'refresh_token') {
        if (!this.refreshTokens.has(form.refresh_token)) return [400, { error: 'invalid_grant' }];
        const body = this.issue();
        // El refresh token original sigue valiendo (Google); no rota salvo que se emita otro.
        if (body.refresh_token) this.refreshTokens.delete(body.refresh_token as string);
        delete body.refresh_token;
        return [200, body];
      }
      if (form.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
        const steps = this.devices.get(form.device_code);
        if (!steps) return [400, { error: 'incorrect_device_code' }];
        const step = steps.length > 1 ? steps.shift()! : steps[0];
        if (step === 'approve') {
          this.devices.delete(form.device_code);
          const body = this.issue(28800, false);
          if (this.deviceIdToken) {
            const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
            body.id_token = `${part({ alg: 'RS256' })}.${part(this.deviceIdToken)}.firma`;
          }
          return [200, body];
        }
        if (step === 'slow_down') return [400, { error: 'slow_down', interval: this.deviceInterval + 5 }];
        return [400, { error: step }];
      }
      return [400, { error: 'unsupported_grant_type' }];
    }
    if (path === '/hf/oauth/device' && req.method === 'POST') {
      const deviceCode = `dc-${randomBytes(8).toString('hex')}`;
      this.devices.set(deviceCode, ['authorization_pending']);
      return [
        200,
        {
          device_code: deviceCode,
          user_code: 'WDJB-MJHT',
          verification_uri: 'https://huggingface.co/oauth/device',
          expires_in: 900,
          interval: this.deviceInterval,
        },
      ];
    }
    if (path === '/google/revoke' && req.method === 'POST') {
      this.revoked.push(form.token);
      this.refreshTokens.delete(form.token);
      return [200, {}];
    }

    // ---- APIs de inferencia ----
    if (path.startsWith('/ollama/v1/models')) return [200, { data: [{ id: 'llama3.2' }, { id: 'qwen3' }] }];
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const exp = this.accessTokens.get(bearer);
    if (/\/(models|chat\/completions)$/.test(path)) {
      if (!exp || exp < Date.now()) return [401, { error: { message: 'Token inválido o expirado' } }];
      const project = /\/projects\/([^/]+)\//.exec(path)?.[1];
      if (project && this.forbiddenProjects.has(project)) {
        return [403, { error: { message: 'Permission denied on resource project' } }];
      }
      if (path.endsWith('/models')) {
        // Vertex y Azure v1 no documentan /models: el mock responde 404 (verificación tolerante).
        if (path.startsWith('/vertex') || path.startsWith('/azure')) return [404, { error: { message: 'Not found' } }];
        return [200, { data: [{ id: 'deepseek-ai/DeepSeek-R1' }, { id: 'org/modelo-hf' }] }];
      }
      return [
        200,
        {
          choices: [{ message: { role: 'assistant', content: 'Respuesta con OAuth' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 4 },
        },
      ];
    }
    return [404, { error: { message: 'No encontrado' } }];
  }

  /** Simula el consentimiento: valida la URL de autorización y devuelve la query del callback. */
  authorize(authorizeUrl: string, expected: { path: string; clientId: string; scope: string; provider: string }) {
    const url = new URL(authorizeUrl);
    expect(url.origin + url.pathname).toBe(`${this.origin}${expected.path}`);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(expected.clientId);
    expect(url.searchParams.get('scope')).toBe(expected.scope);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const redirectUri = url.searchParams.get('redirect_uri')!;
    expect(new URL(redirectUri).pathname).toBe(`/api/llm/oauth/${expected.provider}/callback`);
    const code = `code-${randomBytes(6).toString('hex')}`;
    this.codes.set(code, {
      challenge: url.searchParams.get('code_challenge')!,
      clientId: expected.clientId,
      redirectUri,
    });
    return { code, state: url.searchParams.get('state')!, url };
  }
}

interface MechanismView {
  type: string;
  label: string;
  available: boolean;
  unavailableReason?: string;
  primary: boolean;
}

interface ProviderView {
  id: string;
  mechanisms: MechanismView[];
  suggestedModels: { id: string; specialties: string[]; contextTokens: number | null; tier: string }[];
}

interface ConnectionView {
  id: string;
  providerId: string;
  credentialType: string;
  oauthRenewable: boolean | null;
  hasApiKey: boolean;
  models: { modelId: string; specialties: string[]; contextTokens: number | null; tier: string }[];
}

describe('Mecanismos oficiales de conexión de proveedores IA (E2E)', () => {
  let app: INestApplication;
  let idp: IdpMock;
  let config: ConfigService;
  let webUrl: string;
  let owner: Session;
  let editor: Session;
  let admin: Session;
  let other: Session;

  const providers = async (s: Session) =>
    ((await s.api.get('/admin/llm/providers').expect(200)).body as { providers: ProviderView[] }).providers;
  const callback = (provider: string, query: Record<string, string>) =>
    new Api(app)
      .get(`/llm/oauth/${provider}/callback?${new URLSearchParams(query).toString()}`)
      .set('Cookie', llmOAuthCookie())
      .redirects(0);
  const errorTarget = (provider: string, reason: string) =>
    `${webUrl}/admin/providers?llm=error&provider=${provider}&reason=${reason}`;
  const connectedId = (location: string, provider: string) => {
    const target = new URL(location);
    expect(`${target.origin}${target.pathname}`).toBe(`${webUrl}/admin/providers`);
    expect(target.searchParams.get('llm')).toBe('connected');
    expect(target.searchParams.get('provider')).toBe(provider);
    return target.searchParams.get('connectionId')!;
  };
  const configureApps = () => {
    config.set('OAUTH_LLM_VERTEX_CLIENT_ID', 'nexo-vertex.apps.googleusercontent.com');
    config.set('OAUTH_LLM_VERTEX_CLIENT_SECRET', 'secreto-vertex');
    config.set('OAUTH_LLM_AZURE_OPENAI_CLIENT_ID', 'nexo-entra-app');
    config.set('OAUTH_LLM_AZURE_OPENAI_CLIENT_SECRET', 'secreto-entra');
    // App pública de Hugging Face (sin secreto, PKCE).
    config.set('OAUTH_LLM_HUGGINGFACE_CLIENT_ID', 'nexo-hf-app');
  };

  beforeAll(async () => {
    idp = await new IdpMock().start();
    app = await createTestApp();
    config = app.get(ConfigService);
    config.set('llm.providerUrlOverrides', {
      vertex: `${idp.origin}/vertex/v1/projects/mi-proyecto-123/locations/global/endpoints/openapi`,
      'azure-openai': `${idp.origin}/azure/openai/v1`,
      huggingface: `${idp.origin}/hf/v1`,
    });
    config.set('llm.oauthEndpointOverrides', {
      vertex: {
        authorizeUrl: `${idp.origin}/google/auth`,
        tokenUrl: `${idp.origin}/google/token`,
        revokeUrl: `${idp.origin}/google/revoke`,
      },
      'azure-openai': {
        authorizeUrl: `${idp.origin}/{{ tenantId }}/oauth2/v2.0/authorize`,
        tokenUrl: `${idp.origin}/{{ tenantId }}/oauth2/v2.0/token`,
      },
      huggingface: {
        authorizeUrl: `${idp.origin}/hf/oauth/authorize`,
        tokenUrl: `${idp.origin}/hf/oauth/token`,
        deviceUrl: `${idp.origin}/hf/oauth/device`,
      },
    });
    webUrl = config.get<string>('webUrl')!;
    owner = await registerOwner(app, 'mecanismos');
    editor = await addMember(app, owner, { role: 'EDITOR' });
    admin = await addMember(app, owner, { role: 'ADMIN' });
    other = await registerOwner(app, 'mecanismos-otro');
  });

  afterAll(async () => {
    await app?.close();
    await idp?.stop();
  });

  describe('app OAuth de Nexo no configurada', () => {
    it('los mecanismos OAuth y de dispositivo se listan con available:false y el motivo', async () => {
      const list = await providers(owner);
      const vertex = list.find((p) => p.id === 'vertex')!;
      expect(vertex.mechanisms).toEqual([
        expect.objectContaining({ type: 'OAUTH', label: 'Iniciar sesión con Google', available: false, primary: true }),
      ]);
      expect(vertex.mechanisms[0].unavailableReason).toMatch(/OAUTH_LLM_VERTEX_CLIENT_ID/);
      const hf = list.find((p) => p.id === 'huggingface')!;
      expect(hf.mechanisms.map((m) => [m.type, m.available])).toEqual([
        ['OAUTH', false],
        ['DEVICE_CODE', false],
        ['API_KEY', true],
      ]);
      const azure = list.find((p) => p.id === 'azure-openai')!;
      expect(azure.mechanisms.map((m) => [m.type, m.available, m.primary])).toEqual([
        ['OAUTH', false, true],
        ['API_KEY', true, false],
      ]);
      expect(list.find((p) => p.id === 'openrouter')!.mechanisms.every((m) => m.available)).toBe(true);
      // CONNECTOR_ALLOW_PRIVATE_NETWORKS=true en la suite: la detección local está disponible.
      expect(list.find((p) => p.id === 'ollama')!.mechanisms).toEqual([
        { type: 'LOCAL_DETECT', label: 'Detectar servidor local', available: true, primary: true },
      ]);
      const opus = list.find((p) => p.id === 'anthropic')!.suggestedModels.find((m) => m.id === 'claude-opus-5-5')!;
      expect(opus).toMatchObject({
        specialties: ['CODE', 'GENERAL', 'VISION'],
        contextTokens: 1_000_000,
        tier: 'PREMIUM',
      });
    });

    it('intentar iniciar sesión responde 400 sin crear flujos ni conexiones', async () => {
      const r1 = await owner.api
        .post('/admin/llm/providers/vertex/oauth/start', { fields: { projectId: 'mi-proyecto-123' } })
        .expect(400);
      expect((r1.body as { message: string }).message).toMatch(/no está configurada.*OAUTH_LLM_VERTEX_CLIENT_ID/);
      await owner.api
        .post('/admin/llm/providers/azure-openai/oauth/start', { fields: { resource: 'contoso', deployment: 'd' } })
        .expect(400);
      await owner.api.post('/admin/llm/providers/huggingface/device/start', {}).expect(400);
      expect(await prismaOf(app).llmAuthFlow.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
      expect(await prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
    });

    it('mecanismos inexistentes y formulario de clave en proveedores solo OAuth → 400', async () => {
      configureApps();
      const r = await owner.api
        .post('/admin/llm/providers/vertex/connect', { fields: { projectId: 'mi-proyecto-123' } })
        .expect(400);
      expect((r.body as { message: string }).message).toMatch(/no usa clave de API.*Iniciar sesión con Google/);
      await owner.api.post('/admin/llm/providers/openai/oauth/start', {}).expect(400);
      await owner.api.post('/admin/llm/providers/vertex/device/start', {}).expect(400);
      await owner.api.post('/admin/llm/providers/no-existe/oauth/start', {}).expect(404);
      await editor.api.post('/admin/llm/providers/vertex/oauth/start', {}).expect(403);
      await editor.api.post('/admin/llm/providers/huggingface/device/start', {}).expect(403);
      await editor.api.post('/admin/llm/providers/ollama/detect', {}).expect(403);
    });
  });

  describe('Google Vertex AI con «Iniciar sesión con Google»', () => {
    let connectionId: string;

    it('autoriza con PKCE → canjea → guarda tokens cifrados (sin /models documentado) e importa los modelos', async () => {
      configureApps();
      const start = await owner.api
        .post('/admin/llm/providers/vertex/oauth/start', {
          name: 'Vertex producción',
          fields: { projectId: 'mi-proyecto-123', region: 'global' },
          models: ['google/gemini-e2e'],
        })
        .expect(200);
      const { code, state, url } = idp.authorize((start.body as { authorizeUrl: string }).authorizeUrl, {
        path: '/google/auth',
        clientId: 'nexo-vertex.apps.googleusercontent.com',
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        provider: 'vertex',
      });
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('prompt')).toBe('consent');

      const res = await callback('vertex', { code, state }).expect(302);
      connectionId = connectedId(res.headers.location, 'vertex');
      const exchange = idp.tokenRequests('/google/token').pop()!;
      expect(exchange.form).toMatchObject({
        grant_type: 'authorization_code',
        client_id: 'nexo-vertex.apps.googleusercontent.com',
        client_secret: 'secreto-vertex',
      });

      const row = await prismaOf(app).llmConnection.findUniqueOrThrow({
        where: { id: connectionId },
        include: { models: true },
      });
      expect(row).toMatchObject({
        workspaceId: owner.workspaceId,
        providerId: 'vertex',
        name: 'Vertex producción',
        credentialType: 'OAUTH',
        providerFields: { projectId: 'mi-proyecto-123', region: 'global' },
        driverOptions: { authHeader: 'bearer' },
      });
      expect(row.oauthRefreshCipher).toBeTruthy();
      expect(row.oauthExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 3_000_000);
      const crypto = app.get(CryptoService);
      expect(idp.accessTokens.has(crypto.decrypt(row.apiKeyCipher!, CipherContexts.llmApiKey(row.workspaceId)))).toBe(
        true,
      );
      expect(row.models.map((m) => m.modelId)).toEqual(['google/gemini-e2e']);

      const models = (await owner.api.get(`/admin/llm/connections/${connectionId}/models`).expect(200)).body as {
        modelId: string;
        specialties: string[];
        contextTokens: number | null;
        tier: string;
        inputUsdPerMTok: number;
        needsPricing: boolean;
      }[];
      expect(models).toEqual([
        expect.objectContaining({
          modelId: 'google/gemini-e2e',
          specialties: ['GENERAL'],
          contextTokens: null,
          tier: 'STANDARD',
          inputUsdPerMTok: 0,
          needsPricing: true,
        }),
      ]);
      await other.api.get(`/admin/llm/connections/${connectionId}/models`).expect(404);
      const conn = ((await owner.api.get('/admin/llm/connections').expect(200)).body as ConnectionView[]).find(
        (c) => c.id === connectionId,
      )!;
      expect(conn).toMatchObject({ credentialType: 'OAUTH', oauthRenewable: true, hasApiKey: true });
      expect(JSON.stringify(conn)).not.toMatch(/at-|rt-/);

      // El state y el flujo son de un solo uso.
      expect((await callback('vertex', { code, state }).expect(302)).headers.location).toBe(
        errorTarget('vertex', 'invalid_state'),
      );
    });

    it('usa el token en el chat de un agente y lo renueva automáticamente al expirar', async () => {
      const agent = await createAgent(owner, { provider: connectionId, model: 'google/gemini-e2e' });
      const first = await chat(owner, agent.id, 'Hola Vertex');
      expect(first).toMatchObject({
        providerId: connectionId,
        model: 'google/gemini-e2e',
        text: 'Respuesta con OAuth',
      });
      const refreshesBefore = idp.tokenRequests('/google/token').filter((r) => r.form.grant_type === 'refresh_token');

      // Pasa una hora: el token emitido ya no sirve y la conexión indica que vence.
      idp.expireAll();
      const before = await prismaOf(app).llmConnection.findUniqueOrThrow({ where: { id: connectionId } });
      await prismaOf(app).llmConnection.update({
        where: { id: connectionId },
        data: { oauthExpiresAt: new Date(Date.now() - 1000) },
      });

      const second = await chat(owner, agent.id, 'Sigo aquí');
      expect(second.text).toBe('Respuesta con OAuth');
      const refreshes = idp.tokenRequests('/google/token').filter((r) => r.form.grant_type === 'refresh_token');
      expect(refreshes.length).toBe(refreshesBefore.length + 1);
      expect(refreshes.at(-1)!.form).toMatchObject({ client_id: 'nexo-vertex.apps.googleusercontent.com' });
      const after = await prismaOf(app).llmConnection.findUniqueOrThrow({ where: { id: connectionId } });
      expect(after.apiKeyCipher).not.toBe(before.apiKeyCipher);
      expect(after.oauthRefreshCipher).toBe(before.oauthRefreshCipher);
      expect(after.oauthExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 3_000_000);
      const chats = idp.requests.filter((r) => r.path.endsWith('/chat/completions'));
      const crypto = app.get(CryptoService);
      expect(chats.at(-1)!.headers.authorization).toBe(
        `Bearer ${crypto.decrypt(after.apiKeyCipher!, CipherContexts.llmApiKey(after.workspaceId))}`,
      );
      await prismaOf(app).agent.delete({ where: { id: agent.id } });
    });

    it('cerrar sesión revoca y borra los tokens pero conserva la conexión, sus modelos y los agentes', async () => {
      const agent = await createAgent(owner, { provider: connectionId, model: 'google/gemini-e2e' });
      const row = await prismaOf(app).llmConnection.findUniqueOrThrow({ where: { id: connectionId } });
      const refresh = app
        .get(CryptoService)
        .decrypt(row.oauthRefreshCipher!, CipherContexts.llmRefresh(row.workspaceId));
      await other.api.post(`/admin/llm/connections/${connectionId}/sign-out`, {}).expect(404);

      const res = await owner.api.post(`/admin/llm/connections/${connectionId}/sign-out`, {}).expect(200);
      expect(res.body).toMatchObject({
        revoked: true,
        connection: { id: connectionId, signedOut: true, hasApiKey: false, oauthRenewable: false },
      });
      expect(idp.revoked).toContain(refresh);
      const after = await prismaOf(app).llmConnection.findUniqueOrThrow({
        where: { id: connectionId },
        include: { models: true },
      });
      expect(after).toMatchObject({
        apiKeyCipher: null,
        oauthRefreshCipher: null,
        oauthExpiresAt: null,
        enabled: true,
      });
      expect(after.models.map((m) => m.modelId)).toEqual(['google/gemini-e2e']);
      await expect(chat(owner, agent.id, 'Hola')).rejects.toThrow(/Vertex producción.*está cerrada/);
      const catalog = (await owner.api.get('/llm/catalog').expect(200)).body as { id: string; configured: boolean }[];
      expect(catalog.find((c) => c.id === connectionId)?.configured).toBe(false);
      await prismaOf(app).agent.delete({ where: { id: agent.id } });
    });

    it('volver a iniciar sesión reemplaza los tokens de la misma conexión (mismo id, campos y modelos)', async () => {
      const agent = await createAgent(owner, { provider: connectionId, model: 'google/gemini-e2e' });
      const before = await prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } });
      await other.api.post('/admin/llm/providers/vertex/oauth/start', { connectionId }).expect(404);
      await owner.api.post('/admin/llm/providers/azure-openai/oauth/start', { connectionId }).expect(400);

      // Los campos guardados (proyecto y región) mandan sobre los del cuerpo.
      const start = await owner.api
        .post('/admin/llm/providers/vertex/oauth/start', { connectionId, fields: { projectId: 'otro', region: 'x' } })
        .expect(200);
      const { code, state } = idp.authorize((start.body as { authorizeUrl: string }).authorizeUrl, {
        path: '/google/auth',
        clientId: 'nexo-vertex.apps.googleusercontent.com',
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        provider: 'vertex',
      });
      const res = await callback('vertex', { code, state }).expect(302);
      expect(connectedId(res.headers.location, 'vertex')).toBe(connectionId);
      expect(await prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } })).toBe(before);

      const row = await prismaOf(app).llmConnection.findUniqueOrThrow({
        where: { id: connectionId },
        include: { models: true },
      });
      expect(row).toMatchObject({
        name: 'Vertex producción',
        providerFields: { projectId: 'mi-proyecto-123', region: 'global' },
      });
      expect(row.oauthRefreshCipher).toBeTruthy();
      expect(row.models.map((m) => m.modelId)).toEqual(['google/gemini-e2e']);
      expect((await chat(owner, agent.id, 'De vuelta')).text).toBe('Respuesta con OAuth');
      await prismaOf(app).agent.delete({ where: { id: agent.id } });
    });

    it('desconectar revoca el grant en Google y borra la conexión', async () => {
      const row = await prismaOf(app).llmConnection.findUniqueOrThrow({ where: { id: connectionId } });
      const refresh = app
        .get(CryptoService)
        .decrypt(row.oauthRefreshCipher!, CipherContexts.llmRefresh(row.workspaceId));
      const res = await owner.api.delete(`/admin/llm/connections/${connectionId}`).expect(200);
      expect(res.body).toEqual({ deleted: true, revoked: true });
      expect(idp.revoked).toContain(refresh);
      expect(await prismaOf(app).llmConnection.count({ where: { id: connectionId } })).toBe(0);
    });

    it('callback con errores → redirige con el motivo sin crear conexiones', async () => {
      const states = app.get(OAuthStateService);
      const startFlow = async (fields: Record<string, string> = { projectId: 'mi-proyecto-123' }) => {
        const r = await owner.api.post('/admin/llm/providers/vertex/oauth/start', { fields }).expect(200);
        return new URL((r.body as { authorizeUrl: string }).authorizeUrl).searchParams.get('state')!;
      };
      const before = await prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } });

      expect((await callback('vertex', { code: 'x', state: 'no-jwt' }).expect(302)).headers.location).toBe(
        errorTarget('vertex', 'invalid_state'),
      );
      // Un state de otro proveedor (o de los conectores) no sirve aquí.
      const foreign = await states.sign({
        workspaceId: owner.workspaceId,
        userId: owner.userId,
        connectorId: 'llm-provider:azure-openai:flujo',
        codeVerifier: 'v'.repeat(43),
      });
      expect((await callback('vertex', { code: 'x', state: foreign }).expect(302)).headers.location).toBe(
        errorTarget('vertex', 'invalid_state'),
      );
      expect((await callback('vertex', { state: await startFlow() }).expect(302)).headers.location).toBe(
        errorTarget('vertex', 'missing_code'),
      );
      expect(
        (await callback('vertex', { state: await startFlow(), error: 'access_denied' }).expect(302)).headers.location,
      ).toBe(errorTarget('vertex', 'access_denied'));
      expect((await callback('vertex', { state: await startFlow(), code: 'malo' }).expect(302)).headers.location).toBe(
        errorTarget('vertex', 'exchange_failed'),
      );

      // Sin permiso sobre el proyecto (403 del endpoint): no se guarda la conexión.
      const startRes = await owner.api
        .post('/admin/llm/providers/vertex/oauth/start', { fields: { projectId: 'sin-permiso-123' } })
        .expect(200);
      config.set('llm.providerUrlOverrides', {
        ...config.get<Record<string, string>>('llm.providerUrlOverrides'),
        vertex: `${idp.origin}/vertex/v1/projects/sin-permiso-123/locations/global/endpoints/openapi`,
      });
      const denied = idp.authorize((startRes.body as { authorizeUrl: string }).authorizeUrl, {
        path: '/google/auth',
        clientId: 'nexo-vertex.apps.googleusercontent.com',
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        provider: 'vertex',
      });
      expect((await callback('vertex', { code: denied.code, state: denied.state }).expect(302)).headers.location).toBe(
        errorTarget('vertex', 'verification_failed'),
      );
      config.set('llm.providerUrlOverrides', {
        ...config.get<Record<string, string>>('llm.providerUrlOverrides'),
        vertex: `${idp.origin}/vertex/v1/projects/mi-proyecto-123/locations/global/endpoints/openapi`,
      });

      // Quien inició el flujo dejó de ser ADMIN+.
      const editorFlow = await prismaOf(app).llmAuthFlow.create({
        data: {
          type: 'OAUTH',
          providerId: 'vertex',
          userId: editor.userId,
          workspaceId: owner.workspaceId,
          fields: { projectId: 'mi-proyecto-123', region: 'global' },
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      const editorState = await states.sign({
        workspaceId: owner.workspaceId,
        userId: editor.userId,
        // Con la huella de la cookie del navegador de la prueba (M1), para llegar a la comprobación de rol.
        connectorId: `llm-provider:vertex:${editorFlow.id}:${bindingTag(llmOAuthCookie().split('=')[1])}`,
        codeVerifier: 'v'.repeat(43),
      });
      expect((await callback('vertex', { state: editorState, code: 'x' }).expect(302)).headers.location).toBe(
        errorTarget('vertex', 'forbidden'),
      );
      expect(await prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } })).toBe(before);
    });
  });

  describe('Azure OpenAI con «Iniciar sesión con Microsoft» (Entra ID)', () => {
    it('autoriza en el inquilino, envía el scope al canjear, usa Bearer en el chat y renueva', async () => {
      const start = await owner.api
        .post('/admin/llm/providers/azure-openai/oauth/start', {
          fields: { resource: 'contoso', deployment: 'gpt-prod', tenantId: 'contoso.onmicrosoft.com' },
        })
        .expect(200);
      const scope = 'https://ai.azure.com/.default offline_access';
      const { code, state } = idp.authorize((start.body as { authorizeUrl: string }).authorizeUrl, {
        path: '/contoso.onmicrosoft.com/oauth2/v2.0/authorize',
        clientId: 'nexo-entra-app',
        scope,
        provider: 'azure-openai',
      });
      const res = await callback('azure-openai', { code, state }).expect(302);
      const connectionId = connectedId(res.headers.location, 'azure-openai');
      const exchange = idp.tokenRequests('/contoso.onmicrosoft.com/oauth2/v2.0/token').pop()!;
      expect(exchange.form).toMatchObject({ grant_type: 'authorization_code', scope, client_secret: 'secreto-entra' });

      const row = await prismaOf(app).llmConnection.findUniqueOrThrow({
        where: { id: connectionId },
        include: { models: true },
      });
      expect(row).toMatchObject({ credentialType: 'OAUTH', driverOptions: { authHeader: 'bearer' } });
      expect(row.providerFields).toEqual({
        resource: 'contoso',
        deployment: 'gpt-prod',
        tenantId: 'contoso.onmicrosoft.com',
      });
      // En la API v1 el despliegue es el modelo.
      expect(row.models.map((m) => m.modelId)).toEqual(['gpt-prod']);

      const agent = await createAgent(owner, { provider: connectionId, model: 'gpt-prod' });
      await chat(owner, agent.id, 'Hola Azure');
      const call = idp.requests.filter((r) => r.path === '/azure/openai/v1/chat/completions').pop()!;
      expect(call.headers.authorization).toMatch(/^Bearer at-/);
      expect(call.headers['api-key']).toBeUndefined();

      idp.expireAll();
      await prismaOf(app).llmConnection.update({
        where: { id: connectionId },
        data: { oauthExpiresAt: new Date(Date.now() - 1000) },
      });
      await chat(owner, agent.id, 'Otra vez');
      const refresh = idp.tokenRequests('/contoso.onmicrosoft.com/oauth2/v2.0/token').pop()!;
      expect(refresh.form).toMatchObject({ grant_type: 'refresh_token', scope });

      // Entra ID no documenta revocación: se borra sin llamar al proveedor.
      await prismaOf(app).agent.delete({ where: { id: agent.id } });
      const revokedBefore = idp.revoked.length;
      const del = await owner.api.delete(`/admin/llm/connections/${connectionId}`).expect(200);
      expect(del.body).toEqual({ deleted: true, revoked: false });
      expect(idp.revoked.length).toBe(revokedBefore);
    });
  });

  describe('Hugging Face con código de dispositivo', () => {
    const advance = (flowId: string) =>
      prismaOf(app).llmAuthFlow.update({ where: { id: flowId }, data: { nextPollAt: new Date(0) } });
    const poll = (s: Session, flowId: string) =>
      s.api.post('/admin/llm/providers/huggingface/device/poll', { flowId }).expect(200);
    const startDevice = async () => {
      const res = await owner.api.post('/admin/llm/providers/huggingface/device/start', {}).expect(200);
      return res.body as {
        flowId: string;
        userCode: string;
        verificationUri: string;
        expiresIn: number;
        interval: number;
      };
    };
    const deviceCodes = () => [...idp.devices.keys()];

    it('pending → slow_down → connected, respetando el intervalo del proveedor', async () => {
      const start = await startDevice();
      expect(start).toMatchObject({
        userCode: 'WDJB-MJHT',
        verificationUri: 'https://huggingface.co/oauth/device',
        expiresIn: 900,
        interval: 1,
      });
      expect(start).not.toHaveProperty('deviceCode');
      const deviceRequest = idp.tokenRequests('/hf/oauth/device').pop()!;
      // App pública: solo client_id (sin secreto ni Basic) y el scope de inferencia.
      expect(deviceRequest.form).toEqual({ scope: 'openid profile inference-api', client_id: 'nexo-hf-app' });
      expect(deviceRequest.headers.authorization).toBeUndefined();
      const deviceCode = deviceCodes().pop()!;
      idp.devices.set(deviceCode, ['authorization_pending', 'slow_down', 'approve']);

      // Antes del intervalo no se consulta al proveedor.
      const tokenCalls = () => idp.tokenRequests('/hf/oauth/token').length;
      const calls0 = tokenCalls();
      expect((await poll(owner, start.flowId)).body).toEqual({ status: 'pending', interval: 1 });
      expect(tokenCalls()).toBe(calls0);

      await advance(start.flowId);
      expect((await poll(owner, start.flowId)).body).toEqual({ status: 'pending', interval: 1 });
      expect(tokenCalls()).toBe(calls0 + 1);
      expect(idp.tokenRequests('/hf/oauth/token').pop()!.form).toEqual({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: 'nexo-hf-app',
      });

      await advance(start.flowId);
      expect((await poll(owner, start.flowId)).body).toEqual({ status: 'slow_down', interval: 6 });
      const flow = await prismaOf(app).llmAuthFlow.findUniqueOrThrow({ where: { id: start.flowId } });
      expect(flow.intervalSec).toBe(6);
      expect(flow.nextPollAt!.getTime()).toBeGreaterThan(Date.now() + 4000);

      await advance(start.flowId);
      // M1b: con los tokens emitidos la conexión todavía no existe; se muestra la cuenta (HF sin id_token: no la informa).
      const connectionsBefore = await prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } });
      const awaiting = (await poll(owner, start.flowId)).body as Record<string, unknown>;
      expect(awaiting).toMatchObject({ status: 'confirm', account: { available: false, source: null } });
      expect(awaiting.confirmExpiresIn).toBeGreaterThan(500);
      expect(JSON.stringify(awaiting)).not.toMatch(/at-[0-9a-f]{12}/);
      expect(await prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } })).toBe(
        connectionsBefore,
      );
      const pendingRow = await prismaOf(app).llmAuthFlow.findUniqueOrThrow({ where: { id: start.flowId } });
      expect(pendingRow.status).toBe('confirm');
      expect(pendingRow.deviceCodeCipher).toMatch(/^v2:/);
      expect(pendingRow.deviceCodeCipher).not.toMatch(/at-[0-9a-f]{12}/);
      // Solo el ADMIN que inició el flujo lo ve y lo confirma.
      await admin.api.post('/admin/llm/providers/huggingface/device/poll', { flowId: start.flowId }).expect(404);
      await admin.api.post('/admin/llm/providers/huggingface/device/confirm', { flowId: start.flowId }).expect(404);
      await editor.api.post('/admin/llm/providers/huggingface/device/confirm', { flowId: start.flowId }).expect(403);
      // Seguir sondeando no vuelve a llamar al proveedor.
      const callsAwaiting = tokenCalls();
      expect((await poll(owner, start.flowId)).body).toMatchObject({ status: 'confirm' });
      expect(tokenCalls()).toBe(callsAwaiting);

      const done = (
        await owner.api.post('/admin/llm/providers/huggingface/device/confirm', { flowId: start.flowId }).expect(200)
      ).body as { status: string; connection: ConnectionView };
      expect(done.status).toBe('connected');
      expect(done.connection).toMatchObject({
        providerId: 'huggingface',
        credentialType: 'OAUTH',
        oauthRenewable: false,
      });
      // Sugerido verificado (DeepSeek R1 = razonamiento) importado con sus metadatos.
      expect(done.connection.models).toEqual([
        expect.objectContaining({ modelId: 'deepseek-ai/DeepSeek-R1', specialties: ['REASONING'], tier: 'PREMIUM' }),
      ]);
      // Idempotente: volver a consultar devuelve la misma conexión sin llamar al proveedor.
      const calls = tokenCalls();
      const again = (await poll(owner, start.flowId)).body as { status: string; connection: ConnectionView };
      expect(again).toMatchObject({ status: 'connected', connection: { id: done.connection.id } });
      expect(tokenCalls()).toBe(calls);
      const stored = await prismaOf(app).llmAuthFlow.findUniqueOrThrow({ where: { id: start.flowId } });
      expect(stored.deviceCodeCipher).toBeNull();

      // Aislamiento: otro workspace no ve el flujo.
      await other.api.post('/admin/llm/providers/huggingface/device/poll', { flowId: start.flowId }).expect(404);
      // Confirmar dos veces no crea otra conexión.
      await owner.api.post('/admin/llm/providers/huggingface/device/confirm', { flowId: start.flowId }).expect(400);
    });

    it('M1b: muestra la cuenta del id_token y «No es mi cuenta» descarta los tokens sin crear la conexión', async () => {
      idp.deviceIdToken = {
        sub: 'hf-77',
        aud: 'nexo-hf-app',
        exp: Math.floor(Date.now() / 1000) + 600,
        name: 'Ana Pérez',
        preferred_username: 'ana-hf',
        email: 'ana@acme.test',
      };
      try {
        const start = await startDevice();
        idp.devices.set(deviceCodes().pop()!, ['approve']);
        await advance(start.flowId);
        const awaiting = (await poll(owner, start.flowId)).body as Record<string, unknown>;
        expect(awaiting).toMatchObject({
          status: 'confirm',
          account: {
            available: true,
            source: 'id_token',
            subject: 'hf-77',
            email: 'ana@acme.test',
            name: 'Ana Pérez',
            username: 'ana-hf',
          },
        });
        const before = await prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } });
        const cancelled = await owner.api
          .post('/admin/llm/providers/huggingface/device/cancel', { flowId: start.flowId })
          .expect(200);
        expect(cancelled.body).toEqual({ status: 'cancelled' });
        const row = await prismaOf(app).llmAuthFlow.findUniqueOrThrow({ where: { id: start.flowId } });
        expect(row).toMatchObject({ status: 'cancelled', deviceCodeCipher: null });
        expect((await poll(owner, start.flowId)).body).toEqual({ status: 'cancelled' });
        await owner.api.post('/admin/llm/providers/huggingface/device/confirm', { flowId: start.flowId }).expect(400);
        expect(await prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } })).toBe(before);
      } finally {
        idp.deviceIdToken = null;
      }
    });

    it('M1b: la confirmación vence y descarta la autorización', async () => {
      const start = await startDevice();
      idp.devices.set(deviceCodes().pop()!, ['approve']);
      await advance(start.flowId);
      expect((await poll(owner, start.flowId)).body).toMatchObject({ status: 'confirm' });
      await prismaOf(app).llmAuthFlow.update({
        where: { id: start.flowId },
        data: { expiresAt: new Date(Date.now() - 1) },
      });
      const late = await owner.api
        .post('/admin/llm/providers/huggingface/device/confirm', { flowId: start.flowId })
        .expect(200);
      expect(late.body).toEqual({ status: 'expired' });
      const row = await prismaOf(app).llmAuthFlow.findUniqueOrThrow({ where: { id: start.flowId } });
      expect(row).toMatchObject({ status: 'expired', deviceCodeCipher: null });
    });

    it('expired (por el proveedor y por tiempo) y denied', async () => {
      const a = await startDevice();
      idp.devices.set(deviceCodes().pop()!, ['expired_token']);
      await advance(a.flowId);
      expect((await poll(owner, a.flowId)).body).toEqual({ status: 'expired' });
      expect((await poll(owner, a.flowId)).body).toEqual({ status: 'expired' });

      const b = await startDevice();
      await prismaOf(app).llmAuthFlow.update({
        where: { id: b.flowId },
        data: { expiresAt: new Date(Date.now() - 1) },
      });
      const calls = idp.tokenRequests('/hf/oauth/token').length;
      expect((await poll(owner, b.flowId)).body).toEqual({ status: 'expired' });
      expect(idp.tokenRequests('/hf/oauth/token').length).toBe(calls);

      const c = await startDevice();
      idp.devices.set(deviceCodes().pop()!, ['access_denied']);
      await advance(c.flowId);
      expect((await poll(owner, c.flowId)).body).toEqual({ status: 'denied' });
      await owner.api.post('/admin/llm/providers/huggingface/device/poll', { flowId: 'no-existe' }).expect(404);
    });

    it('Hugging Face también inicia sesión con OAuth web (scope inference-api)', async () => {
      const start = await owner.api.post('/admin/llm/providers/huggingface/oauth/start', {}).expect(200);
      const { code, state } = idp.authorize((start.body as { authorizeUrl: string }).authorizeUrl, {
        path: '/hf/oauth/authorize',
        clientId: 'nexo-hf-app',
        scope: 'openid profile inference-api',
        provider: 'huggingface',
      });
      const res = await callback('huggingface', { code, state }).expect(302);
      connectedId(res.headers.location, 'huggingface');
    });
  });

  describe('Claude con «Iniciar sesión con Google» (Google Cloud operado por Anthropic y Vertex AI)', () => {
    let claude: ClaudeMessagesMock;

    beforeAll(async () => {
      configureApps();
      claude = await new ClaudeMessagesMock().start();
      // Solo tokens vigentes emitidos por el IdP de Google simulado.
      claude.authorize = (h) => {
        const token = String(h.authorization ?? '').replace(/^Bearer /, '');
        const exp = idp.accessTokens.get(token);
        return !!exp && exp > Date.now();
      };
      config.set('llm.providerUrlOverrides', {
        ...config.get<Record<string, string>>('llm.providerUrlOverrides'),
        'claude-google-cloud': `${claude.origin}/gc`,
        'claude-vertex': `${claude.origin}/vx`,
      });
    });

    afterAll(async () => {
      await claude?.stop();
    });

    /** Consentimiento con la misma app de Google de Nexo (OAUTH_LLM_VERTEX_*), callback y conexión creada. */
    async function signInWithGoogle(provider: string, fields: Record<string, string>, models: string[]) {
      const start = await owner.api
        .post(`/admin/llm/providers/${provider}/oauth/start`, { fields, models })
        .expect(200);
      const { code, state } = idp.authorize((start.body as { authorizeUrl: string }).authorizeUrl, {
        path: '/google/auth',
        clientId: 'nexo-vertex.apps.googleusercontent.com',
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        provider,
      });
      return connectedId((await callback(provider, { code, state }).expect(302)).headers.location as string, provider);
    }

    it('los canales de Claude se publican como una familia y comparten la app de Google', async () => {
      const family = (await providers(owner)).filter(
        (p) => (p as ProviderView & { family?: string }).family === 'CLAUDE',
      );
      expect(family.map((p) => p.id)).toEqual([
        'anthropic',
        'claude-google-cloud',
        'claude-vertex',
        'claude-foundry',
        'claude-bedrock',
        'claude-aws',
      ]);
      const gc = family.find((p) => p.id === 'claude-google-cloud')!;
      expect(gc.mechanisms).toEqual([expect.objectContaining({ type: 'OAUTH', available: true })]);
      expect(gc.suggestedModels.map((m) => m.id)).toEqual(
        expect.arrayContaining(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']),
      );
    });

    it('Claude en Google Cloud: inicia sesión, verifica con el token de Google y un agente conversa con Claude', async () => {
      const id = await signInWithGoogle(
        'claude-google-cloud',
        { projectId: 'mi-proyecto-123', workspaceId: 'wrkspc_e2e0001' },
        ['claude-opus-5-5'],
      );
      const row = await prismaOf(app).llmConnection.findUniqueOrThrow({ where: { id }, include: { models: true } });
      expect(row).toMatchObject({
        kind: 'ANTHROPIC',
        credentialType: 'OAUTH',
        providerId: 'claude-google-cloud',
        driverOptions: {
          claude: { channel: 'google-cloud', project: 'mi-proyecto-123', workspaceId: 'wrkspc_e2e0001' },
        },
      });
      expect(row.models.map((m) => m.modelId)).toEqual(['claude-opus-5-5']);
      // Google factura este canal con sus tarifas: el modelo queda pendiente de tarifa.
      expect(row.models[0].needsPricing).toBe(true);

      const agent = await createAgent(owner, { provider: id, model: 'claude-opus-5-5' });
      expect((await chat(owner, agent.id, 'Hola Claude')).text).toBe('Hola desde Claude simulado');
      const sent = claude.messageRequests().at(-1)!;
      expect(sent.path).toBe('/gc/v1/messages');
      expect(idp.accessTokens.has(String(sent.headers.authorization).replace(/^Bearer /, ''))).toBe(true);
      expect(sent.headers['x-api-key']).toBeUndefined();
      expect(sent.body).toMatchObject({ model: 'claude-opus-5-5', stream: true, thinking: { type: 'adaptive' } });
      // Con un endpoint distinto del oficial no se pide el fallback server-side.
      expect(sent.body).not.toHaveProperty('fallbacks');

      // El token vence: Nexo lo renueva con el refresh token y la conversación sigue.
      idp.expireAll();
      await prismaOf(app).llmConnection.update({
        where: { id },
        data: { oauthExpiresAt: new Date(Date.now() - 1000) },
      });
      expect((await chat(owner, agent.id, 'Sigo aquí')).text).toBe('Hola desde Claude simulado');
      await prismaOf(app).agent.delete({ where: { id: agent.id } });
    });

    it('Claude en Vertex AI: se verifica con un conteo de tokens y conversa por streamRawPredict', async () => {
      const id = await signInWithGoogle('claude-vertex', { projectId: 'mi-proyecto-123', region: 'global' }, [
        'claude-sonnet-5-5',
      ]);
      const verify = claude.requests.filter((r) => r.path.startsWith('/vx/')).at(0)!;
      expect(verify.path).toMatch(
        /\/projects\/mi-proyecto-123\/locations\/global\/publishers\/anthropic\/models\/count-tokens:rawPredict$/,
      );
      const agent = await createAgent(owner, { provider: id, model: 'claude-sonnet-5-5' });
      expect((await chat(owner, agent.id, 'Hola Vertex')).text).toBe('Hola desde Claude simulado');
      expect(claude.messageRequests().at(-1)!.path).toMatch(/\/models\/claude-sonnet-5-5:streamRawPredict$/);
      await prismaOf(app).agent.delete({ where: { id: agent.id } });
    });

    it('M1: el consentimiento que vuelve a otro navegador (sin la cookie del que inició) no conecta nada', async () => {
      const before = await prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } });
      const start = await owner.api
        .post('/admin/llm/providers/claude-vertex/oauth/start', {
          fields: { projectId: 'mi-proyecto-123', region: 'global' },
        })
        .expect(200);
      expect(start.headers['set-cookie']?.[0]).toMatch(/^nexo_llm_oauth=[\w-]+; .*HttpOnly.*SameSite=Lax/i);
      expect(JSON.stringify(start.body)).not.toContain(llmOAuthCookie().split('=')[1]);
      const { code, state } = idp.authorize((start.body as { authorizeUrl: string }).authorizeUrl, {
        path: '/google/auth',
        clientId: 'nexo-vertex.apps.googleusercontent.com',
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        provider: 'claude-vertex',
      });
      // La víctima abre el enlace del atacante en su propio navegador: no tiene la cookie.
      const res = await new Api(app)
        .get(`/llm/oauth/claude-vertex/callback?${new URLSearchParams({ code, state }).toString()}`)
        .redirects(0)
        .expect(302);
      expect(res.headers.location).toBe(errorTarget('claude-vertex', 'browser_mismatch'));
      expect(await prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } })).toBe(before);
      expect(idp.tokenRequests('/google/token').filter((r) => r.form.code === code)).toHaveLength(0);
    });

    it('rechaza campos con formato inválido antes de abrir el consentimiento', async () => {
      await owner.api
        .post('/admin/llm/providers/claude-google-cloud/oauth/start', {
          fields: { projectId: 'mi-proyecto-123', workspaceId: 'otro-formato' },
        })
        .expect(400);
    });
  });

  describe('Detección de modelos locales', () => {
    it('detecta el servidor indicado y lista sus modelos sin guardar nada', async () => {
      const before = await prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } });
      const res = await owner.api
        .post('/admin/llm/providers/ollama/detect', { baseUrl: `${idp.origin}/ollama/v1` })
        .expect(200);
      expect(res.body).toEqual({
        providerId: 'ollama',
        baseUrl: `${idp.origin}/ollama/v1`,
        reachable: true,
        models: [
          expect.objectContaining({ id: 'llama3.2', specialties: ['GENERAL'], contextTokens: null, tier: 'ECONOMY' }),
          expect.objectContaining({ id: 'qwen3', specialties: ['GENERAL'], contextTokens: null, tier: 'ECONOMY' }),
        ],
      });
      expect(await prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } })).toBe(before);
    });

    it('sin servidor en la URL por defecto responde reachable:false con el motivo', async () => {
      const res = await owner.api
        .post('/admin/llm/providers/lmstudio/detect', { baseUrl: 'http://127.0.0.1:1/v1' })
        .expect(200);
      expect(res.body).toMatchObject({ providerId: 'lmstudio', reachable: false, models: [] });
      expect((res.body as { message: string }).message).toMatch(/No se pudo alcanzar 127\.0\.0\.1:1/);
      const def = await owner.api.post('/admin/llm/providers/ollama/detect', {}).expect(200);
      expect((def.body as { baseUrl: string }).baseUrl).toBe('http://localhost:11434/v1');
    });

    it('valida la URL y solo aplica a proveedores locales', async () => {
      await owner.api.post('/admin/llm/providers/ollama/detect', { baseUrl: 'file:///etc/passwd' }).expect(400);
      await owner.api.post('/admin/llm/providers/openai/detect', {}).expect(400);
    });
  });
});
