import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { AgentsService } from './agents.service';
import { AGENTS_LIST_DEFAULT_TAKE } from './dto/agent.dto';

/**
 * Rendimiento #4: `list` acota el `findMany` (sin `take` aplica un tope por defecto; acepta `take`/`skip` opcionales)
 * SIN cambiar el contrato: la respuesta sigue siendo un array (el front consume `Agent[]`).
 */
describe('AgentsService.list · paginación aditiva sin romper el contrato', () => {
  const auth = { via: 'jwt', userId: 'u1', workspaceId: 'ws1' } as unknown as AuthContext;

  function build() {
    const findMany = jest
      .fn<Promise<unknown[]>, [{ take?: number; skip?: number }]>()
      .mockResolvedValue([{ id: 'a1', ownerId: null, _count: { tools: 0 } }]);
    const prisma = {
      agent: { findMany },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      conversation: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    const access = {
      usableWhere: jest.fn().mockResolvedValue({ workspaceId: 'ws1' }),
      scopeWhere: jest.fn().mockResolvedValue({ workspaceId: 'ws1' }),
      permissions: jest.fn().mockResolvedValue(new Map([['a1', 'USE']])),
    };
    const service = new AgentsService(
      prisma as never,
      {} as never,
      {} as never,
      access as never,
      {} as never,
      {} as never,
    );
    return { service, findMany };
  }

  it('sin parámetros aplica el tope por defecto y devuelve un array', async () => {
    const { service, findMany } = build();
    const res = await service.list(auth);
    expect(Array.isArray(res)).toBe(true);
    expect(findMany.mock.calls[0][0].take).toBe(AGENTS_LIST_DEFAULT_TAKE);
    expect(findMany.mock.calls[0][0].skip).toBeUndefined();
  });

  it('respeta take/skip cuando se indican', async () => {
    const { service, findMany } = build();
    await service.list(auth, undefined, { take: 50, skip: 100 });
    expect(findMany.mock.calls[0][0].take).toBe(50);
    expect(findMany.mock.calls[0][0].skip).toBe(100);
  });
});
