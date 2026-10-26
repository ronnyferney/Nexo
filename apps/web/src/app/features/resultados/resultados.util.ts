import type { KpiRatioBase, KpiTiempoCiclo } from '../../core/indicadores.models';

/**
 * Lógica pura del tablero de indicadores de resultado (E10): formateo honesto de los valores que pueden faltar.
 * Sin dependencias de Angular para poder probarse de forma aislada. La regla de oro es no inventar ceros:
 * un `null` del backend es «sin datos en el período», no «0 %».
 */

const PCT = new Intl.NumberFormat('es', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const HORAS = new Intl.NumberFormat('es', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const ENTERO = new Intl.NumberFormat('es');

/** Texto único para un KPI sin denominador en el período (nunca mostrar «0 %»). */
export const SIN_DATOS = 'Sin datos en el período';

/** Texto único para el tiempo de ciclo cuando no hay ninguna muestra aceptada. */
export const SIN_RESULTADOS = 'Sin resultados aceptados aún';

/**
 * Formatea un porcentaje del backend. `null` ⇒ «Sin datos en el período» (porque no hubo denominador),
 * distinto de un `0` real que sí se muestra como «0 %».
 */
export function formatPct(pct: number | null): string {
  if (pct === null) return SIN_DATOS;
  return `${PCT.format(pct)} %`;
}

/** Horas con un decimal; `null`/`NaN` ⇒ guion. */
export function formatHoras(horas: number | null | undefined): string {
  if (horas === null || horas === undefined || Number.isNaN(horas)) return '—';
  return `${HORAS.format(horas)} h`;
}

/** Subtítulo honesto de un KPI de razón: «numerador / denominador». */
export function fraccion(k: Pick<KpiRatioBase, 'numerador' | 'denominador'>): string {
  return `${ENTERO.format(k.numerador)} / ${ENTERO.format(k.denominador)}`;
}

/**
 * Etiqueta principal del tiempo de ciclo (mediana / p95 en horas). `null` cuando no hubo ninguna muestra
 * aceptada: entonces no hay cifra que mostrar, solo la aclaración.
 */
export function tiempoCicloLabel(tc: KpiTiempoCiclo | null): string {
  if (!tc) return SIN_RESULTADOS;
  return `${formatHoras(tc.medianaHoras)} / ${formatHoras(tc.p95Horas)}`;
}
