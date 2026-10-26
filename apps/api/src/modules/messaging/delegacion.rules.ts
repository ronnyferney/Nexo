/**
 * Control de delegación (RF10) — reglas PURAS y deterministas, sin dependencias de Nest/Prisma/Redis (como el motor de
 * flujos). Deciden si una delegación/handoff/asignación puede proceder: límites de profundidad, concurrencia y nº de
 * pasos por proceso, detección de ciclos, y las reglas duras de la plataforma: «un agente no crea agentes productivos,
 * ni aprueba su propia excepción, ni amplía su presupuesto por instrucción generada». Al alcanzar un límite el trabajo
 * se DETIENE (se escala en la capa de aplicación); estas funciones solo deciden, no ejecutan efectos.
 */

/** Límites de delegación por proceso (configurables por empresa; aquí van valores conservadores por defecto). */
export interface LimitesDelegacion {
  /** Profundidad máxima de la cadena `parentTareaId` (RF10). */
  maxProfundidad: number;
  /** Nº máximo de subtareas/segmentos activos simultáneos por padre (concurrencia). */
  maxConcurrencia: number;
  /** Nº máximo de pasos/intercambios por proceso (misión/correlación) antes de escalar. */
  maxPasos: number;
}

export const LIMITES_DELEGACION_DEFECTO: LimitesDelegacion = {
  maxProfundidad: 5,
  maxConcurrencia: 10,
  maxPasos: 50,
};

/** Motivo auditable por el que una delegación se detiene (código, nunca razonamiento de un modelo). */
export type MotivoBloqueoDelegacion =
  | 'PROFUNDIDAD_EXCEDIDA'
  | 'CICLO_DETECTADO'
  | 'CONCURRENCIA_EXCEDIDA'
  | 'PASOS_EXCEDIDOS'
  | 'AGENTE_NO_CREA_AGENTES'
  | 'NO_AUTOAPROBACION'
  | 'NO_AMPLIA_PRESUPUESTO';

export interface SolicitudDelegacion {
  /** Profundidad de la tarea/segmento padre (la nueva será +1). */
  profundidadPadre: number;
  /** Agentes de la cadena ascendente (del padre hacia la raíz), para detectar ciclos. */
  cadenaAgentes: readonly string[];
  /** Agente (o receptor) al que se delega; si ya está en la cadena hay ciclo. */
  nuevoAgenteId?: string | null;
  /** Subtareas/segmentos activos del padre en este instante. */
  concurrenciaActual: number;
  /** Intercambios/pasos ya realizados en el proceso (misión/correlación). */
  pasosActuales: number;
}

export interface ResultadoDelegacion {
  permitido: boolean;
  motivo?: MotivoBloqueoDelegacion;
  /** Profundidad que tendría la nueva tarea/segmento (padre + 1). */
  profundidadResultante: number;
}

/**
 * Decide si una delegación puede proceder bajo los límites dados. Orden de comprobación estable para un motivo
 * determinista. No hay efectos: devuelve `permitido=false` + `motivo` para que la aplicación detenga y escale (QA10).
 */
export function evaluarDelegacion(sol: SolicitudDelegacion, limites: LimitesDelegacion): ResultadoDelegacion {
  const profundidadResultante = sol.profundidadPadre + 1;
  if (profundidadResultante > limites.maxProfundidad) {
    return { permitido: false, motivo: 'PROFUNDIDAD_EXCEDIDA', profundidadResultante };
  }
  if (sol.nuevoAgenteId && sol.cadenaAgentes.includes(sol.nuevoAgenteId)) {
    return { permitido: false, motivo: 'CICLO_DETECTADO', profundidadResultante };
  }
  if (sol.concurrenciaActual >= limites.maxConcurrencia) {
    return { permitido: false, motivo: 'CONCURRENCIA_EXCEDIDA', profundidadResultante };
  }
  if (sol.pasosActuales >= limites.maxPasos) {
    return { permitido: false, motivo: 'PASOS_EXCEDIDOS', profundidadResultante };
  }
  return { permitido: true, profundidadResultante };
}

/**
 * Reglas duras (RF10, ADR 0010 D7): un `permisos`/instrucción generada por un agente NUNCA puede crear agentes
 * productivos, autoaprobar una excepción propia ni ampliar su presupuesto. Devuelve el motivo si el objeto pretende
 * alguna de esas cosas, o `null` si es inocuo. Pura y testeable; la aplicación rechaza y audita (no amplía atribuciones).
 */
export function detectarAmpliacionAtribuciones(permisos: unknown): MotivoBloqueoDelegacion | null {
  if (typeof permisos !== 'object' || permisos === null) return null;
  const p = permisos as Record<string, unknown>;
  const verdadero = (...claves: string[]) => claves.some((k) => p[k] === true);
  if (verdadero('crearAgentes', 'createAgents', 'spawnAgents')) return 'AGENTE_NO_CREA_AGENTES';
  if (verdadero('autoAprobar', 'selfApprove', 'aprobarPropiaExcepcion')) return 'NO_AUTOAPROBACION';
  if (
    verdadero('ampliarPresupuesto', 'expandBudget', 'increaseBudget') ||
    (typeof p.presupuestoExtraUsd === 'number' && p.presupuestoExtraUsd > 0) ||
    (typeof p.budgetDeltaUsd === 'number' && p.budgetDeltaUsd > 0)
  ) {
    return 'NO_AMPLIA_PRESUPUESTO';
  }
  return null;
}
