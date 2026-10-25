/** Utilidades puras de formateo para las métricas de observabilidad de la supervisión (RX-12). */

/**
 * Formatea una duración en milisegundos a un texto legible: `ms` por debajo de un segundo y `s` (con un decimal)
 * a partir de un segundo. Devuelve `—` cuando no hay dato (`null`/`undefined`/`NaN`).
 */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Formatea un porcentaje (ya calculado por el backend); `—` cuando no hay dato. */
export function formatPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return '—';
  return `${pct} %`;
}
