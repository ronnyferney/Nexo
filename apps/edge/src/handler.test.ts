import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseEdgeConfig } from './config';
import type { DbDriver, DbQueryResult, QueryOptions, SchemaFilter } from './core/drivers';
import { RequestHandler } from './handler';
import { silentLogger } from './logger';
import type { ErrorMessage, ResultMessage, SchemaResultMessage } from './protocol';

class FakeDriver implements DbDriver {
  readonly engine = 'postgres' as const;
  calls: { sql: string; params: Record<string, unknown>; opts: QueryOptions }[] = [];
  async query(sql: string, params: Record<string, unknown>, opts: QueryOptions): Promise<DbQueryResult> {
    this.calls.push({ sql, params, opts });
    return { rows: [{ ok: 1 }], rowCount: 1, truncated: false, fields: [{ name: 'ok' }] };
  }
  async listSchema(_filter?: SchemaFilter) {
    return [
      { schema: 'public', name: 'vehiculos', type: 'TABLE' as const, columns: [] },
      { schema: 'public', name: 'nomina', type: 'TABLE' as const, columns: [] },
    ];
  }
  async ping() {
    return { version: 'PostgreSQL 16' };
  }
  async close() {}
}

const config = parseEdgeConfig(
  `
connections:
  ro:
    engine: postgres
    host: h
    database: d
    user: u
    maxRows: 10
    timeoutMs: 5000
    allowedTables: [vehiculos]
  rw:
    engine: postgres
    host: h
    database: d
    user: u
    allowWrites: true
`,
  {},
);

function setup() {
  const driver = new FakeDriver();
  return { driver, handler: new RequestHandler(config, silentLogger, () => driver) };
}

const q = (extra: Record<string, unknown>) =>
  ({ type: 'query', id: 'r1', connectionKey: 'ro', sql: 'SELECT * FROM vehiculos', params: {}, mode: 'read', ...extra }) as never;

describe('RequestHandler (defensa en profundidad)', () => {
  it('ejecuta lecturas aplicando los topes locales', async () => {
    const { handler, driver } = setup();
    const reply = (await handler.handle(q({ maxRows: 5000, timeoutMs: 60000 }))) as ResultMessage;
    assert.equal(reply.type, 'result');
    assert.equal(reply.id, 'r1');
    assert.deepEqual(driver.calls[0].opts, { readOnly: true, maxRows: 10, timeoutMs: 5000 });
  });

  it('rechaza escrituras si la conexión local no las permite', async () => {
    const { handler, driver } = setup();
    const reply = (await handler.handle(q({ mode: 'write', sql: 'UPDATE vehiculos SET a = 1' }))) as ErrorMessage;
    assert.equal(reply.type, 'error');
    assert.equal(reply.code, 'POLICY');
    assert.match(reply.message, /allowWrites: false/);
    assert.equal(driver.calls.length, 0);
  });

  it('permite escrituras en conexiones con allowWrites', async () => {
    const { handler, driver } = setup();
    const reply = await handler.handle(q({ connectionKey: 'rw', mode: 'write', sql: 'UPDATE t SET a = :a' }));
    assert.equal(reply.type, 'result');
    assert.equal(driver.calls[0].opts.readOnly, false);
  });

  it('re-valida modo lectura, una sola sentencia y tablas permitidas', async () => {
    const { handler, driver } = setup();
    for (const sql of ['DELETE FROM vehiculos', 'SELECT 1; DROP TABLE vehiculos', 'SELECT * FROM nomina']) {
      const reply = (await handler.handle(q({ sql }))) as ErrorMessage;
      assert.equal(reply.code, 'POLICY', sql);
    }
    const w = (await handler.handle(q({ connectionKey: 'rw', mode: 'write', sql: 'DELETE FROM t; DROP TABLE t' }))) as ErrorMessage;
    assert.equal(w.code, 'POLICY');
    assert.equal(driver.calls.length, 0);
  });

  it('conexión desconocida, motor distinto o modo inválido → BAD_REQUEST', async () => {
    const { handler } = setup();
    assert.equal(((await handler.handle(q({ connectionKey: 'x' }))) as ErrorMessage).code, 'BAD_REQUEST');
    assert.equal(((await handler.handle(q({ engine: 'mssql' }))) as ErrorMessage).code, 'BAD_REQUEST');
    assert.equal(((await handler.handle(q({ mode: 'admin' }))) as ErrorMessage).code, 'BAD_REQUEST');
  });

  it('el esquema solo expone tablas permitidas', async () => {
    const { handler } = setup();
    const reply = (await handler.handle({ type: 'schema', id: 's1', connectionKey: 'ro' })) as SchemaResultMessage;
    assert.deepEqual(
      reply.tables.map((t) => t.name),
      ['vehiculos'],
    );
    assert.equal(reply.engine, 'postgres');
  });

  it('test devuelve motor y versión', async () => {
    const { handler } = setup();
    const reply = await handler.handle({ type: 'test', id: 't1', connectionKey: 'rw' });
    assert.equal(reply.type, 'test_result');
  });
});
