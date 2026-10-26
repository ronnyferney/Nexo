/**
 * Tipos de la imputación de costos (ADR 0011 D5/D7 · E9 · RF44/RF45/RF47 parcial). Espejan el contrato del backend
 * (`modules/governance/imputacion`): servicios internos / compartidos, su reparto de costo (suma 100 % por
 * servicio+periodo, de REPORTE: no toca presupuestos ni reservas, ADR 0002) y la consolidación económica que separa el
 * costo MEDIDO (snapshot de consumo) del ESTIMADO (reparto de servicios compartidos). Filtran por `workspaceId`.
 */

import type { EstadoEstructura } from './estructura.models';

// ============================ Servicio interno / compartido (RF44) ============================

export interface ServicioInterno {
  id: string;
  workspaceId: string;
  /** OrgUnit `EMPRESA` dueña del servicio. */
  empresaId: string;
  /** OrgUnit que presta el servicio (área dueña). */
  areaDuenoId: string;
  codigo: string;
  nombre: string;
  /** Responsable humano opcional (no concede acceso, D6). */
  responsableUserId: string | null;
  /** Responsable digital (agente) opcional. */
  responsableAgentId: string | null;
  /** Acuerdo de servicio: entradas, salidas, criterios. */
  acuerdoServicio: Record<string, unknown>;
  /** Clientes internos [{ tipo, id, nombre }]. */
  clientesInternos: ClienteInterno[];
  estado: EstadoEstructura;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  createdAt: string;
  updatedAt: string;
  /** Reparto incluido solo al pedir el detalle (`servicio(id)`). */
  imputaciones?: ImputacionCosto[];
}

/** Cliente interno de un servicio compartido (no concede acceso, D6). */
export interface ClienteInterno {
  tipo?: string;
  id?: string;
  nombre: string;
}

export interface ServicioInternoCreateInput {
  empresaId: string;
  areaDuenoId: string;
  codigo: string;
  nombre: string;
  responsableUserId?: string | null;
  responsableAgentId?: string | null;
  acuerdoServicio?: Record<string, unknown>;
  clientesInternos?: ClienteInterno[];
  estado?: EstadoEstructura;
  vigenteDesde?: string | null;
  vigenteHasta?: string | null;
}

/** La empresa de un servicio no se cambia tras crearlo (altera el ámbito de unicidad del código). */
export type ServicioInternoUpdateInput = Partial<Omit<ServicioInternoCreateInput, 'empresaId'>>;

// ============================ Reparto de costo del servicio (RF45) ============================

/** Una fila del reparto persistida: exactamente un destino (línea/área/centro) y su porcentaje. */
export interface ImputacionCosto {
  id: string;
  workspaceId: string;
  servicioInternoId: string;
  periodoKey: string;
  lineaNegocioId: string | null;
  orgUnitId: string | null;
  centroCostoId: string | null;
  /** Porcentaje (0 < x ≤ 100); Prisma `Decimal` llega como texto. */
  porcentaje: string | number;
  createdAt: string;
}

/** Una fila del reparto a enviar: exactamente un destino con su porcentaje. */
export interface DestinoImputacionInput {
  lineaNegocioId?: string | null;
  orgUnitId?: string | null;
  centroCostoId?: string | null;
  porcentaje: number;
}

/** Reparto COMPLETO de un servicio para un periodo (reemplaza el anterior de ese periodo). */
export interface SetRepartoInput {
  periodoKey: string;
  destinos: DestinoImputacionInput[];
}

// ============================ Consolidación económica (RF47 parcial) ============================

/** Dimensión por la que consolida el costo (ADR 0011 D7). */
export type DimensionConsolidacion = 'empresa' | 'linea' | 'area' | 'centro';
export const DIMENSIONES_CONSOLIDACION: readonly DimensionConsolidacion[] = ['empresa', 'linea', 'area', 'centro'];

/** Tipo de destino de una fila de reparto, tal como lo etiqueta la consolidación. */
export type TipoDestino = 'linea' | 'area' | 'centro';

/** Un grupo de la consolidación: costo medido y estimado por clave de la dimensión. */
export interface GrupoConsolidado {
  key: string;
  label: string;
  costoMedidoUsd: number;
  costoEstimadoUsd: number;
  calls: number;
}

/** Reparto de un servicio compartido en un periodo, con su costo medido y el detalle repartido. */
export interface ServicioCompartidoReparto {
  servicioId: string;
  codigo: string;
  nombre: string;
  periodoKey: string;
  costoMedidoUsd: number;
  repartido: { tipo: TipoDestino; destinoId: string; montoUsd: number }[];
}

export interface ConsolidacionResult {
  dimension: DimensionConsolidacion;
  from: string;
  to: string;
  totalMedidoUsd: number;
  totalEstimadoUsd: number;
  groups: GrupoConsolidado[];
  serviciosCompartidos: ServicioCompartidoReparto[];
}

export interface ConsolidacionQuery {
  dimension: DimensionConsolidacion;
  from?: string;
  to?: string;
  empresaId?: string;
}
