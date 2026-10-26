/**
 * Tipos de la bandeja de excepciones (E7 · RF20/RF21). Reflejan el contrato del módulo
 * `apps/api/src/modules/durability/excepciones` (controlador `/excepciones`). Los campos `Json` del backend
 * (`evidencia`, `detalle`) llegan ya parseados como objetos; las fechas llegan como texto ISO.
 */

/** Estado operativo de la excepción (resumen de la última situación; el historial es append-only). */
export type EstadoExcepcion = 'ABIERTA' | 'EN_PROGRESO' | 'CONCILIADA' | 'REASIGNADA' | 'CANCELADA' | 'RESUELTA';

/** Clasificación del fallo (RF20): decide si se puede reintentar o hay que conciliar. */
export type ClaseFallo = 'TEMPORAL' | 'PERMANENTE' | 'INCIERTO';

/** Origen de la excepción: de dónde vino el fallo que requiere intervención humana. */
export type OrigenExcepcion = 'MOTOR_DURABLE' | 'ESCRITURA_INCIERTA' | 'MANUAL';

/** Tipo de evento del historial append-only de una excepción (RF21). */
export type TipoEventoExcepcion =
  | 'CREADA'
  | 'INFO'
  | 'REINTENTO'
  | 'REASIGNACION'
  | 'CANCELACION'
  | 'CONCILIACION';

export const ESTADOS_EXCEPCION: readonly EstadoExcepcion[] = [
  'ABIERTA',
  'EN_PROGRESO',
  'CONCILIADA',
  'REASIGNADA',
  'CANCELADA',
  'RESUELTA',
];

export const CLASES_FALLO: readonly ClaseFallo[] = ['TEMPORAL', 'PERMANENTE', 'INCIERTO'];

export const ORIGENES_EXCEPCION: readonly OrigenExcepcion[] = ['MOTOR_DURABLE', 'ESCRITURA_INCIERTA', 'MANUAL'];

/** Evento append-only del historial de una excepción. Los eventos no se borran ni se editan. */
export interface ExcepcionEvento {
  id: string;
  workspaceId: string;
  excepcionId: string;
  tipo: TipoEventoExcepcion;
  detalle: Record<string, unknown>;
  actorUserId?: string | null;
  createdAt: string;
}

/** Excepción de la bandeja operativa (RF21). */
export interface Excepcion {
  id: string;
  workspaceId: string;
  empresaId?: string | null;
  /** Causa auditable (código/razón), nunca el razonamiento del modelo. */
  causa: string;
  clase?: ClaseFallo | null;
  impacto?: string | null;
  /** Referencias blandas al proceso/flujo, tarea, ejecución y paso/nodo afectados. */
  procesoId?: string | null;
  tareaId?: string | null;
  executionId?: string | null;
  paso?: string | null;
  /** Evidencia referenciada (no copia de datos sensibles): { executionId, providerRef, stepId, ... }. */
  evidencia: Record<string, unknown>;
  duenoUserId?: string | null;
  siguienteAccion?: string | null;
  origen: OrigenExcepcion;
  /** Clave de idempotencia de la acción asociada: al reintentar evita duplicar un efecto ya confirmado (QA06). */
  idempotencyKeyId?: string | null;
  estado: EstadoExcepcion;
  createdAt: string;
  updatedAt: string;
}

/** Detalle de la excepción: incluye su historial de eventos (orden cronológico ascendente). */
export interface ExcepcionDetalle extends Excepcion {
  eventos: ExcepcionEvento[];
}

// ---------- Filtros y entradas de las mutaciones ----------

export interface ExcepcionesFiltro {
  estado?: EstadoExcepcion;
  tareaId?: string;
}

export interface AportarInfoInput {
  nota: string;
  evidencia?: Record<string, unknown>;
  siguienteAccion?: string;
}

export interface ReasignarInput {
  duenoUserId: string;
  motivo?: string;
}

export interface CancelarInput {
  motivo: string;
}

export type ResultadoConciliacion = 'CONFIRMADO' | 'NO_OCURRIO';

export interface ConciliarInput {
  resultado: ResultadoConciliacion;
  detalle?: string;
}
