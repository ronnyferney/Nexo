/**
 * Tipos del marco de dimensiones configurables y la consola de análisis (ADR 0011 D8 · E1b). Espejan el contrato del
 * módulo `apps/api/src/modules/governance/dimensiones`. El cliente crea sus dimensiones (Proyecto, Cliente, Producto,
 * Campaña) sin migración; las 3 integradas (línea de negocio, sede, centro de costo) llegan con `esSistema=true` y son
 * solo lectura. Todo filtra por `workspaceId` (multi-tenant) y, cuando aplica, por empresa. Etiquetar NO concede
 * acceso (D6). Las fechas llegan como ISO; los campos `Decimal` del consumo llegan ya numéricos.
 */

import type { EstadoEstructura } from './estructura.models';

export type { EstadoEstructura } from './estructura.models';

/** Naturaleza de los valores de una dimensión (ADR 0011 D8). */
export type DimensionTipoValor = 'LISTA' | 'REFERENCIA' | 'TEXTO' | 'NUMERO';
export const DIMENSION_TIPOS_VALOR: readonly DimensionTipoValor[] = ['LISTA', 'REFERENCIA', 'TEXTO', 'NUMERO'];

/** Entidades admitidas cuando `tipoValor = REFERENCIA` (el backend valide la existencia y la empresa). */
export type ReferenciaEntidad = 'LineaNegocio' | 'Sede' | 'CentroCosto' | 'OrgUnit';
export const REFERENCIA_ENTIDADES: readonly ReferenciaEntidad[] = ['LineaNegocio', 'Sede', 'CentroCosto', 'OrgUnit'];

// ============================ Dimensión ============================

export interface Dimension {
  id: string;
  workspaceId: string;
  /** `null` = aplica a toda la organización; si no, a una empresa (OrgUnit EMPRESA). */
  empresaId: string | null;
  codigo: string;
  nombre: string;
  tipoValor: DimensionTipoValor;
  referenciaEntidad: string | null;
  /** Si sus valores forman árbol (roll-up). */
  jerarquica: boolean;
  obligatoria: boolean;
  /** Se exige al despachar/registrar trabajo con efecto económico (RF11/RF45). */
  obligatoriaParaEfectoEconomico: boolean;
  /** Entidades/acciones etiquetables ("ejecucion" | "tarea" | "costo" | "agente" | ...). */
  aplicaA: string[];
  /** Las 3 integradas de D3. No se editan ni borran por el cliente. */
  esSistema: boolean;
  estado: EstadoEstructura;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  createdAt: string;
  updatedAt: string;
}

/** El código, la empresa, el tipo de valor y la entidad referida fijan el ámbito y no se cambian tras crear. */
export interface DimensionCreateInput {
  codigo: string;
  nombre: string;
  empresaId?: string | null;
  tipoValor?: DimensionTipoValor;
  referenciaEntidad?: string | null;
  jerarquica?: boolean;
  obligatoria?: boolean;
  obligatoriaParaEfectoEconomico?: boolean;
  aplicaA?: string[];
  estado?: EstadoEstructura;
  vigenteDesde?: string | null;
  vigenteHasta?: string | null;
}

export type DimensionUpdateInput = Partial<
  Omit<DimensionCreateInput, 'codigo' | 'empresaId' | 'tipoValor' | 'referenciaEntidad'>
>;

// ============================ Valor de dimensión ============================

export interface DimensionValue {
  id: string;
  workspaceId: string;
  dimensionId: string;
  codigo: string;
  nombre: string;
  /** Padre para la jerarquía (roll-up). Sin ciclos. */
  padreId: string | null;
  estado: EstadoEstructura;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DimensionValueCreateInput {
  codigo: string;
  nombre: string;
  padreId?: string | null;
  estado?: EstadoEstructura;
  vigenteDesde?: string | null;
  vigenteHasta?: string | null;
}

/** El código de un valor no se cambia tras crearlo (es la clave del snapshot). */
export type DimensionValueUpdateInput = Partial<Omit<DimensionValueCreateInput, 'codigo'>>;

// ============================ Etiquetado ============================

export interface DimensionAssignment {
  id: string;
  workspaceId: string;
  dimensionId: string;
  /** Para LISTA: id del DimensionValue. Para REFERENCIA: id de la entidad referida. */
  dimensionValueId: string | null;
  /** Para TEXTO/NUMERO: valor literal. */
  valorLiteral: string | null;
  targetType: string;
  targetId: string;
  createdAt: string;
}

export interface DimensionAssignmentInput {
  targetType: string;
  targetId: string;
  dimensionValueId?: string | null;
  valorLiteral?: string | null;
}

// ============================ Consola de análisis (pivot) ============================

/** Un grupo del pivot: el consumo etiquetado con un valor de la dimensión (sin doble conteo). */
export interface GrupoAnalisis {
  key: string;
  label: string;
  costUsd: number;
  calls: number;
}

/** Resultado de `GET /consolas/analisis`: pivota el consumo por una dimensión configurada. */
export interface AnalisisResult {
  dimension: { id: string; codigo: string; nombre: string; tipoValor: DimensionTipoValor };
  from: string;
  to: string;
  totalCostUsd: number;
  calls: number;
  groups: GrupoAnalisis[];
}

export interface AnalisisQuery {
  groupBy: string;
  from?: string;
  to?: string;
}
