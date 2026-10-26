import { Prisma } from '@prisma/client';
import { CATALOGO_BASE_ACCIONES_SENSIBLES } from './sensitive-actions.catalog';
import { SensitiveActionsService } from './sensitive-actions.service';

/**
 * Rendimiento #1/#3: el arranque no barre en serie los workspaces (una consulta de diferencia + un `createMany`
 * idempotente) y `ensureForWorkspace` no repite el SELECT una vez que el workspace ya quedó sembrado (caché
 * process-local). La idempotencia se preserva (P2002 se ignora).
 */
describe('SensitiveActionsService · siembra sin barrido en serie y caché', () => {
  function build(opts: { existentes?: { codigo: string }[] } = {}) {
    const createMany = jest
      .fn<Promise<{ count: number }>, [{ skipDuplicates: boolean; data: unknown[] }]>()
      .mockResolvedValue({ count: 0 });
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      tipoAccionSensible: {
        findMany: jest.fn().mockResolvedValue(opts.existentes ?? []),
        create: jest.fn().mockResolvedValue({}),
        createMany,
      },
    };
    const audit = { append: jest.fn() };
    return { service: new SensitiveActionsService(prisma as never, audit as never), prisma, createMany };
  }

  it('bootstrap: una sola consulta de diferencia; sin pendientes no inserta nada', async () => {
    const { service, prisma } = build();
    await service.onApplicationBootstrap();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.tipoAccionSensible.createMany).not.toHaveBeenCalled();
  });

  it('bootstrap: siembra los workspaces pendientes en un único createMany', async () => {
    const { service, prisma, createMany } = build();
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'ws1' }, { id: 'ws2' }]);
    createMany.mockResolvedValueOnce({ count: 2 * CATALOGO_BASE_ACCIONES_SENSIBLES.length });
    await service.onApplicationBootstrap();
    expect(createMany).toHaveBeenCalledTimes(1);
    const arg = createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toHaveLength(2 * CATALOGO_BASE_ACCIONES_SENSIBLES.length);
    // Tras sembrarlos en bootstrap, su primer acceso lazy no vuelve a consultar.
    await service.ensureForWorkspace('ws1');
    expect(prisma.tipoAccionSensible.findMany).not.toHaveBeenCalled();
  });

  it('ensureForWorkspace: crea el catálogo base la primera vez y no consulta la segunda (caché)', async () => {
    const { service, prisma } = build({ existentes: [] });
    const creadas = await service.ensureForWorkspace('wsX');
    expect(creadas).toBe(CATALOGO_BASE_ACCIONES_SENSIBLES.length);
    expect(prisma.tipoAccionSensible.findMany).toHaveBeenCalledTimes(1);
    prisma.tipoAccionSensible.findMany.mockClear();
    prisma.tipoAccionSensible.create.mockClear();
    const segunda = await service.ensureForWorkspace('wsX');
    expect(segunda).toBe(0);
    expect(prisma.tipoAccionSensible.findMany).not.toHaveBeenCalled();
    expect(prisma.tipoAccionSensible.create).not.toHaveBeenCalled();
  });

  it('ensureForWorkspace: idempotente ante P2002 concurrente (no propaga el error)', async () => {
    const { service, prisma } = build({ existentes: [] });
    prisma.tipoAccionSensible.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(service.ensureForWorkspace('wsP')).resolves.toBe(0);
  });
});
