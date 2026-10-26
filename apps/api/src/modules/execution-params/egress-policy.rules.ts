/**
 * Gobierno de la salida a internet del empleado digital (E8 · corrección Opción A), como reglas PURAS y sin
 * dependencias (fáciles de probar y de reutilizar desde el runtime o los ejecutores de conectores).
 *
 * El control único `salidaInternet` se SEGMENTA en categorías gobernables por separado, para que el nombre describa su
 * alcance real:
 *  - `navegacionWeb`         — navegación/fetch web general (buscar, leer páginas).
 *  - `sistemasAutorizados`   — conexión a conectores/sistemas de negocio explícitamente autorizados (REST/SOAP/GraphQL/MCP).
 *  - (IA) la comunicación con proveedores de IA NO es un toggle de usuario: siempre pasa por el runtime y su gobierno
 *    propio (ADR 0010). No se modela aquí para no confundir el control con un "bloqueo total de internet".
 *
 * CIERRE DE LA ELUSIÓN: la política aplica CON O SIN estación asignada. Un agente sin categoría habilitada no hace el
 * egress correspondiente, tenga o no estación. (Antes, un agente sin estación eludía la política.)
 *
 * INVARIANTE DE SEGURIDAD: estas banderas son gates ADICIONALES, NUNCA un bypass. `true` solo HABILITA; cuando se
 * permite, la llamada saliente DEBE seguir pasando por `HttpClientService` (SSRF, allowlist, timeout, tamaño). Con la
 * categoría en `false`, el egress correspondiente queda bloqueado antes de intentar la llamada.
 */

/** Subconjunto de los parámetros de ejecución de un agente que decide el egress, por categoría. */
export interface ParametrosEgress {
  navegacionWeb: boolean;
  sistemasAutorizados: boolean;
}

/** `true` solo si el agente tiene explícitamente habilitada la conexión a sistemas/conectores de negocio autorizados. */
export function puedeConectarSistemasAutorizados(parametros: ParametrosEgress): boolean {
  return parametros.sistemasAutorizados === true;
}

/** `true` solo si el agente tiene explícitamente habilitada la navegación/fetch web general. */
export function puedeNavegarWeb(parametros: ParametrosEgress): boolean {
  return parametros.navegacionWeb === true;
}
