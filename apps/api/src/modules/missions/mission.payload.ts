/**
 * Versionado de la forma JSON de misiones (ADR 0016 · decisión 7 del patrocinador). Módulo PURO (sin Nest/Prisma/Redis):
 * los JSON de `MisionParticipante.alcance` y de `MisionEvento.payload` llevan un campo `schemaVersion` desde el inicio,
 * con **lectura tolerante a versiones** y **upcasting aditivo**. Es la misma disciplina que las definiciones de flujo y
 * `CuadrillaVersion`: nunca se rompe un JSON ya guardado; las versiones viejas se "suben" a la actual al leerse.
 *
 * Reglas:
 *  - Escribir SIEMPRE estampa `schemaVersion = MISION_SCHEMA_VERSION`.
 *  - Leer un JSON sin `schemaVersion` (datos del Incremento 1, previos a este campo) se trata como `v0` y se upcastea.
 *  - El upcasting es ADITIVO: no borra claves desconocidas (compatibilidad hacia adelante) ni exige forma rígida.
 */

/** Versión actual de la forma JSON de misiones. Subir SOLO con una migración de datos/upcasting correspondiente. */
export const MISION_SCHEMA_VERSION = 1 as const;

/** JSON versionado: cualquier objeto con (opcional) `schemaVersion`. */
export type JsonVersionado = Record<string, unknown> & { schemaVersion?: number };

/** Lee la versión declarada de un JSON; un JSON sin campo (o inválido) se considera `v0` (Incremento 1). */
export function versionDe(payload: unknown): number {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const v = (payload as JsonVersionado).schemaVersion;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  }
  return 0;
}

/**
 * Estampa `schemaVersion = MISION_SCHEMA_VERSION` en un objeto JSON a persistir (no muta la entrada). Un valor no-objeto
 * se envuelve en `{ valor, schemaVersion }` para no perder información ni romper la lectura.
 */
export function conSchemaVersion(payload: unknown): JsonVersionado {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return { ...(payload as Record<string, unknown>), schemaVersion: MISION_SCHEMA_VERSION };
  }
  return { valor: payload ?? null, schemaVersion: MISION_SCHEMA_VERSION };
}

/**
 * Upcastea un JSON leído a la versión actual (lectura tolerante). El upcasting es ADITIVO y determinista: por cada salto
 * de versión aplica una transformación conocida. Hoy solo existe `v0 -> v1` (estampar `schemaVersion`); futuras versiones
 * añaden casos sin romper los datos previos. Devuelve siempre un objeto con `schemaVersion = MISION_SCHEMA_VERSION`.
 */
export function upcastPayload(payload: unknown): JsonVersionado {
  const base: Record<string, unknown> =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>) }
      : { valor: payload ?? null };
  let version = versionDe(payload);
  // v0 (sin campo, Incremento 1) -> v1: solo se añade la marca de versión; no se altera ningún dato existente.
  if (version < 1) version = 1;
  return { ...base, schemaVersion: Math.min(version, MISION_SCHEMA_VERSION) };
}
