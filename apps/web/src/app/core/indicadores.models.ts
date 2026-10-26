/**
 * Tipos del tablero de indicadores de resultado (E10). Espejan EXACTAMENTE el contrato del backend
 * (`GET /indicadores/resultados`, rol mínimo VIEWER). Claves de honestidad del dato que la UI debe respetar:
 * `ratio`/`pct` en `null` significan «sin denominador en el período» (no «0 %»); `tiempoCiclo` en `null`,
 * «ninguna muestra aceptada»; `costoPorResultadoUsd` en `null`, «0 resultados aceptados»; y tanto
 * `horasLiberadas` como `beneficioValidado` llegan como estimación/pendiente con su `nota` y nunca como cifra
 * confirmada.
 */

/** Ventana temporal del cálculo (ISO). */
export interface IndicadoresPeriodo {
  from: string;
  to: string;
}

/** Filtros efectivamente aplicados por el servidor (eco de la petición). */
export interface IndicadoresFiltrosEco {
  empresaId: string | null;
  areaId: string | null;
  agentId: string | null;
}

/** Base de un KPI de razón: numerador/denominador y su `ratio`/`pct` (ambos `null` sin denominador). */
export interface KpiRatioBase {
  numerador: number;
  denominador: number;
  ratio: number | null;
  pct: number | null;
}

/** Cumplimiento de compromisos con vencimiento en el período (RF29). */
export interface KpiCumplimiento extends KpiRatioBase {
  vencimientosEnPeriodo: number;
}

/** Calidad de los resultados revisados en el período (RF30). */
export interface KpiCalidad extends KpiRatioBase {
  revisadosEnPeriodo: number;
}

/** Excepciones sobre las ejecuciones iniciadas en el período (RF31). */
export interface KpiExcepciones extends KpiRatioBase {
  ejecucionesIniciadas: number;
}

/** Tiempo de ciclo de los resultados aceptados. `null` global cuando no hay muestras. */
export interface KpiTiempoCiclo {
  muestras: number;
  medianaMs: number;
  p95Ms: number;
  medianaHoras: number;
  p95Horas: number;
}

/** Costo por resultado aceptado. `costoPorResultadoUsd` en `null` cuando no hay resultados aceptados. */
export interface KpiCostoPorResultado {
  costoTotalUsd: number;
  resultadosAceptados: number;
  costoPorResultadoUsd: number | null;
}

/** Horas liberadas: SIEMPRE una estimación pendiente de fuente (`horas` en `null`). */
export interface KpiHorasLiberadas {
  estimacion: true;
  horas: null;
  causa: string;
  nota: string;
}

/** Beneficio validado / proyectado: pendiente de fuente mientras `validadoUsd` sea `null`. */
export interface KpiBeneficioValidado {
  validadoUsd: number | null;
  proyectadoUsd: number | null;
  moneda: string | null;
  causa: string;
  nota: string;
}

/** Conjunto de KPIs del período. */
export interface IndicadoresKpis {
  cumplimiento: KpiCumplimiento;
  calidad: KpiCalidad;
  tiempoCiclo: KpiTiempoCiclo | null;
  costoPorResultado: KpiCostoPorResultado;
  excepciones: KpiExcepciones;
  horasLiberadas: KpiHorasLiberadas;
  beneficioValidado: KpiBeneficioValidado;
}

/** Respuesta completa de `GET /indicadores/resultados`. */
export interface IndicadoresResultados {
  periodo: IndicadoresPeriodo;
  filtros: IndicadoresFiltrosEco;
  kpis: IndicadoresKpis;
}

/** Filtro de la consulta (todo opcional; sin `from`/`to` el backend usa una ventana de 30 días). */
export interface IndicadoresFiltro {
  from?: string;
  to?: string;
  empresaId?: string;
  areaId?: string;
  agentId?: string;
}
