/**
 * Gobierno de la salida a internet del empleado digital (E8), como reglas PURAS y sin dependencias (fáciles de probar
 * y de reutilizar desde el runtime o los ejecutores de conectores).
 *
 * INVARIANTE DE SEGURIDAD: esta bandera es un gate ADICIONAL, NUNCA un bypass. `salidaInternet = true` solo HABILITA la
 * salida; cuando se permite, la llamada saliente DEBE seguir pasando por `HttpClientService` (SSRF, allowlist, timeout,
 * tamaño). Con `salidaInternet = false` el egress del agente queda bloqueado antes de intentar la llamada.
 */

/** Subconjunto de los parámetros de ejecución de un agente que decide el egress. */
export interface ParametrosEgress {
  salidaInternet: boolean;
}

/** `true` solo si el agente tiene explícitamente habilitada la salida a internet. */
export function puedeSalirAInternet(parametros: ParametrosEgress): boolean {
  return parametros.salidaInternet === true;
}
