/**
 * Tipos de la estructura empresarial (ADR 0011 E1): dimensiones organizacional, de negocio, territorial y económica,
 * más la matriz de asignaciones. Espejan el contrato del backend (`modules/governance/estructura`). Todas las entidades
 * filtran por `workspaceId` (multi-tenant) y pertenecen a una empresa (OrgUnit `EMPRESA`). NO conceden acceso a datos
 * por sí mismas (D6/RF46): describen estructura, no permisos.
 */

/** Estado de vigencia de una entidad de estructura (ADR 0011 D2). */
export type EstadoEstructura = 'ACTIVA' | 'SUSPENDIDA' | 'CERRADA';
export const ESTADOS_ESTRUCTURA: readonly EstadoEstructura[] = ['ACTIVA', 'SUSPENDIDA', 'CERRADA'];

/** Discriminador de la dimensión jerárquica/funcional del árbol `OrgUnit` (ADR 0011 D2). */
export type OrgUnitTipo = 'GRUPO' | 'EMPRESA' | 'UNIDAD_NEGOCIO' | 'AREA_FUNCIONAL' | 'DEPARTAMENTO' | 'EQUIPO';
export const ORG_UNIT_TIPOS: readonly OrgUnitTipo[] = [
  'GRUPO',
  'EMPRESA',
  'UNIDAD_NEGOCIO',
  'AREA_FUNCIONAL',
  'DEPARTAMENTO',
  'EQUIPO',
];

/** Naturaleza de una asignación organizacional (ADR 0011 D4/RF42). */
export type TipoAsignacion = 'FUNCIONAL_PRINCIPAL' | 'LINEA' | 'SEDE' | 'PROYECTO' | 'SERVICIO';
export const TIPOS_ASIGNACION: readonly TipoAsignacion[] = [
  'FUNCIONAL_PRINCIPAL',
  'LINEA',
  'SEDE',
  'PROYECTO',
  'SERVICIO',
];

// ============================ Línea de negocio (dimensión de negocio, D3) ============================

export interface LineaNegocio {
  id: string;
  workspaceId: string;
  /** OrgUnit `EMPRESA` dueña de la línea. */
  empresaId: string;
  codigo: string;
  nombre: string;
  /** Responsable humano opcional (RF43); no concede acceso (D6). */
  responsableUserId: string | null;
  /** Metas u objetivos comerciales; no reemplazan el sistema de origen (RF43). */
  metas: Record<string, unknown>;
  estado: EstadoEstructura;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LineaNegocioCreateInput {
  empresaId: string;
  codigo: string;
  nombre: string;
  responsableUserId?: string | null;
  metas?: Record<string, unknown>;
  estado?: EstadoEstructura;
  vigenteDesde?: string | null;
  vigenteHasta?: string | null;
}

/** La empresa de una línea no se cambia tras crearla (altera el ámbito de unicidad del código). */
export type LineaNegocioUpdateInput = Partial<Omit<LineaNegocioCreateInput, 'empresaId'>>;

// ============================ Sede (dimensión territorial, D3) ============================

export interface Sede {
  id: string;
  workspaceId: string;
  empresaId: string;
  codigo: string;
  nombre: string;
  /** Zona horaria IANA, p. ej. "America/Bogota". */
  zonaHoraria: string;
  alcanceTerritorial: string | null;
  estado: EstadoEstructura;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SedeCreateInput {
  empresaId: string;
  codigo: string;
  nombre: string;
  zonaHoraria: string;
  alcanceTerritorial?: string | null;
  estado?: EstadoEstructura;
  vigenteDesde?: string | null;
  vigenteHasta?: string | null;
}

export type SedeUpdateInput = Partial<Omit<SedeCreateInput, 'empresaId'>>;

// ============================ Centro de costo (dimensión económica, D3/D5) ============================

export interface CentroCosto {
  id: string;
  workspaceId: string;
  empresaId: string;
  codigo: string;
  nombre: string;
  /** Asociación por defecto opcional (no concede permisos). */
  orgUnitId: string | null;
  lineaNegocioId: string | null;
  estado: EstadoEstructura;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CentroCostoCreateInput {
  empresaId: string;
  codigo: string;
  nombre: string;
  orgUnitId?: string | null;
  lineaNegocioId?: string | null;
  estado?: EstadoEstructura;
  vigenteDesde?: string | null;
  vigenteHasta?: string | null;
}

export type CentroCostoUpdateInput = Partial<Omit<CentroCostoCreateInput, 'empresaId'>>;

// ============================ Asignación organizacional (la matriz, D4) ============================

export interface AsignacionOrganizacional {
  id: string;
  workspaceId: string;
  /** Sujeto: exactamente uno de los dos. */
  agentId: string | null;
  userId: string | null;
  tipoAsignacion: TipoAsignacion;
  /** Destino según `tipoAsignacion`: área/equipo, línea, sede o proyecto (futuro). */
  orgUnitId: string | null;
  lineaNegocioId: string | null;
  sedeId: string | null;
  proyectoId: string | null;
  /** Rol en esa dimensión (colaborador | revisor | responsable_proceso ...). */
  rol: string | null;
  /** Qué habilita OPERATIVAMENTE; nunca acceso a datos (D6). */
  alcance: Record<string, unknown>;
  estado: EstadoEstructura;
  vigenteDesde: string;
  vigenteHasta: string | null;
  creadaPorUserId: string | null;
  createdAt: string;
}

export interface AsignacionCreateInput {
  agentId?: string | null;
  userId?: string | null;
  tipoAsignacion: TipoAsignacion;
  orgUnitId?: string | null;
  lineaNegocioId?: string | null;
  sedeId?: string | null;
  proyectoId?: string | null;
  rol?: string | null;
  alcance?: Record<string, unknown>;
  vigenteDesde?: string | null;
  vigenteHasta?: string | null;
}

/** En una asignación solo se editan rol, alcance, estado y la vigencia (cerrar); nunca el sujeto ni el destino. */
export interface AsignacionUpdateInput {
  rol?: string | null;
  alcance?: Record<string, unknown>;
  estado?: EstadoEstructura;
  vigenteHasta?: string | null;
}

/** Filtro de listado de asignaciones (por sujeto o por línea). */
export interface AsignacionFilter {
  agentId?: string;
  userId?: string;
  lineaNegocioId?: string;
}
