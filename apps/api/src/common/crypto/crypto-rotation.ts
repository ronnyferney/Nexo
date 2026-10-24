import type { PrismaClient } from '@prisma/client';
import { CipherContexts, type CipherContext } from './cipher-context';
import type { CryptoService } from './crypto.service';

/**
 * Rotación de claves de cifrado (auditoría B7, `npm run crypto:rotate`). Recorre por lotes cada campo cifrado, y cada
 * valor en formato legacy o con una clave distinta de la activa lo descifra con su contexto y lo vuelve a cifrar con la
 * clave activa (formato v2 + AAD).
 *
 * - **Idempotente:** solo toca los valores que no empiezan por `v2:<kid activo>:`; repetirla no cambia nada.
 * - **Segura con la API en marcha:** cada fila se actualiza con `updateMany` condicionado al texto cifrado leído; si la
 *   API la reescribió entretanto (renovación de un token), la rotación no la pisa (la escritura de la API ya usa la
 *   clave activa).
 * - Un valor que no se puede descifrar se informa (tabla, campo e id, nunca el valor) y se deja como está.
 *
 * Al agregar un campo cifrado nuevo, agréguelo también aquí con el mismo `CipherContext` con el que se cifra.
 */
export interface RotationRow {
  id: string;
  cipher: string;
  context: CipherContext;
}

export interface RotationTarget {
  /** `Modelo.campo`. */
  name: string;
  /** Hasta `take` filas con id > `afterId` (orden por id) cuyo valor no empieza por `activePrefix`. */
  fetch(afterId: string | undefined, take: number, activePrefix: string): Promise<RotationRow[]>;
  /** Reemplaza el valor solo si sigue siendo `from`. Devuelve las filas actualizadas (0 o 1). */
  update(id: string, from: string, to: string): Promise<number>;
}

export interface RotationStats {
  target: string;
  scanned: number;
  rotated: number;
  /** Reescritas por la API durante la rotación (ya usan la clave activa). */
  skipped: number;
  failed: number;
  failedIds: string[];
}

export interface RotationOptions {
  batchSize?: number;
  /** Solo cuenta lo que se rotaría (descifra para verificar, no escribe). */
  dryRun?: boolean;
  log?: (line: string) => void;
}

type Db = Pick<PrismaClient, 'secret' | 'llmConnection' | 'llmAuthFlow' | 'oAuthCredential'>;

const page = (take: number) => ({ orderBy: { id: 'asc' as const }, take });
const after = (afterId: string | undefined) => (afterId ? { id: { gt: afterId } } : {});

/**
 * Campos cifrados de la base de datos con el contexto (AAD) de cada fila. `workspaceId` limita la rotación a un
 * workspace (pruebas o rotación gradual); sin él, recorre todos.
 */
export function rotationTargets(db: Db, opts: { workspaceId?: string } = {}): RotationTarget[] {
  const ws = opts.workspaceId ? { workspaceId: opts.workspaceId } : {};
  const connectorWs = opts.workspaceId ? { connector: { workspaceId: opts.workspaceId } } : {};
  return [
    {
      name: 'Secret.ciphertext',
      fetch: async (afterId, take, prefix) => {
        const rows = await db.secret.findMany({
          ...page(take),
          where: { ...after(afterId), ...ws, NOT: { ciphertext: { startsWith: prefix } } },
          select: { id: true, workspaceId: true, name: true, ciphertext: true },
        });
        return rows.map((r) => ({
          id: r.id,
          cipher: r.ciphertext,
          context: CipherContexts.secret(r.workspaceId, r.name),
        }));
      },
      update: async (id, from, to) =>
        (await db.secret.updateMany({ where: { id, ciphertext: from }, data: { ciphertext: to } })).count,
    },
    {
      name: 'LlmConnection.apiKeyCipher',
      fetch: async (afterId, take, prefix) => {
        const rows = await db.llmConnection.findMany({
          ...page(take),
          where: {
            ...after(afterId),
            ...ws,
            apiKeyCipher: { not: null },
            NOT: { apiKeyCipher: { startsWith: prefix } },
          },
          select: { id: true, workspaceId: true, apiKeyCipher: true },
        });
        return rows.map((r) => ({
          id: r.id,
          cipher: r.apiKeyCipher!,
          context: CipherContexts.llmApiKey(r.workspaceId),
        }));
      },
      update: async (id, from, to) =>
        (await db.llmConnection.updateMany({ where: { id, apiKeyCipher: from }, data: { apiKeyCipher: to } })).count,
    },
    {
      name: 'LlmConnection.oauthRefreshCipher',
      fetch: async (afterId, take, prefix) => {
        const rows = await db.llmConnection.findMany({
          ...page(take),
          where: {
            ...after(afterId),
            ...ws,
            oauthRefreshCipher: { not: null },
            NOT: { oauthRefreshCipher: { startsWith: prefix } },
          },
          select: { id: true, workspaceId: true, oauthRefreshCipher: true },
        });
        return rows.map((r) => ({
          id: r.id,
          cipher: r.oauthRefreshCipher!,
          context: CipherContexts.llmRefresh(r.workspaceId),
        }));
      },
      update: async (id, from, to) =>
        (
          await db.llmConnection.updateMany({
            where: { id, oauthRefreshCipher: from },
            data: { oauthRefreshCipher: to },
          })
        ).count,
    },
    {
      // Vida corta (≤ 30 min); el contexto depende del estado: código de dispositivo o tokens por confirmar (M1b).
      name: 'LlmAuthFlow.deviceCodeCipher',
      fetch: async (afterId, take, prefix) => {
        const rows = await db.llmAuthFlow.findMany({
          ...page(take),
          where: {
            ...after(afterId),
            ...ws,
            deviceCodeCipher: { not: null },
            NOT: { deviceCodeCipher: { startsWith: prefix } },
          },
          select: { id: true, workspaceId: true, userId: true, status: true, deviceCodeCipher: true },
        });
        return rows.map((r) => ({
          id: r.id,
          cipher: r.deviceCodeCipher!,
          context:
            r.status === 'confirm' || r.status === 'confirming'
              ? CipherContexts.llmPendingTokens(r.workspaceId, r.userId)
              : CipherContexts.llmDeviceCode(r.workspaceId, r.userId),
        }));
      },
      update: async (id, from, to) =>
        (await db.llmAuthFlow.updateMany({ where: { id, deviceCodeCipher: from }, data: { deviceCodeCipher: to } }))
          .count,
    },
    {
      name: 'OAuthCredential.accessTokenCipher',
      fetch: async (afterId, take, prefix) => {
        const rows = await db.oAuthCredential.findMany({
          ...page(take),
          where: { ...after(afterId), ...connectorWs, NOT: { accessTokenCipher: { startsWith: prefix } } },
          select: {
            id: true,
            connectorId: true,
            accessTokenCipher: true,
            connector: { select: { workspaceId: true } },
          },
        });
        return rows.map((r) => ({
          id: r.id,
          cipher: r.accessTokenCipher,
          context: CipherContexts.oauthAccess(r.connector.workspaceId, r.connectorId),
        }));
      },
      update: async (id, from, to) =>
        (
          await db.oAuthCredential.updateMany({
            where: { id, accessTokenCipher: from },
            data: { accessTokenCipher: to },
          })
        ).count,
    },
    {
      name: 'OAuthCredential.refreshTokenCipher',
      fetch: async (afterId, take, prefix) => {
        const rows = await db.oAuthCredential.findMany({
          ...page(take),
          where: {
            ...after(afterId),
            ...connectorWs,
            refreshTokenCipher: { not: null },
            NOT: { refreshTokenCipher: { startsWith: prefix } },
          },
          select: {
            id: true,
            connectorId: true,
            refreshTokenCipher: true,
            connector: { select: { workspaceId: true } },
          },
        });
        return rows.map((r) => ({
          id: r.id,
          cipher: r.refreshTokenCipher!,
          context: CipherContexts.oauthRefresh(r.connector.workspaceId, r.connectorId),
        }));
      },
      update: async (id, from, to) =>
        (
          await db.oAuthCredential.updateMany({
            where: { id, refreshTokenCipher: from },
            data: { refreshTokenCipher: to },
          })
        ).count,
    },
  ];
}

/** Re-cifra con la clave activa todo lo que no la usa. Devuelve estadísticas por campo. */
export async function rotateCiphertexts(
  crypto: CryptoService,
  targets: RotationTarget[],
  opts: RotationOptions = {},
): Promise<RotationStats[]> {
  const batchSize = Math.max(1, Math.min(opts.batchSize ?? 200, 5_000));
  const prefix = `v2:${crypto.currentKid}:`;
  const log = opts.log ?? (() => undefined);
  const all: RotationStats[] = [];
  for (const target of targets) {
    const stats: RotationStats = { target: target.name, scanned: 0, rotated: 0, skipped: 0, failed: 0, failedIds: [] };
    let afterId: string | undefined;
    for (;;) {
      const rows = await target.fetch(afterId, batchSize, prefix);
      if (!rows.length) break;
      for (const row of rows) {
        stats.scanned++;
        let next: string;
        try {
          next = crypto.reencrypt(row.cipher, row.context);
        } catch {
          stats.failed++;
          if (stats.failedIds.length < 100) stats.failedIds.push(row.id);
          continue;
        }
        if (next === row.cipher) continue;
        if (opts.dryRun) {
          stats.rotated++;
          continue;
        }
        if (await target.update(row.id, row.cipher, next)) stats.rotated++;
        else stats.skipped++;
      }
      afterId = rows[rows.length - 1].id;
      if (rows.length < batchSize) break;
    }
    log(
      `${target.name}: ${stats.scanned} pendientes, ${stats.rotated} ${opts.dryRun ? 'por rotar' : 'rotados'}` +
        (stats.skipped ? `, ${stats.skipped} reescritos por la API` : '') +
        (stats.failed ? `, ${stats.failed} sin descifrar (ids: ${stats.failedIds.join(', ')})` : ''),
    );
    all.push(stats);
  }
  return all;
}
