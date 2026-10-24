/**
 * Motor de expresiones regulares para el `pattern` de los `inputSchema` (Ajv `code.regExp`), protegido contra ReDoS.
 *
 * Los `pattern` los escribe un EDITOR y se evalúan sobre entradas que decide el LLM, en el hilo principal: un patrón
 * con retroceso catastrófico bloquearía el proceso para todos los workspaces. No usamos RE2 porque exige binarios
 * nativos (`re2`) o un port WASM sin mantenimiento (`re2-wasm`); `vm` con timeout equivale a evaluar código. En su
 * lugar se combinan tres límites deterministas:
 *
 * 1. Longitud del patrón (`MAX_PATTERN_LENGTH`).
 * 2. Rechazo estructural de las construcciones que producen retroceso exponencial: cuantificador de repetición
 *    (`*`, `+`, `{n,}` o `{n,m}` con m > 10) aplicado a un grupo que ya contiene un cuantificador o una alternancia
 *    (`(a+)+`, `(a|aa)*`, `(.*a){20}`, `(a?){25}`), y referencias hacia atrás (`\1`, `\k<x>`).
 * 3. Longitud máxima del texto evaluado (`MAX_PATTERN_SUBJECT_LENGTH`): acota el costo polinómico residual
 *    (p. ej. `\s*\s*$`) a unos milisegundos.
 *
 *    Excepción: grupos «delimitados» (ver `isDelimitedGroup`), p. ej. `([ \t]+<[^<>\s]{1,250}>){0,50}`.
 *
 * Es conservadora: puede rechazar algún patrón inofensivo (p. ej. `^(\w+\s?)+$` o grupos repetidos con grupos
 * internos); se reescribe con un delimitador literal o se acota con `{n,m}` (m ≤ 10). Los patrones del catálogo pasan
 * esta validación (ver `safe-pattern.spec.ts`).
 */

export const MAX_PATTERN_LENGTH = 512;
export const MAX_PATTERN_SUBJECT_LENGTH = 4096;
/** Repeticiones acotadas de un grupo complejo que se toleran (`(?:,(a|b)){0,2}`): 2^10 caminos como máximo. */
const MAX_SAFE_GROUP_REPEAT = 10;

/** Patrón rechazado por la política anti-ReDoS (se devuelve como 400 al guardar o invocar la operación). */
export class UnsafePatternError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafePatternError';
  }
}

/** Átomo del nivel actual de un grupo (sin su cuantificador). */
interface Atom {
  text: string;
  /** Carácter literal exacto (`a`, `\.`, `\t`), o `undefined` si es clase, escape de clase, `.` o grupo. */
  literal?: string;
  group: boolean;
  quantified: boolean;
}

interface GroupFrame {
  /** El grupo contiene algún cuantificador (en cualquier nivel). */
  quantified: boolean;
  /** El grupo contiene una alternancia `|` en su propio nivel o anidada. */
  alternation: boolean;
  atoms: Atom[];
}

const newFrame = (): GroupFrame => ({ quantified: false, alternation: false, atoms: [] });
const ESCAPED_LITERALS: Record<string, string> = { t: '\t', n: '\n', r: '\r', f: '\f', v: '\v', '0': '\0' };

/**
 * Excepción a la regla 2 para grupos «delimitados» como `([ \t]+<[^<>\s]{1,250}>){0,50}`: sin alternancias ni grupos
 * internos, con al menos un carácter literal obligatorio que ningún átomo cuantificado del grupo puede consumir, y
 * como mucho un átomo cuantificado entre dos delimitadores (contando la vuelta de una repetición a la siguiente).
 * Así cada repetición tiene una única forma de partir el texto y no hay retroceso exponencial.
 */
function isDelimitedGroup(frame: GroupFrame, flags: string): boolean {
  if (frame.alternation || frame.atoms.some((a) => a.group)) return false;
  const quantified = frame.atoms.filter((a) => a.quantified);
  const matchers = quantified.map((a) => new RegExp(`^(?:${a.text})$`, flags));
  const isDelimiter = (a: Atom) =>
    !a.quantified && a.literal !== undefined && !matchers.some((m) => m.test(a.literal as string));
  const first = frame.atoms.findIndex(isDelimiter);
  if (first < 0) return false;
  // Recorrido circular desde el primer delimitador: cuenta átomos cuantificados entre delimitadores consecutivos.
  let run = 0;
  for (let k = 1; k <= frame.atoms.length; k++) {
    const atom = frame.atoms[(first + k) % frame.atoms.length];
    if (isDelimiter(atom)) run = 0;
    else if (atom.quantified && ++run > 1) return false;
  }
  return true;
}

/**
 * Lee un cuantificador en `i`. Devuelve su longitud y si repite sin cota razonable (`*`, `+`, `{n,}` o máximo mayor a
 * `MAX_SAFE_GROUP_REPEAT`), o `null` si no hay cuantificador.
 * `{` que no forma un cuantificador válido es un literal (modo no-unicode); con `u` Ajv/RegExp lo rechaza después.
 */
function readQuantifier(p: string, i: number): { length: number; repeats: boolean } | null {
  const c = p[i];
  let length = 0;
  let repeats = false;
  if (c === '*' || c === '+') {
    length = 1;
    repeats = true;
  } else if (c === '?') {
    length = 1;
  } else if (c === '{') {
    const m = /^\{(\d+)(,(\d*))?\}/.exec(p.slice(i));
    if (!m) return null;
    length = m[0].length;
    const min = Number(m[1]);
    const max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3]);
    repeats = max > MAX_SAFE_GROUP_REPEAT;
  } else {
    return null;
  }
  if (p[i + length] === '?') length += 1; // perezoso
  return { length, repeats };
}

/** Lanza `UnsafePatternError` si el patrón supera la longitud o tiene construcciones de retroceso exponencial. */
export function assertSafePattern(pattern: string, flags = 'u'): void {
  if (typeof pattern !== 'string') throw new UnsafePatternError('El "pattern" debe ser una cadena');
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new UnsafePatternError(`El "pattern" supera ${MAX_PATTERN_LENGTH} caracteres`);
  }
  const stack: GroupFrame[] = [newFrame()];
  const top = () => stack[stack.length - 1];
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    const start = i;
    let literal: string | undefined;
    if (c === '\\') {
      const next = pattern[i + 1] ?? '';
      if ((next >= '1' && next <= '9') || next === 'k') {
        throw new UnsafePatternError('El "pattern" no admite referencias hacia atrás (\\1, \\k<nombre>)');
      }
      if (ESCAPED_LITERALS[next]) literal = ESCAPED_LITERALS[next];
      else if (next && !/[A-Za-z0-9]/.test(next)) literal = next;
      i += 2;
    } else if (c === '[') {
      // Clase de caracteres: se salta hasta el `]` de cierre (respetando escapes).
      i += 1;
      if (pattern[i] === '^') i += 1;
      if (pattern[i] === ']') i += 1;
      while (i < pattern.length && pattern[i] !== ']') i += pattern[i] === '\\' ? 2 : 1;
      i += 1;
    } else if (c === '(') {
      stack.push(newFrame());
      i += 1;
      // `(?:`, `(?=`, `(?!`, `(?<=`, `(?<!`, `(?<nombre>`
      if (pattern[i] === '?') {
        i += 1;
        if (pattern[i] === '<' && pattern[i + 1] !== '=' && pattern[i + 1] !== '!') {
          while (i < pattern.length && pattern[i] !== '>') i += 1;
        }
        i += 1;
      }
      continue;
    } else if (c === ')') {
      const frame = stack.length > 1 ? stack.pop()! : newFrame();
      i += 1;
      const q = readQuantifier(pattern, i);
      if (q) {
        if (q.repeats && (frame.quantified || frame.alternation) && !isDelimitedGroup(frame, flags)) {
          throw new UnsafePatternError(
            'El "pattern" repite un grupo que ya contiene cuantificadores o alternativas (riesgo de ReDoS)',
          );
        }
        i += q.length;
      }
      const parent = top();
      parent.quantified ||= frame.quantified || !!q;
      parent.alternation ||= frame.alternation;
      parent.atoms.push({ text: '', group: true, quantified: !!q });
      continue;
    } else if (c === '|') {
      top().alternation = true;
      i += 1;
      continue;
    } else if (c === '^' || c === '$') {
      i += 1; // anclas: ancho cero
      continue;
    } else {
      if (c !== '.') literal = c;
      i += 1;
    }
    // Tras un átomo (literal, escape o clase) puede venir un cuantificador.
    const atom: Atom = { text: pattern.slice(start, i), literal, group: false, quantified: false };
    const q = readQuantifier(pattern, i);
    if (q) {
      top().quantified = true;
      atom.quantified = true;
      i += q.length;
    }
    top().atoms.push(atom);
  }
}

/** Objeto `RegExp`-like que entiende Ajv: solo necesita `test()` (y `toString()` como clave de caché). */
interface SafeRegExp {
  test(subject: string): boolean;
  toString(): string;
}

/**
 * Fábrica para `new Ajv({ code: { regExp: safeRegExp } })`. Valida el patrón al compilar el esquema y limita la
 * longitud del texto evaluado (lanza `UnsafePatternError`, que el servicio convierte en 400).
 */
export const safeRegExp = Object.assign(
  (pattern: string, flags?: string): SafeRegExp => {
    assertSafePattern(pattern, flags);
    const re = new RegExp(pattern, flags);
    return {
      test(subject: string): boolean {
        if (subject.length > MAX_PATTERN_SUBJECT_LENGTH) {
          throw new UnsafePatternError(
            `Un texto validado con "pattern" no puede superar ${MAX_PATTERN_SUBJECT_LENGTH} caracteres`,
          );
        }
        re.lastIndex = 0;
        return re.test(subject);
      },
      toString: () => re.toString(),
    };
  },
  { code: 'safeRegExp' },
);

/** Recorre un JSON Schema y valida cada `pattern` y cada clave de `patternProperties`. */
export function assertSafeSchemaPatterns(schema: unknown, depth = 0): void {
  if (depth > 64 || !schema || typeof schema !== 'object') return;
  if (Array.isArray(schema)) {
    for (const item of schema) assertSafeSchemaPatterns(item, depth + 1);
    return;
  }
  const obj = schema as Record<string, unknown>;
  if (typeof obj.pattern === 'string') assertSafePattern(obj.pattern);
  if (obj.patternProperties && typeof obj.patternProperties === 'object') {
    for (const key of Object.keys(obj.patternProperties)) assertSafePattern(key);
  }
  for (const value of Object.values(obj)) assertSafeSchemaPatterns(value, depth + 1);
}
