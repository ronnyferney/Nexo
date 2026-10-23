import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { DbConnectionSettings } from './core/drivers';
import { DB_ENGINES, DB_LIMITS, type DbEngine } from './core/sql';

/** Conexión nombrada de `edge.yaml`, con sus políticas locales. */
export interface EdgeConnection extends DbConnectionSettings {
  key: string;
  /** Escrituras permitidas en esta conexión (def. false). Se exige además `allowWrites` en el conector de Nexo. */
  allowWrites: boolean;
  /** Tope local de filas (≤ 5000). */
  maxRows?: number;
  /** Tope local de tiempo por consulta en ms (≤ 60000). */
  timeoutMs?: number;
  /** Si se define, solo se pueden consultar estas tablas (`tabla` o `esquema.tabla`). */
  allowedTables?: string[];
}

export interface EdgeConfig {
  connections: Record<string, EdgeConnection>;
}

export class ConfigError extends Error {}

const KEY = /^[A-Za-z0-9_.-]{1,64}$/;
const VAR = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/** Sustituye `${VAR}` y `${VAR:-valor}` en un texto con variables de entorno. */
export function expandEnv(value: string, env: NodeJS.ProcessEnv, where: string): string {
  return value.replace(VAR, (_, name: string, def: string | undefined) => {
    const v = env[name];
    if (v !== undefined && v !== '') return v;
    if (def !== undefined) return def;
    throw new ConfigError(`${where}: la variable de entorno ${name} no está definida`);
  });
}

function expandDeep(value: unknown, env: NodeJS.ProcessEnv, where: string): unknown {
  if (typeof value === 'string') return expandEnv(value, env, where);
  if (Array.isArray(value)) return value.map((v, i) => expandDeep(v, env, `${where}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expandDeep(v, env, `${where}.${k}`)]));
  }
  return value;
}

function optionalInt(v: unknown, where: string, min: number, max: number): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`${where} debe ser un entero entre ${min} y ${max}`);
  }
  return n;
}

function bool(v: unknown, where: string): boolean {
  if (v === undefined || v === null || v === '') return false;
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new ConfigError(`${where} debe ser true o false`);
}

/** Valida el contenido YAML de `edge.yaml` (las variables `${VAR}` se resuelven con `env`). */
export function parseEdgeConfig(yamlText: string, env: NodeJS.ProcessEnv = process.env): EdgeConfig {
  let doc: unknown;
  try {
    doc = parse(yamlText);
  } catch (err) {
    throw new ConfigError(`edge.yaml no es YAML válido: ${(err as Error).message}`);
  }
  const root = (doc ?? {}) as { connections?: unknown };
  if (!root.connections || typeof root.connections !== 'object' || Array.isArray(root.connections)) {
    throw new ConfigError('edge.yaml debe definir "connections" con al menos una conexión');
  }
  const connections: Record<string, EdgeConnection> = {};
  for (const [key, raw] of Object.entries(root.connections as Record<string, unknown>)) {
    const where = `connections.${key}`;
    if (!KEY.test(key)) throw new ConfigError(`${where}: nombre inválido (letras, números, _ . -; máx. 64)`);
    if (!raw || typeof raw !== 'object') throw new ConfigError(`${where} debe ser un objeto`);
    const c = expandDeep(raw, env, where) as Record<string, unknown>;
    const engine = String(c.engine ?? '') as DbEngine;
    if (!DB_ENGINES.includes(engine)) throw new ConfigError(`${where}.engine debe ser ${DB_ENGINES.join(', ')}`);
    for (const f of ['host', 'database', 'user'] as const) {
      if (typeof c[f] !== 'string' || !(c[f] as string).trim()) throw new ConfigError(`${where}.${f} es obligatorio`);
    }
    let ssl: EdgeConnection['ssl'];
    if (c.ssl && typeof c.ssl === 'object') {
      const s = c.ssl as Record<string, unknown>;
      ssl = {
        rejectUnauthorized: s.rejectUnauthorized === undefined ? true : bool(s.rejectUnauthorized, `${where}.ssl.rejectUnauthorized`),
        ca: s.caFile ? readFileSync(String(s.caFile), 'utf8') : typeof s.ca === 'string' ? s.ca : undefined,
      };
    } else ssl = bool(c.ssl, `${where}.ssl`);
    let allowedTables: string[] | undefined;
    if (c.allowedTables !== undefined && c.allowedTables !== null) {
      if (!Array.isArray(c.allowedTables) || c.allowedTables.some((t) => typeof t !== 'string' || !t.trim())) {
        throw new ConfigError(`${where}.allowedTables debe ser una lista de nombres de tabla`);
      }
      allowedTables = (c.allowedTables as string[]).map((t) => t.trim());
    }
    connections[key] = {
      key,
      engine,
      host: String(c.host).trim(),
      port: optionalInt(c.port, `${where}.port`, 1, 65535),
      database: String(c.database),
      user: String(c.user),
      password: c.password === undefined || c.password === null ? undefined : String(c.password),
      ssl,
      poolMax: optionalInt(c.poolMax, `${where}.poolMax`, 1, 50),
      allowWrites: bool(c.allowWrites, `${where}.allowWrites`),
      maxRows: optionalInt(c.maxRows, `${where}.maxRows`, 1, DB_LIMITS.maxRows),
      timeoutMs: optionalInt(c.timeoutMs, `${where}.timeoutMs`, DB_LIMITS.minTimeoutMs, DB_LIMITS.maxTimeoutMs),
      allowedTables,
    };
  }
  if (!Object.keys(connections).length) throw new ConfigError('edge.yaml no define ninguna conexión');
  return { connections };
}

export function loadEdgeConfig(path: string, env: NodeJS.ProcessEnv = process.env): EdgeConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new ConfigError(`No se pudo leer ${path}: ${(err as Error).message}`);
  }
  return parseEdgeConfig(text, env);
}
