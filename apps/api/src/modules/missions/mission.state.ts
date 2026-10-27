import type { EstadoMision } from '@prisma/client';

/**
 * Máquina de estados PURA de una misión transversal (ADR 0016 D2). Sin dependencias de Nest/Prisma/Redis: es la
 * especificación viva de las transiciones verificables y se prueba de forma aislada en `mission.state.spec.ts`.
 *
 * Ciclo de vida: PROPUESTA -> AUTORIZADA -> EN_CURSO -> EN_VALIDACION -> LOGRADA, con las ramas DETENIDA (bloqueo o
 * suspensión que exige decisión humana) y CANCELADA. LOGRADA y CANCELADA son terminales. Crear/autorizar/detener/
 * cancelar lo hace SIEMPRE un humano con nivel suficiente; el sistema solo observa/propone el avance operativo.
 */

/** Estados terminales: no admiten ninguna transición de salida. */
export const ESTADOS_TERMINALES: readonly EstadoMision[] = ['LOGRADA', 'CANCELADA'];

/** Transiciones permitidas por estado de origen (lista blanca; todo lo demás se rechaza). */
export const TRANSICIONES_MISION: Record<EstadoMision, readonly EstadoMision[]> = {
  PROPUESTA: ['AUTORIZADA', 'CANCELADA'],
  AUTORIZADA: ['EN_CURSO', 'DETENIDA', 'CANCELADA'],
  EN_CURSO: ['EN_VALIDACION', 'DETENIDA', 'CANCELADA'],
  EN_VALIDACION: ['LOGRADA', 'EN_CURSO', 'DETENIDA', 'CANCELADA'],
  // DETENIDA exige decisión humana: se reanuda (AUTORIZADA/EN_CURSO) o se cancela.
  DETENIDA: ['AUTORIZADA', 'EN_CURSO', 'CANCELADA'],
  LOGRADA: [],
  CANCELADA: [],
};

/** ¿Es válida la transición `desde -> hacia` según la máquina de estados? Un no-op (`desde === hacia`) NO es válido. */
export function esTransicionValida(desde: EstadoMision, hacia: EstadoMision): boolean {
  return TRANSICIONES_MISION[desde].includes(hacia);
}

/** ¿El estado es terminal (no admite más cambios)? */
export function esEstadoTerminal(estado: EstadoMision): boolean {
  return ESTADOS_TERMINALES.includes(estado);
}

/**
 * Resumen determinista del trabajo vinculado a la misión, para computar el avance operativo (D2/D3). Todos los
 * contadores salen de `Objetivo`/`Tarea`/`ContratoResultado` existentes (E4); la misión no computa nada en paralelo.
 */
export interface ResumenMision {
  /** Total de tareas vinculadas (directas o vía objetivo). */
  totalTareas: number;
  /** Tareas con algún trabajo en producción (EN_EJECUCION / EN_REVISION / ESPERANDO_APROBACION). */
  tareasEnProduccion: number;
  /** Tareas cuyo resultado ya fue presentado (COMPLETADA o contrato en validación/aceptado). */
  tareasPresentadas: number;
  /** Contratos de RESULTADO_NEGOCIO vinculados. */
  contratosNegocio: number;
  /** Contratos de RESULTADO_NEGOCIO vinculados en estado ACEPTADO (verificador != ejecutor, E4). */
  contratosNegocioAceptados: number;
  /** Nº de bloqueos activos (incumplimiento/excepción abierta o dependencia vencida) en el trabajo vinculado. */
  bloqueos: number;
}

/**
 * Estado operativo DERIVADO (observación) a partir del resumen del trabajo vinculado, respetando el estado base
 * persistido (humano). No muta nada: solo propone el avance que el sistema observa (D2).
 *  - Antes de AUTORIZADA (PROPUESTA) o en estados terminales/DETENIDA: se respeta el estado base.
 *  - AUTORIZADA en adelante: EN_CURSO si hay trabajo en producción; EN_VALIDACION si todo está presentado.
 */
export function estadoOperativoSugerido(base: EstadoMision, r: ResumenMision): EstadoMision {
  if (base === 'PROPUESTA' || base === 'DETENIDA' || esEstadoTerminal(base)) return base;
  if (r.totalTareas > 0 && r.tareasPresentadas === r.totalTareas) return 'EN_VALIDACION';
  if (r.tareasEnProduccion > 0) return 'EN_CURSO';
  return base;
}

/**
 * Condición verificable de LOGRADA (ADR 0016 D2): TODOS los `ContratoResultado` de negocio vinculados están ACEPTADO
 * (con verificador != ejecutor, garantizado por E4) y debe existir al menos uno. Como el indicador de misión no se
 * computa de forma determinista en el Incremento 1, se exige además confirmación humana explícita del dueño: el sistema
 * PROPONE LOGRADA, el humano la confirma (open question D5). Sin contratos de negocio aceptados, nunca se puede lograr.
 */
export function cumpleCondicionLograda(r: ResumenMision, confirmacionHumana: boolean): boolean {
  if (r.contratosNegocio === 0) return false;
  if (r.contratosNegocioAceptados !== r.contratosNegocio) return false;
  return confirmacionHumana === true;
}
