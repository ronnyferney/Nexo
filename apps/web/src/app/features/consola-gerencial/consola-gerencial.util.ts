import type { ConsolaAuditoria, ConsolaEconomia } from '../../core/consolas.models';

/**
 * Lógica pura de la consola gerencial (E12): decisiones de presentación honestas, sin dependencias de Angular para
 * poder probarse de forma aislada. La regla de oro se hereda del tablero de resultados: no inventar cifras. Un
 * `consolidado` en `null` es «alcance no consolidable» con su causa, nunca un 0; y el sello de integridad refleja
 * literalmente el flag del backend.
 */

const ENTERO = new Intl.NumberFormat('es');

/** Distintivo de integridad de la cadena de auditoría: el sello de confianza para dirección. */
export interface SelloIntegridad {
  /** `true` cadena íntegra, `false` comprometida. */
  integra: boolean;
  label: string;
  /** Clase de badge del design system (`badge success` / `badge danger`). */
  badgeClass: string;
  /** Ícono del mapa de `nx-icon`. */
  icon: string;
}

/**
 * Decide el sello de integridad a partir del flag `cadenaIntegra`. Es una decisión binaria deliberada: la cadena está
 * íntegra o comprometida, sin estados intermedios, porque es el sello de confianza que lee dirección.
 */
export function selloIntegridad(cadenaIntegra: boolean): SelloIntegridad {
  return cadenaIntegra
    ? { integra: true, label: 'Cadena íntegra', badgeClass: 'badge success', icon: 'checkCircle' }
    : { integra: false, label: 'Cadena comprometida', badgeClass: 'badge danger', icon: 'alert' };
}

/**
 * `true` cuando el libro consolidado está disponible para el alcance. Cuando es `false`, la UI debe mostrar la causa/
 * nota del backend (honesto), nunca un total en 0.
 */
export function tieneConsolidado(economia: Pick<ConsolaEconomia, 'consolidado'>): boolean {
  return economia.consolidado !== null;
}

/**
 * Nota a mostrar cuando no hay libro consolidado: prioriza la nota explicativa del backend y, en su defecto, un texto
 * por defecto. Nunca devuelve una cifra.
 */
export function notaSinConsolidado(economia: Pick<ConsolaEconomia, 'consolidadoNota'>): string {
  return (
    economia.consolidadoNota?.trim() ||
    'El libro consolidado solo aplica a un alcance por empresa; para área o agente use el costo atribuible.'
  );
}

/** Enteros con separador de miles en español (hechos de auditoría, conteos de gobierno). */
export function formatEntero(valor: number): string {
  return ENTERO.format(valor);
}

/**
 * Resumen accesible de la auditoría para lectores de pantalla: combina el sello con los conteos del período. No muestra
 * nada que no venga del backend.
 */
export function resumenAuditoria(a: Pick<ConsolaAuditoria, 'cadenaIntegra' | 'hechosEnPeriodo' | 'totalHechos'>): string {
  const sello = selloIntegridad(a.cadenaIntegra).label;
  return `${sello}. ${formatEntero(a.hechosEnPeriodo)} hechos en el período de ${formatEntero(a.totalHechos)} en total.`;
}
