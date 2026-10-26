import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AuditLog } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { chainHashOf, contentHashOf, GENESIS_HASH } from './audit.hashing';
import type { AuditEntryInput, VerifyChainResult } from './audit.types';

export interface AuditListFilter {
  action?: string;
  targetType?: string;
  targetId?: string;
  desde?: Date;
  hasta?: Date;
  take?: number;
  cursor?: string;
}

/**
 * Auditoría inmutable (E13). Registro append-only y a prueba de manipulación de los hechos de gobierno. El servicio NO
 * expone `update` ni `delete`: solo `append`, `list`, `get` y `verificarCadena`. Cada entrada encadena por hash con la
 * anterior del mismo workspace, de modo que alterar o borrar una fila rompe la cadena de forma detectable.
 *
 * Concurrencia del `seq`: `append` corre en una transacción Prisma y el primer paso es un `INSERT ... ON CONFLICT DO
 * UPDATE ... RETURNING` sobre `AuditCounter` (una fila por workspace). Postgres garantiza que ese upsert es atómico y
 * toma el bloqueo de fila: dos `append` concurrentes del MISMO workspace se serializan (el segundo espera al commit del
 * primero), así el `seq` nunca colisiona y el `prevHash` siempre apunta a la entrada realmente anterior. Se prefiere al
 * `SELECT ... FOR UPDATE` manual porque el upsert crea el contador si no existe sin una carrera en la primera entrada, y
 * a `Serializable` porque evita los reintentos por error de serialización bajo alta concurrencia.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Registra un hecho de gobierno de forma inmutable y encadenada. Transaccional: el `seq` no colisiona. */
  async append(workspaceId: string, entrada: AuditEntryInput): Promise<AuditLog> {
    return this.prisma.$transaction(async (tx) => {
      // Incremento atómico del contador por workspace. ON CONFLICT serializa los appends concurrentes del workspace.
      const rows = await tx.$queryRaw<{ seq: number }[]>`
        INSERT INTO "AuditCounter" ("workspaceId", "seq", "updatedAt")
        VALUES (${workspaceId}, 1, now())
        ON CONFLICT ("workspaceId") DO UPDATE SET "seq" = "AuditCounter"."seq" + 1, "updatedAt" = now()
        RETURNING "seq"`;
      const seq = Number(rows[0].seq);

      // `prevHash` = hash de la entrada inmediatamente anterior (o GENESIS en la primera). El bloqueo del contador
      // garantiza que ninguna otra entrada de este workspace se intercale entre esta lectura y la inserción.
      const prev =
        seq > 1 ? await tx.auditLog.findUnique({ where: { workspaceId_seq: { workspaceId, seq: seq - 1 } } }) : null;
      const prevHash = prev?.hash ?? GENESIS_HASH;

      const createdAt = new Date();
      const metadata = entrada.metadata ?? {};
      const contentHash = contentHashOf({
        workspaceId,
        seq,
        createdAt: createdAt.toISOString(),
        actorType: entrada.actorType,
        actorId: entrada.actorId ?? null,
        action: entrada.action,
        targetType: entrada.targetType ?? null,
        targetId: entrada.targetId ?? null,
        resumen: entrada.resumen,
        metadata,
      });
      const hash = chainHashOf(contentHash, prevHash, seq);

      return tx.auditLog.create({
        data: {
          workspaceId,
          seq,
          createdAt,
          actorType: entrada.actorType,
          actorId: entrada.actorId ?? null,
          action: entrada.action,
          targetType: entrada.targetType ?? null,
          targetId: entrada.targetId ?? null,
          resumen: entrada.resumen,
          metadata: metadata as Prisma.InputJsonValue,
          contentHash,
          prevHash,
          hash,
        },
      });
    });
  }

  /** Lista paginada y filtrable (orden descendente por `seq`). Siempre acotada al workspace. */
  async list(workspaceId: string, filtro: AuditListFilter = {}) {
    const take = Math.min(Math.max(filtro.take ?? 50, 1), 200);
    const where: Prisma.AuditLogWhereInput = {
      workspaceId,
      ...(filtro.action ? { action: filtro.action } : {}),
      ...(filtro.targetType ? { targetType: filtro.targetType } : {}),
      ...(filtro.targetId ? { targetId: filtro.targetId } : {}),
      ...(filtro.desde || filtro.hasta
        ? {
            createdAt: {
              ...(filtro.desde ? { gte: filtro.desde } : {}),
              ...(filtro.hasta ? { lte: filtro.hasta } : {}),
            },
          }
        : {}),
    };
    const items = await this.prisma.auditLog.findMany({
      where,
      orderBy: { seq: 'desc' },
      take: take + 1,
      ...(filtro.cursor ? { cursor: { id: filtro.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > take;
    return { items: hasMore ? items.slice(0, take) : items, nextCursor: hasMore ? items[take - 1].id : null };
  }

  async get(workspaceId: string, id: string): Promise<AuditLog> {
    const entry = await this.prisma.auditLog.findFirst({ where: { id, workspaceId } });
    if (!entry) throw new NotFoundException('Entrada de auditoría no encontrada');
    return entry;
  }

  /**
   * Recorre la cadena del workspace en orden de `seq` y verifica que cada entrada no haya sido alterada
   * (`contentHash`), que su `hash` cuadre y que `prevHash`/`seq` enlacen con la anterior. Devuelve el `seq` de la
   * primera rotura si la hay.
   */
  async verificarCadena(workspaceId: string): Promise<VerifyChainResult> {
    const entries = await this.prisma.auditLog.findMany({ where: { workspaceId }, orderBy: { seq: 'asc' } });
    let prevHash = GENESIS_HASH;
    let expectedSeq = 1;

    for (const e of entries) {
      if (e.seq !== expectedSeq) {
        return { ok: false, total: entries.length, rotaEnSeq: e.seq, motivo: 'SECUENCIA_ROTA' };
      }
      const recomputedContent = contentHashOf({
        workspaceId: e.workspaceId,
        seq: e.seq,
        createdAt: e.createdAt.toISOString(),
        actorType: e.actorType,
        actorId: e.actorId,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        resumen: e.resumen,
        metadata: e.metadata,
      });
      if (recomputedContent !== e.contentHash) {
        return { ok: false, total: entries.length, rotaEnSeq: e.seq, motivo: 'CONTENIDO_ALTERADO' };
      }
      if (e.prevHash !== prevHash || e.hash !== chainHashOf(e.contentHash, e.prevHash, e.seq)) {
        return { ok: false, total: entries.length, rotaEnSeq: e.seq, motivo: 'ENLACE_ROTO' };
      }
      prevHash = e.hash;
      expectedSeq += 1;
    }

    return { ok: true, total: entries.length };
  }
}
