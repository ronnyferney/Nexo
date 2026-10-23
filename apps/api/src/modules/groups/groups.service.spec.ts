import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { GroupsService, normalizeIds, toGroupView } from './groups.service';

describe('Grupos de usuarios (ADR 0007 D6)', () => {
  it('normaliza ids: sin vacíos ni duplicados', () => {
    expect(normalizeIds([' u1 ', 'u2', 'u1', ''])).toEqual(['u1', 'u2']);
    expect(normalizeIds(undefined)).toEqual([]);
  });

  it('vista con miembros ordenados por nombre y conteo', () => {
    const createdAt = new Date('2026-10-01T00:00:00Z');
    const view = toGroupView({
      id: 'g1',
      workspaceId: 'w1',
      name: 'Gerentes de línea',
      description: null,
      createdAt,
      updatedAt: createdAt,
      members: [
        { user: { id: 'u2', name: 'Bruno', email: 'b@x.test' } },
        { user: { id: 'u1', name: 'Ana', email: 'a@x.test' } },
      ],
    });
    expect(view).toEqual({
      id: 'g1',
      name: 'Gerentes de línea',
      description: null,
      memberCount: 2,
      members: [
        { userId: 'u1', name: 'Ana', email: 'a@x.test' },
        { userId: 'u2', name: 'Bruno', email: 'b@x.test' },
      ],
      createdAt,
    });
  });

  describe('validaciones', () => {
    const prisma = {
      userGroup: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      membership: { findMany: jest.fn() },
    };
    const svc = new GroupsService(prisma as unknown as PrismaService);
    beforeEach(() => jest.resetAllMocks());

    it('409 si el nombre ya existe en el workspace (sin distinguir mayúsculas)', async () => {
      prisma.userGroup.findFirst.mockResolvedValue({ id: 'g0' });
      await expect(svc.create('w1', { name: 'gerentes de línea' })).rejects.toThrow(ConflictException);
      expect(prisma.userGroup.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: 'w1', name: { equals: 'gerentes de línea', mode: 'insensitive' } },
        }),
      );
      expect(prisma.userGroup.create).not.toHaveBeenCalled();
    });

    it('400 indicando qué usuarios no son miembros del workspace', async () => {
      prisma.userGroup.findFirst.mockResolvedValue(null);
      prisma.membership.findMany.mockResolvedValue([{ userId: 'u1' }]);
      const err = await svc.create('w1', { name: 'Gerentes', userIds: ['u1', 'ajeno'] }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toBe('Estos usuarios no son miembros del workspace: ajeno');
      expect(prisma.membership.findMany).toHaveBeenCalledWith({
        where: { workspaceId: 'w1', userId: { in: ['u1', 'ajeno'] } },
        select: { userId: true },
      });
    });

    it('404 si el grupo es de otro workspace', async () => {
      prisma.userGroup.findFirst.mockResolvedValue(null);
      await expect(svc.get('w2', 'g1')).rejects.toThrow(NotFoundException);
      expect(prisma.userGroup.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'g1', workspaceId: 'w2' } }),
      );
    });
  });
});
