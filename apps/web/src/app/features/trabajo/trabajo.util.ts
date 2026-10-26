import type {
  ContratoResumen,
  EstadoResultado,
  EstadoResultadoAvance,
  EstadoTarea,
  ModoValidacion,
  Tarea,
  TipoResultado,
  Veredicto,
} from '../../core/results.models';

/** Clase de `.badge` del design system (vacía = neutra). */
export type BadgeClase = '' | 'primary' | 'success' | 'danger' | 'warning' | 'info';

export interface EstadoMeta {
  label: string;
  badge: BadgeClase;
}

// ============================ Mapeo de estados a etiquetas ============================

/** Etiqueta y color del estado OPERATIVO de la tarea (RF08). */
export const ESTADO_TAREA_META: Record<EstadoTarea, EstadoMeta> = {
  PENDIENTE: { label: 'Pendiente', badge: '' },
  EN_EJECUCION: { label: 'En ejecución', badge: 'primary' },
  ESPERANDO_APROBACION: { label: 'Esperando aprobación', badge: 'warning' },
  BLOQUEADA: { label: 'Bloqueada', badge: 'danger' },
  EN_REVISION: { label: 'En revisión', badge: 'info' },
  COMPLETADA: { label: 'Completada', badge: 'success' },
  FALLIDA_CANCELADA: { label: 'Fallida / cancelada', badge: 'danger' },
};

/** Etiqueta y color del estado del RESULTADO verificable (RF29/RF31). */
export const ESTADO_RESULTADO_META: Record<EstadoResultado, EstadoMeta> = {
  PROPUESTO: { label: 'Propuesto', badge: '' },
  COMPROMETIDO: { label: 'Comprometido', badge: 'info' },
  EN_PRODUCCION: { label: 'En producción', badge: 'primary' },
  PENDIENTE_VALIDACION: { label: 'Pendiente de validación', badge: 'warning' },
  ACEPTADO: { label: 'Aceptado', badge: 'success' },
  DEVUELTO_INCUMPLIDO: { label: 'Devuelto / incumplido', badge: 'danger' },
};

export const TIPO_RESULTADO_META: Record<TipoResultado, EstadoMeta> = {
  PRODUCTO_INTERMEDIO: { label: 'Producto intermedio', badge: '' },
  RESULTADO_NEGOCIO: { label: 'Resultado de negocio', badge: 'primary' },
};

export const MODO_VALIDACION_LABEL: Record<ModoValidacion, string> = {
  DETERMINISTA: 'Determinista',
  HUMANA: 'Humana',
  ASISTIDA: 'Asistida',
};

export const VEREDICTO_META: Record<Veredicto, EstadoMeta> = {
  ACEPTA: { label: 'Acepta', badge: 'success' },
  DEVUELVE: { label: 'Devuelve', badge: 'danger' },
};

export const estadoTareaMeta = (e: EstadoTarea): EstadoMeta => ESTADO_TAREA_META[e];
export const estadoResultadoMeta = (e: EstadoResultado): EstadoMeta => ESTADO_RESULTADO_META[e];

// ============================ Resultado: generado vs aceptado (HU15) ============================

/** El resultado está ACEPTADO (verificado por alguien distinto del ejecutor), no solo ejecutado. */
export const resultadoAceptado = (estado?: EstadoResultado | null): boolean => estado === 'ACEPTADO';

/**
 * El resultado ya se GENERÓ (hay un entregable) pero todavía no está aceptado: distinción central de HU15/QA09.
 * Un correo de cobro enviado no cierra el recaudo hasta que la verificación lo acepta.
 */
export const resultadoGeneradoNoAceptado = (estado?: EstadoResultado | null): boolean =>
  estado === 'EN_PRODUCCION' || estado === 'PENDIENTE_VALIDACION';

// ============================ Transiciones permitidas (espejo del backend) ============================

const TRANSICIONES_TAREA: Record<EstadoTarea, readonly EstadoTarea[]> = {
  PENDIENTE: ['EN_EJECUCION', 'BLOQUEADA', 'FALLIDA_CANCELADA'],
  EN_EJECUCION: ['ESPERANDO_APROBACION', 'EN_REVISION', 'BLOQUEADA', 'COMPLETADA', 'FALLIDA_CANCELADA'],
  ESPERANDO_APROBACION: ['EN_EJECUCION', 'EN_REVISION', 'BLOQUEADA', 'COMPLETADA', 'FALLIDA_CANCELADA'],
  BLOQUEADA: ['EN_EJECUCION', 'FALLIDA_CANCELADA'],
  EN_REVISION: ['EN_EJECUCION', 'COMPLETADA', 'BLOQUEADA', 'FALLIDA_CANCELADA'],
  COMPLETADA: [],
  FALLIDA_CANCELADA: [],
};

const TRANSICIONES_RESULTADO: Record<EstadoResultado, readonly EstadoResultado[]> = {
  PROPUESTO: ['COMPROMETIDO'],
  COMPROMETIDO: ['EN_PRODUCCION'],
  EN_PRODUCCION: ['PENDIENTE_VALIDACION'],
  PENDIENTE_VALIDACION: ['EN_PRODUCCION'],
  ACEPTADO: [],
  DEVUELTO_INCUMPLIDO: ['EN_PRODUCCION'],
};

const AVANCES: readonly EstadoResultado[] = ['EN_PRODUCCION', 'PENDIENTE_VALIDACION'];

/** Estados operativos a los que la tarea puede transicionar desde `desde`. */
export function transicionesTarea(desde: EstadoTarea): EstadoTarea[] {
  return [...TRANSICIONES_TAREA[desde]];
}

/** ¿Puede la tarea pasar a COMPLETADA? Exige, además, resultado ACEPTADO (guarda dura HU15/QA09). */
export function puedeCompletarTarea(estado: EstadoTarea, contrato?: ContratoResumen | null): boolean {
  return TRANSICIONES_TAREA[estado].includes('COMPLETADA') && resultadoAceptado(contrato?.estado);
}

/** Estado terminal de una tarea (ya no avanza por el flujo normal). */
export const tareaTerminal = (estado: EstadoTarea): boolean =>
  estado === 'COMPLETADA' || estado === 'FALLIDA_CANCELADA';

/** Estados de AVANCE posibles del resultado (los que ofrece `POST /contratos/:id/avanzar`). */
export function avancesResultado(desde: EstadoResultado): EstadoResultadoAvance[] {
  return TRANSICIONES_RESULTADO[desde].filter((e): e is EstadoResultadoAvance => AVANCES.includes(e));
}

export const puedeComprometer = (estado: EstadoResultado): boolean =>
  TRANSICIONES_RESULTADO[estado].includes('COMPROMETIDO');

/** El contrato solo se edita mientras está PROPUESTO (comprometido es inmutable, RF29). */
export const contratoEditable = (estado: EstadoResultado): boolean => estado === 'PROPUESTO';

/** Se valida (acepta/devuelve) un resultado solo en PENDIENTE_VALIDACION. */
export const puedeValidar = (estado: EstadoResultado): boolean => estado === 'PENDIENTE_VALIDACION';

// ============================ Siguiente paso y urgencia ============================

/**
 * «Siguiente paso» legible de una tarea para «Mi trabajo» (RF24/HU12/§8): combina el estado operativo y el del
 * resultado para decir qué falta hacer ahora. No inventa datos: describe el estado real.
 */
export function siguientePaso(tarea: Pick<Tarea, 'estado' | 'contratoResultado'>): string {
  const contrato = tarea.contratoResultado;
  if (tarea.estado === 'COMPLETADA') return 'Tarea completada';
  if (tarea.estado === 'FALLIDA_CANCELADA') return 'Tarea fallida o cancelada';
  if (tarea.estado === 'BLOQUEADA') return 'Resolver el bloqueo para reanudar';
  if (tarea.estado === 'ESPERANDO_APROBACION') return 'Esperando aprobación';
  if (!contrato) return 'Definir el contrato de resultado';
  switch (contrato.estado) {
    case 'PROPUESTO':
      return 'Comprometer el contrato de resultado';
    case 'COMPROMETIDO':
      return 'Comenzar la producción del resultado';
    case 'EN_PRODUCCION':
      return 'Presentar el resultado para validación';
    case 'PENDIENTE_VALIDACION':
      return 'Verificar y aceptar o devolver el resultado';
    case 'DEVUELTO_INCUMPLIDO':
      return 'Corregir y volver a presentar el resultado';
    case 'ACEPTADO':
      return 'Resultado aceptado: completar la tarea';
  }
}

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

/** ¿La tarea está vencida (fecha límite pasada y no terminal)? */
export function tareaVencida(tarea: Pick<Tarea, 'estado' | 'fechaLimite'>, ahora: number = Date.now()): boolean {
  if (!tarea.fechaLimite || tareaTerminal(tarea.estado)) return false;
  return new Date(tarea.fechaLimite).getTime() < ahora;
}

/**
 * Puntaje de urgencia (menor = más urgente), para ordenar «Mi trabajo». Prioriza, en orden: tareas no terminales
 * sobre terminales, vencidas primero, luego por cercanía de la fecha límite y por prioridad (1 = máxima). Las tareas
 * sin fecha límite caen después de las que la tienen, desempatando por prioridad.
 */
export function urgenciaScore(tarea: Pick<Tarea, 'estado' | 'fechaLimite' | 'prioridad'>, ahora: number = Date.now()): number {
  if (tareaTerminal(tarea.estado)) return Number.MAX_SAFE_INTEGER;
  const prioridad = tarea.prioridad ?? 3;
  if (!tarea.fechaLimite) {
    // Sin fecha: después de cualquier tarea con fecha (base alta), ordenadas por prioridad.
    return 1_000 * DIA_MS + prioridad * HORA_MS;
  }
  const restante = new Date(tarea.fechaLimite).getTime() - ahora;
  // La fecha domina; la prioridad desempata en una ventana pequeña.
  return restante + prioridad * HORA_MS;
}

/** Comparador de urgencia para `Array.prototype.sort` (más urgente primero). */
export function ordenarPorUrgencia<T extends Pick<Tarea, 'estado' | 'fechaLimite' | 'prioridad'>>(
  a: T,
  b: T,
  ahora: number = Date.now(),
): number {
  return urgenciaScore(a, ahora) - urgenciaScore(b, ahora);
}

/**
 * ¿La tarea es «mía»? Lo es si soy el dueño humano (`duenoUserId`) o si su agente ejecutor (`responsableAgentId`)
 * está entre mis agentes. Base de «Mi trabajo» (RF24): mis tareas y las de mis agentes.
 */
export function esMiTarea(
  tarea: Pick<Tarea, 'duenoUserId' | 'responsableAgentId'>,
  userId: string | null | undefined,
  misAgentes: ReadonlySet<string> | readonly string[],
): boolean {
  if (userId && tarea.duenoUserId === userId) return true;
  if (!tarea.responsableAgentId) return false;
  const set = misAgentes instanceof Set ? misAgentes : new Set(misAgentes);
  return set.has(tarea.responsableAgentId);
}

export const PRIORIDAD_LABEL: Record<number, string> = {
  1: 'Máxima',
  2: 'Alta',
  3: 'Media',
  4: 'Baja',
  5: 'Mínima',
};

/** Clase de badge para la prioridad (1–2 destaca). */
export function prioridadBadge(prioridad: number): BadgeClase {
  if (prioridad <= 1) return 'danger';
  if (prioridad === 2) return 'warning';
  return '';
}
