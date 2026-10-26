import { ConflictException } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';

interface Row {
  id: string;
  workspaceId: string;
  clave: string;
  scope: string;
  estado: 'EN_PROGRESO' | 'COMPLETADA' | 'FALLIDA';
  resultado: unknown;
  hash: string | null;
  expiresAt: Date | null;
}

/** Prisma en memoria del modelo IdempotencyKey, respetando el unique (workspaceId, clave). */
function fakePrisma() {
  const rows = new Map<string, Row>();
  const key = (w: string, c: string) => `${w}::${c}`;
  let seq = 0;
  return {
    rows,
    idempotencyKey: {
      findUnique: jest.fn(
        async ({ where }: { where: { workspaceId_clave: { workspaceId: string; clave: string } } }) => {
          const { workspaceId, clave } = where.workspaceId_clave;
          return rows.get(key(workspaceId, clave)) ?? null;
        },
      ),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { workspaceId_clave: { workspaceId: string; clave: string } };
          create: Partial<Row>;
          update: Partial<Row>;
        }) => {
          const { workspaceId, clave } = where.workspaceId_clave;
          const k = key(workspaceId, clave);
          const existing = rows.get(k);
          if (existing) {
            const merged = { ...existing, ...update };
            rows.set(k, merged);
            return merged;
          }
          const row: Row = {
            id: `idem-${++seq}`,
            workspaceId,
            clave,
            scope: '',
            estado: 'EN_PROGRESO',
            resultado: null,
            hash: null,
            expiresAt: null,
            ...create,
          };
          rows.set(k, row);
          return row;
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { workspaceId_clave: { workspaceId: string; clave: string } };
          data: Partial<Row>;
        }) => {
          const { workspaceId, clave } = where.workspaceId_clave;
          const k = key(workspaceId, clave);
          const existing = rows.get(k);
          if (!existing) throw new Error('no existe');
          const merged = { ...existing, ...data };
          rows.set(k, merged);
          return merged;
        },
      ),
    },
  };
}

describe('IdempotencyService.withIdempotency (RF17/QA04)', () => {
  it('ejecuta el efecto una sola vez y devuelve el resultado previo ante una repetición', async () => {
    const prisma = fakePrisma();
    const service = new IdempotencyService(prisma as never);
    const efecto = jest.fn().mockResolvedValue({ status: 'CONFIRMADO', providerRef: 'msg-1' });

    const r1 = await service.withIdempotency('w1', 'clave-1', 'EMAIL_SEND', efecto);
    expect(r1.reusado).toBe(false);
    expect(efecto).toHaveBeenCalledTimes(1);

    // Misma clave: NO re-ejecuta el efecto; devuelve el resultado previo (QA04).
    const r2 = await service.withIdempotency('w1', 'clave-1', 'EMAIL_SEND', efecto);
    expect(r2.reusado).toBe(true);
    expect(r2.resultado).toEqual({ status: 'CONFIRMADO', providerRef: 'msg-1' });
    expect(efecto).toHaveBeenCalledTimes(1);
  });

  it('aísla por workspace: la misma clave en otro workspace sí ejecuta', async () => {
    const prisma = fakePrisma();
    const service = new IdempotencyService(prisma as never);
    const efecto = jest.fn().mockResolvedValue('ok');
    await service.withIdempotency('w1', 'k', 's', efecto);
    await service.withIdempotency('w2', 'k', 's', efecto);
    expect(efecto).toHaveBeenCalledTimes(2);
  });

  it('marca FALLIDA y re-lanza si el efecto falla, permitiendo un reintento posterior', async () => {
    const prisma = fakePrisma();
    const service = new IdempotencyService(prisma as never);
    const efecto = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');

    await expect(service.withIdempotency('w1', 'k', 's', efecto)).rejects.toThrow('boom');
    // La clave quedó FALLIDA: un reintento vuelve a ejecutar (no quedó bloqueada).
    const r = await service.withIdempotency('w1', 'k', 's', efecto);
    expect(r.reusado).toBe(false);
    expect(efecto).toHaveBeenCalledTimes(2);
  });

  it('rechaza una ejecución concurrente mientras otra está EN_PROGRESO', async () => {
    const prisma = fakePrisma();
    const service = new IdempotencyService(prisma as never);
    let resolver: (v: unknown) => void = () => undefined;
    const efecto = jest.fn().mockImplementation(() => new Promise((res) => (resolver = res)));

    const p1 = service.withIdempotency('w1', 'k', 's', efecto);
    await Promise.resolve();
    await expect(service.withIdempotency('w1', 'k', 's', efecto)).rejects.toBeInstanceOf(ConflictException);
    resolver('ok');
    await p1;
  });
});
