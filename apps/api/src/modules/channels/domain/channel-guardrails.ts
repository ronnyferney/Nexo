/**
 * Guardarraíles de la cuenta de canal (defensa en profundidad, ADR 0015 · diseño de controles de correo §2/§3).
 *
 * Son un SEGUNDO filtro, configurable por empresa en `CanalCuenta.config` (NUNCA secretos), que se evalúa ANTES de
 * invocar al `ActionGateway`. La lista blanca canónica y versionada vive en el motor de políticas E6 (`Politica`); estos
 * guardarraíles son un refuerzo local, no lo sustituyen. Funciones PURAS y SIN red: se prueban de forma aislada.
 *
 * GATED: nacen INERTES. Si la cuenta no define `destinatariosPermitidos`/`maxCuerpoBytes`, no bloquean nada; el servicio
 * solo los aplica a proveedores PRODUCTIVOS (nunca al sandbox `simulado`). No hay dominios ni topes hardcodeados: todo es
 * dato de la cuenta (multiempresa/multisectorial).
 */

/** Guardarraíles leídos de `CanalCuenta.config` (ambos opcionales). */
export interface GuardarrailesCuenta {
  /** Lista blanca de destinatarios permitidos: direcciones exactas o patrones de sufijo `*@dominio` (p. ej. `*@empresa.test`). */
  destinatariosPermitidos?: string[];
  /** Tamaño máximo del cuerpo en bytes (UTF-8). Un cuerpo mayor se bloquea sin salir a la red. */
  maxCuerpoBytes?: number;
}

/** Resultado de evaluar los guardarraíles: `ok=false` lleva un `motivo` auditable (código, nunca texto libre). */
export interface ResultadoGuardarrailes {
  ok: boolean;
  motivo?: 'DESTINATARIO_FUERA_DE_LISTA_BLANCA' | 'CUERPO_EXCEDE_TAMANO_MAXIMO';
}

/**
 * Lee los guardarraíles de un `config` arbitrario de forma defensiva: solo acepta `destinatariosPermitidos` si es un
 * arreglo de cadenas no vacías, y `maxCuerpoBytes` si es un número finito positivo. Cualquier otra forma se ignora (el
 * guardarraíl queda inerte), nunca lanza.
 */
export function leerGuardarrailes(config: Record<string, unknown> | null | undefined): GuardarrailesCuenta {
  const out: GuardarrailesCuenta = {};
  const lista = config?.destinatariosPermitidos;
  if (Array.isArray(lista)) {
    const patrones = lista
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim());
    if (patrones.length > 0) out.destinatariosPermitidos = patrones;
  }
  const max = config?.maxCuerpoBytes;
  if (typeof max === 'number' && Number.isFinite(max) && max > 0) out.maxCuerpoBytes = Math.floor(max);
  return out;
}

/**
 * ¿El destinatario está en la lista blanca? Coincidencia EXACTA (sin distinguir mayúsculas) o por SUFIJO si el patrón
 * empieza por `*` (p. ej. `*@empresa.test` ⇒ cualquier buzón de ese dominio). Mismo criterio que el selector de
 * destinatarios del `PolicyEngine`, para que el refuerzo local sea coherente con la política canónica.
 */
export function destinatarioEnListaBlanca(destino: string, patrones: string[]): boolean {
  const d = destino.trim().toLowerCase();
  return patrones.some((p) => {
    const pat = p.trim().toLowerCase();
    return pat.startsWith('*') ? d.endsWith(pat.slice(1)) : d === pat;
  });
}

/** Tamaño del cuerpo en bytes UTF-8 (el egress lo acota además `HttpClientService`; esto es un corte temprano). */
export function tamanoCuerpoBytes(cuerpo: string): number {
  return Buffer.byteLength(cuerpo, 'utf8');
}

/**
 * Evalúa ambos guardarraíles sobre un envío concreto. Orden: primero la lista blanca (denegación por defecto de lo no
 * listado), luego el tamaño. Sin guardarraíles configurados ⇒ `{ ok: true }` (inerte).
 */
export function evaluarGuardarrailes(destino: string, cuerpo: string, g: GuardarrailesCuenta): ResultadoGuardarrailes {
  if (g.destinatariosPermitidos && !destinatarioEnListaBlanca(destino, g.destinatariosPermitidos)) {
    return { ok: false, motivo: 'DESTINATARIO_FUERA_DE_LISTA_BLANCA' };
  }
  if (g.maxCuerpoBytes != null && tamanoCuerpoBytes(cuerpo) > g.maxCuerpoBytes) {
    return { ok: false, motivo: 'CUERPO_EXCEDE_TAMANO_MAXIMO' };
  }
  return { ok: true };
}
