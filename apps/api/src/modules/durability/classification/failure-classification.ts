/**
 * Clasificación de fallos y decisión de durabilidad (E7 · RF20). Lógica PURA y determinista, sin dependencias de Nest,
 * Prisma ni Redis: se prueba de forma aislada. El motor de durabilidad solo recibe HECHOS estructurados de la señal de
 * fallo; nada de lo que "diga" un modelo altera la clasificación.
 *
 * Principio (documentado y aplicado): NO se promete exactly-once sobre sistemas externos que no lo garanticen. Un fallo
 * TEMPORAL solo se reintenta cuando la operación es SEGURA (idempotente/lectura o protegida por clave de idempotencia);
 * un fallo INCIERTO —o uno temporal sobre una operación no segura— NO se repite a ciegas: se CONCILIA (se verifica el
 * estado en el destino o se envía a la bandeja de excepciones).
 */

export type ClaseFallo = 'TEMPORAL' | 'PERMANENTE' | 'INCIERTO';

/** Acción de durabilidad que se deriva de la clasificación. */
export type AccionDurabilidad = 'REINTENTAR' | 'NO_REINTENTAR' | 'CONCILIAR';

/** Naturaleza del fallo observado (subconjunto puro, sin acoplarse a una librería de errores concreta). */
export type TipoFallo = 'timeout' | 'red' | 'http' | 'validacion' | 'desconocido';

export interface SenalFallo {
  /** Naturaleza del fallo. */
  tipo?: TipoFallo;
  /** Código HTTP del destino, si lo hubo. */
  httpStatus?: number | null;
  /**
   * Si la operación es SEGURA: idempotente/de lectura, o protegida por una clave de idempotencia que garantiza que un
   * reintento no duplica el efecto. Solo las operaciones seguras se reintentan ante un fallo TEMPORAL.
   */
  operacionSegura?: boolean;
  /**
   * Estado del despacho cuando el efecto SÍ pudo haber salido (p. ej. una escritura cuyo resultado no se confirmó).
   * `INCIERTO` fuerza conciliación: no sabemos si el efecto ocurrió.
   */
  despachoStatus?: 'CONFIRMADO' | 'INCIERTO' | null;
  /** Código auditable del error (opcional, para la evidencia de la excepción). */
  codigo?: string | null;
}

/** Códigos HTTP temporales por convención: el servidor pide reintentar o la petición expiró. */
const HTTP_TEMPORALES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Clasifica un fallo en TEMPORAL / PERMANENTE / INCIERTO (RF20). Reglas puras:
 * - Un despacho marcado `INCIERTO` (la escritura pudo salir) es siempre INCIERTO.
 * - timeout / corte de red: TEMPORAL si la operación es segura (un reintento idempotente no daña); INCIERTO si no lo es
 *   (no sabemos si el efecto llegó al destino).
 * - HTTP 408/425/429/5xx: temporal por convención → TEMPORAL si la operación es segura; INCIERTO si no lo es.
 * - HTTP 4xx restante (400-499): PERMANENTE (la petición es inválida; reintentar no cambia el resultado).
 * - validación local: PERMANENTE.
 * - desconocido / sin señal clara: INCIERTO (conservador; se concilia en vez de reintentar a ciegas).
 */
export function clasificarFallo(senal: SenalFallo): ClaseFallo {
  const segura = senal.operacionSegura === true;

  if (senal.despachoStatus === 'INCIERTO') return 'INCIERTO';
  if (senal.despachoStatus === 'CONFIRMADO') return 'TEMPORAL';

  if (senal.tipo === 'validacion') return 'PERMANENTE';

  if (senal.tipo === 'timeout' || senal.tipo === 'red') {
    return segura ? 'TEMPORAL' : 'INCIERTO';
  }

  const status = senal.httpStatus ?? null;
  if (status != null) {
    if (HTTP_TEMPORALES.has(status)) return segura ? 'TEMPORAL' : 'INCIERTO';
    if (status >= 400 && status < 500) return 'PERMANENTE';
    if (status >= 500) return segura ? 'TEMPORAL' : 'INCIERTO';
  }

  return 'INCIERTO';
}

/**
 * Decide la acción de durabilidad a partir de la clase y de si la operación es segura (RF20):
 * - PERMANENTE → NO_REINTENTAR (va directo a la bandeja de excepciones).
 * - INCIERTO → CONCILIAR (verificar destino o abrir excepción; nunca reintento a ciegas).
 * - TEMPORAL → REINTENTAR solo si la operación es segura; si no, CONCILIAR.
 */
export function decidirAccion(clase: ClaseFallo, operacionSegura: boolean): AccionDurabilidad {
  if (clase === 'PERMANENTE') return 'NO_REINTENTAR';
  if (clase === 'INCIERTO') return 'CONCILIAR';
  return operacionSegura ? 'REINTENTAR' : 'CONCILIAR';
}

/** Conveniencia: clasifica y decide en un solo paso. */
export function evaluarFallo(senal: SenalFallo): { clase: ClaseFallo; accion: AccionDurabilidad } {
  const clase = clasificarFallo(senal);
  return { clase, accion: decidirAccion(clase, senal.operacionSegura === true) };
}
