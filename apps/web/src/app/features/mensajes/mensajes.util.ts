import type {
  ContratoTransferencia,
  EstadoTransferencia,
  MensajeAgente,
  TipoMensaje,
} from '../../core/messaging.models';
import type { TipoCanal } from '../../core/collaboration.models';

/** Clase de `.badge` del design system (vacía = neutra). */
export type BadgeClase = '' | 'primary' | 'success' | 'danger' | 'warning' | 'info';

export interface Meta {
  label: string;
  badge: BadgeClase;
}

export interface TipoMeta extends Meta {
  /** Ícono del mapa de `nx-icon`. */
  icon: string;
}

// ============================ Mapeo de tipos de mensaje ============================

/** Etiqueta, color e ícono de cada tipo de mensaje (RF35). */
export const TIPO_MENSAJE_META: Record<TipoMensaje, TipoMeta> = {
  ASIGNACION: { label: 'Asignación', badge: 'primary', icon: 'send' },
  ACEPTACION: { label: 'Aceptación', badge: 'success', icon: 'check' },
  SOLICITUD_INFO: { label: 'Solicitud de información', badge: 'info', icon: 'info' },
  ENTREGA: { label: 'Entrega', badge: 'info', icon: 'inbox' },
  DEVOLUCION: { label: 'Devolución', badge: 'warning', icon: 'repeat' },
  BLOQUEO: { label: 'Bloqueo', badge: 'danger', icon: 'lock' },
  ESCALAMIENTO: { label: 'Escalamiento', badge: 'danger', icon: 'flag' },
  CIERRE: { label: 'Cierre', badge: 'success', icon: 'checkCircle' },
  HANDOFF: { label: 'Handoff', badge: 'primary', icon: 'shuffle' },
};

export const tipoMensajeMeta = (t: TipoMensaje): TipoMeta => TIPO_MENSAJE_META[t];

// ============================ Estado del mensaje por timestamps ============================

/**
 * Estado del mensaje DERIVADO de sus hechos de ciclo de vida (RF35): los timestamps son la fuente de verdad, no un
 * campo de estado. El más avanzado alcanzado manda (resuelto > aceptado > recibido > enviado).
 */
export type EstadoMensaje = 'ENVIADO' | 'RECIBIDO' | 'ACEPTADO' | 'RESUELTO';

export const ESTADO_MENSAJE_META: Record<EstadoMensaje, Meta> = {
  ENVIADO: { label: 'Enviado', badge: '' },
  RECIBIDO: { label: 'Recibido', badge: 'info' },
  ACEPTADO: { label: 'Aceptado', badge: 'primary' },
  RESUELTO: { label: 'Resuelto', badge: 'success' },
};

export function estadoMensaje(
  m: Pick<MensajeAgente, 'enviadoAt' | 'recibidoAt' | 'aceptadoAt' | 'resueltoAt'>,
): EstadoMensaje {
  if (m.resueltoAt) return 'RESUELTO';
  if (m.aceptadoAt) return 'ACEPTADO';
  if (m.recibidoAt) return 'RECIBIDO';
  return 'ENVIADO';
}

export const estadoMensajeMeta = (m: Parameters<typeof estadoMensaje>[0]): Meta =>
  ESTADO_MENSAJE_META[estadoMensaje(m)];

// ============================ Autor humano vs digital ============================

/** Distingue visualmente al autor/actor de un registro: digital (agente), humano (persona) o del sistema. */
export type AutorTipo = 'digital' | 'humano' | 'sistema';

export const AUTOR_META: Record<AutorTipo, TipoMeta> = {
  digital: { label: 'Agente', badge: 'primary', icon: 'bot' },
  humano: { label: 'Persona', badge: 'info', icon: 'user' },
  sistema: { label: 'Sistema', badge: '', icon: 'cpu' },
};

/** Un agente presente ⇒ autor digital; en su defecto una persona ⇒ humano; si no hay ninguno ⇒ sistema. */
export function autorTipo(agentId?: string | null, userId?: string | null): AutorTipo {
  if (agentId) return 'digital';
  if (userId) return 'humano';
  return 'sistema';
}

// ============================ Acciones disponibles según hechos y tipo ============================

export interface AccionesMensaje {
  /** Marcar recepción (aún no recibido). */
  recibir: boolean;
  /** Marcar aceptación (aún no aceptado). */
  aceptar: boolean;
  /** Marcar resolución (aún no resuelto). */
  resolver: boolean;
  /** Al resolver una DEVOLUCION el motivo es obligatorio (conserva trazabilidad, HU14). */
  motivoRequeridoAlResolver: boolean;
}

/**
 * Qué hechos del ciclo de vida se pueden marcar aún sobre un mensaje. Cada hecho es idempotente (una vez marcado no
 * se ofrece de nuevo). La necesidad de EDITOR+ la impone el permiso del usuario, no esta función.
 */
export function accionesMensaje(
  m: Pick<MensajeAgente, 'tipo' | 'recibidoAt' | 'aceptadoAt' | 'resueltoAt'>,
): AccionesMensaje {
  return {
    recibir: !m.recibidoAt,
    aceptar: !m.aceptadoAt,
    resolver: !m.resueltoAt,
    motivoRequeridoAlResolver: m.tipo === 'DEVOLUCION',
  };
}

// ============================ Orden y agrupación (conversación = representación) ============================

/** Comparador por envío más reciente primero (espejo del `orderBy enviadoAt desc` del backend). */
export function ordenarPorReciente(a: Pick<MensajeAgente, 'enviadoAt'>, b: Pick<MensajeAgente, 'enviadoAt'>): number {
  return new Date(b.enviadoAt).getTime() - new Date(a.enviadoAt).getTime();
}

/** Clase de badge para la prioridad del mensaje (1 = máxima). */
export function prioridadMensajeBadge(prioridad: number): BadgeClase {
  if (prioridad <= 1) return 'danger';
  if (prioridad === 2) return 'warning';
  return '';
}

export const PRIORIDAD_MENSAJE_LABEL: Record<number, string> = {
  1: 'Máxima',
  2: 'Alta',
  3: 'Media',
  4: 'Baja',
  5: 'Mínima',
};

/** Una conversación: el grupo de mensajes de un mismo hilo de negocio (`correlationId`), ordenado cronológicamente. */
export interface Conversacion {
  /** Clave estable de la agrupación (el `correlationId` o, si no lo hay, el id del mensaje suelto). */
  clave: string;
  correlationId: string | null;
  /** Mensajes del hilo, del más antiguo al más reciente (lectura como línea de tiempo). */
  mensajes: MensajeAgente[];
  /** El mensaje más reciente del hilo (para el encabezado del grupo). */
  ultimo: MensajeAgente;
}

/**
 * Agrupa los mensajes en conversaciones por `correlationId` (los sueltos quedan en su propio grupo). La conversación
 * visible es una REPRESENTACIÓN de estos registros, no un chat libre (RF35/ADR 0012 D3). Dentro del grupo los
 * mensajes van en orden cronológico ascendente; los grupos se ordenan por su mensaje más reciente (desc).
 */
export function agruparPorConversacion(mensajes: readonly MensajeAgente[]): Conversacion[] {
  const grupos = new Map<string, MensajeAgente[]>();
  for (const m of mensajes) {
    const clave = m.correlationId ?? `__suelto__:${m.id}`;
    const lista = grupos.get(clave);
    if (lista) lista.push(m);
    else grupos.set(clave, [m]);
  }
  const salida: Conversacion[] = [];
  for (const [clave, lista] of grupos) {
    const ordenados = [...lista].sort(
      (a, b) => new Date(a.enviadoAt).getTime() - new Date(b.enviadoAt).getTime(),
    );
    salida.push({
      clave,
      correlationId: ordenados[0].correlationId,
      mensajes: ordenados,
      ultimo: ordenados[ordenados.length - 1],
    });
  }
  return salida.sort((a, b) => new Date(b.ultimo.enviadoAt).getTime() - new Date(a.ultimo.enviadoAt).getTime());
}

// ============================ Handoff / transferencia ============================

export const ESTADO_TRANSFERENCIA_META: Record<EstadoTransferencia, Meta> = {
  PROPUESTO: { label: 'Propuesto', badge: 'warning' },
  ACEPTADO: { label: 'Aceptado', badge: 'success' },
  RECHAZADO: { label: 'Rechazado', badge: 'danger' },
};

export const estadoTransferenciaMeta = (e: EstadoTransferencia): Meta => ESTADO_TRANSFERENCIA_META[e];

/** Solo una transferencia PROPUESTA se puede aceptar o rechazar (una ya decidida no se duplica, QA11). */
export const puedeDecidirTransferencia = (t: Pick<ContratoTransferencia, 'estado'>): boolean =>
  t.estado === 'PROPUESTO';

/** Ordena los segmentos por su número de secuencia (la cadena quién encargó → aceptó → entregó). */
export function ordenarSegmentos(transferencias: readonly ContratoTransferencia[]): ContratoTransferencia[] {
  return [...transferencias].sort((a, b) => a.secuenciaSegmento - b.secuenciaSegmento);
}

// ============================ Canales ============================

export const TIPO_CANAL_META: Record<TipoCanal, TipoMeta> = {
  MISION: { label: 'Misión', badge: 'primary', icon: 'target' },
  PROCESO: { label: 'Proceso', badge: 'info', icon: 'flow' },
  AREA: { label: 'Área', badge: '', icon: 'building' },
};

export const tipoCanalMeta = (t: TipoCanal): TipoMeta => TIPO_CANAL_META[t];

/** Identificador corto para mostrar referencias blandas sin exponer el id completo. */
export const corto = (id?: string | null): string => (id ? `…${id.slice(-6)}` : '—');
