/**
 * Cronómetro de la latencia de un turno del modelo (ADR 0017 Inc.3). Puro y determinista (el instante se puede
 * inyectar para las pruebas). Se marca justo antes de la llamada al proveedor (`beforeTurn`, tras el control de
 * presupuesto) y se lee al recibir el consumo (`onUsage`): la diferencia es la latencia del turno, que se registra
 * junto al costo en `UsageRecord`. No cambia la respuesta ni la latencia percibida: solo mide.
 */
export class TurnClock {
  private start: number;

  constructor(now: number = Date.now()) {
    this.start = now;
  }

  /** Marca el inicio del turno (idealmente tras el control de presupuesto, para medir solo la llamada al modelo). */
  mark(now: number = Date.now()): void {
    this.start = now;
  }

  /** Latencia transcurrida desde la última marca, en milisegundos (nunca negativa). */
  elapsedMs(now: number = Date.now()): number {
    return Math.max(0, now - this.start);
  }
}
