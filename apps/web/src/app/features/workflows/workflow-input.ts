import type { WorkflowNode } from '../../core/models';

/**
 * Datos de entrada del flujo (espejo de `engine/workflow-input.ts` de la API).
 * - Esquema declarado en el disparador: `trigger.config.inputFields` (bloquea la ejecución si falta un requerido).
 * - Campos que usan las plantillas `{{ input.campo }}` de los nodos: solo aviso (los que tienen `| default` no cuentan).
 */
export type InputFieldType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface InputField {
  name: string;
  type?: InputFieldType;
  required?: boolean;
  description?: string;
}

export const INPUT_FIELD_TYPES: { id: InputFieldType; label: string }[] = [
  { id: 'string', label: 'Texto' },
  { id: 'number', label: 'Número' },
  { id: 'boolean', label: 'Booleano' },
  { id: 'object', label: 'Objeto' },
  { id: 'array', label: 'Lista' },
];

export const MAX_INPUT_FIELDS = 50;
export const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const EXPR = /\{\{\s*([^}]+?)\s*\}\}/g;

export interface InputHints {
  /** Esquema declarado (null si el disparador no declara ninguno: flujos antiguos). */
  declared: InputField[] | null;
  /** Campos usados por las plantillas sin valor por defecto ni declaración. */
  referenced: string[];
  /** Requeridos del esquema ausentes o vacíos en la entrada (bloquean). */
  missingRequired: string[];
  /** Presentes con otro tipo del declarado (bloquean). */
  invalid: { name: string; expected: InputFieldType }[];
  /** Usados por plantillas y ausentes en la entrada (aviso). */
  missingReferenced: string[];
}

export function declaredInputFields(nodes: WorkflowNode[]): InputField[] | null {
  const raw = nodes.find((n) => n.type === 'trigger')?.config?.['inputFields'];
  if (!Array.isArray(raw)) return null;
  return raw.filter((f: InputField) => typeof f?.name === 'string' && f.name.trim()).map((f: InputField) => ({ ...f, name: f.name.trim() }));
}

function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 20) return;
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out, depth + 1);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectStrings(v, out, depth + 1);
}

/** Campos de primer nivel de `input` que usan las plantillas de los nodos (sin repetir, en orden de aparición). */
export function referencedInputFields(nodes: WorkflowNode[]): { name: string; optional: boolean }[] {
  const found = new Map<string, boolean>();
  for (const node of nodes) {
    if (node.type === 'trigger') continue;
    const strings: string[] = [];
    collectStrings(node.config ?? {}, strings);
    for (const s of strings) {
      for (const m of s.matchAll(EXPR)) {
        const [path, ...filters] = m[1].split('|');
        const parts = path.trim().replace(/\[['"]?([\w-]+)['"]?\]/g, '.$1').split('.').filter(Boolean);
        if (parts[0] !== 'input' || !parts[1] || FORBIDDEN.has(parts[1])) continue;
        const hasDefault = filters.some((f) => f.trim().split(':')[0].trim() === 'default');
        found.set(parts[1], (found.get(parts[1]) ?? true) && hasDefault);
      }
    }
  }
  return [...found].map(([name, optional]) => ({ name, optional }));
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === '';

function matchesType(value: unknown, type: InputFieldType): boolean {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return !!value && typeof value === 'object' && !Array.isArray(value);
  }
}

export function inputHints(nodes: WorkflowNode[], input: unknown): InputHints {
  const data = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const value = (name: string) => (Object.prototype.hasOwnProperty.call(data, name) ? data[name] : undefined);
  const declared = declaredInputFields(nodes);
  const declaredNames = new Set((declared ?? []).map((f) => f.name));
  const referenced = referencedInputFields(nodes).filter((r) => !r.optional && !declaredNames.has(r.name)).map((r) => r.name);
  const missingRequired: string[] = [];
  const invalid: InputHints['invalid'] = [];
  for (const f of declared ?? []) {
    const v = value(f.name);
    if (isEmpty(v)) {
      if (f.required) missingRequired.push(f.name);
    } else if (f.type && !matchesType(v, f.type)) invalid.push({ name: f.name, expected: f.type });
  }
  return { declared, referenced, missingRequired, invalid, missingReferenced: referenced.filter((n) => isEmpty(value(n))) };
}

const SAMPLE: Record<InputFieldType, unknown> = { string: '', number: 0, boolean: false, object: {}, array: [] };

/**
 * JSON de ejemplo con los campos detectados que aún no están en `current` (no pisa lo que el usuario ya escribió).
 * Los requeridos y los de plantillas quedan en `null` para que el aviso «Faltan» siga visible hasta completarlos.
 */
export function sampleInput(hints: InputHints, current: unknown): Record<string, unknown> {
  const base = (current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {}) as Record<string, unknown>;
  for (const f of hints.declared ?? []) {
    if (!Object.prototype.hasOwnProperty.call(base, f.name)) base[f.name] = f.required || !f.type ? null : structuredClone(SAMPLE[f.type]);
  }
  for (const name of hints.referenced) if (!Object.prototype.hasOwnProperty.call(base, name)) base[name] = null;
  return base;
}

export const typeLabel = (t?: InputFieldType) => INPUT_FIELD_TYPES.find((x) => x.id === t)?.label.toLowerCase() ?? 'cualquiera';

/** Primer problema del esquema de entrada del disparador (bloquea Guardar, como en la API), o null. */
export function inputFieldsProblem(nodes: WorkflowNode[]): string | null {
  const raw = nodes.find((n) => n.type === 'trigger')?.config?.['inputFields'];
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return 'Los campos de entrada del disparador no son una lista';
  if (raw.length > MAX_INPUT_FIELDS) return `El disparador admite como máximo ${MAX_INPUT_FIELDS} campos de entrada`;
  const seen = new Set<string>();
  for (const f of raw as InputField[]) {
    const name = (f?.name ?? '').trim();
    if (!FIELD_NAME.test(name) || FORBIDDEN.has(name)) return `Campo de entrada con nombre inválido: «${name || '(vacío)'}» (letras, números, _ o -)`;
    if (seen.has(name)) return `Campo de entrada duplicado: «${name}»`;
    seen.add(name);
  }
  return null;
}
