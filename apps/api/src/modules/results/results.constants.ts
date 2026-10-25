import type { EstadoResultado, EstadoTarea } from '@prisma/client';

/** Estados operativos terminales de una tarea (ya no avanza por el flujo normal). */
export const ESTADOS_TAREA_TERMINALES: readonly EstadoTarea[] = ['COMPLETADA', 'FALLIDA_CANCELADA'];

/**
 * Transiciones permitidas del estado OPERATIVO de la tarea (RF08, solicitud §4). Es ortogonal al estado del
 * resultado: una tarea puede estar COMPLETADA como DAG y su resultado seguir PENDIENTE_VALIDACION (y viceversa).
 * El paso a COMPLETADA lleva además la guarda dura de resultado ACEPTADO (se valida en el servicio, no aquí).
 */
export const TRANSICIONES_TAREA: Record<EstadoTarea, readonly EstadoTarea[]> = {
  PENDIENTE: ['EN_EJECUCION', 'BLOQUEADA', 'FALLIDA_CANCELADA'],
  EN_EJECUCION: ['ESPERANDO_APROBACION', 'EN_REVISION', 'BLOQUEADA', 'COMPLETADA', 'FALLIDA_CANCELADA'],
  ESPERANDO_APROBACION: ['EN_EJECUCION', 'EN_REVISION', 'BLOQUEADA', 'COMPLETADA', 'FALLIDA_CANCELADA'],
  BLOQUEADA: ['EN_EJECUCION', 'FALLIDA_CANCELADA'],
  EN_REVISION: ['EN_EJECUCION', 'COMPLETADA', 'BLOQUEADA', 'FALLIDA_CANCELADA'],
  COMPLETADA: [],
  FALLIDA_CANCELADA: [],
};

/**
 * Transiciones de AVANCE del estado del resultado (RF31). La rama terminal `ACEPTADO`/`DEVUELTO_INCUMPLIDO` desde
 * `PENDIENTE_VALIDACION` NO se hace por aquí: la decide la verificación (`ValidacionResultado`, verificador ≠ ejecutor)
 * o el barrido de incumplimientos. `comprometer` es una transición propia (hace el contrato inmutable).
 */
export const TRANSICIONES_RESULTADO: Record<EstadoResultado, readonly EstadoResultado[]> = {
  PROPUESTO: ['COMPROMETIDO'],
  COMPROMETIDO: ['EN_PRODUCCION'],
  EN_PRODUCCION: ['PENDIENTE_VALIDACION'],
  PENDIENTE_VALIDACION: ['EN_PRODUCCION'], // volver a producción para corregir antes de re-presentar
  ACEPTADO: [],
  DEVUELTO_INCUMPLIDO: ['EN_PRODUCCION'], // reabrir para corregir tras una devolución
};

export function puedeTransicionarTarea(desde: EstadoTarea, hacia: EstadoTarea): boolean {
  return TRANSICIONES_TAREA[desde]?.includes(hacia) ?? false;
}

export function puedeTransicionarResultado(desde: EstadoResultado, hacia: EstadoResultado): boolean {
  return TRANSICIONES_RESULTADO[desde]?.includes(hacia) ?? false;
}
