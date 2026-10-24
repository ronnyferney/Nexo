import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { HttpClientService } from '../src/common/http/http-client.service';
import { DatabaseAdapter } from '../src/modules/connectors/adapters/database/database.adapter';
import type { EdgeService } from '../src/modules/edge/edge.service';
import { createTestApp } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

/**
 * ADR 0005 (D4/D5): conector DATABASE directo contra el Postgres local y a través de Nexo Edge
 * (la clase cliente de apps/edge corre en este mismo proceso y se conecta por WebSocket a la app de prueba).
 */

const PG = {
  host: process.env.E2E_PG_HOST ?? 'localhost',
  port: Number(process.env.E2E_PG_PORT ?? 5432),
  database: process.env.E2E_PG_DATABASE ?? 'nexo',
  user: process.env.E2E_PG_USER ?? 'nexo',
  password: process.env.E2E_PG_PASSWORD ?? 'nexo',
};

// ---- Cliente Edge (apps/edge compilado; se carga en tiempo de ejecución para no acoplar los tsconfig) ----
const EDGE_DIR = join(__dirname, '..', '..', 'edge');
interface EdgeClientLike {
  start(): void;
  stop(): Promise<void>;
  waitForWelcome(timeoutMs?: number): Promise<{ edgeId: string; name: string }>;
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  readonly connected: boolean;
}
interface EdgeLib {
  EdgeClient: new (opts: Record<string, unknown>) => EdgeClientLike;
  parseEdgeConfig(yaml: string, env?: Record<string, string | undefined>): unknown;
}
function loadEdgeLib(): EdgeLib {
  if (!existsSync(join(EDGE_DIR, 'node_modules'))) {
    throw new Error(`Instale las dependencias de apps/edge antes de la suite: cd ${EDGE_DIR} && npm ci`);
  }
  execSync('npm run build', { cwd: EDGE_DIR, stdio: 'pipe' });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(join(EDGE_DIR, 'dist', 'index.js')) as EdgeLib;
}

const suffix = `${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
const TABLE = `e2e_vehiculos_${suffix}`;
const SEQ = `e2e_seq_${suffix}`;
const ROWS = 30;

describe('Conector DATABASE y Nexo Edge (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let pg: Client;
  let owner: Session;
  let edgeLib: EdgeLib;
  const clients: EdgeClientLike[] = [];

  beforeAll(async () => {
    edgeLib = loadEdgeLib();
    pg = new Client(PG);
    await pg.connect();
    await pg.query(
      `CREATE TABLE "${TABLE}" (id serial PRIMARY KEY, placa text NOT NULL, estado text NOT NULL, km integer)`,
    );
    await pg.query(`CREATE SEQUENCE "${SEQ}"`);
    await pg.query(
      `INSERT INTO "${TABLE}" (placa, estado, km)
       SELECT 'PLC' || lpad(g::text, 3, '0'), CASE WHEN g % 2 = 0 THEN 'ACTIVO' ELSE 'TALLER' END, g * 100
         FROM generate_series(1, ${ROWS}) g`,
    );

    app = await createTestApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    owner = await registerOwner(app, 'db');
    await owner.api.put('/workspace/secrets', { name: 'E2E_DB_PASSWORD', value: PG.password }).expect(200);
  });

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.stop().catch(() => undefined)));
    await app?.close();
    if (pg) {
      await pg.query(`DROP TABLE IF EXISTS "${TABLE}"`).catch(() => undefined);
      await pg.query(`DROP SEQUENCE IF EXISTS "${SEQ}"`).catch(() => undefined);
      await pg.end();
    }
  });

  async function createConnector(s: Session, config: Record<string, unknown>, name = 'BD E2E') {
    const res = await s.api.post('/connectors', { name, type: 'DATABASE', config }).expect(201);
    return (res.body as { id: string }).id;
  }

  async function createOp(
    s: Session,
    connectorId: string,
    key: string,
    definition: Record<string, unknown>,
    inputSchema?: Record<string, unknown>,
  ) {
    const res = await s.api
      .post(`/connectors/${connectorId}/operations`, { key, name: key, definition, inputSchema })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  const invoke = (s: Session, connectorId: string, opId: string, input: Record<string, unknown> = {}) =>
    s.api.post(`/connectors/${connectorId}/operations/${opId}/invoke`, { input });

  const directConfig = (extra: Record<string, unknown> = {}) => ({
    engine: 'postgres',
    mode: 'direct',
    host: PG.host,
    port: PG.port,
    database: PG.database,
    user: PG.user,
    password: '{{ secrets.E2E_DB_PASSWORD }}',
    ssl: false,
    ...extra,
  });

  // ------------------------------------------------------------------------------------------------
  describe('modo directo', () => {
    let connectorId: string;

    beforeAll(async () => {
      connectorId = await createConnector(owner, directConfig());
    });

    it('test: SELECT 1 y versión del motor', async () => {
      const res = await owner.api.post(`/connectors/${connectorId}/test`).expect(200);
      expect(res.body).toMatchObject({ ok: true, details: { engine: 'postgres' } });
      expect(res.body.message).toMatch(/PostgreSQL \d+/);
    });

    it('invoca una consulta con parámetros nombrados enlazados', async () => {
      const opId = await createOp(owner, connectorId, 'por_placa', {
        sql: `SELECT id, placa, estado, km FROM "${TABLE}" WHERE placa = :placa AND km >= :km::int`,
        mode: 'read',
      });
      const res = await invoke(owner, connectorId, opId, { placa: 'PLC007', km: 100 }).expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toMatchObject({
        rows: [{ placa: 'PLC007', estado: 'TALLER', km: 700 }],
        rowCount: 1,
        truncated: false,
      });
      expect(res.body.data.fields.map((f: { name: string }) => f.name)).toEqual(['id', 'placa', 'estado', 'km']);
      expect(typeof res.body.durationMs).toBe('number');
    });

    it('límite de filas: devuelve maxRows y truncated: true', async () => {
      const opId = await createOp(owner, connectorId, 'todas', {
        sql: `SELECT id FROM "${TABLE}" ORDER BY id`,
        mode: 'read',
        maxRows: 7,
      });
      const res = await invoke(owner, connectorId, opId).expect(200);
      expect(res.body.data.rows).toHaveLength(7);
      expect(res.body.data).toMatchObject({ rowCount: 7, truncated: true });

      const huge = await createOp(owner, connectorId, 'tope', {
        sql: `SELECT g FROM generate_series(1, 6000) g`,
        maxRows: 999999,
      });
      const capped = await invoke(owner, connectorId, huge).expect(200);
      expect(capped.body.data.rows).toHaveLength(5000);
      expect(capped.body.data.truncated).toBe(true);
    });

    it('rechaza escrituras sin allowWrites y sentencias no SELECT en modo lectura', async () => {
      const write = await createOp(owner, connectorId, 'actualizar', {
        sql: `UPDATE "${TABLE}" SET estado = :estado WHERE id = :id`,
        mode: 'write',
      });
      const res = await invoke(owner, connectorId, write, { estado: 'X', id: 1 }).expect(400);
      expect(res.body.message).toMatch(/allowWrites/);

      const disguised = await createOp(owner, connectorId, 'disfrazada', {
        sql: `DELETE FROM "${TABLE}"`,
        mode: 'read',
      });
      expect((await invoke(owner, connectorId, disguised).expect(400)).body.message).toMatch(/SELECT o WITH/);

      const chained = await createOp(owner, connectorId, 'encadenada', {
        sql: `SELECT 1; DROP TABLE "${TABLE}"`,
        mode: 'read',
      });
      expect((await invoke(owner, connectorId, chained).expect(400)).body.message).toMatch(/una sentencia/);

      const cte = await createOp(owner, connectorId, 'cte_borra', {
        sql: `WITH b AS (DELETE FROM "${TABLE}" RETURNING id) SELECT count(*) FROM b`,
        mode: 'read',
      });
      await invoke(owner, connectorId, cte).expect(400);

      // Barrera del motor: aunque la validación léxica lo deje pasar, la transacción es READ ONLY.
      const seq = await createOp(owner, connectorId, 'secuencia', { sql: `SELECT nextval('"${SEQ}"')`, mode: 'read' });
      const ro = await invoke(owner, connectorId, seq).expect(200);
      expect(ro.body.ok).toBe(false);
      expect(ro.body.data.error).toMatch(/read-only/);

      const count = await pg.query(`SELECT count(*)::int AS n FROM "${TABLE}" WHERE estado = 'X'`);
      expect(count.rows[0].n).toBe(0);
    });

    it('permite escrituras cuando el conector tiene allowWrites', async () => {
      const rw = await createConnector(owner, directConfig({ allowWrites: true }), 'BD escritura');
      const op = await createOp(owner, rw, 'marcar', {
        sql: `UPDATE "${TABLE}" SET km = km + 1 WHERE placa = :placa`,
        mode: 'write',
      });
      const res = await invoke(owner, rw, op, { placa: 'PLC030' }).expect(200);
      expect(res.body).toMatchObject({ ok: true, data: { rowCount: 1 } });
      const after = await pg.query(`SELECT km FROM "${TABLE}" WHERE placa = 'PLC030'`);
      expect(after.rows[0].km).toBe(3001);
    });

    it('neutraliza inyección en los parámetros', async () => {
      const opId = await createOp(owner, connectorId, 'buscar', {
        sql: `SELECT id FROM "${TABLE}" WHERE placa = :placa`,
      });
      for (const placa of [`x' OR '1'='1`, `'; DROP TABLE "${TABLE}"; --`, `PLC001' --`]) {
        const res = await invoke(owner, connectorId, opId, { placa }).expect(200);
        expect(res.body).toMatchObject({ ok: true, data: { rows: [], rowCount: 0 } });
      }
      const still = await pg.query(`SELECT count(*)::int AS n FROM "${TABLE}"`);
      expect(still.rows[0].n).toBe(ROWS);
    });

    it('errores del motor → ok: false con el mensaje', async () => {
      const opId = await createOp(owner, connectorId, 'rota', { sql: 'SELECT columna_inexistente FROM pg_class' });
      const res = await invoke(owner, connectorId, opId).expect(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.data.error).toMatch(/columna_inexistente/);
    });

    it('esquema y descubrimiento de operaciones SELECT sugeridas', async () => {
      const schema = await owner.api.get(`/connectors/${connectorId}/schema`).expect(200);
      const table = (schema.body.tables as any[]).find((t) => t.name === TABLE);
      expect(table).toMatchObject({ schema: 'public', type: 'TABLE' });
      expect(table.columns).toEqual([
        { name: 'id', type: 'integer', nullable: false },
        { name: 'placa', type: 'text', nullable: false },
        { name: 'estado', type: 'text', nullable: false },
        { name: 'km', type: 'integer', nullable: true },
      ]);

      const disc = await owner.api.post(`/connectors/${connectorId}/discover`, { tables: [TABLE] }).expect(200);
      expect(disc.body).toEqual({ imported: 1, operations: [`select_${TABLE}`] });

      const detail = await owner.api.get(`/connectors/${connectorId}`).expect(200);
      const op = (detail.body.operations as any[]).find((o) => o.key === `select_${TABLE}`);
      expect(op.definition.sql).toBe(`SELECT "id", "placa", "estado", "km" FROM "public"."${TABLE}" LIMIT :limit`);
      const three = await invoke(owner, connectorId, op.id, { limit: 3 }).expect(200);
      expect(three.body.data.rows).toHaveLength(3);
      const byDefault = await invoke(owner, connectorId, op.id).expect(200);
      expect(byDefault.body.data.rows).toHaveLength(ROWS);

      await owner.api.post(`/connectors/${connectorId}/discover`, { tables: ['no_existe_xyz'] }).expect(400);
    });

    it('un VIEWER puede leer el esquema pero no descubrir', async () => {
      const viewer = await addMember(app, owner, { role: 'VIEWER' });
      await viewer.api.get(`/connectors/${connectorId}/schema`).expect(200);
      await viewer.api.post(`/connectors/${connectorId}/discover`, { tables: [TABLE] }).expect(403);
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('SSRF', () => {
    const runtime = {
      id: 'c-ssrf',
      workspaceId: 'w',
      type: 'DATABASE' as const,
      config: directConfig({ password: 'x' }),
      auth: { type: 'none' as const },
      secrets: {},
    };

    it('con CONNECTOR_ALLOW_PRIVATE_NETWORKS=false bloquea hosts privados antes de conectar', async () => {
      const http = new HttpClientService(new ConfigService({ http: { allowPrivateNetworks: false } }));
      const adapter = new DatabaseAdapter(http, {} as EdgeService);
      try {
        for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.10']) {
          await expect(
            adapter.invoke(
              { ...runtime, config: { ...runtime.config, host } },
              { key: 'q', definition: { sql: 'SELECT 1' } },
              {},
            ),
          ).rejects.toThrow(/bloqueado por política de red/);
        }
        await expect(adapter.test(runtime)).rejects.toThrow(/bloqueado/);
      } finally {
        await adapter.onModuleDestroy();
      }
    });

    it('DNS rebinding: el driver conecta a la IP validada y no vuelve a resolver el nombre', async () => {
      // `db.rebind.invalid` no existe en DNS: solo conecta si el driver usa la IP fijada por la política de red.
      const resolvePublicHost = jest.fn(async () => [{ address: '127.0.0.1', family: 4 as const }]);
      const http = { resolvePublicHost } as unknown as HttpClientService;
      const adapter = new DatabaseAdapter(http, {} as EdgeService);
      try {
        const res = await adapter.test({
          ...runtime,
          config: directConfig({ host: 'db.rebind.invalid', password: PG.password }),
        });
        expect(res.ok).toBe(true);
        expect(resolvePublicHost).toHaveBeenCalledTimes(1);
        expect(resolvePublicHost).toHaveBeenCalledWith('db.rebind.invalid');
      } finally {
        await adapter.onModuleDestroy();
      }
    });

    it('vía API (flag true en la suite) el mismo host sí se permite', async () => {
      const http = new HttpClientService(new ConfigService({ http: { allowPrivateNetworks: true } }));
      const adapter = new DatabaseAdapter(http, {} as EdgeService);
      try {
        const res = await adapter.test({ ...runtime, config: directConfig({ password: PG.password }) });
        expect(res.ok).toBe(true);
      } finally {
        await adapter.onModuleDestroy();
      }
    });
  });

  // ------------------------------------------------------------------------------------------------
  describe('Nexo Edge', () => {
    let edgeId: string;
    let token: string;
    let client: EdgeClientLike;

    const edgeYaml = `
connections:
  local:
    engine: postgres
    host: ${PG.host}
    port: ${PG.port}
    database: ${PG.database}
    user: ${PG.user}
    password: \${E2E_EDGE_PG_PASSWORD}
    allowWrites: false
    maxRows: 10
  local_rw:
    engine: postgres
    host: ${PG.host}
    port: ${PG.port}
    database: ${PG.database}
    user: ${PG.user}
    password: \${E2E_EDGE_PG_PASSWORD}
    allowWrites: true
  solo_vehiculos:
    engine: postgres
    host: ${PG.host}
    database: ${PG.database}
    user: ${PG.user}
    password: \${E2E_EDGE_PG_PASSWORD}
    allowedTables: [public.${TABLE}]
`;

    function startClient(tok: string): EdgeClientLike {
      const config = edgeLib.parseEdgeConfig(edgeYaml, { E2E_EDGE_PG_PASSWORD: PG.password });
      const c = new edgeLib.EdgeClient({
        url: baseUrl,
        token: tok,
        config,
        hostname: 'edge-e2e',
        version: '9.9.9-e2e',
        backoff: { initialMs: 100, maxMs: 300 },
      });
      clients.push(c);
      c.start();
      return c;
    }

    async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > until) throw new Error('Condición no alcanzada a tiempo');
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const edgeConfig = (extra: Record<string, unknown> = {}) => ({
      engine: 'postgres',
      mode: 'edge',
      edgeId,
      connectionKey: 'local',
      ...extra,
    });

    it('solo ADMIN+ administra Edges; cualquier rol los lista para selectores', async () => {
      const editor = await addMember(app, owner, { role: 'EDITOR' });
      await editor.api.post('/admin/edges', { name: 'No permitido' }).expect(403);
      await editor.api.get('/admin/edges').expect(403);

      const res = await owner.api.post('/admin/edges', { name: 'Sede principal' }).expect(201);
      expect(res.body.token).toMatch(/^nexoedge_[A-Za-z0-9_-]{20,}$/);
      edgeId = res.body.id;
      token = res.body.token;

      const list = await owner.api.get('/admin/edges').expect(200);
      const row = (list.body as any[]).find((e) => e.id === edgeId);
      expect(row).toMatchObject({ name: 'Sede principal', status: 'OFFLINE', connections: [], lastSeenAt: null });
      expect(JSON.stringify(list.body)).not.toContain(token);

      const options = await editor.api.get('/edges').expect(200);
      expect(options.body).toEqual([{ id: edgeId, name: 'Sede principal', status: 'OFFLINE', connections: [] }]);
    });

    it('rechaza el upgrade sin token o con token inválido (401)', async () => {
      const bad = new edgeLib.EdgeClient({
        url: baseUrl,
        token: 'nexoedge_invalido',
        config: edgeLib.parseEdgeConfig(edgeYaml, { E2E_EDGE_PG_PASSWORD: 'x' }),
        backoff: { initialMs: 5000, maxMs: 5000 },
      });
      clients.push(bad);
      const status = await new Promise<number>((resolve) => {
        bad.once('rejected', resolve);
        bad.start();
      });
      expect(status).toBe(401);
      await bad.stop();
    });

    it('hello → ONLINE con conexiones, versión y hostname', async () => {
      client = startClient(token);
      const welcome = await client.waitForWelcome();
      expect(welcome).toEqual({ type: 'welcome', edgeId, name: 'Sede principal' });
      const row = await waitFor(async () => {
        const list = await owner.api.get('/admin/edges').expect(200);
        const e = (list.body as any[]).find((x) => x.id === edgeId);
        return e?.status === 'ONLINE' && e.connections.length ? e : undefined;
      });
      expect(row).toMatchObject({
        status: 'ONLINE',
        version: '9.9.9-e2e',
        hostname: 'edge-e2e',
        connections: ['local', 'local_rw', 'solo_vehiculos'],
      });
      expect(new Date(row.lastSeenAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    it('conector DATABASE en modo edge consulta el Postgres local a través del Edge', async () => {
      const cid = await createConnector(owner, edgeConfig(), 'BD vía Edge');
      const test = await owner.api.post(`/connectors/${cid}/test`).expect(200);
      expect(test.body.ok).toBe(true);
      expect(test.body.message).toMatch(/vía Edge: PostgreSQL/);

      const op = await createOp(owner, cid, 'por_estado', {
        sql: `SELECT placa, km FROM "${TABLE}" WHERE estado = :estado ORDER BY id`,
        maxRows: 50,
      });
      const res = await invoke(owner, cid, op, { estado: 'ACTIVO' }).expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.meta).toEqual({ via: 'edge' });
      // El Edge aplica su tope local (maxRows: 10) aunque la operación pida 50.
      expect(res.body.data.rows).toHaveLength(10);
      expect(res.body.data.truncated).toBe(true);
      expect(res.body.data.rows[0]).toEqual({ placa: 'PLC002', km: 200 });

      const schema = await owner.api.get(`/connectors/${cid}/schema`).expect(200);
      expect((schema.body.tables as any[]).some((t) => t.name === TABLE)).toBe(true);
      const disc = await owner.api.post(`/connectors/${cid}/discover`, { tables: [TABLE] }).expect(200);
      expect(disc.body.operations).toEqual([`select_${TABLE}`]);
    });

    it('el Edge con allowWrites:false rechaza la escritura aunque el conector la permita', async () => {
      const cid = await createConnector(owner, edgeConfig({ allowWrites: true }), 'BD Edge escritura');
      const op = await createOp(owner, cid, 'marcar', {
        sql: `UPDATE "${TABLE}" SET km = km + 1 WHERE placa = :placa`,
        mode: 'write',
      });
      const res = await invoke(owner, cid, op, { placa: 'PLC001' }).expect(400);
      expect(res.body.message).toMatch(/Edge: .*no permite escrituras.*allowWrites: false/);
      expect((await pg.query(`SELECT km FROM "${TABLE}" WHERE placa = 'PLC001'`)).rows[0].km).toBe(100);

      // Con una conexión local que sí lo permite, la escritura pasa.
      const rw = await createConnector(
        owner,
        edgeConfig({ allowWrites: true, connectionKey: 'local_rw' }),
        'BD Edge rw',
      );
      const op2 = await createOp(owner, rw, 'marcar', {
        sql: `UPDATE "${TABLE}" SET km = km + 1 WHERE placa = :placa`,
        mode: 'write',
      });
      const ok = await invoke(owner, rw, op2, { placa: 'PLC001' }).expect(200);
      expect(ok.body).toMatchObject({ ok: true, data: { rowCount: 1 } });
      expect((await pg.query(`SELECT km FROM "${TABLE}" WHERE placa = 'PLC001'`)).rows[0].km).toBe(101);
    });

    it('el Edge re-valida solo lectura y tablas permitidas', async () => {
      const cid = await createConnector(owner, edgeConfig({ connectionKey: 'solo_vehiculos' }), 'BD Edge tablas');
      const okOp = await createOp(owner, cid, 'ok', { sql: `SELECT count(*)::int AS n FROM public."${TABLE}"` });
      expect((await invoke(owner, cid, okOp).expect(200)).body.data.rows).toEqual([{ n: ROWS }]);
      const denied = await createOp(owner, cid, 'otra', { sql: 'SELECT id FROM "User" LIMIT 1' });
      const res = await invoke(owner, cid, denied).expect(400);
      expect(res.body.message).toMatch(/Tablas no permitidas.*User/);

      const schema = await owner.api.get(`/connectors/${cid}/schema`).expect(200);
      expect((schema.body.tables as any[]).map((t) => t.name)).toEqual([TABLE]);

      const unknownKey = await createConnector(owner, edgeConfig({ connectionKey: 'no_existe' }), 'BD Edge sin clave');
      const op = await createOp(owner, unknownKey, 'q', { sql: 'SELECT 1' });
      expect((await invoke(owner, unknownKey, op).expect(400)).body.message).toMatch(/no declara la conexión/);
    });

    it('aislamiento multi-tenant: otro workspace no puede usar ni administrar el Edge', async () => {
      const intruder = await registerOwner(app, 'intruso');
      const cid = await createConnector(intruder, edgeConfig(), 'Robo de Edge');
      const op = await createOp(intruder, cid, 'q', { sql: `SELECT placa FROM "${TABLE}"` });
      const res = await invoke(intruder, cid, op).expect(404);
      expect(res.body.message).toMatch(/Edge no encontrado/);
      expect((await intruder.api.post(`/connectors/${cid}/test`).expect(200)).body.ok).toBe(false);

      expect((await intruder.api.get('/admin/edges').expect(200)).body).toEqual([]);
      expect((await intruder.api.get('/edges').expect(200)).body).toEqual([]);
      await intruder.api.post(`/admin/edges/${edgeId}/rotate-token`).expect(404);
      await intruder.api.delete(`/admin/edges/${edgeId}`).expect(404);
    });

    it('rotar el token desconecta al Edge y el token anterior deja de servir', async () => {
      const kicked = new Promise<number>((resolve) => client.once('disconnected', resolve));
      const rejected = new Promise<number>((resolve) => client.once('rejected', resolve));
      const res = await owner.api.post(`/admin/edges/${edgeId}/rotate-token`).expect(200);
      expect(res.body.token).toMatch(/^nexoedge_/);
      expect(res.body.token).not.toBe(token);
      expect(await kicked).toBe(4001);
      expect(await rejected).toBe(401); // reintenta con el token viejo y Nexo lo rechaza
      await client.stop();

      client = startClient(res.body.token as string);
      await client.waitForWelcome();
      const cid = await createConnector(owner, edgeConfig(), 'BD tras rotación');
      const op = await createOp(owner, cid, 'q', { sql: `SELECT placa FROM "${TABLE}" WHERE id = :id`, maxRows: 1 });
      expect((await invoke(owner, cid, op, { id: 3 }).expect(200)).body.data.rows).toEqual([{ placa: 'PLC003' }]);
    });

    it('una nueva conexión del mismo Edge reemplaza a la anterior', async () => {
      const second = startClient(
        // Reutiliza el token vigente leyendo el que tiene el cliente actual (misma credencial).
        (client as unknown as { opts: { token: string } }).opts.token,
      );
      const replaced = new Promise<number>((resolve) => client.once('disconnected', resolve));
      await second.waitForWelcome();
      expect(await replaced).toBe(4000);
      await client.stop();
      client = second;
    });

    it('Edge desconectado → 503 claro', async () => {
      const cid = await createConnector(owner, edgeConfig(), 'BD Edge caído');
      const op = await createOp(owner, cid, 'q', { sql: 'SELECT 1 AS uno' });
      await client.stop();
      const res = await waitFor(async () => {
        const r = await invoke(owner, cid, op);
        return r.status === 503 ? r : undefined;
      });
      expect(res.body.message).toMatch(/no está conectado/);
    });

    it('eliminar el Edge', async () => {
      await owner.api.delete(`/admin/edges/${edgeId}`).expect(200);
      expect((await owner.api.get('/admin/edges').expect(200)).body).toEqual([]);
    });
  });
});
