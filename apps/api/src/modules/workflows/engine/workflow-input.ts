import type { WorkflowDefinition, WorkflowNode } from './workflow.types';

/**
 * Datos de entrada de un flujo (P2 del plan de mejora): avisar ANTES de ejecutar cuando faltan.
 *
 * Dos fuentes, en este orden de autoridad:
 *  1. Esquema declarado en el disparador: `trigger.config.inputFields = [{ name, type, required, description }]`.
 *     Vive dentro del JSON de la definición (sin cambios de esquema de BD); los flujos guardados sin él siguen igual.
 *     Un campo requerido ausente o un tipo incorrecto impide la ejecución (400 en la API).
 *  2. Análisis estático de las plantillas `{{ input.campo }}` de los nodos: solo produce advertencias, porque muchos
 *     flujos existentes usan valores opcionales a propósito. Un uso con `| default:'x'` no se considera esperado.
 */

export const INPUT_FIELD_TYPES = ['string', 'number', 'boolean', 'object', 'array'] as const;
export type InputFieldType = (typeof INPUT_FIELD_TYPES)[number];

export interface InputField {
  name: string;
  type?: InputFieldType;
  required?: boolean;
  description?: string;
}

/** Campo `input.*` usado por las plantillas de los nodos. */
export interface ReferencedInputField {
  name: string;
  /** Todos sus usos tienen `| default:...`: no hace falta enviarlo. */
  optional: boolean;
  /** Nodos que lo usan (ids, sin repetir). */
  nodeIds: string[];
}

export interface InputCheck {
  /** Campos requeridos del esquema declarado que faltan (bloquean la ejecución). */
  missing: string[];
  /** Campos presentes con un tipo distinto del declarado (bloquean la ejecución). */
  invalid: { name: string; expected: InputFieldType }[];
  /** Campos usados por plantillas (sin valor por defecto ni declaración) que no vienen en la entrada. */
  missingReferenced: string[];
}

export const MAX_INPUT_FIELDS = 50;
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const EXPR = /\{\{\s*([^}]+?)\s*\}\}/g;

const triggerOf = (def: WorkflowDefinition | null | undefined): WorkflowNode | undefined =>
  Array.isArray(def?.nodes) ? def.nodes.find((n) => n?.type === 'trigger') : undefined;

/** Errores de forma de `trigger.config.inputFields` (se valida al guardar, junto con el grafo). */
export function validateInputFields(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return ['"inputFields" del disparador debe ser una lista'];
  if (raw.length > MAX_INPUT_FIELDS) return [`El disparador admite como máximo ${MAX_INPUT_FIELDS} campos de entrada`];
  const errors: string[] = [];
  const seen = new Set<string>();
  raw.forEach((f: unknown, i) => {
    const field = (f ?? {}) as Partial<InputField>;
    const name = typeof field.name === 'string' ? field.name.trim() : '';
    if (!FIELD_NAME.test(name) || FORBIDDEN.has(name)) {
      errors.push(`Campo de entrada ${i + 1}: nombre inválido "${name}" (letras, números, _ o -; sin espacios)`);
    } else if (seen.has(name)) {
      errors.push(`Campo de entrada duplicado: "${name}"`);
    }
    seen.add(name);
    if (field.type !== undefined && !INPUT_FIELD_TYPES.includes(field.type)) {
      errors.push(`Campo de entrada "${name}": tipo desconocido "${String(field.type)}"`);
    }
    if (field.required !== undefined && typeof field.required !== 'boolean') {
      errors.push(`Campo de entrada "${name}": "required" debe ser verdadero o falso`);
    }
    if (field.description !== undefined && (typeof field.description !== 'string' || field.description.length > 300)) {
      errors.push(`Campo de entrada "${name}": la descripción debe ser texto de hasta 300 caracteres`);
    }
  });
  return errors;
}

/** Esquema de entrada declarado en el disparador, o `null` si el flujo no declara ninguno (flujos antiguos). */
export function declaredInputFields(def: WorkflowDefinition | null | undefined): InputField[] | null {
  const raw = triggerOf(def)?.config?.inputFields;
  if (!Array.isArray(raw)) return null;
  return raw
    .filter(
      (f): f is InputField => !!f && typeof (f as InputField).name === 'string' && !!(f as InputField).name.trim(),
    )
    .map((f) => ({ ...f, name: f.name.trim() }));
}

/** Recorre cadenas de un valor de configuración (objetos y arreglos anidados). */
function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 20) return;
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out, depth + 1);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectStrings(v, out, depth + 1);
}

/** Campo de primer nivel de `input` al que apunta una expresión (`input.a.b`, `input[a]`), con su marca de defecto. */
export function inputFieldOfExpression(expression: string): { name: string; hasDefault: boolean } | null {
  const [path, ...filters] = expression.split('|');
  const parts = path
    .trim()
    .replace(/\[['"]?([\w-]+)['"]?\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  if (parts[0] !== 'input' || !parts[1] || FORBIDDEN.has(parts[1])) return null;
  const hasDefault = filters.some((f) => f.trim().split(':')[0].trim() === 'default');
  return { name: parts[1], hasDefault };
}

/** Análisis estático: campos `input.*` que usan las plantillas de los nodos (sin contar el disparador). */
export function referencedInputFields(def: WorkflowDefinition | null | undefined): ReferencedInputField[] {
  const found = new Map<string, ReferencedInputField>();
  const nodes = Array.isArray(def?.nodes) ? def.nodes : [];
  for (const node of nodes) {
    if (!node || node.type === 'trigger') continue;
    const strings: string[] = [];
    collectStrings(node.config ?? {}, strings);
    for (const s of strings) {
      for (const m of s.matchAll(EXPR)) {
        const ref = inputFieldOfExpression(m[1]);
        if (!ref) continue;
        const entry = found.get(ref.name) ?? { name: ref.name, optional: true, nodeIds: [] };
        if (!ref.hasDefault) entry.optional = false;
        if (!entry.nodeIds.includes(node.id)) entry.nodeIds.push(node.id);
        found.set(ref.name, entry);
      }
    }
  }
  return [...found.values()];
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === '';

function matchesType(value: unknown, type: InputFieldType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return !!value && typeof value === 'object' && !Array.isArray(value);
    default:
      return true;
  }
}

/** Compara la entrada con el esquema declarado y con los campos que usan las plantillas. */
export function checkInput(
  def: WorkflowDefinition | null | undefined,
  input: Record<string, unknown> | null,
): InputCheck {
  const data = input && typeof input === 'object' ? input : {};
  const declared = declaredInputFields(def);
  const missing: string[] = [];
  const invalid: InputCheck['invalid'] = [];
  for (const f of declared ?? []) {
    const value = Object.prototype.hasOwnProperty.call(data, f.name) ? data[f.name] : undefined;
    if (isEmpty(value)) {
      if (f.required) missing.push(f.name);
    } else if (f.type && !matchesType(value, f.type)) {
      invalid.push({ name: f.name, expected: f.type });
    }
  }
  const declaredNames = new Set((declared ?? []).map((f) => f.name));
  const missingReferenced = referencedInputFields(def)
    .filter((r) => !r.optional && !declaredNames.has(r.name))
    .map((r) => r.name)
    .filter((name) => isEmpty(Object.prototype.hasOwnProperty.call(data, name) ? data[name] : undefined));
  return { missing, invalid, missingReferenced };
}

const TYPE_LABEL: Record<InputFieldType, string> = {
  string: 'texto',
  number: 'número',
  boolean: 'booleano (true/false)',
  object: 'objeto',
  array: 'lista',
};

/** Mensaje de error en español cuando la entrada no cumple el esquema declarado; `null` si la cumple. */
export function inputErrorMessage(check: InputCheck): string | null {
  const parts: string[] = [];
  if (check.missing.length) parts.push(`Faltan datos de entrada requeridos: ${check.missing.join(', ')}`);
  for (const i of check.invalid) parts.push(`El dato de entrada "${i.name}" debe ser ${TYPE_LABEL[i.expected]}`);
  return parts.length ? `${parts.join('. ')}.` : null;
}

/** Advertencias (no bloquean) por campos que usan las plantillas y no vienen en la entrada. */
export function inputWarnings(check: InputCheck): string[] {
  if (!check.missingReferenced.length) return [];
  return [
    `La entrada no incluye datos que usan las plantillas del flujo: ${check.missingReferenced.join(', ')}. ` +
      'Esas plantillas quedarán vacías; declárelos en el disparador o use | default.',
  ];
}
