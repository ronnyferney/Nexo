import { BadRequestException, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { HttpClientService } from '../../../../common/http/http-client.service';
import { render } from '../../../../common/template/template.engine';
import { EdgeReplyError, EdgeService } from '../../../edge/edge.service';
import type { ResultMessage, SchemaResultMessage, TestResultMessage } from '../../../edge/edge.protocol';
import type { ConnectorAdapter, DiscoverOptions } from '../../domain/connector-adapter';
import type {
  ConnectorRuntime,
  DiscoveredOperation,
  InvocationResult,
  OperationRuntime,
  TestResult,
} from '../../domain/connector.types';
import { createDriver, type DbConnectionSettings, type DbDriver, type SchemaTable } from './core/drivers';
import {
  assertReadOnlySql,
  assertSingleStatement,
  buildSuggestedSelect,
  DB_ENGINES,
  DB_LIMITS,
  resolveLimits,
  SqlPolicyError,
  type DbEngine,
} from './core/sql';

/** `config` de un conector DATABASE (ADR 0005, D4). Las credenciales son plantillas `{{ secrets.X }}`. */
export interface DatabaseConfig {
  engine: DbEngine;
  mode: 'direct' | 'edge';
  edgeId?: string;
  connectionKey?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | { rejectUnauthorized?: boolean; ca?: string };
  allowWrites?: boolean;
  poolMax?: number;
}

/** `definition` de una operación: consulta declarada con parámetros nombrados. */
export interface DatabaseOperationDef {
  sql: string;
  mode?: 'read' | 'write';
  maxRows?: number;
  timeoutMs?: number;
  /** Valores por defecto de parámetros ausentes en la entrada (p. ej. `{ limit: 100 }`). */
  defaults?: Record<string, unknown>;
}

/** Cierre de pools inactivos. */
const POOL_IDLE_MS = 5 * 60_000;
const SWEEP_EVERY_MS = 60_000;
const DISCOVER_DEFAULT_TABLES = 20;
const SUGGESTED_LIMIT = 100;
const SCHEMA_TIMEOUT_MS = 30_000;

interface PoolEntry {
  fingerprint: string;
  driver: DbDriver;
  lastUsed: number;
}

/**
 * Conector de bases de datos SQL (PostgreSQL, MySQL, SQL Server).
 * - Modo `direct`: la API se conecta al motor (host validado contra SSRF, TLS opcional, pool por conector).
 * - Modo `edge`: delega en Nexo Edge, que se conecta dentro de la red del cliente.
 * El SQL de la operación nunca pasa por el motor de plantillas: la entrada solo llega como parámetros enlazados.
 */
@Injectable()
export class DatabaseAdapter implements ConnectorAdapter, OnModuleDestroy {
  readonly type = 'DATABASE' as const;
  private readonly logger = new Logger(DatabaseAdapter.name);
  private readonly pools = new Map<string, PoolEntry>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    private readonly http: HttpClientService,
    private readonly edge: EdgeService,
  ) {
    this.sweeper = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.sweeper.unref();
  }

  async invoke(
    connector: ConnectorRuntime,
    operation: OperationRuntime,
    input: Record<string, unknown>,
  ): Promise<InvocationResult> {
    const config = this.config(connector);
    const def = parseOperation(operation);
    const mode = def.mode ?? 'read';
    if (mode === 'write' && config.allowWrites !== true) {
      throw new BadRequestException(
        `La operación "${operation.key}" escribe datos y el conector no lo permite (active "allowWrites")`,
      );
    }
    try {
      if (mode === 'read') assertReadOnlySql(def.sql, config.engine);
      else assertSingleStatement(def.sql, config.engine);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    const limits = resolveLimits(def);
    const params = { ...(def.defaults ?? {}), ...input };
    const started = Date.now();

    if (config.mode === 'edge') {
      const reply = await this.viaEdge<ResultMessage>(
        connector,
        config,
        {
          type: 'query',
          connectionKey: config.connectionKey!,
          engine: config.engine,
          sql: def.sql,
          params,
          mode,
          maxRows: limits.maxRows,
          timeoutMs: limits.timeoutMs,
          operation: operation.key,
        },
        limits.timeoutMs,
      ).catch((err: unknown) => edgeDbError(err, started));
      if ('ok' in reply) return reply;
      return { ok: true, data: reply.data, durationMs: Date.now() - started, meta: { via: 'edge' } };
    }

    const driver = await this.driver(connector, config);
    try {
      const data = await driver.query(def.sql, params, { readOnly: mode === 'read', ...limits });
      return { ok: true, data, durationMs: Date.now() - started, meta: { via: 'direct' } };
    } catch (err) {
      if (err instanceof SqlPolicyError) throw new BadRequestException(err.message);
      return { ok: false, data: { error: dbMessage(err) }, durationMs: Date.now() - started };
    }
  }

  async test(connector: ConnectorRuntime): Promise<TestResult> {
    const config = this.config(connector);
    const started = Date.now();
    if (config.mode === 'edge') {
      const reply = await this.viaEdge<TestResultMessage>(
        connector,
        config,
        { type: 'test', connectionKey: config.connectionKey! },
        DB_LIMITS.defaultTimeoutMs,
      );
      return {
        ok: true,
        message: `Conexión correcta vía Edge: ${reply.version} (${Date.now() - started} ms)`,
        details: { engine: reply.engine, version: reply.version },
      };
    }
    const driver = await this.driver(connector, config);
    const { version } = await driver.ping();
    return {
      ok: true,
      message: `Conexión correcta: ${version} (${Date.now() - started} ms)`,
      details: { engine: config.engine, version },
    };
  }

  /** Tablas, vistas y columnas (`GET /connectors/:id/schema`). */
  async describeSchema(connector: ConnectorRuntime): Promise<{ tables: SchemaTable[] }> {
    const { tables } = await this.loadSchema(connector);
    return { tables };
  }

  /** Crea operaciones SELECT sugeridas para las tablas indicadas (o las primeras 20). */
  async discover(connector: ConnectorRuntime, options?: DiscoverOptions): Promise<DiscoveredOperation[]> {
    const wanted = (options?.tables ?? []).filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim());
    const { engine, tables } = await this.loadSchema(connector, wanted.length ? wanted : undefined);
    const selected = wanted.length ? tables : tables.slice(0, DISCOVER_DEFAULT_TABLES);
    if (wanted.length && !selected.length) throw new Error(`No se encontraron las tablas: ${wanted.join(', ')}`);
    return suggestOperations(engine, selected);
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.sweeper);
    await Promise.all([...this.pools.values()].map((p) => p.driver.close().catch(() => undefined)));
    this.pools.clear();
  }

  // ---------- Internos ----------
  private async loadSchema(
    connector: ConnectorRuntime,
    tables?: string[],
  ): Promise<{ engine: DbEngine; tables: SchemaTable[] }> {
    const config = this.config(connector);
    if (config.mode === 'edge') {
      const reply = await this.viaEdge<SchemaResultMessage>(
        connector,
        config,
        { type: 'schema', connectionKey: config.connectionKey!, tables },
        SCHEMA_TIMEOUT_MS,
      );
      const engine = DB_ENGINES.includes(reply.engine as DbEngine) ? (reply.engine as DbEngine) : config.engine;
      return { engine, tables: reply.tables };
    }
    const driver = await this.driver(connector, config);
    return { engine: config.engine, tables: await driver.listSchema(tables ? { tables } : undefined) };
  }

  private async viaEdge<T extends ResultMessage | SchemaResultMessage | TestResultMessage>(
    connector: ConnectorRuntime,
    config: DatabaseConfig,
    payload: Parameters<EdgeService['request']>[2],
    timeoutMs: number,
  ): Promise<T> {
    if (!config.edgeId || !config.connectionKey) {
      throw new BadRequestException('En modo edge configure "edgeId" y "connectionKey"');
    }
    try {
      return await this.edge.request<T>(connector.workspaceId, config.edgeId, payload, timeoutMs);
    } catch (err) {
      if (err instanceof EdgeReplyError && (err.code === 'POLICY' || err.code === 'BAD_REQUEST')) {
        throw new BadRequestException(`Edge: ${err.message}`);
      }
      throw err;
    }
  }

  private config(connector: ConnectorRuntime): DatabaseConfig {
    const config = render<DatabaseConfig>(connector.config, { secrets: connector.secrets });
    if (!DB_ENGINES.includes(config.engine)) {
      throw new BadRequestException(`Motor no soportado: "${String(config.engine)}" (use ${DB_ENGINES.join(', ')})`);
    }
    if (config.mode !== 'direct' && config.mode !== 'edge') {
      throw new BadRequestException('El modo del conector debe ser "direct" o "edge"');
    }
    return config;
  }

  /** Pool por conector; se recrea si cambia la configuración renderizada (incluidos los secretos). */
  private async driver(connector: ConnectorRuntime, config: DatabaseConfig): Promise<DbDriver> {
    const settings: DbConnectionSettings = {
      engine: config.engine,
      host: String(config.host ?? '').trim(),
      port: config.port !== undefined && config.port !== null ? Number(config.port) : undefined,
      database: String(config.database ?? ''),
      user: String(config.user ?? ''),
      password: config.password !== undefined ? String(config.password) : undefined,
      ssl: config.ssl,
      poolMax: config.poolMax ? Math.min(Math.max(Number(config.poolMax), 1), 20) : undefined,
    };
    if (!settings.host || !settings.database || !settings.user) {
      throw new BadRequestException('En modo directo configure "host", "database" y "user"');
    }
    if (
      settings.port !== undefined &&
      (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535)
    ) {
      throw new BadRequestException('Puerto inválido');
    }
    const fingerprint = createHash('sha256').update(JSON.stringify(settings)).digest('hex');
    const current = this.pools.get(connector.id);
    if (current?.fingerprint === fingerprint) {
      current.lastUsed = Date.now();
      return current.driver;
    }
    try {
      await this.http.assertPublicHost(settings.host);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    if (current) {
      this.pools.delete(connector.id);
      void current.driver.close().catch(() => undefined);
    }
    const driver = createDriver(settings);
    this.pools.set(connector.id, { fingerprint, driver, lastUsed: Date.now() });
    return driver;
  }

  private async sweep() {
    const now = Date.now();
    for (const [id, entry] of this.pools) {
      if (now - entry.lastUsed < POOL_IDLE_MS) continue;
      this.pools.delete(id);
      await entry.driver.close().catch((err: Error) => this.logger.warn(`Cierre de pool ${id}: ${err.message}`));
    }
  }
}

function parseOperation(operation: OperationRuntime): DatabaseOperationDef {
  const def = operation.definition as unknown as DatabaseOperationDef;
  if (!def || typeof def.sql !== 'string' || !def.sql.trim()) {
    throw new BadRequestException(`La operación "${operation.key}" no define "sql"`);
  }
  if (def.mode !== undefined && def.mode !== 'read' && def.mode !== 'write') {
    throw new BadRequestException(`El modo de "${operation.key}" debe ser "read" o "write"`);
  }
  if (def.defaults !== undefined && (typeof def.defaults !== 'object' || Array.isArray(def.defaults))) {
    throw new BadRequestException(`"defaults" de "${operation.key}" debe ser un objeto`);
  }
  return def;
}

/** Errores del motor reportados por el Edge → resultado `ok: false` (igual que en modo directo). */
function edgeDbError(err: unknown, started: number): InvocationResult {
  if (err instanceof EdgeReplyError && err.code === 'DB') {
    return { ok: false, data: { error: err.message }, durationMs: Date.now() - started, meta: { via: 'edge' } };
  }
  throw err;
}

function dbMessage(err: unknown): string {
  const e = err as Error & { code?: string };
  return e.code && !e.message.includes(e.code) ? `${e.message} (${e.code})` : e.message;
}

function opKey(base: string): string {
  return base
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/_$/, '')
    .slice(0, 64);
}

export function suggestOperations(engine: DbEngine, tables: SchemaTable[]): DiscoveredOperation[] {
  const names = new Map<string, number>();
  for (const t of tables) names.set(t.name.toLowerCase(), (names.get(t.name.toLowerCase()) ?? 0) + 1);
  return tables.map((t) => {
    const ambiguous = (names.get(t.name.toLowerCase()) ?? 0) > 1;
    const key = opKey(ambiguous ? `select_${t.schema}_${t.name}` : `select_${t.name}`);
    const kind = t.type === 'VIEW' ? 'la vista' : 'la tabla';
    const cols = t.columns.map((c) => c.name);
    return {
      key,
      name: `Consultar ${t.schema}.${t.name}`,
      description: `Lee filas de ${kind} ${t.schema}.${t.name} (solo lectura). Columnas: ${cols.join(', ')}.`.slice(
        0,
        2000,
      ),
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: DB_LIMITS.maxRows,
            default: SUGGESTED_LIMIT,
            description: 'Número máximo de filas a devolver',
          },
        },
      },
      definition: {
        sql: buildSuggestedSelect(engine, t),
        mode: 'read',
        maxRows: DB_LIMITS.defaultMaxRows,
        timeoutMs: DB_LIMITS.defaultTimeoutMs,
        defaults: { limit: SUGGESTED_LIMIT },
      },
    };
  });
}
