import { createHash } from 'node:crypto';

/**
 * Hashing determinista de la auditoría inmutable (E13). JSON canónico con claves ordenadas de forma recursiva, de modo
 * que el mismo contenido produce siempre el mismo hash sin importar el orden de inserción de las claves. No depende de
 * Nest ni Prisma (usa solo `node:crypto`): el cálculo es puro y testeable, y NUNCA usa `eval`/`new Function`.
 */

/** Primer `prevHash` de la cadena (no hay entrada anterior): 64 ceros hex. */
export const GENESIS_HASH = '0'.repeat(64);

function canonical(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = canonical(obj[key]);
    }
    return out;
  }
  return value;
}

export function canonicalize(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Campos que entran en el `contentHash` de una entrada de auditoría. Deben ser reproducibles desde la fila guardada. */
export interface AuditContent {
  workspaceId: string;
  seq: number;
  createdAt: string;
  actorType: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  resumen: string;
  metadata: unknown;
}

/** sha256 del contenido canónico: cambiar cualquier campo de la entrada cambia este hash. */
export function contentHashOf(content: AuditContent): string {
  return sha256(
    canonicalize({
      workspaceId: content.workspaceId,
      seq: content.seq,
      createdAt: content.createdAt,
      actorType: content.actorType,
      actorId: content.actorId ?? null,
      action: content.action,
      targetType: content.targetType ?? null,
      targetId: content.targetId ?? null,
      resumen: content.resumen,
      metadata: content.metadata ?? {},
    }),
  );
}

/** Eslabón de la cadena: enlaza el contenido con la entrada anterior y la posición. */
export function chainHashOf(contentHash: string, prevHash: string, seq: number): string {
  return sha256(`${contentHash}|${prevHash}|${seq}`);
}
