/**
 * Tipos de comunicación entre agentes y handoff (E5 · RF35/RF09/RF33). Espejan el contrato del backend
 * (`apps/api/src/modules/messaging`). Un `MensajeAgente` es un registro persistente e idempotente por `messageId`:
 * la «conversación» visible es una REPRESENTACIÓN de estos registros, no un chat libre. Los hechos del ciclo de vida
 * (enviado/recibido/aceptado/resuelto) son marcas de tiempo distintas (RF35). Toda entidad filtra por `workspaceId`
 * y las mutaciones exigen EDITOR+ (el servidor es el gate real). Un mensaje NO autoriza efectos ni amplía permisos.
 */

// ============================ Mensajes (RF35) ============================

/** Tipo de mensaje entre agentes (espejo del enum `TipoMensaje` de Prisma). */
export type TipoMensaje =
  | 'ASIGNACION'
  | 'ACEPTACION'
  | 'SOLICITUD_INFO'
  | 'ENTREGA'
  | 'DEVOLUCION'
  | 'BLOQUEO'
  | 'ESCALAMIENTO'
  | 'CIERRE'
  | 'HANDOFF';

export const TIPOS_MENSAJE: readonly TipoMensaje[] = [
  'ASIGNACION',
  'ACEPTACION',
  'SOLICITUD_INFO',
  'ENTREGA',
  'DEVOLUCION',
  'BLOQUEO',
  'ESCALAMIENTO',
  'CIERRE',
  'HANDOFF',
];

/** Mensaje entre agentes tal como lo devuelve el backend (`GET /mensajes`). Fechas en ISO 8601. */
export interface MensajeAgente {
  id: string;
  workspaceId: string;
  empresaId: string | null;
  /** Clave de idempotencia provista por el emisor: una redelivery devuelve el mismo registro (QA11). */
  messageId: string;
  correlationId: string | null;
  emisorAgentId: string | null;
  destinatarioAgentId: string | null;
  destinatarioEquipoId: string | null;
  canalId: string | null;
  misionId: string | null;
  tareaId: string | null;
  tipo: TipoMensaje;
  prioridad: number;
  version: number;
  fechaLimite: string | null;
  /** Referencias autorizadas (punteros), sin copia de datos sensibles. */
  referencias: unknown[];
  /** Alcance que acompaña; NUNCA amplía atribuciones. */
  permisos: Record<string, unknown>;
  // Hechos de ciclo de vida como registros distintos (RF35).
  enviadoAt: string;
  recibidoAt: string | null;
  aceptadoAt: string | null;
  resueltoAt: string | null;
  motivo: string | null;
  recibidoPorAgentId: string | null;
  aceptadoPorAgentId: string | null;
  createdAt: string;
  /** `true` si la redelivery devolvió un mensaje ya existente (no creó otro efecto). */
  yaExistia?: boolean;
}

/** Datos mínimos para derivar la tarea asignada de una ASIGNACION (la acción se ejecuta una sola vez). */
export interface TareaAsignadaInput {
  titulo: string;
  criterioAceptacion?: string;
  parentTareaId?: string;
  entradas?: Record<string, unknown>;
  fechaLimite?: string;
}

/** Envío de un mensaje (`POST /mensajes`). `messageId` es la clave de idempotencia del emisor. */
export interface EnviarMensajeInput {
  messageId: string;
  tipo: TipoMensaje;
  correlationId?: string;
  empresaId?: string;
  emisorAgentId?: string;
  destinatarioAgentId?: string;
  destinatarioEquipoId?: string;
  canalId?: string;
  misionId?: string;
  tareaId?: string;
  prioridad?: number;
  version?: number;
  fechaLimite?: string;
  referencias?: unknown[];
  permisos?: Record<string, unknown>;
  tarea?: TareaAsignadaInput;
}

/** Marca de un hecho del ciclo de vida (recibir/aceptar/resolver) con su actor y motivo. */
export interface HechoMensajeInput {
  agentId?: string;
  motivo?: string;
}

/** Filtro de la bandeja (lado servidor). */
export interface MensajeFiltro {
  correlationId?: string;
  tareaId?: string;
  destinatarioAgentId?: string;
}

// ============================ Handoff / transferencia (RF09/RF33) ============================

export type EstadoTransferencia = 'PROPUESTO' | 'ACEPTADO' | 'RECHAZADO';

/**
 * Contrato de transferencia de una tarea en un punto de corte (RF09). Cierra el segmento actual con el estado
 * alcanzado y el entregable parcial; el receptor acepta (continúa desde el estado persistido, SIN rehacer) o rechaza
 * (con motivo). La unicidad `(tareaId, secuenciaSegmento)` evita duplicar lo confirmado.
 */
export interface ContratoTransferencia {
  id: string;
  workspaceId: string;
  tareaId: string;
  secuenciaSegmento: number;
  fromAgentId: string | null;
  toAgentId: string | null;
  toEquipoId: string | null;
  estadoAlcanzado: Record<string, unknown>;
  entregableParcial: Record<string, unknown> | null;
  contextoAutorizado: unknown[];
  criterioSiguiente: string | null;
  permisos: Record<string, unknown>;
  responsableEntranteUserId: string | null;
  workflowId: string | null;
  estado: EstadoTransferencia;
  motivoRechazo: string | null;
  mensajeId: string | null;
  executionId: string | null;
  profundidadDelegacion: number;
  createdAt: string;
  decididoAt: string | null;
}

/** Propuesta de handoff (`POST /tareas/:id/handoff`). `messageId` del `MensajeAgente` HANDOFF que acompaña. */
export interface ProponerHandoffInput {
  messageId: string;
  fromAgentId?: string;
  toAgentId?: string;
  toEquipoId?: string;
  estadoAlcanzado?: Record<string, unknown>;
  entregableParcial?: Record<string, unknown>;
  contextoAutorizado?: unknown[];
  criterioSiguiente?: string;
  permisos?: Record<string, unknown>;
  responsableEntranteUserId?: string;
  workflowId?: string;
}

/** Aceptación del handoff (`POST /transferencias/:id/aceptar`). Encola el siguiente segmento. */
export interface AceptarHandoffInput {
  messageId: string;
  workflowId?: string;
  aceptaAgentId?: string;
}

/** Rechazo del handoff (`POST /transferencias/:id/rechazar`): devuelve al emisor con motivo (auditable). */
export interface RechazarHandoffInput {
  messageId: string;
  motivo: string;
}
