/**
 * Núcleo SQL puro (sin Nest, sin drivers) compartido entre la API y Nexo Edge.
 *
 * FUENTE CANÓNICA: apps/api/src/modules/connectors/adapters/database/core/
 * COPIA IDÉNTICA:  apps/edge/src/core/   (la CI verifica con `diff -r` que ambas coincidan)
 *
 * - Conversión de parámetros nombrados `:nombre` al marcador nativo de cada motor, con enlace real por el driver.
 * - Validación de sentencias de solo lectura (una sola sentencia, SELECT/WITH, sin palabras de escritura).
 * - Límites de filas y de tiempo.
 * - Extracción aproximada de tablas referenciadas (política `allowedTables` del Edge).
 */

export type DbEngine = 'postgres' | 'mysql' | 'mssql';
export const DB_ENGINES: readonly DbEngine[] = ['postgres', 'mysql', 'mssql'];

export const DB_LIMITS = {
  defaultMaxRows: 500,
  maxRows: 5000,
  defaultTimeoutMs: 15_000,
  minTimeoutMs: 1_000,
  maxTimeoutMs: 60_000,
} as const;

export class SqlPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlPolicyError';
  }
}

// ------------------------------------------------------------------------------------------------
// Tokenizador mínimo: distingue código de literales, identificadores entrecomillados y comentarios.
// ------------------------------------------------------------------------------------------------

type TokenKind = 'code' | 'string' | 'ident' | 'comment' | 'param';
interface Token {
  kind: TokenKind;
  text: string;
  /** Nombre del parámetro (kind = 'param') o identificador sin comillas (kind = 'ident'). */
  value?: string;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;

function readQuoted(sql: string, start: number, quote: string, backslashEscapes: boolean): number {
  let i = start + 1;
  while (i < sql.length) {
    const ch = sql[i];
    if (backslashEscapes && ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) {
      if (sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  throw new SqlPolicyError(`Literal o identificador sin cerrar (${quote}) en la consulta`);
}

function tokenize(sql: string, engine: DbEngine): Token[] {
  const tokens: Token[] = [];
  let code = '';
  const flush = () => {
    if (code) tokens.push({ kind: 'code', text: code });
    code = '';
  };
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Comentarios
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      flush();
      tokens.push({ kind: 'comment', text: sql.slice(i, stop) });
      i = stop;
      continue;
    }
    if (engine === 'mysql' && ch === '#') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      flush();
      tokens.push({ kind: 'comment', text: sql.slice(i, stop) });
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) throw new SqlPolicyError('Comentario /* sin cerrar en la consulta');
      flush();
      tokens.push({ kind: 'comment', text: sql.slice(i, end + 2) });
      i = end + 2;
      continue;
    }

    // Literales de texto
    if (ch === "'") {
      const prev = sql[i - 1];
      const eString = engine === 'postgres' && (prev === 'E' || prev === 'e') && !IDENT_CHAR.test(sql[i - 2] ?? ' ');
      const end = readQuoted(sql, i, "'", engine === 'mysql' || eString);
      flush();
      tokens.push({ kind: 'string', text: sql.slice(i, end) });
      i = end;
      continue;
    }
    // Dollar quoting de PostgreSQL: $$...$$ o $etiqueta$...$etiqueta$
    if (engine === 'postgres' && ch === '$' && !IDENT_CHAR.test(sql[i - 1] ?? ' ')) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        if (end === -1) throw new SqlPolicyError('Literal $$ sin cerrar en la consulta');
        flush();
        tokens.push({ kind: 'string', text: sql.slice(i, end + tag.length) });
        i = end + tag.length;
        continue;
      }
    }

    // Identificadores entrecomillados
    if (ch === '"') {
      const end = readQuoted(sql, i, '"', engine === 'mysql');
      flush();
      // En MySQL (sin ANSI_QUOTES) "..." es un literal de texto; en el resto, un identificador.
      tokens.push(
        engine === 'mysql'
          ? { kind: 'string', text: sql.slice(i, end) }
          : { kind: 'ident', text: sql.slice(i, end), value: sql.slice(i + 1, end - 1).replace(/""/g, '"') },
      );
      i = end;
      continue;
    }
    if (engine === 'mysql' && ch === '`') {
      const end = readQuoted(sql, i, '`', false);
      flush();
      tokens.push({ kind: 'ident', text: sql.slice(i, end), value: sql.slice(i + 1, end - 1).replace(/``/g, '`') });
      i = end;
      continue;
    }
    if (engine === 'mssql' && ch === '[') {
      const end = readQuoted(sql, i, ']', false);
      flush();
      tokens.push({ kind: 'ident', text: sql.slice(i, end), value: sql.slice(i + 1, end - 1).replace(/]]/g, ']') });
      i = end;
      continue;
    }

    // Parámetros nombrados y casts `::`
    if (ch === ':') {
      if (next === ':') {
        code += '::';
        i += 2;
        continue;
      }
      const prev = sql[i - 1] ?? ' ';
      if (next && IDENT_START.test(next) && !IDENT_CHAR.test(prev)) {
        let j = i + 1;
        while (j < sql.length && IDENT_CHAR.test(sql[j])) j++;
        flush();
        tokens.push({ kind: 'param', text: sql.slice(i, j), value: sql.slice(i + 1, j) });
        i = j;
        continue;
      }
    }

    code += ch;
    i++;
  }
  flush();
  return tokens;
}

// ------------------------------------------------------------------------------------------------
// Parámetros nombrados
// ------------------------------------------------------------------------------------------------

export interface CompiledQuery {
  /** SQL con marcadores nativos ($1 / ? / @p1). */
  sql: string;
  /** Valores en orden de marcador (PostgreSQL y MSSQL: uno por nombre; MySQL: uno por aparición). */
  values: unknown[];
  /** Nombres de parámetro en el orden de `values`. */
  names: string[];
}

/** Nombres de parámetros (`:nombre`) usados en la consulta, sin repetidos y en orden de aparición. */
export function extractParamNames(sql: string, engine: DbEngine): string[] {
  const names: string[] = [];
  for (const t of tokenize(sql, engine)) if (t.kind === 'param' && !names.includes(t.value!)) names.push(t.value!);
  return names;
}

function bindValue(value: unknown, engine: DbEngine, name: string): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new SqlPolicyError(`El parámetro :${name} no es un número finito`);
    // mysql2 envía los números como DOUBLE en sentencias preparadas, lo que MySQL ≥ 8.0.22 rechaza en LIMIT;
    // los enteros se envían como texto y MySQL los convierte implícitamente.
    if (engine === 'mysql' && Number.isInteger(value)) return String(value);
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    if (engine === 'postgres') return value;
    throw new SqlPolicyError(`El parámetro :${name} es una lista: solo PostgreSQL admite listas (= ANY(:${name}))`);
  }
  return JSON.stringify(value);
}

/**
 * Convierte `:nombre` en el marcador nativo del motor. Los valores viajan aparte y los enlaza el driver:
 * nunca se concatenan al SQL. Ignora `:` dentro de literales, identificadores entrecomillados y comentarios,
 * y los casts `::tipo` de PostgreSQL. Los parámetros ausentes se enlazan como NULL.
 */
export function compileNamedParams(sql: string, params: Record<string, unknown>, engine: DbEngine): CompiledQuery {
  const out: string[] = [];
  const values: unknown[] = [];
  const names: string[] = [];
  const index = new Map<string, number>();
  for (const t of tokenize(sql, engine)) {
    if (t.kind !== 'param') {
      out.push(t.text);
      continue;
    }
    const name = t.value!;
    const value = bindValue(
      Object.prototype.hasOwnProperty.call(params, name) ? params[name] : undefined,
      engine,
      name,
    );
    if (engine === 'mysql') {
      values.push(value);
      names.push(name);
      out.push('?');
      continue;
    }
    let n = index.get(name);
    if (n === undefined) {
      values.push(value);
      names.push(name);
      n = values.length;
      index.set(name, n);
    }
    out.push(engine === 'postgres' ? `$${n}` : `@p${n}`);
  }
  return { sql: out.join(''), values, names };
}

// ------------------------------------------------------------------------------------------------
// Validación de solo lectura
// ------------------------------------------------------------------------------------------------

/** Palabras que nunca pueden aparecer (fuera de literales) en una consulta de lectura. */
const WRITE_KEYWORDS = new Set([
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'UPSERT',
  'DROP',
  'ALTER',
  'CREATE',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'EXEC',
  'EXECUTE',
  'CALL',
  'COPY',
  'INTO',
  'LOCK',
  'VACUUM',
  'REINDEX',
  'CLUSTER',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
  'DECLARE',
  'KILL',
  'SHUTDOWN',
  'HANDLER',
  'OPENROWSET',
  'OPENQUERY',
  'OPENDATASOURCE',
  'DBLINK',
  'PG_READ_FILE',
  'PG_READ_BINARY_FILE',
  'PG_LS_DIR',
  'LO_IMPORT',
  'LO_EXPORT',
  'PG_TERMINATE_BACKEND',
  'PG_CANCEL_BACKEND',
  'SET_CONFIG',
  'LOAD_FILE',
  'XP_CMDSHELL',
]);

/** Texto "de código" (sin literales ni comentarios) para análisis léxico. */
function codeView(tokens: Token[]): string {
  return tokens.map((t) => (t.kind === 'code' ? t.text : t.kind === 'comment' ? ' ' : ' ? ')).join('');
}

/**
 * Valida que la consulta sea una única sentencia de lectura: empieza por SELECT o WITH, no contiene `;`
 * adicionales y no incluye palabras de escritura (p. ej. un CTE con DELETE o un SELECT ... INTO).
 * Es una primera barrera: la ejecución además ocurre en una transacción de solo lectura.
 */
export function assertReadOnlySql(sql: string, engine: DbEngine): void {
  const code = codeView(tokenize(sql, engine)).trim().replace(/;\s*$/, '');
  if (!code) throw new SqlPolicyError('La consulta está vacía');
  if (code.includes(';')) throw new SqlPolicyError('Solo se permite una sentencia SQL por operación');
  const first = /^[\s(]*([A-Za-z]+)/.exec(code)?.[1]?.toUpperCase();
  if (first !== 'SELECT' && first !== 'WITH') {
    throw new SqlPolicyError('Las operaciones de lectura deben empezar por SELECT o WITH');
  }
  for (const word of code.match(/[A-Za-z_][A-Za-z0-9_$#@]*/g) ?? []) {
    if (WRITE_KEYWORDS.has(word.toUpperCase())) {
      throw new SqlPolicyError(`La consulta de lectura contiene una instrucción no permitida: ${word.toUpperCase()}`);
    }
  }
}

/** Una sola sentencia (también para escrituras): evita encadenar `; DROP ...`. */
export function assertSingleStatement(sql: string, engine: DbEngine): void {
  const code = codeView(tokenize(sql, engine)).trim().replace(/;\s*$/, '');
  if (!code) throw new SqlPolicyError('La consulta está vacía');
  if (code.includes(';')) throw new SqlPolicyError('Solo se permite una sentencia SQL por operación');
}

// ------------------------------------------------------------------------------------------------
// Límites
// ------------------------------------------------------------------------------------------------

export interface ResolvedLimits {
  maxRows: number;
  timeoutMs: number;
}

function clampInt(value: unknown, def: number, min: number, max: number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/** maxRows ∈ [1, 5000] (def. 500) y timeoutMs ∈ [1000, 60000] (def. 15000); `cap` aplica topes locales. */
export function resolveLimits(
  req: { maxRows?: unknown; timeoutMs?: unknown },
  cap: { maxRows?: unknown; timeoutMs?: unknown } = {},
): ResolvedLimits {
  const capRows = clampInt(cap.maxRows, DB_LIMITS.maxRows, 1, DB_LIMITS.maxRows);
  const capTimeout = clampInt(cap.timeoutMs, DB_LIMITS.maxTimeoutMs, DB_LIMITS.minTimeoutMs, DB_LIMITS.maxTimeoutMs);
  return {
    maxRows: Math.min(clampInt(req.maxRows, DB_LIMITS.defaultMaxRows, 1, DB_LIMITS.maxRows), capRows),
    timeoutMs: Math.min(
      clampInt(req.timeoutMs, DB_LIMITS.defaultTimeoutMs, DB_LIMITS.minTimeoutMs, DB_LIMITS.maxTimeoutMs),
      capTimeout,
    ),
  };
}

// ------------------------------------------------------------------------------------------------
// Tablas referenciadas (política allowedTables del Edge)
// ------------------------------------------------------------------------------------------------

type Lex = { t: 'word' | 'ident' | 'punct'; v: string };

function lex(tokens: Token[]): Lex[] {
  const out: Lex[] = [];
  for (const tok of tokens) {
    if (tok.kind === 'ident') out.push({ t: 'ident', v: tok.value! });
    else if (tok.kind === 'string' || tok.kind === 'param') out.push({ t: 'punct', v: '?' });
    else if (tok.kind === 'code') {
      for (const m of tok.text.matchAll(/[A-Za-z_][A-Za-z0-9_$#@]*|\S/g)) {
        out.push(/^[A-Za-z_]/.test(m[0]) ? { t: 'word', v: m[0] } : { t: 'punct', v: m[0] });
      }
    }
  }
  return out;
}

const TABLE_INTRODUCERS = new Set(['FROM', 'JOIN', 'INTO', 'UPDATE', 'TABLE']);
const FROM_TERMINATORS = new Set([
  'WHERE',
  'GROUP',
  'ORDER',
  'LIMIT',
  'OFFSET',
  'HAVING',
  'WINDOW',
  'FETCH',
  'FOR',
  'UNION',
  'EXCEPT',
  'INTERSECT',
  'RETURNING',
  'SELECT',
  'SET',
  'VALUES',
]);
const NOT_ALIAS = new Set([
  'WHERE',
  'JOIN',
  'INNER',
  'LEFT',
  'RIGHT',
  'FULL',
  'CROSS',
  'OUTER',
  'ON',
  'USING',
  'GROUP',
  'ORDER',
  'LIMIT',
  'OFFSET',
  'UNION',
  'EXCEPT',
  'INTERSECT',
  'HAVING',
  'WINDOW',
  'FETCH',
  'FOR',
  'SET',
  'VALUES',
  'RETURNING',
  'WITH',
  'NATURAL',
  'LATERAL',
  'OUTPUT',
  'SELECT',
]);

/**
 * Tablas referenciadas tras FROM/JOIN/INTO/UPDATE (excluye nombres de CTE). Aproximado y conservador:
 * ante una construcción ambigua puede devolver nombres de más (la política falla cerrada).
 */
export function extractTableRefs(sql: string, engine: DbEngine): string[] {
  const lx = lex(tokenize(sql, engine));
  const ctes = new Set<string>();
  for (let i = 0; i < lx.length - 1; i++) {
    const isName = lx[i].t === 'word' || lx[i].t === 'ident';
    const prev = lx[i - 1];
    if (
      isName &&
      lx[i + 1].t === 'word' &&
      lx[i + 1].v.toUpperCase() === 'AS' &&
      lx[i + 2]?.v === '(' &&
      prev &&
      (prev.v === ',' || prev.v.toUpperCase() === 'WITH' || prev.v.toUpperCase() === 'RECURSIVE')
    ) {
      ctes.add(lx[i].v.toLowerCase());
    }
  }
  const refs = new Set<string>();
  const readName = (start: number): { name: string; end: number } | null => {
    const first = lx[start];
    if (!first || (first.t !== 'word' && first.t !== 'ident')) return null;
    const parts = [first.v];
    let j = start + 1;
    while (lx[j]?.v === '.' && lx[j + 1] && (lx[j + 1].t === 'word' || lx[j + 1].t === 'ident')) {
      parts.push(lx[j + 1].v);
      j += 2;
    }
    return { name: parts.join('.'), end: j };
  };
  /** Lee `nombre [AS] [alias]` desde j; registra el nombre (incluidas funciones: falla cerrada). */
  const readItem = (j: number): number => {
    if (lx[j]?.t === 'word' && ['ONLY', 'LATERAL'].includes(lx[j].v.toUpperCase())) j++;
    const r = readName(j);
    if (!r) return j;
    if (r.name.includes('.') || !ctes.has(r.name.toLowerCase())) refs.add(r.name);
    j = r.end;
    if (lx[j]?.t === 'word' && lx[j].v.toUpperCase() === 'AS') j++;
    if (lx[j] && (lx[j].t === 'ident' || (lx[j].t === 'word' && !NOT_ALIAS.has(lx[j].v.toUpperCase())))) j++;
    return j;
  };
  // Por nivel de paréntesis: ¿estamos dentro de una lista FROM? (las comas de ese nivel separan tablas).
  const inFrom: boolean[] = [false];
  for (let i = 0; i < lx.length; i++) {
    const tok = lx[i];
    const depth = inFrom.length - 1;
    if (tok.v === '(') {
      inFrom.push(false);
      continue;
    }
    if (tok.v === ')') {
      if (inFrom.length > 1) inFrom.pop();
      continue;
    }
    if (tok.v === ',' && inFrom[depth]) {
      i = readItem(i + 1) - 1;
      continue;
    }
    if (tok.t !== 'word') continue;
    const upper = tok.v.toUpperCase();
    if (TABLE_INTRODUCERS.has(upper)) {
      inFrom[depth] = upper === 'FROM' || upper === 'JOIN' ? true : inFrom[depth];
      i = readItem(i + 1) - 1;
    } else if (FROM_TERMINATORS.has(upper)) {
      inFrom[depth] = false;
    }
  }
  return [...refs];
}

/** Coincidencia de una referencia (`tabla` o `esquema.tabla`) con la lista permitida (sin distinguir mayúsculas). */
export function isTableAllowed(ref: string, allowed: string[]): boolean {
  const r = ref.toLowerCase();
  const rName = r.split('.').pop()!;
  return allowed.some((entry) => {
    const e = entry.toLowerCase();
    if (e === r) return true;
    const eParts = e.split('.');
    const eName = eParts.pop()!;
    // `tabla` permitida cubre cualquier esquema; `esquema.tabla` cubre la referencia sin esquema.
    return eName === rName && (eParts.length === 0 || !r.includes('.'));
  });
}

export function assertAllowedTables(sql: string, engine: DbEngine, allowed?: string[]): void {
  if (!allowed || allowed.length === 0) return;
  const refs = extractTableRefs(sql, engine);
  const denied = refs.filter((r) => !isTableAllowed(r, allowed));
  if (denied.length) throw new SqlPolicyError(`Tablas no permitidas por la política del Edge: ${denied.join(', ')}`);
}

// ------------------------------------------------------------------------------------------------
// Identificadores (consultas sugeridas)
// ------------------------------------------------------------------------------------------------

export function quoteIdent(name: string, engine: DbEngine): string {
  if (engine === 'mysql') return '`' + name.replace(/`/g, '``') + '`';
  if (engine === 'mssql') return '[' + name.replace(/]/g, ']]') + ']';
  return '"' + name.replace(/"/g, '""') + '"';
}

/** SELECT sugerido con columnas explícitas y límite parametrizable (`:limit`). */
export function buildSuggestedSelect(
  engine: DbEngine,
  table: { schema: string; name: string; columns: { name: string }[] },
): string {
  const cols = table.columns.length ? table.columns.map((c) => quoteIdent(c.name, engine)).join(', ') : '*';
  const from = `${quoteIdent(table.schema, engine)}.${quoteIdent(table.name, engine)}`;
  return engine === 'mssql' ? `SELECT TOP (:limit) ${cols} FROM ${from}` : `SELECT ${cols} FROM ${from} LIMIT :limit`;
}
