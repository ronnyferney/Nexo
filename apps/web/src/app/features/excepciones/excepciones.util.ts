/**
 * Lógica pura de la bandeja de excepciones (E7 · RF20/RF21): mapeo de estado/clase/origen/evento a presentación,
 * el estado de conciliación (confirmado vs. incierto), qué acciones admite cada estado y el orden de la bandeja
 * (antigüedad e impacto). Sin Angular ni red: se prueba de forma aislada en `excepciones.util.spec.ts`.
 *
 * El servidor es el gate real (rechaza acciones sobre excepciones cerradas y exige EDITOR+); estas reglas solo
 * guían la UI para no ofrecer acciones imposibles.
 */
import type {
  ClaseFallo,
  EstadoExcepcion,
  Excepcion,
  OrigenExcepcion,
  TipoEventoExcepcion,
} from '../../core/excepciones.models';

export interface Meta {
  label: string;
  /** Clase del design system para `.badge`/`.callout` (success|warning|danger|info|primary|''). */
  cls: string;
}

export const ESTADO_META: Record<EstadoExcepcion, Meta> = {
  ABIERTA: { label: 'Abierta', cls: 'danger' },
  EN_PROGRESO: { label: 'En progreso', cls: 'warning' },
  REASIGNADA: { label: 'Reasignada', cls: 'info' },
  CONCILIADA: { label: 'Conciliada', cls: 'success' },
  RESUELTA: { label: 'Resuelta', cls: 'success' },
  CANCELADA: { label: 'Cancelada', cls: '' },
};

export const CLASE_META: Record<ClaseFallo, Meta & { hint: string }> = {
  TEMPORAL: {
    label: 'Temporal',
    cls: 'warning',
    hint: 'Fallo transitorio; se puede reintentar cuando la operación es segura (idempotente o protegida por clave).',
  },
  PERMANENTE: {
    label: 'Permanente',
    cls: 'danger',
    hint: 'El fallo no se resuelve reintentando; requiere corregir la causa antes de volver a intentarlo.',
  },
  INCIERTO: {
    label: 'Incierto',
    cls: 'danger',
    hint: 'No se sabe si el efecto ocurrió; no se repite a ciegas, hay que conciliar contra el destino (RF20).',
  },
};

export const ORIGEN_META: Record<OrigenExcepcion, Meta & { icon: string; hint: string }> = {
  MOTOR_DURABLE: {
    label: 'Motor durable',
    cls: 'info',
    icon: 'repeat',
    hint: 'Fallo detectado por el motor durable tras agotar los reintentos seguros.',
  },
  ESCRITURA_INCIERTA: {
    label: 'Escritura incierta',
    cls: 'danger',
    icon: 'alert',
    hint: 'Una escritura cuyo resultado no se confirmó: hay que conciliar para saber si el efecto ocurrió.',
  },
  MANUAL: {
    label: 'Manual',
    cls: '',
    icon: 'user',
    hint: 'Excepción abierta manualmente por una persona del equipo.',
  },
};

export const EVENTO_META: Record<TipoEventoExcepcion, Meta & { icon: string }> = {
  CREADA: { label: 'Excepción creada', cls: 'info', icon: 'plus' },
  INFO: { label: 'Información aportada', cls: 'info', icon: 'info' },
  REINTENTO: { label: 'Reintento solicitado', cls: 'warning', icon: 'repeat' },
  REASIGNACION: { label: 'Reasignación', cls: 'info', icon: 'users' },
  CANCELACION: { label: 'Cancelación', cls: 'danger', icon: 'xCircle' },
  CONCILIACION: { label: 'Conciliación', cls: 'success', icon: 'checkCircle' },
};

/** Acciones operativas disponibles sobre una excepción. */
export type AccionExcepcion = 'info' | 'reintentar' | 'reasignar' | 'cancelar' | 'conciliar';

/** Estados en los que la excepción ya no admite info/reintento/reasignación/cancelación (terminales). */
const CERRADAS: readonly EstadoExcepcion[] = ['CANCELADA', 'RESUELTA', 'CONCILIADA'];

/** ¿La excepción está cerrada (no admite acciones generales)? Refleja `CERRADAS` del backend. */
export function isCerrada(estado: EstadoExcepcion): boolean {
  return CERRADAS.includes(estado);
}

/**
 * ¿El estado admite esta acción? Replica las guardas del servicio del backend: las acciones generales se bloquean en
 * estados cerrados; `conciliar` sigue disponible salvo en CANCELADA/RESUELTA (una CONCILIADA puede re-conciliarse).
 */
export function accionDisponible(estado: EstadoExcepcion, accion: AccionExcepcion): boolean {
  if (accion === 'conciliar') return estado !== 'CANCELADA' && estado !== 'RESUELTA';
  return !isCerrada(estado);
}

export type Gate = { ok: true } | { ok: false; mensaje: string };

/** ¿Puede el usuario actual ejecutar esta acción? (estado + permiso EDITOR+). El servidor revalida. */
export function puedeAccion(estado: EstadoExcepcion, accion: AccionExcepcion, canEdit: boolean): Gate {
  if (!canEdit) return { ok: false, mensaje: 'Se necesita rol Editor o superior para actuar sobre la excepción.' };
  if (!accionDisponible(estado, accion)) {
    return { ok: false, mensaje: `La excepción en estado ${ESTADO_META[estado].label} no admite esta acción.` };
  }
  return { ok: true };
}

export interface ConciliacionMeta {
  /** CONFIRMADO: el efecto ocurrió una sola vez. INCIERTO: no se sabe. PENDIENTE: aún sin conciliar. N/A: no aplica. */
  estado: 'CONFIRMADO' | 'INCIERTO' | 'PENDIENTE' | 'NO_APLICA';
  label: string;
  cls: string;
  hint: string;
}

/**
 * Estado de conciliación derivado (RF20): deja claro si el efecto en el destino está confirmado o es incierto.
 * - CONCILIADA → confirmado (el efecto ocurrió una sola vez).
 * - origen ESCRITURA_INCIERTA o clase INCIERTO, aún abierta → incierto: hay que verificar contra el destino.
 * - resto de excepciones abiertas → pendiente de conciliar.
 * - CANCELADA → no aplica (se cerró sin conciliar).
 */
export function conciliacion(exc: Pick<Excepcion, 'estado' | 'origen' | 'clase'>): ConciliacionMeta {
  if (exc.estado === 'CONCILIADA' || exc.estado === 'RESUELTA') {
    return {
      estado: 'CONFIRMADO',
      label: 'Confirmado',
      cls: 'success',
      hint: 'El estado se verificó contra el destino: el efecto ocurrió una sola vez.',
    };
  }
  if (exc.estado === 'CANCELADA') {
    return {
      estado: 'NO_APLICA',
      label: 'Sin conciliar',
      cls: '',
      hint: 'La excepción se canceló sin conciliar.',
    };
  }
  if (exc.origen === 'ESCRITURA_INCIERTA' || exc.clase === 'INCIERTO') {
    return {
      estado: 'INCIERTO',
      label: 'Incierto',
      cls: 'danger',
      hint: 'No se sabe si el efecto ocurrió; concilie verificando el destino antes de reintentar (RF20).',
    };
  }
  return {
    estado: 'PENDIENTE',
    label: 'Pendiente',
    cls: 'warning',
    hint: 'Aún no se ha conciliado el estado en el destino.',
  };
}

/** Antigüedad de la excepción en milisegundos (edad desde su creación). */
export function antiguedadMs(createdAt: string | Date, now: number = Date.now()): number {
  return Math.max(0, now - new Date(createdAt).getTime());
}

/** Peso de severidad por clase para ordenar (INCIERTO es lo más urgente: el efecto es desconocido). */
function pesoClase(clase?: ClaseFallo | null): number {
  switch (clase) {
    case 'INCIERTO':
      return 3;
    case 'PERMANENTE':
      return 2;
    case 'TEMPORAL':
      return 1;
    default:
      return 0;
  }
}

/** Las excepciones abiertas (requieren atención) pesan más que las cerradas en el orden de la bandeja. */
function pesoEstado(estado: EstadoExcepcion): number {
  return isCerrada(estado) ? 0 : 1;
}

/**
 * Orden de la bandeja: primero lo que requiere atención (abiertas), luego por impacto/severidad de clase y, a igualdad,
 * las más antiguas primero (una excepción vieja sin resolver es más urgente). No muta el arreglo de entrada.
 */
export function ordenarBandeja<T extends Pick<Excepcion, 'estado' | 'clase' | 'createdAt'>>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const estado = pesoEstado(b.estado) - pesoEstado(a.estado);
    if (estado !== 0) return estado;
    const clase = pesoClase(b.clase) - pesoClase(a.clase);
    if (clase !== 0) return clase;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

/** Filtra en cliente por clase y origen (el backend solo filtra por estado/tarea). */
export function filtrarBandeja<T extends Pick<Excepcion, 'clase' | 'origen'>>(
  items: readonly T[],
  filtro: { clase?: ClaseFallo | ''; origen?: OrigenExcepcion | '' },
): T[] {
  return items.filter((i) => {
    if (filtro.clase && i.clase !== filtro.clase) return false;
    if (filtro.origen && i.origen !== filtro.origen) return false;
    return true;
  });
}
