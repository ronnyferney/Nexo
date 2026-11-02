/**
 * Programación consciente de concurrencia y prioridad de las colas BullMQ (ADR 0017 Inc.3).
 *
 * Módulo **puro** (sin Nest, Prisma ni Redis): define la política de prioridad por urgencia/costo y el contrato de los
 * límites de concurrencia por inquilino. El worker la aplica; aquí solo se decide. Así la política se prueba como
 * funciones puras y no cambia el resultado funcional: solo el **orden** (prioridad) y el **grado de paralelismo**
 * (concurrencia) con que se procesan los trabajos.
 */

/**
 * Clase de urgencia del trabajo encolado. Determina su prioridad BullMQ (menor número = se atiende antes). El criterio
 * es «lo interactivo y barato primero, lo masivo y de mantenimiento después»: un turno de agente disparado por una
 * persona o un webhook no debe quedar detrás de una corrida de evaluación o una limpieza programada.
 */
export type WorkKind = 'interactive' | 'scheduled' | 'batch' | 'maintenance';

/**
 * Prioridad BullMQ por clase de urgencia. BullMQ ordena de 1 (máxima) hacia arriba y, a igual prioridad, respeta el
 * orden de llegada (FIFO). El `0` significa «sin prioridad» y en BullMQ se atiende ANTES que cualquier trabajo
 * priorizado, por eso NUNCA se usa: todos los trabajos llevan una prioridad explícita > 0 para que el orden sea
 * determinista. Hay huecos entre valores para poder intercalar clases nuevas sin renumerar.
 */
export const PRIORITY: Record<WorkKind, number> = {
  interactive: 10,
  scheduled: 20,
  batch: 30,
  maintenance: 40,
};

/** Prioridad BullMQ (entero > 0) para una clase de urgencia. */
export function priorityFor(kind: WorkKind): number {
  return PRIORITY[kind];
}

/**
 * Clase de urgencia a partir del disparador de un flujo. Un flujo lanzado a mano, por webhook, por un agente o por MCP
 * es interactivo (alguien o algo espera la respuesta); el disparo por calendario (`SCHEDULE`) es trabajo programado.
 */
export function workKindForTrigger(trigger: string): WorkKind {
  return trigger === 'SCHEDULE' ? 'scheduled' : 'interactive';
}

/** Configuración de programación de colas resuelta del entorno (defaults conservadores). */
export interface SchedulingConfig {
  /** Trabajos simultáneos por instancia de worker (`WORKER_CONCURRENCY`, por defecto 10). */
  workerConcurrency: number;
  /**
   * Tope de trabajos simultáneos por workspace dentro de una instancia de worker
   * (`WORKER_WORKSPACE_CONCURRENCY`). `0` = sin límite (comportamiento actual): el límite estricto es **opt-in** para
   * no alterar el comportamiento observable salvo que el operador lo active. Con varias instancias, el tope global
   * aproximado es `workerConcurrency` × nº de instancias por workspace.
   */
  perWorkspaceConcurrency: number;
  /**
   * Milisegundos que un trabajo se reencola (diferido) cuando su workspace ya está en el tope, para ceder turno a
   * otros inquilinos (`WORKER_WORKSPACE_DEFER_MS`, por defecto 250). Reintenta la admisión sin bloquear el worker.
   */
  deferMs: number;
}

export const DEFAULT_WORKER_CONCURRENCY = 10;
export const DEFAULT_PER_WORKSPACE_CONCURRENCY = 0;
export const DEFAULT_DEFER_MS = 250;

/** Entero >= `min` o el `fallback` si la variable no está definida o no es válida. */
function intOr(raw: string | undefined, fallback: number, min: number): number {
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isInteger(n) && n >= min ? n : fallback;
}

/** Lee la configuración de programación del entorno con defaults conservadores (sin cambio observable salvo carga). */
export function schedulingConfigFrom(env: NodeJS.ProcessEnv): SchedulingConfig {
  return {
    workerConcurrency: intOr(env.WORKER_CONCURRENCY, DEFAULT_WORKER_CONCURRENCY, 1),
    perWorkspaceConcurrency: intOr(env.WORKER_WORKSPACE_CONCURRENCY, DEFAULT_PER_WORKSPACE_CONCURRENCY, 0),
    deferMs: intOr(env.WORKER_WORKSPACE_DEFER_MS, DEFAULT_DEFER_MS, 1),
  };
}

/**
 * Semáforo en memoria por clave (p. ej. `workspaceId`): limita cuántos trabajos de una misma clave corren a la vez en
 * una instancia de worker, para que un inquilino no acapare el paralelismo. Vive por proceso; con varias instancias
 * cada una aplica su propio tope (aislamiento aproximado, documentado). Un límite `<= 0` deshabilita el gate: siempre
 * admite (comportamiento actual). Es puro y síncrono: `tryAcquire` decide y reserva, `release` libera.
 */
export class ConcurrencyGate {
  private readonly inFlight = new Map<string, number>();

  constructor(private readonly limitFor: (key: string) => number) {}

  /** Reserva un hueco para la clave si hay cupo. Devuelve `false` si ya está en el tope (el llamador debe diferir). */
  tryAcquire(key: string): boolean {
    const limit = this.limitFor(key);
    if (limit <= 0) return true;
    const n = this.inFlight.get(key) ?? 0;
    if (n >= limit) return false;
    this.inFlight.set(key, n + 1);
    return true;
  }

  /** Libera un hueco de la clave. Idempotente hasta cero: nunca baja de cero. */
  release(key: string): void {
    const n = this.inFlight.get(key) ?? 0;
    if (n <= 1) this.inFlight.delete(key);
    else this.inFlight.set(key, n - 1);
  }

  /** Trabajos en curso de la clave (para diagnóstico/pruebas). */
  current(key: string): number {
    return this.inFlight.get(key) ?? 0;
  }
}
