import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { bindingTag } from '../src/common/oauth/browser-binding';
import { OAuthStateService } from '../src/modules/oauth/oauth-state.service';
import { SecretsService } from '../src/modules/workspaces/secrets.service';
import { Api, createTestApp, prismaOf } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

/**
 * Proveedor OAuth2 simulado + API protegida (estilo HubSpot/Slack). Valida client credentials, redirect_uri y PKCE
 * S256 en el intercambio del código, emite tokens rotables y exige `Authorization: Bearer <token vigente>`.
 */
class OAuthProviderMock {
  readonly clientId = 'cid-e2e';
  readonly clientSecret = 'csecret-e2e-no-revelar';
  private server?: Server;
  private port = 0;
  private readonly codes = new Map<string, { challenge: string; redirectUri: string }>();
  accessToken = '';
  refreshToken = '';
  /** `instance_url` que se devuelve con el token (estilo Salesforce), si se define. */
  instanceUrl?: string;
  issued = 0;
  refreshes = 0;
  readonly apiTokens: string[] = [];
  readonly slackCalls: { auth?: string; body: unknown }[] = [];

  get origin() {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => void this.route(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  async stop() {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  /** Simula el consentimiento del usuario: registra el código y devuelve la query del callback. */
  authorize(authorizeUrl: string): { code: string; state: string; redirectUri: string } {
    const url = new URL(authorizeUrl);
    expect(url.origin).toBe(this.origin);
    expect(url.searchParams.get('client_id')).toBe(this.clientId);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const code = `code-${randomBytes(6).toString('hex')}`;
    const redirectUri = url.searchParams.get('redirect_uri')!;
    this.codes.set(code, { challenge: url.searchParams.get('code_challenge')!, redirectUri });
    return { code, state: url.searchParams.get('state')!, redirectUri };
  }

  private async route(req: IncomingMessage, res: ServerResponse) {
    const raw = await new Promise<string>((resolve) => {
      let d = '';
      req.on('data', (c: Buffer) => (d += c.toString()));
      req.on('end', () => resolve(d));
    });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const path = new URL(req.url ?? '/', this.origin).pathname;

    if (path === '/token' && req.method === 'POST') {
      const form = new URLSearchParams(raw);
      if (form.get('client_id') !== this.clientId || form.get('client_secret') !== this.clientSecret) {
        return send(401, { error: 'invalid_client' });
      }
      if (form.get('grant_type') === 'authorization_code') {
        const entry = this.codes.get(form.get('code') ?? '');
        this.codes.delete(form.get('code') ?? '');
        const verifier = form.get('code_verifier') ?? '';
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        if (!entry || entry.challenge !== challenge || entry.redirectUri !== form.get('redirect_uri')) {
          return send(400, { error: 'invalid_grant' });
        }
        return send(200, this.issue());
      }
      if (form.get('grant_type') === 'refresh_token') {
        if (form.get('refresh_token') !== this.refreshToken) return send(400, { error: 'invalid_grant' });
        this.refreshes += 1;
        await new Promise((r) => setTimeout(r, 150)); // ventana para detectar renovaciones concurrentes
        return send(200, this.issue());
      }
      return send(400, { error: 'unsupported_grant_type' });
    }

    const auth = req.headers.authorization;
    if (path === '/chat.postMessage') {
      this.slackCalls.push({ auth, body: JSON.parse(raw || '{}') });
      return send(200, { ok: true, ts: '1.0' });
    }
    if (auth !== `Bearer ${this.accessToken}` || !this.accessToken) return send(401, { message: 'token inválido' });
    if (path === '/me') return send(200, { email: 'vendedora@acme.test' });
    if (path === '/crm/v3/objects/contacts/search') {
      this.apiTokens.push(this.accessToken);
      return send(200, { total: 1, results: [{ id: '101', properties: { email: 'ana@acme.test' } }] });
    }
    return send(404, { message: 'no encontrado' });
  }

  private issue() {
    this.issued += 1;
    this.accessToken = `at-${this.issued}-${randomBytes(4).toString('hex')}`;
    this.refreshToken = `rt-${this.issued}-${randomBytes(4).toString('hex')}`;
    return {
      access_token: this.accessToken,
      refresh_token: this.refreshToken,
      expires_in: 1800,
      token_type: 'bearer',
      scope: 'oauth crm.objects.contacts.read',
      ...(this.instanceUrl ? { instance_url: this.instanceUrl } : {}),
    };
  }
}

interface CatalogItem {
  id: string;
  authMethods: string[];
  credentialFields: { key: string; required: boolean; secret: boolean }[];
  operations: { key: string; write: boolean }[];
  installed: number;
}
interface InstalledConnector {
  id: string;
  catalogId: string;
  config: Record<string, unknown>;
  auth: Record<string, unknown>;
  operations: { id: string; key: string }[];
  secrets: string[];
  authorizeUrl?: string;
}

describe('Catálogo de conectores y OAuth2 de usuario (E2E, ADR 0005)', () => {
  let app: INestApplication;
  let provider: OAuthProviderMock;
  let owner: Session;
  let other: Session;
  let viewer: Session;
  let webUrl: string;
  let hubspot: InstalledConnector;
  let searchOpId: string;
  const savedEnv: Record<string, string | undefined> = {};

  const catalog = async (s: Session) => (await s.api.get('/connector-catalog').expect(200)).body as CatalogItem[];
  const invoke = (s: Session, connectorId: string, opId: string, input: Record<string, unknown>) =>
    s.api.post(`/connectors/${connectorId}/operations/${opId}/invoke`, { input });
  /** Callback del proveedor; `cookie` es la cookie de ligadura que presenta el navegador (M1b). */
  const callback = (query: Record<string, string>, cookie?: string) => {
    const req = new Api(app).get(`/oauth/callback?${new URLSearchParams(query).toString()}`).redirects(0);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  /** `nexo_connector_oauth=<nonce>` de la respuesta que inició el flujo. */
  const bindingCookie = (res: { headers: Record<string, unknown> }): string => {
    const cookies = ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []);
    const found = cookies.find((c) => c.startsWith('nexo_connector_oauth=') && !c.startsWith('nexo_connector_oauth=;'));
    if (!found) throw new Error('La respuesta no entregó la cookie de ligadura OAuth');
    return found.split(';')[0];
  };
  /** Nonce fijo para los `state` firmados directamente en las pruebas. */
  const NONCE = 'nonce-de-prueba-0123456789abcdef';
  const NONCE_COOKIE = `nexo_connector_oauth=${NONCE}`;
  const startOAuth = async (s: Session, connectorId: string) => {
    const res = await s.api.post(`/connectors/${connectorId}/oauth/start`).expect(200);
    return { authorizeUrl: (res.body as { authorizeUrl: string }).authorizeUrl, cookie: bindingCookie(res) };
  };

  beforeAll(async () => {
    // Sin app OAuth de la plataforma: la suite controla cuándo hay credenciales.
    for (const k of ['OAUTH_HUBSPOT_CLIENT_ID', 'OAUTH_HUBSPOT_CLIENT_SECRET']) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    provider = await new OAuthProviderMock().start();
    app = await createTestApp();
    webUrl = app.get(ConfigService).get<string>('webUrl')!;
    owner = await registerOwner(app, 'catalog-a');
    other = await registerOwner(app, 'catalog-b');
    viewer = await addMember(app, owner, { role: 'VIEWER' });
  });

  afterAll(async () => {
    await app?.close();
    await provider?.stop();
    for (const [k, v] of Object.entries(savedEnv)) if (v !== undefined) process.env[k] = v;
  });

  describe('catálogo', () => {
    it('lista las integraciones con su contrato (cualquier rol)', async () => {
      const items = await catalog(viewer);
      const ids = items.map((i) => i.id);
      for (const id of ['lusha-mcp', 'lusha', 'hubspot', 'salesforce', 'pipedrive', 'gmail', 'whatsapp', 'slack']) {
        expect(ids).toContain(id);
      }
      const hs = items.find((i) => i.id === 'hubspot')!;
      expect(hs.authMethods).toEqual(['bearer', 'oauth2_code']);
      expect(hs.operations.map((o) => o.key)).toEqual(
        expect.arrayContaining(['search_contacts', 'create_contact', 'create_deal', 'create_note', 'search_companies']),
      );
      expect(hs.installed).toBe(0);
    });

    it('instala con un clic: guarda secretos, crea conector y operaciones sin devolver credenciales', async () => {
      const token = 'xoxb-secreto-e2e-no-revelar';
      const res = await owner.api
        .post('/connector-catalog/slack/install', { authMethod: 'bearer', credentials: { botToken: token } })
        .expect(201);
      const body = res.body as InstalledConnector;
      expect(JSON.stringify(body)).not.toContain(token);
      expect(body.catalogId).toBe('slack');
      expect(body.secrets).toEqual(['SLACK_BOT_TOKEN']);
      expect(body.auth).toEqual({ type: 'bearer', token: '{{ secrets.SLACK_BOT_TOKEN }}' });
      expect(body.operations.map((o) => o.key)).toEqual(
        expect.arrayContaining(['post_message', 'reply_in_thread', 'post_blocks_message', 'lookup_user_by_email']),
      );
      const postMessage = body.operations.find((o) => o.key === 'post_message')!;

      const secrets = (await owner.api.get('/workspace/secrets').expect(200)).body as { name: string }[];
      expect(secrets.map((s) => s.name)).toContain('SLACK_BOT_TOKEN');
      expect(JSON.stringify(secrets)).not.toContain(token);
      const detail = await owner.api.get(`/connectors/${body.id}`).expect(200);
      expect(JSON.stringify(detail.body)).not.toContain(token);

      // La operación usa el secreto de la bóveda (base apuntada al simulador).
      await owner.api.patch(`/connectors/${body.id}`, { config: { baseUrl: provider.origin } }).expect(200);
      const inv = await invoke(owner, body.id, postMessage.id, { channel: '#ventas', text: 'Lead caliente' });
      expect(inv.status).toBe(200);
      expect(provider.slackCalls.at(-1)).toEqual({
        auth: `Bearer ${token}`,
        body: { channel: '#ventas', text: 'Lead caliente' },
      });

      // Reinstalar como OWNER sobrescribe el secreto existente (un EDITOR recibiría 409: ver prueba M6).
      await owner.api
        .post('/connector-catalog/slack/install', { name: 'Slack ventas', credentials: { botToken: 'xoxb-nuevo' } })
        .expect(201);
      expect((await catalog(owner)).find((i) => i.id === 'slack')!.installed).toBe(2);
      const after = (await owner.api.get('/workspace/secrets').expect(200)).body as { name: string }[];
      expect(after.filter((s) => s.name === 'SLACK_BOT_TOKEN')).toHaveLength(1);
    });

    it('rechaza credenciales faltantes, inválidas o desconocidas (400) e integraciones inexistentes (404)', async () => {
      const missing = await owner.api
        .post('/connector-catalog/pipedrive/install', { authMethod: 'apiKey', credentials: { apiToken: 'x' } })
        .expect(400);
      expect(JSON.stringify(missing.body)).toContain('Faltan credenciales requeridas');
      await owner.api
        .post('/connector-catalog/pipedrive/install', {
          authMethod: 'apiKey',
          credentials: { apiToken: 'x', companyDomain: 'evil.com/x' },
        })
        .expect(400);
      await owner.api
        .post('/connector-catalog/slack/install', { credentials: { botToken: 'x', otro: 'y' } })
        .expect(400);
      await owner.api
        .post('/connector-catalog/slack/install', { authMethod: 'oauth2_code', credentials: {} })
        .expect(400);
      await owner.api.post('/connector-catalog/no-existe/install', { credentials: {} }).expect(404);
      // OAuth sin app propia ni app de la plataforma configurada.
      const noApp = await owner.api
        .post('/connector-catalog/hubspot/install', { authMethod: 'oauth2_code', credentials: {} })
        .expect(400);
      expect(JSON.stringify(noApp.body)).toContain('OAUTH_HUBSPOT_CLIENT_ID');
      expect((await catalog(owner)).find((i) => i.id === 'pipedrive')!.installed).toBe(0);
    });

    it('un VIEWER no puede instalar ni crear el kit comercial', async () => {
      await viewer.api.post('/connector-catalog/slack/install', { credentials: { botToken: 'x' } }).expect(403);
      await viewer.api.post('/connector-catalog/starter-kit/commercial').expect(403);
    });

    it('M6: un EDITOR no reemplaza credenciales existentes al reinstalar (409); un ADMIN sí', async () => {
      const editor = await addMember(app, owner, { role: 'EDITOR', tag: 'catalog-editor' });
      const admin = await addMember(app, owner, { role: 'ADMIN', tag: 'catalog-admin' });
      const vault = app.get(SecretsService);
      const lushaKey = async () => (await vault.resolveMany(owner.workspaceId, ['LUSHA_API_KEY'])).LUSHA_API_KEY;
      const installed = async () => (await catalog(owner)).find((i) => i.id === 'lusha')!.installed;

      await owner.api
        .post('/connector-catalog/lusha/install', { credentials: { apiKey: 'lusha-original' } })
        .expect(201);
      // Mismo valor: no es reemplazo, el EDITOR puede crear otra instancia con la misma cuenta.
      await editor.api
        .post('/connector-catalog/lusha/install', { credentials: { apiKey: 'lusha-original' } })
        .expect(201);
      expect(await installed()).toBe(2);

      const denied = await editor.api
        .post('/connector-catalog/lusha/install', { credentials: { apiKey: 'lusha-ajena' } })
        .expect(409);
      expect(JSON.stringify(denied.body)).toContain(
        'Ya existen credenciales de Lusha (API REST) en la bóveda; solo un administrador puede reemplazarlas',
      );
      expect(JSON.stringify(denied.body)).not.toContain('lusha-ajena');
      // No escribe nada: ni el secreto ni el conector.
      expect(await lushaKey()).toBe('lusha-original');
      expect(await installed()).toBe(2);

      await admin.api.post('/connector-catalog/lusha/install', { credentials: { apiKey: 'lusha-admin' } }).expect(201);
      expect(await lushaKey()).toBe('lusha-admin');
      expect(await installed()).toBe(3);
    });

    it('el kit comercial crea 4 skills una sola vez (idempotente por slug)', async () => {
      const first = (await owner.api.post('/connector-catalog/starter-kit/commercial').expect(201)).body as {
        created: number;
        skills: { id: string; slug: string }[];
      };
      expect(first.created).toBe(4);
      expect(first.skills.map((s) => s.slug)).toContain('calificacion-de-leads-bant');
      const second = (await owner.api.post('/connector-catalog/starter-kit/commercial').expect(201)).body as {
        created: number;
        skills: { id: string }[];
      };
      expect(second.created).toBe(0);
      expect(second.skills.map((s) => s.id)).toEqual(first.skills.map((s) => s.id));
      const skills = (await owner.api.get('/skills').expect(200)).body as { id: string }[];
      expect(skills.filter((s) => first.skills.some((f) => f.id === s.id))).toHaveLength(4);
    });
  });

  describe('OAuth2 de usuario (authorization code + PKCE + refresh)', () => {
    it('instala HubSpot por OAuth con app propia y devuelve la URL de consentimiento', async () => {
      const res = await owner.api
        .post('/connector-catalog/hubspot/install', {
          authMethod: 'oauth2_code',
          credentials: { clientId: provider.clientId, clientSecret: provider.clientSecret },
        })
        .expect(201);
      hubspot = res.body as InstalledConnector;
      expect(JSON.stringify(hubspot)).not.toContain(provider.clientSecret);
      // M1b: la URL de consentimiento que devuelve la instalación también queda ligada a este navegador.
      expect(JSON.stringify(hubspot)).not.toContain(bindingCookie(res).split('=')[1]);
      // A4: la app OAuth propia usa solo los secretos que se ingresaron al instalar.
      expect(hubspot).toMatchObject({
        allowedSecrets: ['HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET'],
        blockedSecrets: [],
      });
      expect(hubspot.auth).toMatchObject({
        type: 'oauth2_code',
        provider: 'hubspot',
        clientIdRef: '{{ secrets.HUBSPOT_CLIENT_ID }}',
        clientSecretRef: '{{ secrets.HUBSPOT_CLIENT_SECRET }}',
      });
      const url = new URL(hubspot.authorizeUrl!);
      expect(url.origin + url.pathname).toBe('https://app.hubspot.com/oauth/authorize');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('redirect_uri')).toMatch(/\/api\/oauth\/callback$/);
      expect(url.searchParams.get('state')).toBeTruthy();
      searchOpId = hubspot.operations.find((o) => o.key === 'search_contacts')!.id;

      const status = await owner.api.get(`/connectors/${hubspot.id}/oauth`).expect(200);
      expect(status.body).toEqual({ connected: false, accountLabel: null, scope: null, expiresAt: null });
      const inv = await invoke(owner, hubspot.id, searchOpId, { query: 'ana' }).expect(400);
      expect(JSON.stringify(inv.body)).toContain('Conecte la cuenta OAuth del conector');
    });

    it('autoriza → callback → guarda tokens cifrados → la invocación usa Bearer', async () => {
      // Se apunta el conector al proveedor simulado (app propia: las URLs del conector se respetan).
      await owner.api
        .patch(`/connectors/${hubspot.id}`, {
          config: { baseUrl: provider.origin },
          auth: {
            ...hubspot.auth,
            authorizeUrl: `${provider.origin}/authorize`,
            tokenUrl: `${provider.origin}/token`,
            accountLabel: { url: `${provider.origin}/me`, path: 'email' },
          },
        })
        .expect(200);

      await viewer.api.post(`/connectors/${hubspot.id}/oauth/start`).expect(403);
      const { authorizeUrl, cookie } = await startOAuth(owner, hubspot.id);
      const { code, state, redirectUri } = provider.authorize(authorizeUrl);
      expect(redirectUri).toMatch(/\/api\/oauth\/callback$/);

      const cb = await callback({ code, state, redirect: 'https://evil.example' }, cookie).expect(302);
      expect(cb.headers.location).toBe(`${webUrl}/connectors/${hubspot.id}?oauth=ok`);

      const status = (await owner.api.get(`/connectors/${hubspot.id}/oauth`).expect(200)).body as Record<string, any>;
      expect(status).toMatchObject({
        connected: true,
        accountLabel: 'vendedora@acme.test',
        scope: 'oauth crm.objects.contacts.read',
      });
      expect(new Date(status.expiresAt as string).getTime()).toBeGreaterThan(Date.now() + 60_000);
      expect(JSON.stringify(status)).not.toContain(provider.accessToken);

      const cred = await prismaOf(app).oAuthCredential.findUnique({ where: { connectorId: hubspot.id } });
      expect(cred!.accessTokenCipher).not.toContain(provider.accessToken);
      expect(cred!.refreshTokenCipher).not.toContain(provider.refreshToken);

      const firstToken = provider.accessToken;
      const inv = await invoke(owner, hubspot.id, searchOpId, { query: 'ana' }).expect(200);
      expect(inv.body).toMatchObject({ ok: true, status: 200 });
      expect(provider.apiTokens.at(-1)).toBe(firstToken);

      // El mismo state no se puede reutilizar.
      const replay = await callback({ code, state }, cookie).expect(302);
      expect(replay.headers.location).toBe(`${webUrl}/connectors?oauth=error&reason=invalid_state`);
    });

    it('renueva con refresh token al expirar, una sola vez ante invocaciones concurrentes', async () => {
      const before = provider.refreshes;
      const oldToken = provider.accessToken;
      await prismaOf(app).oAuthCredential.update({
        where: { connectorId: hubspot.id },
        data: { expiresAt: new Date(Date.now() + 10_000) },
      });
      const results = await Promise.all(
        [1, 2, 3].map(() => invoke(owner, hubspot.id, searchOpId, { query: 'ana', limit: 5 })),
      );
      for (const r of results) expect(r.status).toBe(200);
      expect(provider.refreshes).toBe(before + 1);
      expect(provider.accessToken).not.toBe(oldToken);
      expect(provider.apiTokens.slice(-3)).toEqual([provider.accessToken, provider.accessToken, provider.accessToken]);

      const cred = await prismaOf(app).oAuthCredential.findUnique({ where: { connectorId: hubspot.id } });
      expect(cred!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 60_000);
      expect(cred!.accountLabel).toBe('vendedora@acme.test');
    });

    it('M1b: el state queda ligado al navegador que inició el flujo (cookie HttpOnly SameSite=Lax)', async () => {
      const start = await owner.api.post(`/connectors/${hubspot.id}/oauth/start`).expect(200);
      const setCookie = ([] as string[]).concat(start.headers['set-cookie'] ?? []).join('\n');
      expect(setCookie).toMatch(/^nexo_connector_oauth=[\w-]+; .*Path=\/api\/oauth.*HttpOnly.*SameSite=Lax/im);
      const cookie = bindingCookie(start);
      expect(JSON.stringify(start.body)).not.toContain(cookie.split('=')[1]);

      // Phishing de consentimiento: la víctima abre la URL del atacante en su navegador (sin la cookie del atacante).
      const tokensBefore = await prismaOf(app).oAuthCredential.findUnique({ where: { connectorId: hubspot.id } });
      const { code, state } = provider.authorize((start.body as { authorizeUrl: string }).authorizeUrl);
      const issuedBefore = provider.issued;
      const victim = await callback({ code, state }).expect(302);
      expect(victim.headers.location).toBe(`${webUrl}/connectors/${hubspot.id}?oauth=error&reason=browser_mismatch`);
      expect(provider.issued).toBe(issuedBefore);
      const tokensAfter = await prismaOf(app).oAuthCredential.findUnique({ where: { connectorId: hubspot.id } });
      expect(tokensAfter?.accessTokenCipher).toBe(tokensBefore?.accessTokenCipher);

      // Tampoco sirve la cookie de otro inicio (otro navegador), y el state ya quedó consumido.
      const other = await startOAuth(owner, hubspot.id);
      const second = provider.authorize(other.authorizeUrl);
      const wrong = await callback({ code: second.code, state: second.state }, cookie).expect(302);
      expect(wrong.headers.location).toContain('reason=browser_mismatch');
      const replay = await callback({ code: second.code, state: second.state }, other.cookie).expect(302);
      expect(replay.headers.location).toContain('reason=invalid_state');
    });

    it('state inválido, expirado o denegado → redirección con error a la web, sin redirección abierta', async () => {
      const garbage = await callback({ code: 'x', state: 'no-es-un-jwt' }).expect(302);
      expect(garbage.headers.location).toBe(`${webUrl}/connectors?oauth=error&reason=invalid_state`);

      const states = app.get(OAuthStateService);
      const base = {
        workspaceId: owner.workspaceId,
        connectorId: hubspot.id,
        userId: owner.userId,
        codeVerifier: 'v',
        browserTag: bindingTag(NONCE),
      };
      const expired = await callback({ code: 'x', state: await states.sign(base, -5) }, NONCE_COOKIE).expect(302);
      expect(expired.headers.location).toBe(`${webUrl}/connectors?oauth=error&reason=invalid_state`);

      const denied = await callback({ error: 'access_denied', state: await states.sign(base) }, NONCE_COOKIE).expect(
        302,
      );
      expect(denied.headers.location).toBe(`${webUrl}/connectors/${hubspot.id}?oauth=error&reason=access_denied`);

      const bad = await callback({ code: 'codigo-inexistente', state: await states.sign(base) }, NONCE_COOKIE).expect(
        302,
      );
      expect(bad.headers.location).toBe(`${webUrl}/connectors/${hubspot.id}?oauth=error&reason=exchange_failed`);

      // Un state de un usuario sin permisos de edición no se acepta.
      const asViewer = await callback(
        { code: 'x', state: await states.sign({ ...base, userId: viewer.userId }) },
        NONCE_COOKIE,
      );
      expect(asViewer.headers.location).toBe(`${webUrl}/connectors/${hubspot.id}?oauth=error&reason=forbidden`);
      for (const r of [garbage, expired, denied, bad, asViewer])
        expect(r.headers.location.startsWith(webUrl)).toBe(true);
    });

    it('aísla OAuth y catálogo por workspace', async () => {
      await other.api.get(`/connectors/${hubspot.id}/oauth`).expect(404);
      await other.api.post(`/connectors/${hubspot.id}/oauth/start`).expect(404);
      await other.api.delete(`/connectors/${hubspot.id}/oauth`).expect(404);
      await invoke(other, hubspot.id, searchOpId, { query: 'ana' }).expect(404);
      const items = await catalog(other);
      expect(items.find((i) => i.id === 'hubspot')!.installed).toBe(0);
      expect(items.find((i) => i.id === 'slack')!.installed).toBe(0);
      const secrets = (await other.api.get('/workspace/secrets').expect(200)).body as { name: string }[];
      expect(secrets.map((s) => s.name)).not.toContain('HUBSPOT_CLIENT_SECRET');
      // Un state firmado para el workspace A con un usuario de B no conecta nada.
      const states = app.get(OAuthStateService);
      const cross = await callback(
        {
          code: 'x',
          state: await states.sign({
            workspaceId: owner.workspaceId,
            connectorId: hubspot.id,
            userId: other.userId,
            codeVerifier: 'v',
            browserTag: bindingTag(NONCE),
          }),
        },
        NONCE_COOKIE,
      );
      expect(cross.headers.location).toContain('reason=forbidden');
    });

    it('Salesforce: la instance_url del token (host validado) pasa a ser la base del conector', async () => {
      const sf = (
        await owner.api
          .post('/connector-catalog/salesforce/install', {
            credentials: { clientId: provider.clientId, clientSecret: provider.clientSecret },
          })
          .expect(201)
      ).body as InstalledConnector;
      await owner.api
        .patch(`/connectors/${sf.id}`, {
          auth: { ...sf.auth, authorizeUrl: `${provider.origin}/authorize`, tokenUrl: `${provider.origin}/token` },
        })
        .expect(200);
      const connect = async () => {
        const { authorizeUrl, cookie } = await startOAuth(owner, sf.id);
        const { code, state } = provider.authorize(authorizeUrl);
        return (await callback({ code, state }, cookie).expect(302)).headers.location;
      };
      try {
        provider.instanceUrl = 'https://evil.example';
        expect(await connect()).toBe(`${webUrl}/connectors/${sf.id}?oauth=error&reason=exchange_failed`);
        provider.instanceUrl = 'https://acme.my.salesforce.com';
        expect(await connect()).toBe(`${webUrl}/connectors/${sf.id}?oauth=ok`);
      } finally {
        provider.instanceUrl = undefined;
      }
      const detail = (await owner.api.get(`/connectors/${sf.id}`).expect(200)).body as InstalledConnector;
      expect(detail.config.baseUrl).toBe('https://acme.my.salesforce.com/services/data/v62.0');
      const status = (await owner.api.get(`/connectors/${sf.id}/oauth`).expect(200)).body as Record<string, unknown>;
      expect(status).toMatchObject({ connected: true, accountLabel: 'acme.my.salesforce.com' });
      // Sin expires_in del proveedor se asume una vida conservadora (no aplica aquí: el simulador envía 1800 s).
      expect(status.expiresAt).toBeTruthy();
    });

    it('desconectar elimina los tokens y la invocación vuelve a pedir conexión', async () => {
      await viewer.api.delete(`/connectors/${hubspot.id}/oauth`).expect(403);
      await owner.api.delete(`/connectors/${hubspot.id}/oauth`).expect(200);
      const status = await owner.api.get(`/connectors/${hubspot.id}/oauth`).expect(200);
      expect(status.body).toMatchObject({ connected: false });
      const inv = await invoke(owner, hubspot.id, searchOpId, { query: 'ana' }).expect(400);
      expect(JSON.stringify(inv.body)).toContain('Conecte la cuenta OAuth del conector');
    });
  });
});
