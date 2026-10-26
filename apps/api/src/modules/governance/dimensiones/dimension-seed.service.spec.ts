import { Prisma } from '@prisma/client';
import { DIMENSIONES_SISTEMA, DimensionSeedService } from './dimension-seed.service';

/**
 * Rendimiento #1/#3: el arranque no barre en serie los workspaces (una consulta de diferencia + un `createMany`
 * idempotente) y `ensureForWorkspace` no repite el SELECT una vez que el workspace ya quedó sembrado (caché
 * process-local). La idempotencia se preserva (P2002 se ignora).
 */
describe('DimensionSeedService · siembra sin barrido en serie y caché', () => {
  function build(opts: { existentes?: { codigo: string }[] } = {}) {
    const createMany = jest
      .fn<Promise<{ count: number }>, [{ skipDuplicates: boolean; data: unknown[] }]>()
      .mockResolvedValue({ count: 0 });
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      dimension: {
        findMany: jest.fn().mockResolvedValue(opts.existentes ?? []),
        create: jest.fn().mockResolvedValue({}),
        createMany,
      },
    };
    return { service: new DimensionSeedService(prisma as never), prisma, createMany };
  }

  it('bootstrap: una sola consulta de diferencia; sin pendientes no inserta nada', async () => {
    const { service, prisma } = build();
    await service.onApplicationBootstrap();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.dimension.createMany).not.toHaveBeenCalled();
  });

  it('bootstrap: siembra los workspaces pendientes en un único createMany', async () => {
    const { service, prisma, createMany } = build();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'ws1' }, { id: 'ws2' }]);
    createMany.mockResolvedValueOnce({ count: 2 * DIMENSIONES_SISTEMA.length });
    await service.onApplicationBootstrap();
    expect(createMany).toHaveBeenCalledTimes(1);
    const arg = createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toHaveLength(2 * DIMENSIONES_SISTEMA.length);
    // Tras sembrarlos en bootstrap, su primer acceso lazy no vuelve a consultar.
    await service.ensureForWorkspace('ws1');
    expect(prisma.dimension.findMany).not.toHaveBeenCalled();
  });

  it('ensureForWorkspace: crea las 3 faltantes la primera vez y no consulta la segunda (caché)', async () => {
    const { service, prisma } = build({ existentes: [] });
    const creadas = await service.ensureForWorkspace('wsX');
    expect(creadas).toBe(DIMENSIONES_SISTEMA.length);
    expect(prisma.dimension.findMany).toHaveBeenCalledTimes(1);
    prisma.dimension.findMany.mockClear();
    prisma.dimension.create.mockClear();
    const segunda = await service.ensureForWorkspace('wsX');
    expect(segunda).toBe(0);
    expect(prisma.dimension.findMany).not.toHaveBeenCalled();
    expect(prisma.dimension.create).not.toHaveBeenCalled();
  });

  it('ensureForWorkspace: idempotente ante P2002 concurrente (no propaga el error)', async () => {
    const { service, prisma } = build({ existentes: [] });
    prisma.dimension.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(service.ensureForWorkspace('wsP')).resolves.toBe(0);
  });
});
