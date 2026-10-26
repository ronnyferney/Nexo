import type { Publicacion, PublicacionEstado, PublicacionTipo, ReaccionTipo } from '../../core/community.models';

/**
 * Lógica pura del muro de comunidad (E11), sin Angular: metadatos de presentación (etiqueta/color/ícono por tipo,
 * estado y reacción), decisión de acciones del autor/ADMIN y formateo de conteos. Vive aquí, con pruebas propias
 * (`comunidad.util.spec.ts`), para que el componente sea solo presentación y estado reactivo. El permiso real lo
 * impone el servidor; estas funciones solo deciden qué ofrecer en la interfaz.
 */

/** Clase de `.badge` del design system (vacía = neutra). */
export type BadgeClase = '' | 'primary' | 'success' | 'danger' | 'warning' | 'info';

export interface Meta {
  label: string;
  badge: BadgeClase;
}

export interface TipoMeta extends Meta {
  /** Ícono del mapa de `nx-icon`. */
  icon: string;
  /** Descripción corta del propósito del tipo (ayuda al componer). */
  descripcion: string;
}

// ============================ Tipo de publicación ============================

/** Etiqueta, color e ícono distintivos de cada tipo de publicación (chip del feed). */
export const TIPO_PUBLICACION_META: Record<PublicacionTipo, TipoMeta> = {
  NOVEDAD: { label: 'Novedad', badge: 'info', icon: 'bell', descripcion: 'Comparte una noticia o anuncio.' },
  APOYO: { label: 'Apoyo', badge: 'warning', icon: 'headset', descripcion: 'Pide ayuda al equipo.' },
  APRENDIZAJE: { label: 'Aprendizaje', badge: 'success', icon: 'graduation', descripcion: 'Comparte algo que aprendiste.' },
  COMPROMISO: { label: 'Compromiso', badge: 'primary', icon: 'target', descripcion: 'Declara un compromiso de trabajo.' },
};

export const tipoPublicacionMeta = (t: PublicacionTipo): TipoMeta => TIPO_PUBLICACION_META[t];

// ============================ Estado de publicación ============================

export const ESTADO_PUBLICACION_META: Record<PublicacionEstado, Meta> = {
  ACTIVA: { label: 'Activa', badge: '' },
  RESUELTA: { label: 'Resuelta', badge: 'success' },
  ARCHIVADA: { label: 'Archivada', badge: 'danger' },
};

export const estadoPublicacionMeta = (e: PublicacionEstado): Meta => ESTADO_PUBLICACION_META[e];

// ============================ Reacciones ============================

export interface ReaccionMeta {
  label: string;
  icon: string;
}

export const REACCION_META: Record<ReaccionTipo, ReaccionMeta> = {
  like: { label: 'Me gusta', icon: 'thumbsUp' },
  celebrar: { label: 'Celebrar', icon: 'sparkles' },
  apoyo: { label: 'Apoyo', icon: 'heartPulse' },
};

export const reaccionMeta = (t: ReaccionTipo): ReaccionMeta => REACCION_META[t];

// ============================ Reglas de la publicación ============================

/** Una tarea solo se liga a un COMPROMISO o un APOYO (regla del backend). */
export function permiteTarea(tipo: PublicacionTipo): boolean {
  return tipo === 'COMPROMISO' || tipo === 'APOYO';
}

/** Puede moderar (editar/cambiar estado/archivar) el autor de la publicación o un administrador (ADMIN/OWNER). */
export function puedeModerar(pub: Pick<Publicacion, 'autorUserId'>, userId: string | null, isAdmin: boolean): boolean {
  return isAdmin || (!!userId && pub.autorUserId === userId);
}

/**
 * Se puede marcar como RESUELTA un APOYO o COMPROMISO aún ACTIVO, por quien puede moderar. No aplica a NOVEDAD/
 * APRENDIZAJE (no tienen cierre) ni a una ya resuelta o archivada.
 */
export function puedeResolver(
  pub: Pick<Publicacion, 'autorUserId' | 'tipo' | 'estado'>,
  userId: string | null,
  isAdmin: boolean,
): boolean {
  return puedeModerar(pub, userId, isAdmin) && pub.estado === 'ACTIVA' && permiteTarea(pub.tipo);
}

/** Se puede archivar (baja lógica) cualquier publicación no archivada, por quien puede moderar. */
export function puedeArchivar(
  pub: Pick<Publicacion, 'autorUserId' | 'estado'>,
  userId: string | null,
  isAdmin: boolean,
): boolean {
  return puedeModerar(pub, userId, isAdmin) && pub.estado !== 'ARCHIVADA';
}

// ============================ Formateo ============================

/** Conteo compacto para chips: 0–999 literal; a partir de 1000, con sufijo «k» (es-ES, coma decimal). */
export function formatearConteo(n: number | null | undefined): string {
  const v = Math.max(0, Math.floor(n ?? 0));
  if (v < 1000) return String(v);
  const miles = v / 1000;
  const texto = miles >= 10 ? String(Math.floor(miles)) : miles.toFixed(1).replace(/\.0$/, '').replace('.', ',');
  return `${texto} k`;
}

/** Identificador corto para mostrar referencias blandas (autor, tarea) sin exponer el id completo. */
export const corto = (id?: string | null): string => (id ? `…${id.slice(-6)}` : '—');
