/**
 * Drivers de base de datos (PostgreSQL, MySQL, SQL Server) detrás de una interfaz común. Módulo puro:
 * sin Nest; solo depende de `pg`, `mysql2` y `mssql`.
 *
 * FUENTE CANÓNICA: apps/api/src/modules/connectors/adapters/database/core/
 * COPIA IDÉNTICA:  apps/edge/src/core/   (la CI verifica con `diff -r` que ambas coincidan)
 */
import mssql from 'mssql';
import type { Connection as MysqlCoreConnection } from 'mysql2';
import mysql from 'mysql2/promise';
import { connect as netConnect, isIP } from 'node:net';
import { Pool as PgPool, types as pgTypes, type PoolClient } from 'pg';
import {
  assertReadOnlySql,
  assertSingleStatement,
  compileNamedParams,
  SqlPolicyError,
  type DbEngine,
  type ResolvedLimits,
} from './sql';

export interface DbConnectionSettings {
  engine: DbEngine;
  host: string;
  /**
   * IP ya validada a la que se abre el socket (sin volver a resolver `host`: evita DNS rebinding). `host` se
   * conserva para TLS (SNI y verificación del certificado). Sin valor, el driver resuelve `host` normalmente.
   */
  connectAddress?: string;
  port?: number;
  database: string;
  user: string;
  password?: string;
  /** `true` = TLS verificando el certificado; objeto para ajustar la verificación o aportar la CA. */
  ssl?: boolean | { rejectUnauthorized?: boolean; ca?: string };
  /** Conexiones simultáneas del pool (def. 5). */
  poolMax?: number;
}

export interface QueryOptions extends ResolvedLimits {
  readOnly: boolean;
}

export interface DbField {
  name: string;
  type?: string;
}

export interface DbQueryResult {
  rows: Record<string, unknown>[];
  /** Lectura: filas devueltas. Escritura: filas afectadas. */
  rowCount: number;
  truncated: boolean;
  fields: DbField[];
}

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface SchemaTable {
  schema: string;
  name: string;
  type: 'TABLE' | 'VIEW';
  columns: SchemaColumn[];
}

export interface SchemaFilter {
  /** Solo estas tablas (`tabla` o `esquema.tabla`). */
  tables?: string[];
  /** Texto contenido en el nombre de la tabla (sin distinguir mayúsculas). */
  search?: string;
  /** Máximo de tablas devueltas (def. 500). */
  limit?: number;
}

export interface DbDriver {
  readonly engine: DbEngine;
  /** Ejecuta una consulta con parámetros nombrados (`:nombre`) enlazados por el driver. */
  query(sql: string, params: Record<string, unknown>, opts: QueryOptions): Promise<DbQueryResult>;
  listSchema(filter?: SchemaFilter): Promise<SchemaTable[]>;
  /** `SELECT 1` + versión del motor. */
  ping(): Promise<{ version: string }>;
  close(): Promise<void>;
}

const CONNECT_TIMEOUT_MS = 10_000;

/** Nombre para SNI/certificado cuando se conecta a una IP fijada en lugar del nombre configurado. */
function tlsServername(s: DbConnectionSettings): string | undefined {
  return s.connectAddress && !isIP(s.host) ? s.host : undefined;
}
const MAX_SCHEMA_TABLES = 500;

export function createDriver(settings: DbConnectionSettings): DbDriver {
  if (!settings.host) throw new Error('Falta "host" en la conexión de base de datos');
  if (!settings.database) throw new Error('Falta "database" en la conexión de base de datos');
  switch (settings.engine) {
    case 'postgres':
      return new PostgresDriver(settings);
    case 'mysql':
      return new MysqlDriver(settings);
    case 'mssql':
      return new MssqlDriver(settings);
    default:
      throw new Error(`Motor de base de datos no soportado: ${String(settings.engine)}`);
  }
}

/** Valida la sentencia según el modo antes de enviarla al motor. */
function guard(sql: string, engine: DbEngine, readOnly: boolean): void {
  if (readOnly) assertReadOnlySql(sql, engine);
  else assertSingleStatement(sql, engine);
}

/** Valores JSON-serializables y estables entre motores (Buffer → base64, bigint → texto). */
export function normalizeValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return v.toString();
  if (Buffer.isBuffer(v)) return v.toString('base64');
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  return v;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = normalizeValue(v);
  return out;
}

function tableMatches(t: { schema: string; name: string }, filter?: SchemaFilter): boolean {
  if (filter?.search && !t.name.toLowerCase().includes(filter.search.toLowerCase())) return false;
  if (filter?.tables?.length) {
    const full = `${t.schema}.${t.name}`.toLowerCase();
    return filter.tables.some((x) => x.toLowerCase() === full || x.toLowerCase() === t.name.toLowerCase());
  }
  return true;
}

/** Agrupa filas (esquema, tabla, tipo, columna, tipo de dato, nullable) en tablas con sus columnas. */
function groupSchema(
  rows: { s: string; t: string; tt: string; c: string; dt: string; n: string }[],
  filter?: SchemaFilter,
): SchemaTable[] {
  const limit = Math.min(Math.max(filter?.limit ?? MAX_SCHEMA_TABLES, 1), MAX_SCHEMA_TABLES);
  const tables = new Map<string, SchemaTable>();
  for (const r of rows) {
    const key = `${r.s}.${r.t}`;
    let table = tables.get(key);
    if (!table) {
      if (!tableMatches({ schema: r.s, name: r.t }, filter)) continue;
      if (tables.size >= limit) continue;
      table = { schema: r.s, name: r.t, type: /VIEW/i.test(r.tt) ? 'VIEW' : 'TABLE', columns: [] };
      tables.set(key, table);
    }
    table.columns.push({ name: r.c, type: r.dt, nullable: String(r.n).toUpperCase() === 'YES' });
  }
  return [...tables.values()];
}

/** Rechaza si la promesa no termina a tiempo (respaldo del timeout del propio motor). */
async function withDeadline<T>(p: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`La consulta excedió el tiempo máximo de ${ms} ms`));
    }, ms);
  });
  try {
    return await Promise.race([p, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------------------------------------
// PostgreSQL
// ------------------------------------------------------------------------------------------------

const PG_TYPE_NAMES = new Map<number, string>(
  Object.entries(pgTypes.builtins).map(([name, oid]) => [oid, name.toLowerCase()]),
);

class PostgresDriver implements DbDriver {
  readonly engine = 'postgres' as const;
  private readonly pool: PgPool;

  constructor(s: DbConnectionSettings) {
    const ssl = s.ssl
      ? typeof s.ssl === 'object'
        ? { rejectUnauthorized: s.ssl.rejectUnauthorized ?? true, ca: s.ssl.ca }
        : { rejectUnauthorized: true }
      : false;
    const servername = tlsServername(s);
    this.pool = new PgPool({
      host: s.connectAddress ?? s.host,
      port: s.port ?? 5432,
      database: s.database,
      user: s.user,
      password: s.password,
      ssl: ssl && servername ? { ...ssl, servername } : ssl,
      max: s.poolMax ?? 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      application_name: 'nexo',
    });
    // Un error de un cliente inactivo no debe tumbar el proceso.
    this.pool.on('error', () => undefined);
  }

  async query(sql: string, params: Record<string, unknown>, opts: QueryOptions): Promise<DbQueryResult> {
    guard(sql, 'postgres', opts.readOnly);
    const compiled = compileNamedParams(sql, params, 'postgres');
    const client = await this.pool.connect();
    let broken = false;
    try {
      return await withDeadline(
        this.run(client, compiled.sql, compiled.values, opts),
        opts.timeoutMs + 2_000,
        () => (broken = true),
      );
    } catch (err) {
      if (!broken) await client.query('ROLLBACK').catch(() => (broken = true));
      throw err;
    } finally {
      client.release(broken);
    }
  }

  private async run(client: PoolClient, sql: string, values: unknown[], opts: QueryOptions): Promise<DbQueryResult> {
    const timeout = Math.trunc(opts.timeoutMs);
    if (opts.readOnly) {
      // Cursor de servidor dentro de una transacción READ ONLY: el motor nunca envía más de maxRows + 1 filas.
      await client.query('BEGIN READ ONLY');
      await client.query(`SET LOCAL statement_timeout = ${timeout}`);
      await client.query(`DECLARE nexo_cursor NO SCROLL CURSOR FOR ${sql}`, values);
      const res = await client.query(`FETCH FORWARD ${opts.maxRows + 1} FROM nexo_cursor`);
      await client.query('ROLLBACK');
      const truncated = res.rows.length > opts.maxRows;
      const rows = (res.rows as Record<string, unknown>[]).slice(0, opts.maxRows).map(normalizeRow);
      return { rows, rowCount: rows.length, truncated, fields: this.fields(res.fields) };
    }
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${timeout}`);
    const res = await client.query(sql, values);
    await client.query('COMMIT');
    const all = (res.rows ?? []) as Record<string, unknown>[];
    return {
      rows: all.slice(0, opts.maxRows).map(normalizeRow),
      rowCount: res.rowCount ?? all.length,
      truncated: all.length > opts.maxRows,
      fields: this.fields(res.fields ?? []),
    };
  }

  private fields(fields: { name: string; dataTypeID: number }[]): DbField[] {
    return fields.map((f) => ({ name: f.name, type: PG_TYPE_NAMES.get(f.dataTypeID) ?? String(f.dataTypeID) }));
  }

  async listSchema(filter?: SchemaFilter): Promise<SchemaTable[]> {
    const res = await this.pool.query<{ s: string; t: string; tt: string; c: string; dt: string; n: string }>(
      `SELECT c.table_schema AS s, c.table_name AS t, tb.table_type AS tt, c.column_name AS c, c.data_type AS dt,
              c.is_nullable AS n
         FROM information_schema.columns c
         JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
        WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema') AND c.table_schema NOT LIKE 'pg_toast%'
        ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
    );
    return groupSchema(res.rows, filter);
  }

  async ping(): Promise<{ version: string }> {
    await this.pool.query('SELECT 1');
    const res = await this.pool.query<{ v: string }>("SELECT current_setting('server_version') AS v");
    return { version: `PostgreSQL ${res.rows[0]?.v ?? ''}`.trim() };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ------------------------------------------------------------------------------------------------
// MySQL / MariaDB
// ------------------------------------------------------------------------------------------------

class MysqlDriver implements DbDriver {
  readonly engine = 'mysql' as const;
  private readonly pool: mysql.Pool;

  constructor(s: DbConnectionSettings) {
    const ssl = s.ssl
      ? typeof s.ssl === 'object'
        ? { rejectUnauthorized: s.ssl.rejectUnauthorized ?? true, ca: s.ssl.ca }
        : { rejectUnauthorized: true }
      : undefined;
    const port = s.port ?? 3306;
    const address = s.connectAddress;
    this.pool = mysql.createPool({
      // `host` sigue siendo el nombre (SNI/certificado); el socket se abre contra la IP fijada.
      host: s.host,
      port,
      ...(address ? { stream: () => netConnect({ host: address, port, noDelay: true, keepAlive: true }) } : {}),
      database: s.database,
      user: s.user,
      password: s.password,
      ssl,
      connectionLimit: s.poolMax ?? 5,
      connectTimeout: CONNECT_TIMEOUT_MS,
      maxIdle: 2,
      idleTimeout: 30_000,
      supportBigNumbers: true,
      bigNumberStrings: true,
      multipleStatements: false,
    });
  }

  async query(sql: string, params: Record<string, unknown>, opts: QueryOptions): Promise<DbQueryResult> {
    guard(sql, 'mysql', opts.readOnly);
    const compiled = compileNamedParams(sql, params, 'mysql');
    const conn = await this.pool.getConnection();
    let broken = false;
    try {
      return await withDeadline(
        this.run(conn, compiled.sql, compiled.values, opts),
        opts.timeoutMs + 2_000,
        () => (broken = true),
      );
    } catch (err) {
      if (!broken) await conn.query('ROLLBACK').catch(() => (broken = true));
      throw err;
    } finally {
      if (broken) conn.destroy();
      else conn.release();
    }
  }

  private async run(
    conn: mysql.PoolConnection,
    sql: string,
    values: unknown[],
    opts: QueryOptions,
  ): Promise<DbQueryResult> {
    const timeout = Math.trunc(opts.timeoutMs);
    if (opts.readOnly) {
      await conn.query(`SET SESSION max_execution_time = ${timeout}`);
      await conn.query('SET TRANSACTION READ ONLY');
      await conn.query('START TRANSACTION');
      const res = await this.stream(conn, sql, values, opts);
      await conn.query('ROLLBACK');
      return res;
    }
    await conn.query('START TRANSACTION');
    const [result, fields] = await conn.execute({ sql, timeout }, values as never[]);
    await conn.query('COMMIT');
    if (Array.isArray(result)) {
      const all = result as Record<string, unknown>[];
      return {
        rows: all.slice(0, opts.maxRows).map(normalizeRow),
        rowCount: all.length,
        truncated: all.length > opts.maxRows,
        fields: (fields ?? []).map((f) => ({ name: f.name, type: String(f.type ?? '') })),
      };
    }
    const header = result as { affectedRows?: number };
    return { rows: [], rowCount: header.affectedRows ?? 0, truncated: false, fields: [] };
  }

  /** Lectura en streaming: conserva como máximo maxRows + 1 filas en memoria (el resto se descarta). */
  private stream(conn: mysql.PoolConnection, sql: string, values: unknown[], opts: QueryOptions) {
    return new Promise<DbQueryResult>((resolve, reject) => {
      const rows: Record<string, unknown>[] = [];
      let fields: DbField[] = [];
      let seen = 0;
      // La conexión "core" (API de eventos) permite procesar fila a fila sin acumular el resultado completo.
      const core = conn.connection as unknown as MysqlCoreConnection;
      const cmd = core.execute({ sql, timeout: Math.trunc(opts.timeoutMs) }, values as never[]);
      cmd.on('fields', (f: { name: string; type?: number }[]) => {
        fields = f.map((x) => ({ name: x.name, type: String(x.type ?? '') }));
      });
      cmd.on('result', (row: Record<string, unknown>) => {
        seen++;
        if (rows.length < opts.maxRows) rows.push(normalizeRow(row));
      });
      cmd.on('error', reject);
      cmd.on('end', () => resolve({ rows, rowCount: rows.length, truncated: seen > opts.maxRows, fields }));
    });
  }

  async listSchema(filter?: SchemaFilter): Promise<SchemaTable[]> {
    const [rows] = await this.pool.query(
      `SELECT c.TABLE_SCHEMA AS s, c.TABLE_NAME AS t, tb.TABLE_TYPE AS tt, c.COLUMN_NAME AS c, c.DATA_TYPE AS dt,
              c.IS_NULLABLE AS n
         FROM information_schema.COLUMNS c
         JOIN information_schema.TABLES tb ON tb.TABLE_SCHEMA = c.TABLE_SCHEMA AND tb.TABLE_NAME = c.TABLE_NAME
        WHERE c.TABLE_SCHEMA = DATABASE()
        ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`,
    );
    return groupSchema(rows as { s: string; t: string; tt: string; c: string; dt: string; n: string }[], filter);
  }

  async ping(): Promise<{ version: string }> {
    const [rows] = await this.pool.query('SELECT 1 AS ok, VERSION() AS v');
    return { version: `MySQL ${(rows as { v: string }[])[0]?.v ?? ''}`.trim() };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ------------------------------------------------------------------------------------------------
// SQL Server
// ------------------------------------------------------------------------------------------------

class MssqlDriver implements DbDriver {
  readonly engine = 'mssql' as const;
  private readonly pool: mssql.ConnectionPool;
  private connecting?: Promise<mssql.ConnectionPool>;

  constructor(s: DbConnectionSettings) {
    const verify = typeof s.ssl === 'object' ? (s.ssl.rejectUnauthorized ?? true) : true;
    const servername = tlsServername(s);
    this.pool = new mssql.ConnectionPool({
      server: s.connectAddress ?? s.host,
      port: s.port ?? 1433,
      database: s.database,
      user: s.user,
      password: s.password,
      connectionTimeout: CONNECT_TIMEOUT_MS,
      // Tope duro del driver; cada consulta además se cancela con su propio timeout.
      requestTimeout: 65_000,
      pool: { max: s.poolMax ?? 5, min: 0, idleTimeoutMillis: 30_000 },
      options: {
        encrypt: !!s.ssl,
        trustServerCertificate: !s.ssl || !verify,
        ...(servername ? { serverName: servername } : {}),
      },
    });
    this.pool.on('error', () => undefined);
  }

  private ready(): Promise<mssql.ConnectionPool> {
    this.connecting ??= this.pool.connect().catch((err: unknown) => {
      this.connecting = undefined;
      throw err;
    });
    return this.connecting;
  }

  async query(sql: string, params: Record<string, unknown>, opts: QueryOptions): Promise<DbQueryResult> {
    guard(sql, 'mssql', opts.readOnly);
    const compiled = compileNamedParams(sql, params, 'mssql');
    const pool = await this.ready();
    const tx = new mssql.Transaction(pool);
    await tx.begin(mssql.ISOLATION_LEVEL.READ_COMMITTED);
    try {
      const res = await this.stream(new mssql.Request(tx), compiled.sql, compiled.values, opts);
      // SQL Server no tiene transacciones READ ONLY: la lectura siempre se revierte.
      if (opts.readOnly) await tx.rollback();
      else await tx.commit();
      return res;
    } catch (err) {
      await tx.rollback().catch(() => undefined);
      throw err;
    }
  }

  private stream(req: mssql.Request, sql: string, values: unknown[], opts: QueryOptions): Promise<DbQueryResult> {
    return new Promise<DbQueryResult>((resolve, reject) => {
      values.forEach((v, i) => req.input(`p${i + 1}`, v));
      req.stream = true;
      const rows: Record<string, unknown>[] = [];
      let fields: DbField[] = [];
      let truncated = false;
      let affected = 0;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        req.cancel();
      }, opts.timeoutMs);
      req.on('recordset', (cols: Record<string, { name: string; type?: { name?: string } }>) => {
        if (!fields.length) fields = Object.values(cols).map((c) => ({ name: c.name, type: c.type?.name }));
      });
      req.on('row', (row: Record<string, unknown>) => {
        if (rows.length < opts.maxRows) rows.push(normalizeRow(row));
        else if (!truncated) {
          truncated = true;
          req.cancel();
        }
      });
      req.on('rowsaffected', (n: number) => (affected += n));
      req.on('error', (err: Error & { code?: string }) => {
        if (err.code === 'ECANCEL' && truncated && !timedOut) return;
        clearTimeout(timer);
        reject(timedOut ? new Error(`La consulta excedió el tiempo máximo de ${opts.timeoutMs} ms`) : err);
      });
      req.on('done', () => {
        clearTimeout(timer);
        if (timedOut) return;
        resolve({
          rows,
          rowCount: opts.readOnly || rows.length ? rows.length : affected,
          truncated,
          fields,
        });
      });
      void req.query(sql);
    });
  }

  async listSchema(filter?: SchemaFilter): Promise<SchemaTable[]> {
    const pool = await this.ready();
    const res = await pool.request().query<{ s: string; t: string; tt: string; c: string; dt: string; n: string }>(
      `SELECT c.TABLE_SCHEMA AS s, c.TABLE_NAME AS t, tb.TABLE_TYPE AS tt, c.COLUMN_NAME AS c, c.DATA_TYPE AS dt,
              c.IS_NULLABLE AS n
         FROM INFORMATION_SCHEMA.COLUMNS c
         JOIN INFORMATION_SCHEMA.TABLES tb ON tb.TABLE_SCHEMA = c.TABLE_SCHEMA AND tb.TABLE_NAME = c.TABLE_NAME
        ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`,
    );
    return groupSchema(res.recordset, filter);
  }

  async ping(): Promise<{ version: string }> {
    const pool = await this.ready();
    const res = await pool.request().query<{ v: string }>('SELECT 1 AS ok, @@VERSION AS v');
    return {
      version: String(res.recordset[0]?.v ?? 'SQL Server')
        .split('\n')[0]
        .trim(),
    };
  }

  async close(): Promise<void> {
    await this.pool.close();
  }
}

export { SqlPolicyError };
