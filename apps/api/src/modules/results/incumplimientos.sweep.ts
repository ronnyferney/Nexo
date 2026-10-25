/** Cómo se cierra un incumplimiento al agotar sus límites (RF31): nunca queda activo indefinidamente. */
export type ResolucionIncumplimiento = 'LIMITE_AGOTADO' | 'PLAZO_VENCIDO';

/** Campos de un incumplimiento relevantes para decidir su cierre (subconjunto puro, sin dependencias de Prisma). */
export interface IncumplimientoLimites {
  resuelto: boolean;
  maxReintentos: number;
  intentos: number;
  maxCiclos: number;
  ciclos: number;
  plazo: Date | null;
}

/**
 * Decide si un incumplimiento abierto debe DECLARARSE (cerrarse por límite) en el instante `now` (RF31). Devuelve el
 * motivo del cierre, o `null` si todavía sigue en recuperación. Lógica pura y determinista (fácil de probar): el
 * trabajo nunca queda "activo para siempre" ocultando un resultado no logrado.
 */
export function decidirCierreIncumplimiento(inc: IncumplimientoLimites, now: Date): ResolucionIncumplimiento | null {
  if (inc.resuelto) return null;
  const reintentosAgotados = inc.maxReintentos > 0 && inc.intentos >= inc.maxReintentos;
  const ciclosAgotados = inc.maxCiclos > 0 && inc.ciclos >= inc.maxCiclos;
  if (reintentosAgotados || ciclosAgotados) return 'LIMITE_AGOTADO';
  if (inc.plazo && now.getTime() > inc.plazo.getTime()) return 'PLAZO_VENCIDO';
  return null;
}
