import type { EdgeConfig, EdgeConnection } from './config';
import { createDriver, type DbConnectionSettings, type DbDriver } from './core/drivers';
import {
  assertAllowedTables,
  assertReadOnlySql,
  assertSingleStatement,
  isTableAllowed,
  resolveLimits,
  SqlPolicyError,
} from './core/sql';
import type { Logger } from './logger';
import type { EdgeErrorCode, EdgeReply, EdgeRequest, QueryRequest, SchemaRequest, TestRequest } from './protocol';

export type DriverFactory = (settings: DbConnectionSettings) => DbDriver;

class HandlerError extends Error {
  constructor(
    readonly code: EdgeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Ejecuta las solicitudes de Nexo contra las conexiones locales de `edge.yaml`, re-validando TODO localmente
 * (defensa en profundidad): modo lectura, `allowWrites`, límites de filas/tiempo y tablas permitidas.
 */
export class RequestHandler {
  private readonly drivers = new Map<string, DbDriver>();

  constructor(
    private readonly config: EdgeConfig,
    private readonly logger: Logger,
    private readonly driverFactory: DriverFactory = createDriver,
  ) {}

  get connectionKeys(): string[] {
    return Object.keys(this.config.connections);
  }

  async handle(req: EdgeRequest): Promise<EdgeReply> {
    const started = Date.now();
    try {
      switch (req.type) {
        case 'query':
          return await this.query(req, started);
        case 'schema':
          return await this.schema(req);
        case 'test':
          return await this.test(req, started);
        default:
          throw new HandlerError('BAD_REQUEST', `Tipo de solicitud no soportado: ${(req as { type: string }).type}`);
      }
    } catch (err) {
      const code: EdgeErrorCode =
        err instanceof HandlerError ? err.code : err instanceof SqlPolicyError ? 'POLICY' : 'DB';
      const message = (err as Error).message;
      this.logger.warn('solicitud rechazada', {
        type: req.type,
        connection: req.connectionKey,
        operation: req.type === 'query' ? req.operation : undefined,
        code,
        durationMs: Date.now() - started,
      });
      return { type: 'error', id: req.id, code, message };
    }
  }

  async close(): Promise<void> {
    const all = [...this.drivers.values()];
    this.drivers.clear();
    await Promise.all(all.map((d) => d.close().catch(() => undefined)));
  }

  private connection(key: unknown): EdgeConnection {
    const conn = typeof key === 'string' ? this.config.connections[key] : undefined;
    if (!conn) {
      throw new HandlerError('BAD_REQUEST', `Conexión desconocida en este Edge: "${String(key)}"`);
    }
    return conn;
  }

  private driver(conn: EdgeConnection): DbDriver {
    let d = this.drivers.get(conn.key);
    if (!d) {
      d = this.driverFactory(conn);
      this.drivers.set(conn.key, d);
    }
    return d;
  }

  private async query(req: QueryRequest, started: number): Promise<EdgeReply> {
    const conn = this.connection(req.connectionKey);
    if (req.engine && req.engine !== conn.engine) {
      throw new HandlerError(
        'BAD_REQUEST',
        `El motor configurado en Nexo (${req.engine}) no coincide con el de la conexión "${conn.key}" (${conn.engine})`,
      );
    }
    if (typeof req.sql !== 'string') throw new HandlerError('BAD_REQUEST', 'Falta "sql"');
    if (req.mode !== 'read' && req.mode !== 'write') throw new HandlerError('BAD_REQUEST', 'Modo inválido');
    if (req.mode === 'write' && !conn.allowWrites) {
      throw new HandlerError(
        'POLICY',
        `La conexión "${conn.key}" no permite escrituras en este Edge (allowWrites: false en edge.yaml)`,
      );
    }
    if (req.mode === 'read') assertReadOnlySql(req.sql, conn.engine);
    else assertSingleStatement(req.sql, conn.engine);
    assertAllowedTables(req.sql, conn.engine, conn.allowedTables);
    const limits = resolveLimits(req, { maxRows: conn.maxRows, timeoutMs: conn.timeoutMs });
    const params = req.params && typeof req.params === 'object' && !Array.isArray(req.params) ? req.params : {};

    const data = await this.driver(conn).query(req.sql, params, { readOnly: req.mode === 'read', ...limits });
    const durationMs = Date.now() - started;
    this.logger.info('consulta', {
      connection: conn.key,
      operation: req.operation,
      mode: req.mode,
      rows: data.rowCount,
      truncated: data.truncated,
      durationMs,
      status: 'ok',
    });
    return { type: 'result', id: req.id, data, durationMs };
  }

  private async schema(req: SchemaRequest): Promise<EdgeReply> {
    const conn = this.connection(req.connectionKey);
    const tables = Array.isArray(req.tables) ? req.tables.filter((t) => typeof t === 'string') : undefined;
    let result = await this.driver(conn).listSchema({
      tables: tables?.length ? tables : undefined,
      search: typeof req.search === 'string' ? req.search : undefined,
    });
    const allowed = conn.allowedTables;
    if (allowed?.length) result = result.filter((t) => isTableAllowed(`${t.schema}.${t.name}`, allowed));
    this.logger.info('esquema', { connection: conn.key, tables: result.length, status: 'ok' });
    return { type: 'schema_result', id: req.id, engine: conn.engine, tables: result };
  }

  private async test(req: TestRequest, started: number): Promise<EdgeReply> {
    const conn = this.connection(req.connectionKey);
    const { version } = await this.driver(conn).ping();
    return { type: 'test_result', id: req.id, engine: conn.engine, version, durationMs: Date.now() - started };
  }
}
