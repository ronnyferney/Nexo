/**
 * Tipos de la consola gerencial (E12 · vista ejecutiva para dirección). Espejan EXACTAMENTE el contrato del backend
 * (`GET /consolas/gerencial`, rol mínimo ADMIN). Solo lectura. La consola NO reimplementa métricas: agrega sobre lo ya
 * existente — resultados (E10), economía (E9), estado operativo de gobierno (E6/E7) e integridad de auditoría (E13).
 *
 * Reglas de honestidad del dato que la UI debe respetar:
 *  - `economia.consolidado` llega `null` cuando el alcance no es consolidable (área/agente); en ese caso se muestran
 *    `consolidadoCausa`/`consolidadoNota`, NUNCA un 0 inventado. El `costoAtribuibleUsd` siempre es exacto del alcance.
 *  - `auditoria.cadenaIntegra` es el sello de confianza de la cadena de auditoría: `true` íntegra, `false` comprometida.
 */

import type { IndicadoresFiltro, IndicadoresKpis, IndicadoresPeriodo } from './indicadores.models';
import type { DimensionConsolidacion, GrupoConsolidado } from './imputacion.models';

/** Alcance efectivamente aplicado por el servidor (eco de la petición). */
export interface ConsolaAlcance {
  empresaId: string | null;
  areaId: string | null;
  agentId: string | null;
}

/** Libro consolidado del período por empresa (E9): costo medido vs. estimado por reparto de servicios compartidos. */
export interface ConsolaConsolidado {
  dimension: DimensionConsolidacion;
  totalMedidoUsd: number;
  totalEstimadoUsd: number;
  grupos: GrupoConsolidado[];
}

/**
 * Economía del alcance/período. `costoAtribuibleUsd` es exacto (suma de `UsageRecord` del alcance, E10). El libro
 * `consolidado` solo existe para alcances consolidables (empresa o workspace completo); para área/agente llega `null`
 * con su `consolidadoCausa`/`consolidadoNota` explicando por qué (honesto, no cero).
 */
export interface ConsolaEconomia {
  costoAtribuibleUsd: number;
  consolidado: ConsolaConsolidado | null;
  consolidadoCausa: string | null;
  consolidadoNota: string | null;
}

/** Estado operativo ACTUAL de gobierno/durabilidad (no acotado al período): conteos de bandejas (E6/E7). */
export interface ConsolaGobierno {
  aprobacionesPendientes: number;
  suspensionesActivas: number;
  excepcionesAbiertas: number;
}

/**
 * Integridad de la cadena de auditoría (E13). `cadenaIntegra` es el sello de confianza para dirección. Cuando la cadena
 * está comprometida, el backend añade `rotaEnSeq`/`motivo` con el punto de ruptura.
 */
export interface ConsolaAuditoria {
  hechosEnPeriodo: number;
  totalHechos: number;
  cadenaIntegra: boolean;
  rotaEnSeq?: number | null;
  motivo?: string | null;
}

/** Respuesta completa de `GET /consolas/gerencial`. */
export interface ConsolaGerencial {
  periodo: IndicadoresPeriodo;
  alcance: ConsolaAlcance;
  resultados: IndicadoresKpis;
  economia: ConsolaEconomia;
  gobierno: ConsolaGobierno;
  auditoria: ConsolaAuditoria;
}

/** Filtro de la consulta (todo opcional; mismo shape que indicadores; sin `from`/`to` el backend usa 30 días). */
export type ConsolaGerencialFiltro = IndicadoresFiltro;
