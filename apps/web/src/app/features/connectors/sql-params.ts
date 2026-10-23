import type { SqlQueryResult } from '../../core/integrations.models';

/**
 * Parámetros nombrados (`:placa`) de una consulta, en orden de aparición y sin duplicados.
 * Ignora literales de texto, identificadores entre comillas, comentarios y casts de PostgreSQL (`::text`).
 */
export function detectSqlParams(sql: string): string[] {
  const clean = (sql ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/\[[^\]]*\]/g, '[]');
  const out: string[] = [];
  for (const m of clean.matchAll(/(^|[^:\w]):([A-Za-z_][A-Za-z0-9_]*)/g)) if (!out.includes(m[2])) out.push(m[2]);
  return out;
}

type JsonSchema = { type?: string; properties?: Record<string, unknown>; required?: string[]; [k: string]: unknown };

/** Propone el `inputSchema` a partir de los parámetros, conservando las propiedades ya descritas. */
export function proposeInputSchema(params: string[], current: unknown): JsonSchema {
  const prev = (current && typeof current === 'object' ? current : {}) as JsonSchema;
  const props = (prev.properties ?? {}) as Record<string, unknown>;
  const properties: Record<string, unknown> = {};
  for (const p of params) properties[p] = props[p] ?? { type: 'string', description: `Valor para :${p}` };
  return { ...prev, type: 'object', properties, required: params };
}

/** Diferencias entre los parámetros de la consulta y las propiedades del esquema. */
export function schemaDrift(params: string[], schema: unknown): { missing: string[]; unused: string[] } {
  const props = Object.keys(((schema as JsonSchema | null)?.properties ?? {}) as Record<string, unknown>);
  return { missing: params.filter((p) => !props.includes(p)), unused: props.filter((p) => !params.includes(p)) };
}

/** Reconoce el resultado de una operación SQL dentro de `data`. */
export function asSqlResult(data: unknown): SqlQueryResult | null {
  return data && typeof data === 'object' && Array.isArray((data as SqlQueryResult).rows) ? (data as SqlQueryResult) : null;
}
