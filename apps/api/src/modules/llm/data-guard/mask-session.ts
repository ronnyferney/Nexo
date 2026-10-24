import { createHmac } from 'node:crypto';
import { CATEGORY_LABELS, detect, normalizeValue, type DataCategory, type Finding } from './detector';

/**
 * Política de DataGuard por workspace (ADR 0008 D2, versión por workspace):
 * - `off`: no enmascara datos personales (las credenciales se ocultan siempre).
 * - `mask` (por defecto): reemplaza cada dato por un marcador estable y lo restituye en la respuesta al usuario.
 * - `block`: rechaza el mensaje del usuario o el resultado de herramienta que contenga datos personales.
 */
export type DataGuardMode = 'off' | 'mask' | 'block';
export const DATA_GUARD_MODES: DataGuardMode[] = ['off', 'mask', 'block'];
export const DEFAULT_DATA_GUARD_MODE: DataGuardMode = 'mask';

export type PersonalCategory = Exclude<DataCategory, 'CREDENTIAL'>;

/** Prefijo del marcador por categoría: `[CORREO_1a2b3c4d]`. */
export const MARKER_LABELS: Record<PersonalCategory, string> = {
  NATIONAL_ID: 'DOCUMENTO',
  PAYMENT_CARD: 'TARJETA',
  BANK_ACCOUNT: 'CUENTA',
  EMAIL: 'CORREO',
  PHONE: 'TELEFONO',
};

/** Las credenciales no se restituyen nunca: el marcador es fijo e irreversible. */
export const CREDENTIAL_MARKER = '[CREDENCIAL_OCULTA]';

const MARKER_RE = /\[(DOCUMENTO|TARJETA|CUENTA|CORREO|TELEFONO)_([0-9a-f]{8}|[0-9a-f]{12})\]/g;
/** Longitud máxima de un marcador (para el desenmascarado en streaming). */
export const MAX_MARKER_LENGTH = 24;

export type CategoryCounts = Partial<Record<DataCategory, number>>;

/** Bloques del historial que el proveedor firma o que son razonamiento interno: se reenvían sin tocar. */
const OPAQUE_TYPES = new Set(['thinking', 'redacted_thinking', 'reasoning']);
const OPAQUE_KEYS = new Set(['signature', 'reasoning_content', 'reasoning', 'reasoning_details', 'encrypted_content']);
/** Campos estructurales (identificadores, roles, nombres de herramienta): no son contenido. */
const STRUCTURAL_KEYS = new Set([
  'type',
  'id',
  'tool_use_id',
  'tool_call_id',
  'role',
  'name',
  'model',
  'media_type',
  'stop_reason',
]);
/** Debajo de estas claves todo es dato (entrada de herramientas): se transforman todas las cadenas. */
const DATA_KEYS = new Set(['input', 'arguments']);

/** Recorre el historial nativo y transforma solo las cadenas de contenido; devuelve copias (no muta el original). */
function walk(value: unknown, fn: (s: string) => string, data = false): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => walk(v, fn, data));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (!data && typeof obj.type === 'string' && OPAQUE_TYPES.has(obj.type)) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!data && OPAQUE_KEYS.has(k)) out[k] = v;
      else if (!data && STRUCTURAL_KEYS.has(k) && typeof v === 'string') out[k] = v;
      else out[k] = walk(v, fn, data || DATA_KEYS.has(k));
    }
    return out;
  }
  return value;
}

const isWordChar = (c: string | undefined) => c !== undefined && /[A-Za-z0-9@._-]/.test(c);

/** Lista legible de categorías para avisos y errores: "correo electrónico y teléfono". */
export function describeCategories(counts: CategoryCounts | DataCategory[]): string {
  const cats = Array.isArray(counts)
    ? [...new Set(counts)]
    : (Object.keys(counts) as DataCategory[]).filter((c) => (counts[c] ?? 0) > 0);
  const labels = cats.map((c) => CATEGORY_LABELS[c]);
  return labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} y ${labels[labels.length - 1]}`;
}

export const totalOf = (counts: CategoryCounts) => Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);

/**
 * Sesión de enmascarado de una ejecución (ADR 0008 D2). El marcador de cada valor es un HMAC de la clave de la sesión
 * (derivada del secreto de la plataforma, el workspace y la conversación) y del valor normalizado: es el mismo en cada
 * turno de la conversación sin guardar ninguna tabla, no permite adivinar el valor por fuerza bruta (p. ej. una cédula)
 * y difiere entre conversaciones. La tabla marcador → valor vive solo en memoria durante la ejecución y se reconstruye
 * en cada turno a partir del historial guardado, por lo que el enmascarado del historial es determinista y no rompe
 * la caché de prompts.
 */
export class MaskSession {
  private readonly byMarker = new Map<string, { original: string; normalized: string }>();
  private readonly byValue = new Map<string, { marker: string; category: PersonalCategory }>();

  constructor(
    private readonly key: Buffer,
    readonly mode: DataGuardMode,
    private readonly secrets: string[] = [],
  ) {}

  /** Hallazgos que la política aplica (en `off` solo las credenciales). */
  findings(text: string): Finding[] {
    const all = detect(text, { secrets: this.secrets });
    return this.mode === 'off' ? all.filter((f) => f.category === 'CREDENTIAL') : all;
  }

  /** Datos personales del texto (para el modo `block`). */
  personal(text: string): Finding[] {
    if (this.mode === 'off') return [];
    return detect(text, { secrets: this.secrets }).filter((f) => f.category !== 'CREDENTIAL');
  }

  private markerFor(category: PersonalCategory, original: string): string {
    const known = this.byValue.get(original);
    if (known) return known.marker;
    const normalized = `${category}:${normalizeValue(category, original)}`;
    const digest = createHmac('sha256', this.key).update(normalized).digest('hex');
    let marker = `[${MARKER_LABELS[category]}_${digest.slice(0, 8)}]`;
    const taken = this.byMarker.get(marker);
    if (taken && taken.normalized !== normalized) marker = `[${MARKER_LABELS[category]}_${digest.slice(0, 12)}]`;
    if (!this.byMarker.has(marker)) this.byMarker.set(marker, { original, normalized });
    this.byValue.set(original, { marker, category });
    return marker;
  }

  /** Registra los valores del texto sin reemplazarlos (primera pasada sobre el historial). */
  learn(text: string): void {
    if (this.mode === 'off') return;
    for (const f of this.findings(text)) {
      if (f.category !== 'CREDENTIAL') this.markerFor(f.category, text.slice(f.start, f.end));
    }
  }

  /** Apariciones literales de valores ya conocidos (p. ej. una cédula repetida sin la palabra "cédula"). */
  private knownOccurrences(text: string): Finding[] {
    const out: Finding[] = [];
    for (const [value, { category }] of this.byValue) {
      if (value.length < 4) continue;
      let from = 0;
      for (let i = text.indexOf(value, from); i !== -1; i = text.indexOf(value, from)) {
        const end = i + value.length;
        if (!isWordChar(text[i - 1]) && !isWordChar(text[end])) {
          out.push({ category, kind: 'KNOWN', start: i, end, confidence: 1 });
        }
        from = end;
      }
    }
    return out;
  }

  /** Enmascara un texto: datos personales → marcador reversible; credenciales → marcador fijo irreversible. */
  mask(text: string): { text: string; counts: CategoryCounts } {
    const counts: CategoryCounts = {};
    if (!text) return { text, counts };
    const detected = this.findings(text);
    const known = this.mode === 'off' ? [] : this.knownOccurrences(text);
    const spans = [...detected];
    for (const k of known) if (!spans.some((f) => k.start < f.end && f.start < k.end)) spans.push(k);
    if (!spans.length) return { text, counts };
    spans.sort((a, b) => a.start - b.start);
    let out = '';
    let last = 0;
    for (const f of spans) {
      if (f.start < last) continue;
      out += text.slice(last, f.start);
      const original = text.slice(f.start, f.end);
      out += f.category === 'CREDENTIAL' ? CREDENTIAL_MARKER : this.markerFor(f.category, original);
      counts[f.category] = (counts[f.category] ?? 0) + 1;
      last = f.end;
    }
    return { text: out + text.slice(last), counts };
  }

  maskText(text: string): string {
    return this.mask(text).text;
  }

  /** Solo credenciales (system prompt y descripciones de herramientas: los datos de contacto ahí son instrucciones). */
  redactCredentials(text: string): string {
    if (!text) return text;
    const spans = detect(text, { secrets: this.secrets }).filter((f) => f.category === 'CREDENTIAL');
    let out = '';
    let last = 0;
    for (const f of spans) {
      out += text.slice(last, f.start) + CREDENTIAL_MARKER;
      last = f.end;
    }
    return out + text.slice(last);
  }

  /** Restituye los marcadores conocidos en esta sesión (los desconocidos quedan tal cual). */
  unmaskText(text: string): string {
    if (!text || !text.includes('[')) return text;
    return text.replace(MARKER_RE, (m) => this.byMarker.get(m)?.original ?? m);
  }

  /**
   * Historial nativo enmascarado de forma determinista: primero aprende todos los valores (en orden) y luego
   * reemplaza, para que un valor detectado en un turno también se oculte donde aparece sin contexto.
   */
  maskHistory(history: unknown[], pending: string[] = []): unknown[] {
    walk(history, (s) => {
      this.learn(s);
      return s;
    });
    for (const p of pending) this.learn(p);
    return walk(history, (s) => this.maskText(s)) as unknown[];
  }

  maskDeep<T>(value: T): T {
    return walk(value, (s) => this.maskText(s), true) as T;
  }

  /** Entradas de herramientas y eventos: todas las cadenas, a cualquier profundidad. */
  unmaskDeep<T>(value: T, data = true): T {
    return walk(value, (s) => this.unmaskText(s), data) as T;
  }

  /** Historial nuevo para guardar: restituye el contenido (los bloques de razonamiento quedan intactos). */
  unmaskHistory(history: unknown[]): unknown[] {
    return walk(history, (s) => this.unmaskText(s)) as unknown[];
  }
}

/** Desenmascarado de texto en streaming: retiene un posible marcador partido entre fragmentos. */
export class StreamUnmasker {
  private pending = '';

  constructor(
    private readonly unmask: (s: string) => string,
    private readonly emit: (s: string) => void,
  ) {}

  push(delta: string): void {
    const buf = this.pending + delta;
    const open = buf.lastIndexOf('[');
    if (open !== -1 && buf.indexOf(']', open) === -1 && buf.length - open < MAX_MARKER_LENGTH) {
      this.pending = buf.slice(open);
      if (open > 0) this.emit(this.unmask(buf.slice(0, open)));
      return;
    }
    this.pending = '';
    if (buf) this.emit(this.unmask(buf));
  }

  flush(): void {
    if (!this.pending) return;
    const rest = this.pending;
    this.pending = '';
    this.emit(this.unmask(rest));
  }
}
