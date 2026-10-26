import { createHash } from 'node:crypto';
import type { ActionContext } from './policy.types';

/**
 * Hashing estable para gobierno de acciones (E6 · ADR 0013). JSON canónico con claves ordenadas de forma recursiva, de
 * modo que el mismo contenido produce siempre el mismo hash sin importar el orden de las claves. No depende de Nest ni
 * Prisma (usa solo `node:crypto`), así el cálculo del hash es puro y testeable.
 */

function canonical(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const v = canonical(obj[key]);
      if (v !== null && v !== undefined) out[key] = v;
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

/** Componentes del `contentHash` de una aprobación (ADR 0013 D3): cambiar cualquiera caduca la aprobación (QA03). */
export interface ContentHashParts {
  tipoAccion: string;
  operacion?: unknown;
  /** Herramienta/canal que ejecutará. */
  herramienta?: string | null;
  /** Versión del agente/plantilla que ejecutará. */
  agentVersionId?: string | null;
  destinatarios?: string[];
  contenido?: unknown;
  adjuntos?: unknown;
  importe?: number | string | null;
  moneda?: string | null;
}

export function contentHash(parts: ContentHashParts): string {
  const destinatarios = [...(parts.destinatarios ?? [])].sort();
  return sha256(
    canonicalize({
      tipoAccion: parts.tipoAccion,
      operacion: parts.operacion ?? null,
      herramienta: parts.herramienta ?? null,
      agentVersionId: parts.agentVersionId ?? null,
      destinatarios,
      contenido: parts.contenido ?? null,
      adjuntos: parts.adjuntos ?? null,
      importe: parts.importe != null ? String(parts.importe) : null,
      moneda: parts.moneda ?? null,
    }),
  );
}

/** Hash del contexto de acción evaluado (se guarda en `DecisionPolitica` para trazar qué se evaluó). */
export function actionContextHash(ctx: ActionContext): string {
  return sha256(
    canonicalize({
      workspaceId: ctx.workspaceId,
      empresaId: ctx.empresaId ?? null,
      orgUnitId: ctx.orgUnitId ?? null,
      agentId: ctx.agentId ?? null,
      userId: ctx.userId ?? null,
      tipoAccion: ctx.tipoAccion,
      conectorId: ctx.conectorId ?? null,
      recurso: ctx.recurso ?? null,
      operacion: ctx.operacion ?? null,
      destinatarios: [...(ctx.destinatarios ?? [])].sort(),
      monto: ctx.monto ?? null,
      moneda: ctx.moneda ?? null,
      clasificacionDato: ctx.clasificacionDato ?? null,
    }),
  );
}
