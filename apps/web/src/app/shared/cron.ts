/** Utilidades de expresiones cron de 5 campos (minuto hora día-mes mes día-semana) para rutinas. */

export interface CronPreset {
  expr: string;
  label: string;
}

export const CRON_PRESETS: CronPreset[] = [
  { expr: '0 * * * *', label: 'Cada hora' },
  { expr: '0 8 * * *', label: 'Todos los días a las 08:00' },
  { expr: '0 8 * * 1-5', label: 'Lunes a viernes a las 08:00' },
  { expr: '0 8 1 * *', label: 'El primer día de cada mes a las 08:00' },
];

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const FIELD = /^[A-Za-z0-9*/,\-]+$/;

/** Validación básica: 5 campos con caracteres válidos. El backend hace la validación definitiva. */
export function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  return parts.length === 5 && parts.every((p) => FIELD.test(p));
}

function time(h: string, m: string) {
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

const isNum = (v: string) => /^\d+$/.test(v);

/** Describe en español las expresiones más comunes; si no la reconoce, devuelve la expresión tal cual. */
export function describeCron(expr: string | null | undefined): string {
  if (!expr) return '—';
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [m, h, dom, mon, dow] = parts as [string, string, string, string, string];
  const preset = CRON_PRESETS.find((p) => p.expr === parts.join(' '));
  if (preset) return preset.label;

  if (mon !== '*') return expr;
  const every = /^\*\/(\d+)$/;
  if (every.test(m) && h === '*' && dom === '*' && dow === '*') return `Cada ${every.exec(m)![1]} minutos`;
  if (m === '*' && h === '*' && dom === '*' && dow === '*') return 'Cada minuto';
  if (isNum(m) && h === '*' && dom === '*' && dow === '*') return `Cada hora, en el minuto ${m}`;
  if (isNum(m) && every.test(h) && dom === '*' && dow === '*') return `Cada ${every.exec(h)![1]} horas`;
  if (!isNum(m) || !isNum(h)) return expr;

  const at = `a las ${time(h, m)}`;
  if (dom === '*' && dow === '*') return `Todos los días ${at}`;
  if (dom === '*' && dow === '1-5') return `Lunes a viernes ${at}`;
  if (dom === '*' && (dow === '0,6' || dow === '6,0')) return `Sábados y domingos ${at}`;
  if (dom === '*' && /^[0-7]$/.test(dow)) return `Cada ${DAYS[Number(dow)]} ${at}`;
  if (dom === '*' && /^[0-7](,[0-7])+$/.test(dow)) return `Cada ${dow.split(',').map((d) => DAYS[Number(d)]).join(', ')} ${at}`;
  if (isNum(dom) && dow === '*') return `El día ${dom} de cada mes ${at}`;
  return expr;
}

/** Zona horaria del navegador, usada como valor por defecto de las rutinas. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Lista de zonas horarias para sugerencias (si el navegador la expone). */
export function timeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
}
