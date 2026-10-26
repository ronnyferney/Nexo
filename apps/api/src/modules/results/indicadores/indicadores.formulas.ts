/**
 * Capa PURA de fórmulas de los indicadores de resultado (E10 · RF27/RF28/RF30-métricas, sección 9). Sin dependencias de
 * Nest/Prisma: recibe números/muestras ya consultados y devuelve los KPIs. Regla transversal: NO se inventan cifras; un
 * denominador 0 (o una muestra vacía) devuelve `null`, nunca una división por cero ni un 0 engañoso. Cada KPI distingue
 * el resultado ACEPTADO del simplemente generado (lo garantizan los datos que el servicio le pasa, no esta capa).
 */

const MS_POR_HORA = 3_600_000;

/** Redondea a `decimales` posiciones (evita ruido de coma flotante). */
function redondear(valor: number, decimales: number): number {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}

/** KPI expresado como cociente numerador/denominador. `null` cuando no hay base (denominador 0): no es 0 ni error. */
export interface RatioKpi {
  numerador: number;
  denominador: number;
  /** Proporción 0..1 redondeada a 4 decimales; `null` si el denominador es 0. */
  ratio: number | null;
  /** Porcentaje 0..100 redondeado a 1 decimal; `null` si el denominador es 0. */
  pct: number | null;
}

/**
 * Cociente seguro: numerador/denominador. Si el denominador es 0 devuelve `ratio`/`pct` en `null` (no hay base de
 * cálculo), conservando los conteos crudos para que el consumidor sepa por qué no hay dato.
 */
export function ratioKpi(numerador: number, denominador: number): RatioKpi {
  if (denominador <= 0) return { numerador, denominador, ratio: null, pct: null };
  const ratio = numerador / denominador;
  return { numerador, denominador, ratio: redondear(ratio, 4), pct: redondear(ratio * 100, 1) };
}

/**
 * Percentil por rango más cercano (nearest-rank, mismo criterio que `agent-analytics`): para `p` en [0,100] devuelve la
 * muestra en la posición correspondiente de la serie ordenada. `null` si la muestra está vacía.
 */
export function percentil(muestras: readonly number[], p: number): number | null {
  if (!muestras.length) return null;
  const ordenada = [...muestras].sort((a, b) => a - b);
  const idx = Math.min(ordenada.length - 1, Math.floor((p / 100) * ordenada.length));
  return ordenada[idx];
}

/** Resumen de tiempo de ciclo (ms de negocio desde creación hasta aceptación). `null` si no hubo resultados aceptados. */
export interface ResumenCiclo {
  muestras: number;
  medianaMs: number;
  p95Ms: number;
  medianaHoras: number;
  p95Horas: number;
}

/**
 * Tiempo de ciclo: recibe las duraciones (ms) de los resultados ACEPTADOS y reporta **mediana (p50) y p95** (sección 9).
 * `null` si no hay ninguna muestra (no se promedia la nada). Expone ms y horas para la consola.
 */
export function resumenCiclo(muestrasMs: readonly number[]): ResumenCiclo | null {
  if (!muestrasMs.length) return null;
  const medianaMs = percentil(muestrasMs, 50)!;
  const p95Ms = percentil(muestrasMs, 95)!;
  return {
    muestras: muestrasMs.length,
    medianaMs,
    p95Ms,
    medianaHoras: redondear(medianaMs / MS_POR_HORA, 2),
    p95Horas: redondear(p95Ms / MS_POR_HORA, 2),
  };
}

/** Costo por resultado aceptado. `null` si no hubo resultados aceptados en el alcance (no se divide por 0). */
export interface CostoPorResultado {
  costoTotalUsd: number;
  resultadosAceptados: number;
  costoPorResultadoUsd: number | null;
}

/**
 * Costo por resultado: costo atribuible (UsageRecord del alcance) / resultados **aceptados** del mismo alcance. El
 * denominador son solo resultados aceptados (un producto intermedio o un resultado generado-no-aceptado no cuenta).
 */
export function costoPorResultado(costoTotalUsd: number, resultadosAceptados: number): CostoPorResultado {
  return {
    costoTotalUsd: redondear(costoTotalUsd, 8),
    resultadosAceptados,
    costoPorResultadoUsd: resultadosAceptados > 0 ? redondear(costoTotalUsd / resultadosAceptados, 8) : null,
  };
}
