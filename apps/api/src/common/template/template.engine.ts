/**
 * Motor de plantillas seguro (sin eval) para mapear datos entre nodos y conectores.
 *
 *   "Hola {{ input.name }}"              -> interpolación de texto
 *   "{{ nodes.http.output.items }}"      -> si la cadena es una sola expresión, conserva el tipo original
 *   "{{ input.city | default:'Bogotá' | upper }}"
 *
 * Filtros: json, upper, lower, trim, default:'x', length, first, last.
 */
const EXPR = /\{\{\s*([^}]+?)\s*\}\}/g;
const SINGLE_EXPR = /^\{\{\s*([^}]+?)\s*\}\}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export type TemplateContext = Record<string, unknown>;

export function getPath(source: unknown, path: string): unknown {
  if (!path) return source;
  const parts = path
    .replace(/\[(\w+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let current: unknown = source;
  for (const part of parts) {
    if (FORBIDDEN_KEYS.has(part)) return undefined;
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function parseArg(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) return t.slice(1, -1);
  return t;
}

function applyFilter(value: unknown, filter: string): unknown {
  const [name, ...rest] = filter.split(':');
  const arg = parseArg(rest.join(':') || undefined);
  switch (name.trim()) {
    case 'json':
      return JSON.stringify(value);
    case 'upper':
      return String(value ?? '').toUpperCase();
    case 'lower':
      return String(value ?? '').toLowerCase();
    case 'trim':
      return String(value ?? '').trim();
    case 'default':
      return value === undefined || value === null || value === '' ? arg : value;
    case 'length':
      return Array.isArray(value) || typeof value === 'string' ? value.length : 0;
    case 'first':
      return Array.isArray(value) ? value[0] : value;
    case 'last':
      return Array.isArray(value) ? value[value.length - 1] : value;
    default:
      throw new Error(`Filtro de plantilla desconocido: ${name}`);
  }
}

export function evaluateExpression(expression: string, ctx: TemplateContext): unknown {
  const [path, ...filters] = expression.split('|');
  const trimmed = path.trim();
  let value: unknown = /^'.*'$|^".*"$/.test(trimmed) ? trimmed.slice(1, -1) : getPath(ctx, trimmed);
  for (const f of filters) value = applyFilter(value, f);
  return value;
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** Renderiza recursivamente cadenas, arreglos y objetos. */
export function render<T = unknown>(template: unknown, ctx: TemplateContext): T {
  if (typeof template === 'string') {
    const single = SINGLE_EXPR.exec(template);
    if (single) return evaluateExpression(single[1], ctx) as T;
    return template.replace(EXPR, (_, expr: string) => stringify(evaluateExpression(expr, ctx))) as T;
  }
  if (Array.isArray(template)) return template.map((item) => render(item, ctx)) as T;
  if (template && typeof template === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template)) {
      if (!FORBIDDEN_KEYS.has(k)) out[k] = render(v, ctx);
    }
    return out as T;
  }
  return template as T;
}

/** Escapa texto para insertarlo en XML (SOAP). */
export function escapeXml(value: unknown): string {
  return stringify(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Renderiza una plantilla XML escapando cada valor interpolado. */
export function renderXml(template: string, ctx: TemplateContext): string {
  return template.replace(EXPR, (_, expr: string) => escapeXml(evaluateExpression(expr, ctx)));
}
