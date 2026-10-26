import type { INestApplication } from '@nestjs/common';
import { createServer } from 'node:net';
import request from 'supertest';
import { DevLlmSimulatorService } from '../src/modules/llm/dev-simulator/dev-llm-simulator.service';
import { createTestApp, llmOAuthCookie, prismaOf } from './utils/app';
import { chat, createAgent, registerOwner, type Session } from './utils/fixtures';

/** Puerto libre: la API se llama a sí misma (canje de tokens y chat) como haría con un proveedor real. */
async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer().listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Simulador local (`LLM_DEV_SIMULATOR=true`): el flujo completo de un proveedor con inicio de sesión sin cuentas ni
 * dominio. Consentimiento con PKCE → conexión → agente → renovación → revocación → volver a iniciar sesión → código
 * de dispositivo.
 */
describe('Simulador local de proveedor IA con inicio de sesión (E2E)', () => {
  let app: INestApplication;
  let owner: Session;
  let connectionId: string;
  let agentId: string;

  beforeAll(async () => {
    const port = await freePort();
    process.env.LLM_DEV_SIMULATOR = 'true';
    process.env.PUBLIC_URL = `http://127.0.0.1:${port}`;
    app = await createTestApp();
    await app.listen(port, '127.0.0.1');
    owner = await registerOwner(app, 'simulador');
  });

  afterAll(async () => {
    delete process.env.LLM_DEV_SIMULATOR;
    delete process.env.PUBLIC_URL;
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  /** Abre la pantalla de consentimiento, autoriza y sigue el callback de Nexo; devuelve la redirección a la web. */
  async function signIn(body: Record<string, unknown> = {}, decision = 'allow') {
    const start = await owner.api.post('/admin/llm/providers/nexo-simulado/oauth/start', body).expect(200);
    const url = new URL((start.body as { authorizeUrl: string }).authorizeUrl);
    expect(url.pathname).toBe('/api/dev/llm-sim/authorize');
    expect(url.searchParams.get('client_id')).toBe('nexo-simulador-local');
    const consent = await http().get(`${url.pathname}${url.search}`).expect(200);
    expect(consent.text).toContain('¿Autorizar a Nexo?');
    const back = await http()
      .post('/api/dev/llm-sim/authorize/decision')
      .type('form')
      .send({
        decision,
        redirect_uri: url.searchParams.get('redirect_uri'),
        state: url.searchParams.get('state'),
        code_challenge: url.searchParams.get('code_challenge'),
        scope: url.searchParams.get('scope'),
      })
      .expect(302);
    // La ventana emergente conserva `window.opener` (sin COOP same-origin) para avisar a la consola y cerrarse.
    expect(back.headers['cross-origin-opener-policy']).toBe('unsafe-none');
    const callback = new URL(back.headers.location);
    const res = await http().get(`${callback.pathname}${callback.search}`).set('Cookie', llmOAuthCookie()).expect(302);
    expect(res.headers['cross-origin-opener-policy']).toBe('unsafe-none');
    return new URL(res.headers.location);
  }

  it('aparece en la galería con inicio de sesión y código disponibles', async () => {
    const { providers } = (await owner.api.get('/admin/llm/providers').expect(200)).body as {
      providers: { id: string; mechanisms: { type: string; available: boolean }[] }[];
    };
    const sim = providers.find((p) => p.id === 'nexo-simulado');
    expect(sim?.mechanisms.map((m) => [m.type, m.available])).toEqual([
      ['OAUTH', true],
      ['DEVICE_CODE', true],
    ]);
  });

  it('el simulador rechaza redirecciones a otros sitios y exige PKCE', async () => {
    await http()
      .get('/api/dev/llm-sim/authorize')
      .query({ client_id: 'nexo-simulador-local', redirect_uri: 'https://evil.example/cb', response_type: 'code' })
      .expect(400);
    await http()
      .post('/api/dev/llm-sim/token')
      .type('form')
      .send({ grant_type: 'authorization_code', code: 'inventado', code_verifier: 'x' })
      .expect(400, { error: 'invalid_grant' });
  });

  it('denegar el consentimiento vuelve a la web con access_denied y no crea conexión', async () => {
    const target = await signIn({}, 'deny');
    expect(target.searchParams.get('llm')).toBe('error');
    expect(target.searchParams.get('reason')).toBe('access_denied');
    expect(await prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
  });

  it('autorizar crea la conexión OAuth con sus modelos y un agente la usa', async () => {
    const target = await signIn();
    expect(target.searchParams.get('llm')).toBe('connected');
    connectionId = target.searchParams.get('connectionId')!;
    const row = await prismaOf(app).llmConnection.findUniqueOrThrow({
      where: { id: connectionId },
      include: { models: true },
    });
    expect(row).toMatchObject({ providerId: 'nexo-simulado', credentialType: 'OAUTH' });
    expect(row.oauthRefreshCipher).toBeTruthy();
    expect(row.models.map((m) => m.modelId).sort()).toEqual(['sim-experto', 'sim-rapido']);

    agentId = (await createAgent(owner, { provider: connectionId, model: 'sim-rapido' })).id;
    expect((await chat(owner, agentId, 'Hola simulador')).text).toBe(
      'Respuesta simulada de sim-rapido: Hola simulador',
    );
  });

  it('renueva el token vencido automáticamente', async () => {
    const before = await prismaOf(app).llmConnection.findUniqueOrThrow({ where: { id: connectionId } });
    await prismaOf(app).llmConnection.update({
      where: { id: connectionId },
      data: { oauthExpiresAt: new Date(Date.now() - 1000) },
    });
    expect((await chat(owner, agentId, 'Sigo aquí')).text).toContain('Sigo aquí');
    const after = await prismaOf(app).llmConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(after.apiKeyCipher).not.toBe(before.apiKeyCipher);
  });

  it('si el usuario revoca el acceso en el proveedor, la sesión queda cerrada y volver a iniciarla la recupera', async () => {
    await http().post('/api/dev/llm-sim/revoke-all').expect(200);
    await prismaOf(app).llmConnection.update({
      where: { id: connectionId },
      data: { oauthExpiresAt: new Date(Date.now() - 1000) },
    });
    const res = await owner.api.post(`/agents/${agentId}/chat`, { message: 'Hola' }).expect(400);
    expect((res.body as { message: string }).message).toMatch(/revocada o caducó/);
    const conn = (
      (await owner.api.get('/admin/llm/connections').expect(200)).body as { id: string; signedOut: boolean }[]
    ).find((c) => c.id === connectionId);
    expect(conn?.signedOut).toBe(true);

    const target = await signIn({ connectionId });
    expect(target.searchParams.get('connectionId')).toBe(connectionId);
    expect((await chat(owner, agentId, 'De vuelta')).text).toContain('De vuelta');
  });

  it('cerrar sesión desde Nexo revoca el token en el simulador', async () => {
    const r = await owner.api.post(`/admin/llm/connections/${connectionId}/sign-out`, {}).expect(200);
    expect(r.body).toMatchObject({ revoked: true, connection: { signedOut: true } });
    await owner.api.post(`/agents/${agentId}/chat`, { message: 'Hola' }).expect(400);
  });

  /** Inicia un código de dispositivo, lo autoriza en la página del simulador con `account` y sondea hasta `confirm`. */
  async function deviceAuthorized(account?: string) {
    const start = (await owner.api.post('/admin/llm/providers/nexo-simulado/device/start', {}).expect(200)).body as {
      flowId: string;
      userCode: string;
      verificationUri: string;
      interval: number;
    };
    expect(start.verificationUri).toMatch(/\/api\/dev\/llm-sim\/device$/);
    await new Promise((r) => setTimeout(r, start.interval * 1000 + 100));
    const pending = await owner.api
      .post('/admin/llm/providers/nexo-simulado/device/poll', { flowId: start.flowId })
      .expect(200);
    expect(pending.body).toMatchObject({ status: 'pending' });

    const page = await http().get('/api/dev/llm-sim/device').query({ user_code: start.userCode }).expect(200);
    expect(page.text).toContain('name="account"');
    await http()
      .post('/api/dev/llm-sim/device/decision')
      .type('form')
      .send({ user_code: start.userCode, decision: 'allow', ...(account ? { account } : {}) })
      .expect(200);
    await new Promise((r) => setTimeout(r, start.interval * 1000 + 100));
    const awaiting = await owner.api
      .post('/admin/llm/providers/nexo-simulado/device/poll', { flowId: start.flowId })
      .expect(200);
    return { start, awaiting: awaiting.body as Record<string, any> };
  }

  it('código de dispositivo: autorizado → muestra la cuenta (userinfo) → el ADMIN confirma → conectado', async () => {
    const connections = () => prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } });
    const before = await connections();
    const { start, awaiting } = await deviceAuthorized();
    // M1b: la conexión no se activa hasta que el ADMIN confirma la cuenta que autorizó el código.
    expect(awaiting).toMatchObject({
      status: 'confirm',
      account: { available: true, source: 'userinfo', email: 'dev@nexo.local', name: 'Cuenta simulada' },
    });
    expect(await connections()).toBe(before);

    const done = await owner.api
      .post('/admin/llm/providers/nexo-simulado/device/confirm', { flowId: start.flowId })
      .expect(200);
    expect(done.body).toMatchObject({ status: 'connected', connection: { providerId: 'nexo-simulado' } });
    expect(await connections()).toBe(before + 1);
  });

  it('código de dispositivo autorizado con otra cuenta: «No es mi cuenta» lo descarta y revoca el token', async () => {
    const before = await prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } });
    const { start, awaiting } = await deviceAuthorized('atacante@evil.test');
    expect(awaiting).toMatchObject({ status: 'confirm', account: { email: 'atacante@evil.test' } });
    const sim = app.get(DevLlmSimulatorService);
    const revokedBefore = sim.revoked.length;
    const res = await owner.api
      .post('/admin/llm/providers/nexo-simulado/device/cancel', { flowId: start.flowId })
      .expect(200);
    expect(res.body).toEqual({ status: 'cancelled' });
    expect(sim.revoked.length).toBe(revokedBefore + 1);
    expect(sim.revoked.at(-1)).toMatch(/^sim-rt-/);
    expect(await prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } })).toBe(before);
  });
});
