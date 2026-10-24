import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PrivacySettingsService } from './privacy-settings.service';

type Row = {
  dataGuardMode: 'OFF' | 'MASK' | 'BLOCK';
  conversationRetentionDays: number | null;
  privacySettingsUpdatedAt: Date | null;
};

function fakeConfig(retentionDays: number | null = 90): ConfigService {
  return {
    get: (key: string) => (key === 'conversations.retentionDays' ? retentionDays : undefined),
    getOrThrow: () => ({ host: 'localhost', port: 6379 }),
  } as unknown as ConfigService;
}

/** Prisma en memoria con solo lo que usa el servicio. */
function fakePrisma(rows: Record<string, Row>) {
  const workspace = {
    findUnique: jest.fn(({ where }: { where: { id: string } }) => Promise.resolve(rows[where.id] ?? null)),
    findMany: jest.fn(() =>
      Promise.resolve(
        Object.entries(rows)
          .filter(([, r]) => r.privacySettingsUpdatedAt)
          .map(([id, r]) => ({ id, ...r })),
      ),
    ),
    update: jest.fn(({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      rows[where.id] = { ...rows[where.id], ...data };
      return Promise.resolve(rows[where.id]);
    }),
    updateMany: jest.fn(
      ({ where, data }: { where: { id: string; privacySettingsUpdatedAt?: null }; data: Partial<Row> }) => {
        const row = rows[where.id];
        if (!row || (where.privacySettingsUpdatedAt === null && row.privacySettingsUpdatedAt)) {
          return Promise.resolve({ count: 0 });
        }
        rows[where.id] = { ...row, ...data };
        return Promise.resolve({ count: 1 });
      },
    ),
  };
  return { workspace } as unknown as PrismaService & { workspace: typeof workspace };
}

/** Hash de Redis en memoria. */
function fakeRedis(hash: Record<string, string>) {
  return {
    hgetall: jest.fn(() => Promise.resolve({ ...hash })),
    hdel: jest.fn((_key: string, ...fields: string[]) => {
      for (const f of fields) delete hash[f];
      return Promise.resolve(fields.length);
    }),
    disconnect: jest.fn(),
  };
}

class TestService extends PrivacySettingsService {
  constructor(
    prisma: PrismaService,
    private readonly redisStub: ReturnType<typeof fakeRedis>,
    config = fakeConfig(),
  ) {
    super(prisma, config);
  }
  protected openLegacyRedis(): Redis {
    return this.redisStub as unknown as Redis;
  }
}

const empty = (): Row => ({ dataGuardMode: 'MASK', conversationRetentionDays: null, privacySettingsUpdatedAt: null });

describe('PrivacySettingsService (PostgreSQL)', () => {
  it('sin ajustes guardados aplica los valores de la plataforma', async () => {
    const svc = new TestService(fakePrisma({ ws1: empty() }), fakeRedis({}));
    await expect(svc.get('ws1')).resolves.toEqual({
      dataGuardMode: 'mask',
      conversationRetentionDays: 90,
      isDefault: true,
    });
    await expect(svc.all()).resolves.toEqual(new Map());
  });

  it('si la BD falla al leer, conserva el modo seguro «mask» y la purga se omite (all lanza)', async () => {
    const prisma = fakePrisma({});
    prisma.workspace.findUnique.mockRejectedValue(new Error('conexión rechazada'));
    prisma.workspace.findMany.mockRejectedValue(new Error('conexión rechazada'));
    const svc = new TestService(prisma, fakeRedis({}));
    await expect(svc.get('ws1')).resolves.toMatchObject({ dataGuardMode: 'mask', isDefault: true });
    await expect(svc.all()).rejects.toThrow('conexión rechazada');
  });

  it('si la BD falla al guardar responde 503', async () => {
    const prisma = fakePrisma({ ws1: empty() });
    prisma.workspace.update.mockRejectedValue(new Error('timeout'));
    const svc = new TestService(prisma, fakeRedis({}));
    await expect(svc.update('ws1', { dataGuardMode: 'off' })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('el primer guardado fija la retención por defecto; los siguientes conservan los campos ausentes', async () => {
    const rows = { ws1: empty() };
    const svc = new TestService(fakePrisma(rows), fakeRedis({}));
    await expect(svc.update('ws1', { dataGuardMode: 'block' })).resolves.toEqual({
      dataGuardMode: 'block',
      conversationRetentionDays: 90,
      isDefault: false,
    });
    expect(rows.ws1.dataGuardMode).toBe('BLOCK');
    await svc.update('ws1', { conversationRetentionDays: null });
    await expect(svc.get('ws1')).resolves.toEqual({
      dataGuardMode: 'block',
      conversationRetentionDays: null,
      isDefault: false,
    });
    await expect(svc.all()).resolves.toEqual(
      new Map([['ws1', { dataGuardMode: 'block', conversationRetentionDays: null }]]),
    );
    await svc.reset('ws1');
    await expect(svc.get('ws1')).resolves.toMatchObject({ isDefault: true, dataGuardMode: 'mask' });
  });

  describe('migración única desde Redis', () => {
    it('copia los ajustes, no pisa los ya guardados en BD, descarta lo ilegible y vacía el hash', async () => {
      const savedAt = new Date('2026-10-01T00:00:00Z');
      const rows: Record<string, Row> = {
        a: empty(),
        b: { dataGuardMode: 'OFF', conversationRetentionDays: 5, privacySettingsUpdatedAt: savedAt },
      };
      const hash = {
        a: JSON.stringify({ mode: 'block', retentionDays: 30, updatedAt: '2026-09-01T10:00:00.000Z', updatedBy: 'u' }),
        b: JSON.stringify({ mode: 'mask', retentionDays: 99, updatedAt: '2026-09-01T10:00:00.000Z' }),
        borrado: JSON.stringify({ mode: 'off', retentionDays: null, updatedAt: '' }),
        roto: '{no-json',
      };
      const redis = fakeRedis(hash);
      const svc = new TestService(fakePrisma(rows), redis);

      await expect(svc.migrateLegacyRedisSettings()).resolves.toEqual({ migrated: 1, skipped: 3, failed: 0 });
      expect(rows.a).toEqual({
        dataGuardMode: 'BLOCK',
        conversationRetentionDays: 30,
        privacySettingsUpdatedAt: new Date('2026-09-01T10:00:00.000Z'),
      });
      expect(rows.b).toEqual({ dataGuardMode: 'OFF', conversationRetentionDays: 5, privacySettingsUpdatedAt: savedAt });
      expect(hash).toEqual({});
      expect(redis.disconnect).toHaveBeenCalled();

      // Idempotente: un segundo arranque no encuentra nada que migrar.
      await expect(svc.migrateLegacyRedisSettings()).resolves.toEqual({ migrated: 0, skipped: 0, failed: 0 });
    });

    it('conserva en Redis las entradas que la BD no pudo guardar', async () => {
      const prisma = fakePrisma({ a: empty() });
      prisma.workspace.updateMany.mockRejectedValueOnce(new Error('BD caída'));
      const hash = { a: JSON.stringify({ mode: 'off', retentionDays: 7, updatedAt: 'x' }) };
      const svc = new TestService(prisma, fakeRedis(hash));
      await expect(svc.migrateLegacyRedisSettings()).resolves.toEqual({ migrated: 0, skipped: 0, failed: 1 });
      expect(Object.keys(hash)).toEqual(['a']);
      await expect(svc.migrateLegacyRedisSettings()).resolves.toEqual({ migrated: 1, skipped: 0, failed: 0 });
      expect(hash).toEqual({});
    });

    it('si Redis no responde, el arranque continúa', async () => {
      const redis = fakeRedis({});
      redis.hgetall.mockRejectedValue(new Error('ECONNREFUSED'));
      const svc = new TestService(fakePrisma({}), redis);
      await expect(svc.onModuleInit()).resolves.toBeUndefined();
      expect(redis.disconnect).toHaveBeenCalled();
    });
  });
});
