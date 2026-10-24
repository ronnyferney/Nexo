import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { Api, createTestApp, prismaOf } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

interface KeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  role: string;
  legacy: boolean;
  expiresAt: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  rotationSuggested: boolean;
  revokedReason: string | null;
  lastUsedAt: string | null;
  createdBy: { name: string; email: string } | null;
  key?: string;
}

const DAY = 24 * 3600 * 1000;

const definition = {
  nodes: [
    { id: 'trigger', type: 'trigger', name: 'Inicio', config: {} },
    { id: 't', type: 'transform', name: 'Salida', config: { output: { ok: true } } },
  ],
  edges: [{ id: 'e1', source: 'trigger', target: 't' }],
};

describe('API keys con expiración y alcance (B3, E2E)', () => {
  let app: INestApplication;
  let owner: Session;
  let workflowId: string;

  const createKey = async (s: Session, body: object, status = 201) =>
    (await s.api.post('/workspace/api-keys', { name: 'Integración', ...body }).expect(status)).body as KeyView;
  const list = async (s: Session) => (await s.api.get('/workspace/api-keys').expect(200)).body as KeyView[];
  const mcp = (key: string) =>
    request(app.getHttpServer())
      .post('/api/mcp')
      .set('Authorization', `Bearer ${key}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'api-keys');
    workflowId = (
      (await owner.api.post('/workflows', { name: 'Para API keys', definition }).expect(201)).body as {
        id: string;
      }
    ).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('por defecto vence a los 90 días, con rol EDITOR; la llave completa solo se muestra al crearla', async () => {
    const created = await createKey(owner, { scopes: ['read'] });
    expect(created.key).toMatch(/^nexo_/);
    expect(created).toMatchObject({ role: 'EDITOR', scopes: ['read'], legacy: false, status: 'ACTIVE' });
    const expires = new Date(created.expiresAt!).getTime();
    expect(Math.abs(expires - (Date.now() + 90 * DAY))).toBeLessThan(60_000);
    const listed = (await list(owner)).find((k) => k.id === created.id)!;
    expect(listed).not.toHaveProperty('key');
    expect(JSON.stringify(await list(owner))).not.toContain(created.key);
    expect(listed.createdBy).toMatchObject({ email: owner.email });
    expect(listed.rotationSuggested).toBe(false);
  });

  it('valida el alcance, el rol y la expiración', async () => {
    await createKey(owner, {}, 400);
    await createKey(owner, { scopes: [] }, 400);
    await createKey(owner, { scopes: ['*'] }, 400);
    await createKey(owner, { scopes: ['admin'] }, 400);
    await createKey(owner, { scopes: ['read'], role: 'OWNER' }, 400);
    await createKey(owner, { scopes: ['read'], expiration: '7d' }, 400);
    const year = await createKey(owner, { scopes: ['read'], expiration: '365d', role: 'ADMIN' });
    expect(year.role).toBe('ADMIN');
    expect(Math.abs(new Date(year.expiresAt!).getTime() - (Date.now() + 365 * DAY))).toBeLessThan(60_000);
  });

  it('«sin expiración» solo lo decide un OWNER; un ADMIN no crea claves con más rol que el suyo', async () => {
    const admin = await addMember(app, owner, { role: 'ADMIN', tag: 'keys-admin' });
    const forbidden = await admin.api
      .post('/workspace/api-keys', { name: 'Eterna', scopes: ['read'], expiration: 'never' })
      .expect(403);
    expect((forbidden.body as { message: string }).message).toMatch(/OWNER/);
    const forever = await createKey(owner, { scopes: ['read'], expiration: 'never' });
    expect(forever.expiresAt).toBeNull();
    expect(forever.rotationSuggested).toBe(true);
    await createKey(admin, { scopes: ['read'], role: 'ADMIN', expiration: '30d' });

    const editor = await addMember(app, owner, { role: 'EDITOR', tag: 'keys-editor' });
    await editor.api.post('/workspace/api-keys', { name: 'No', scopes: ['read'] }).expect(403);
  });

  it('una clave vencida responde 401', async () => {
    const created = await createKey(owner, { scopes: ['read'], expiration: '30d' });
    await new Api(app, created.key).get('/workflows').expect(200);
    await prismaOf(app).apiKey.update({ where: { id: created.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await new Api(app, created.key).get('/workflows').expect(401);
    expect((res.body as { message: string }).message).toMatch(/venció/);
    expect((await list(owner)).find((k) => k.id === created.id)?.status).toBe('EXPIRED');
  });

  it('una acción fuera del alcance responde 403; dentro del alcance funciona', async () => {
    const reader = await createKey(owner, { scopes: ['read'] });
    const api = new Api(app, reader.key);
    await api.get(`/workflows/${workflowId}`).expect(200);
    const denied = await api.post(`/workflows/${workflowId}/run`, { input: {}, wait: true }).expect(403);
    expect((denied.body as { message: string }).message).toMatch(/workflows:run/);
    await api.post('/workflows', { name: 'Desde API', definition }).expect(403);
    expect((await mcp(reader.key!)).status).toBe(403);

    const runner = new Api(app, (await createKey(owner, { scopes: ['workflows:run'] })).key);
    const ex = (await runner.post(`/workflows/${workflowId}/run`, { input: {}, wait: true }).expect(202)).body as {
      status: string;
      steps: { nodeId: string; status: string }[];
    };
    expect(ex.status).toBe('SUCCEEDED');
    expect(ex.steps.map((s) => s.nodeId)).toEqual(expect.arrayContaining(['trigger', 't']));
    // Sin `read` no consulta; sin `write` no modifica.
    await runner.get('/workflows').expect(403);
    await runner.patch(`/workflows/${workflowId}`, { name: 'Renombrado' }).expect(403);

    const mcpKey = await createKey(owner, { scopes: ['mcp'] });
    expect((await mcp(mcpKey.key!)).status).toBe(200);
  });

  it('una API key no gestiona API keys (ni con rol ADMIN y alcance write)', async () => {
    const admin = new Api(app, (await createKey(owner, { scopes: ['read', 'write'], role: 'ADMIN' })).key);
    await admin.get('/workspace/api-keys').expect(200);
    await admin.post('/workspace/api-keys', { name: 'Hija', scopes: ['read'] }).expect(403);
    const other = await createKey(owner, { scopes: ['read'] });
    await admin.delete(`/workspace/api-keys/${other.id}`).expect(403);
  });

  it('el rol efectivo se limita al vigente de quien la creó; si deja el workspace, la clave deja de valer', async () => {
    const admin = await addMember(app, owner, { role: 'ADMIN', tag: 'keys-degradado' });
    const created = await createKey(admin, { scopes: ['read', 'write'], role: 'ADMIN' });
    const api = new Api(app, created.key);
    await api.put('/workspace/secrets', { name: 'B3_PRUEBA', value: 'x' }).expect(200);
    await owner.api.patch(`/admin/org/members/${admin.membershipId}`, { role: 'EDITOR' }).expect(200);
    await api.put('/workspace/secrets', { name: 'B3_PRUEBA', value: 'y' }).expect(403);
    await api.get('/workflows').expect(200);
    await owner.api.delete(`/admin/org/members/${admin.membershipId}`).expect(200);
    await api.get('/workflows').expect(401);
  });

  it('revocar invalida la clave de inmediato y queda en la lista como REVOKED', async () => {
    const created = await createKey(owner, { scopes: ['read'] });
    await new Api(app, created.key).get('/workflows').expect(200);
    await owner.api.delete(`/workspace/api-keys/${created.id}`).expect(200);
    await new Api(app, created.key).get('/workflows').expect(401);
    expect((await list(owner)).find((k) => k.id === created.id)).toMatchObject({
      status: 'REVOKED',
      revokedReason: 'manual',
    });
    // Otro workspace no la ve ni la revoca.
    const other = await registerOwner(app, 'keys-ajeno');
    const mine = await createKey(owner, { scopes: ['read'] });
    await other.api.delete(`/workspace/api-keys/${mine.id}`).expect(404);
    expect((await list(other)).map((k) => k.id)).not.toContain(mine.id);
  });

  it('registra lastUsedAt', async () => {
    const created = await createKey(owner, { scopes: ['read'] });
    expect((await list(owner)).find((k) => k.id === created.id)?.lastUsedAt).toBeNull();
    await new Api(app, created.key).get('/workflows').expect(200);
    expect((await list(owner)).find((k) => k.id === created.id)?.lastUsedAt).toEqual(expect.any(String));
  });

  it('una clave anterior a B3 (alcance `*`, sin expiración) sigue funcionando como antes y se marca para rotarla', async () => {
    const key = `nexo_${CryptoService.randomToken(32)}`;
    // Así quedan las claves existentes tras la migración: alcance `*`, rol EDITOR, sin expiración ni creador.
    const row = await prismaOf(app).apiKey.create({
      data: {
        workspaceId: owner.workspaceId,
        name: 'Antigua',
        prefix: key.slice(0, 12),
        hash: CryptoService.sha256(key),
        scopes: ['*'],
        role: 'EDITOR',
      },
    });
    const api = new Api(app, key);
    await api.get('/workflows').expect(200);
    await api.post(`/workflows/${workflowId}/run`, { input: {}, wait: true }).expect(202);
    await api.post('/workflows', { name: 'Desde clave antigua', definition }).expect(201);
    expect((await mcp(key)).status).toBe(200);
    // Igual que antes: rol EDITOR, nada de ADMIN.
    await api.put('/workspace/secrets', { name: 'B3_ANTIGUA', value: 'x' }).expect(403);
    expect((await list(owner)).find((k) => k.id === row.id)).toMatchObject({
      legacy: true,
      expiresAt: null,
      status: 'ACTIVE',
      rotationSuggested: true,
      createdBy: null,
    });
  });
});
