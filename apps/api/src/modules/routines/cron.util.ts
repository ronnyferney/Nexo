/**
 * Validación de expresiones cron de 5 campos (minuto hora día-del-mes mes día-de-la-semana), el formato que
 * programa BullMQ. Admite `*`, valores, rangos `a-b`, pasos `x/n`, listas `a,b` y nombres (JAN-DEC, SUN-SAT).
 */
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

interface FieldSpec {
  min: number;
  max: number;
  names?: string[];
  /** Desplazamiento del índice del nombre (JAN = 1, SUN = 0). */
  nameOffset?: number;
  allowQuestion?: boolean;
}

const FIELDS: FieldSpec[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31, allowQuestion: true },
  { min: 1, max: 12, names: MONTHS, nameOffset: 1 },
  { min: 0, max: 7, names: DAYS, nameOffset: 0, allowQuestion: true },
];

function value(raw: string, spec: FieldSpec): number | undefined {
  if (/^\d{1,2}$/.test(raw)) {
    const n = Number(raw);
    return n >= spec.min && n <= spec.max ? n : undefined;
  }
  const idx = spec.names?.indexOf(raw.toUpperCase()) ?? -1;
  return idx >= 0 ? idx + (spec.nameOffset ?? 0) : undefined;
}

function validItem(item: string, spec: FieldSpec): boolean {
  const [range, step, ...extra] = item.split('/');
  if (extra.length) return false;
  if (step !== undefined && (!/^\d{1,2}$/.test(step) || Number(step) < 1)) return false;
  if (range === '*' || (range === '?' && spec.allowQuestion && step === undefined)) return true;
  const [from, to, ...more] = range.split('-');
  if (more.length) return false;
  const a = value(from, spec);
  if (a === undefined) return false;
  if (to === undefined) return true;
  const b = value(to, spec);
  return b !== undefined && a <= b;
}

export function isValidCron(expr: unknown): boolean {
  if (typeof expr !== 'string') return false;
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((field, i) => field.split(',').every((item) => item !== '' && validItem(item, FIELDS[i])));
}

/** Zona horaria IANA válida para el runtime (Intl lanza RangeError si no existe). */
export function isValidTimezone(tz: unknown): boolean {
  if (typeof tz !== 'string' || !tz.trim() || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
