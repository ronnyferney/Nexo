import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { idsByType, principalFilter, SharePrincipalsService } from './share-principals.service';

/** Prisma mínimo: un workspace con un miembro, una unidad y un grupo. */
function fakePrisma(): PrismaService {
  const inIds = (where: { id?: { in: string[] }; userId?: { in: string[] } }) => where.id?.in ?? where.userId?.in ?? [];
  return {
    membership: {
      findMany: ({ where }: { where: { workspaceId: string; userId: { in: string[] } } }) =>
        Promise.resolve(
          where.workspaceId === 'w1' && inIds(where).includes('u1') ? [{ user: { id: 'u1', name: 'Ana' } }] : [],
        ),
    },
    orgUnit: {
      findMany: ({ where }: { where: { workspaceId: string; id: { in: string[] } } }) =>
        Promise.resolve(
          where.workspaceId === 'w1' && inIds(where).includes('n1') ? [{ id: 'n1', name: 'Ventas' }] : [],
        ),
    },
    userGroup: {
      findMany: ({ where }: { where: { workspaceId: string; id: { in: string[] } } }) =>
        Promise.resolve(
          where.workspaceId === 'w1' && inIds(where).includes('g1') ? [{ id: 'g1', name: 'Gerentes de línea' }] : [],
        ),
    },
  } as unknown as PrismaService;
}

describe('Destinatarios de shares (ADR 0007 D6)', () => {
  it('el filtro incluye un OR por tipo con ids: usuario, cadena de unidades y grupos', () => {
    expect(principalFilter({ USER: ['u1'], UNIT: ['n1', 'raiz'], GROUP: ['g1'] })).toEqual([
      { principalType: 'USER', principalId: { in: ['u1'] } },
      { principalType: 'UNIT', principalId: { in: ['n1', 'raiz'] } },
      { principalType: 'GROUP', principalId: { in: ['g1'] } },
    ]);
    expect(principalFilter({ USER: ['u1'], UNIT: [], GROUP: [] })).toEqual([
      { principalType: 'USER', principalId: { in: ['u1'] } },
    ]);
    expect(principalFilter({ USER: [], UNIT: [], GROUP: [] })).toEqual([]);
  });

  it('agrupa ids por tipo sin duplicados', () => {
    expect(
      idsByType([
        { principalType: 'GROUP', principalId: 'g1' },
        { principalType: 'GROUP', principalId: 'g1' },
        { principalType: 'USER', principalId: 'u1' },
      ]),
    ).toEqual({ USER: ['u1'], UNIT: [], GROUP: ['g1'] });
  });

  it('nombra usuarios, unidades y grupos del workspace', async () => {
    const svc = new SharePrincipalsService(fakePrisma());
    const refs = [
      { principalType: 'USER' as const, principalId: 'u1' },
      { principalType: 'UNIT' as const, principalId: 'n1' },
      { principalType: 'GROUP' as const, principalId: 'g1' },
      { principalType: 'GROUP' as const, principalId: 'otro' },
    ];
    const names = await svc.names('w1', refs);
    expect(refs.map((r) => svc.nameOf(names, r))).toEqual(['Ana', 'Ventas', 'Gerentes de línea', '']);
  });

  it('rechaza (400) un grupo que no es del workspace', async () => {
    const svc = new SharePrincipalsService(fakePrisma());
    await expect(svc.assertExist('w1', [{ principalType: 'GROUP', principalId: 'g1' }])).resolves.toBeUndefined();
    await expect(svc.assertExist('w2', [{ principalType: 'GROUP', principalId: 'g1' }])).rejects.toThrow(
      new BadRequestException('Algún grupo no existe en el workspace'),
    );
    await expect(svc.assertExist('w1', [{ principalType: 'USER', principalId: 'x' }])).rejects.toThrow(
      'Algún usuario no es miembro del workspace',
    );
    await expect(svc.assertExist('w1', [])).resolves.toBeUndefined();
  });
});
