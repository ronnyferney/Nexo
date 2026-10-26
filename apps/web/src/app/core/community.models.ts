/**
 * Tipos del muro de comunidad interna (E11). Espejan el contrato del backend (`apps/api/src/modules/community`).
 * Un muro corporativo privado: novedades, pedidos de apoyo, aprendizajes y compromisos. Un COMPROMISO/APOYO puede
 * ligarse a una `Tarea` del mismo workspace (referencia blanda). Todo filtra por `workspaceId` (multi-tenant); el
 * autor SIEMPRE es el usuario autenticado. El `cuerpo` es texto de usuario: se muestra como texto plano, nunca HTML.
 */

/** Tipo de publicación (espejo del enum `PublicacionTipo` de Prisma). */
export type PublicacionTipo = 'NOVEDAD' | 'APOYO' | 'APRENDIZAJE' | 'COMPROMISO';
export const TIPOS_PUBLICACION: readonly PublicacionTipo[] = ['NOVEDAD', 'APOYO', 'APRENDIZAJE', 'COMPROMISO'];

/** Estado de una publicación (espejo del enum `PublicacionEstado`). ARCHIVADA es la baja lógica (sale del muro). */
export type PublicacionEstado = 'ACTIVA' | 'RESUELTA' | 'ARCHIVADA';
export const ESTADOS_PUBLICACION: readonly PublicacionEstado[] = ['ACTIVA', 'RESUELTA', 'ARCHIVADA'];

/** Tipos de reacción admitidos en el muro (etiqueta corta; contenido social, no ejecutable). */
export type ReaccionTipo = 'like' | 'celebrar' | 'apoyo';
export const TIPOS_REACCION: readonly ReaccionTipo[] = ['like', 'celebrar', 'apoyo'];

/** Conteos agregados que el backend adjunta a cada publicación del feed. */
export interface PublicacionConteo {
  comentarios: number;
  reacciones: number;
}

/** Publicación del muro tal como llega en el feed (`GET /comunidad/publicaciones`). */
export interface Publicacion {
  id: string;
  workspaceId: string;
  /** Autor: referencia blanda a `User`. Siempre el usuario autenticado que la creó. */
  autorUserId: string;
  /** Alcance opcional a un área/empresa (OrgUnit). `null` = muro general del workspace. */
  orgUnitId: string | null;
  tipo: PublicacionTipo;
  titulo: string | null;
  cuerpo: string;
  /** Tarea ligada (solo COMPROMISO/APOYO). Referencia blanda al mismo workspace. */
  tareaId: string | null;
  estado: PublicacionEstado;
  createdAt: string;
  updatedAt: string;
  _count?: PublicacionConteo;
}

/** Comentario a una publicación del muro. */
export interface Comentario {
  id: string;
  workspaceId: string;
  publicacionId: string;
  autorUserId: string;
  cuerpo: string;
  createdAt: string;
}

/** Detalle de una publicación (`GET /comunidad/publicaciones/:id`): la publicación con sus comentarios. */
export interface PublicacionDetalle extends Publicacion {
  comentarios: Comentario[];
}

/** Reacción de un usuario a una publicación (`POST /comunidad/publicaciones/:id/reacciones`). */
export interface Reaccion {
  id: string;
  workspaceId: string;
  publicacionId: string;
  autorUserId: string;
  tipo: string;
  createdAt: string;
}

/** Respuesta paginada por offset del feed. */
export interface FeedPublicaciones {
  items: Publicacion[];
  total: number;
  take: number;
  skip: number;
}

/** Filtros del feed (lado servidor). Paginación por offset (`take`/`skip`). */
export interface FeedFiltro {
  tipo?: PublicacionTipo;
  estado?: PublicacionEstado;
  orgUnitId?: string;
  take?: number;
  skip?: number;
}

/** Alta de una publicación. El autor lo pone el servidor; `tareaId` solo aplica a COMPROMISO/APOYO. */
export interface CrearPublicacionInput {
  tipo: PublicacionTipo;
  titulo?: string;
  cuerpo: string;
  orgUnitId?: string;
  tareaId?: string;
}

/** Edición por el autor o un ADMIN+: ajustar texto o cambiar estado (p. ej. marcar un APOYO como RESUELTA). */
export interface ActualizarPublicacionInput {
  titulo?: string;
  cuerpo?: string;
  estado?: PublicacionEstado;
}

export interface CrearComentarioInput {
  cuerpo: string;
}
