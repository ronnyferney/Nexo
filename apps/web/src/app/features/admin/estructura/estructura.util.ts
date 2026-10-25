import type { OrgUnit } from '../../../core/models';
import type {
  AsignacionOrganizacional,
  EstadoEstructura,
  OrgUnitTipo,
  TipoAsignacion,
} from '../../../core/estructura.models';

/**
 * Lógica pura de la estructura empresarial (ADR 0011 E1): etiquetas en español, metadatos de badges y reglas de
 * vigencia/validación que la UI consume. Sin dependencias de Angular para que sea testeable de forma aislada. El gate
 * real (anidamiento por tipo, unicidad de FUNCIONAL_PRINCIPAL, etc.) lo aplica el backend; esto es presentación y ayuda.
 */

/** Tono de badge alineado al design system (`.badge.success`, `.badge.warning`, …). */
export type Tono = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary';

export interface TipoMeta {
  label: string;
  /** Ícono del mapa de `IconComponent`. */
  icon: string;
  tono: Tono;
}

/** Metadatos por tipo de unidad: etiqueta, ícono y tono para diferenciarlos visualmente (RF41). */
export const TIPO_META: Record<OrgUnitTipo, TipoMeta> = {
  GRUPO: { label: 'Grupo', icon: 'building', tono: 'primary' },
  EMPRESA: { label: 'Empresa', icon: 'building', tono: 'info' },
  UNIDAD_NEGOCIO: { label: 'Unidad de negocio', icon: 'target', tono: 'info' },
  AREA_FUNCIONAL: { label: 'Área funcional', icon: 'layers', tono: 'neutral' },
  DEPARTAMENTO: { label: 'Departamento', icon: 'subunit', tono: 'neutral' },
  EQUIPO: { label: 'Equipo', icon: 'users', tono: 'neutral' },
};

export const tipoLabel = (tipo: OrgUnitTipo): string => TIPO_META[tipo].label;

export interface EstadoMeta {
  label: string;
  tono: Tono;
}

/** Metadatos por estado de vigencia (ADR 0011 D2). */
export const ESTADO_META: Record<EstadoEstructura, EstadoMeta> = {
  ACTIVA: { label: 'Activa', tono: 'success' },
  SUSPENDIDA: { label: 'Suspendida', tono: 'warning' },
  CERRADA: { label: 'Cerrada', tono: 'danger' },
};

export const estadoLabel = (estado: EstadoEstructura): string => ESTADO_META[estado].label;

/** Clase CSS de un badge según su tono; `neutral` deja solo la clase base (sin color). */
export function badgeClass(tono: Tono): string {
  return tono === 'neutral' ? 'badge' : `badge ${tono}`;
}

export interface TipoAsignacionMeta {
  label: string;
  /** Campo destino que exige este tipo de asignación. */
  destino: 'orgUnit' | 'linea' | 'sede' | 'proyecto';
  descripcion: string;
}

/** Metadatos por tipo de asignación (ADR 0011 D4/RF42): a qué dimensión apunta su destino. */
export const TIPO_ASIGNACION_META: Record<TipoAsignacion, TipoAsignacionMeta> = {
  FUNCIONAL_PRINCIPAL: {
    label: 'Funcional principal',
    destino: 'orgUnit',
    descripcion: 'Área y superior funcional principales. Única vigente por sujeto (RF42).',
  },
  LINEA: { label: 'Línea de negocio', destino: 'linea', descripcion: 'Atiende una línea de negocio (transversal).' },
  SEDE: { label: 'Sede', destino: 'sede', descripcion: 'Opera desde o para una sede (transversal).' },
  PROYECTO: { label: 'Proyecto', destino: 'proyecto', descripcion: 'Participa en un proyecto (transversal).' },
  SERVICIO: { label: 'Servicio compartido', destino: 'orgUnit', descripcion: 'Presta un servicio a un área (transversal).' },
};

export const tipoAsignacionLabel = (tipo: TipoAsignacion): string => TIPO_ASIGNACION_META[tipo].label;

/** Nombre del campo destino (`orgUnitId`/`lineaNegocioId`/`sedeId`/`proyectoId`) que exige un tipo de asignación. */
export function destinoField(tipo: TipoAsignacion): 'orgUnitId' | 'lineaNegocioId' | 'sedeId' | 'proyectoId' {
  switch (TIPO_ASIGNACION_META[tipo].destino) {
    case 'linea':
      return 'lineaNegocioId';
    case 'sede':
      return 'sedeId';
    case 'proyecto':
      return 'proyectoId';
    default:
      return 'orgUnitId';
  }
}

/**
 * Una asignación está vigente si su estado es ACTIVA y aún no ha terminado su vigencia (sin fin o fin en el futuro).
 * Cerrar una asignación pone `vigenteHasta`; conserva historial (D4), por eso aquí distinguimos vigentes de históricas.
 */
export function asignacionVigente(a: Pick<AsignacionOrganizacional, 'estado' | 'vigenteHasta'>, now: Date = new Date()): boolean {
  if (a.estado !== 'ACTIVA') return false;
  if (!a.vigenteHasta) return true;
  const fin = new Date(a.vigenteHasta);
  return Number.isNaN(fin.getTime()) ? true : fin.getTime() > now.getTime();
}

/**
 * Valida el rango de vigencia: `desde` no puede ser posterior a `hasta`. Devuelve un mensaje en español o `null` si es
 * válido. Las fechas vacías son válidas (vigencia abierta). Coherente con el validador del backend.
 */
export function validarVigencia(desde?: string | null, hasta?: string | null): string | null {
  if (!desde || !hasta) return null;
  const d = new Date(desde).getTime();
  const h = new Date(hasta).getTime();
  if (Number.isNaN(d) || Number.isNaN(h)) return 'Las fechas de vigencia no son válidas.';
  if (d > h) return 'La fecha de inicio no puede ser posterior a la de fin.';
  return null;
}

/** Empresas del árbol (OrgUnit `tipo = EMPRESA`), ordenadas por nombre, para selectores y filtros. */
export function empresasDe(units: OrgUnit[]): OrgUnit[] {
  return units.filter((u) => u.tipo === 'EMPRESA').sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** Nombre de la empresa por id, o un guion si no se encuentra (p. ej. registro de otra empresa ya inaccesible). */
export function empresaNombre(units: OrgUnit[], empresaId: string | null): string {
  if (!empresaId) return '—';
  return units.find((u) => u.id === empresaId)?.name ?? '—';
}
