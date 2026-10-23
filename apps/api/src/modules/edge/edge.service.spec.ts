import { CryptoService } from '../../common/crypto/crypto.service';
import type { EdgeBusService } from './edge-bus.service';
import { EDGE_OFFLINE_AFTER_MS } from './edge.protocol';
import { edgeStatus, EdgeService } from './edge.service';

describe('edgeStatus', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  it('ONLINE solo si hubo señal en los últimos 45 s', () => {
    expect(edgeStatus(null, now)).toBe('OFFLINE');
    expect(edgeStatus(new Date(now - 1000), now)).toBe('ONLINE');
    expect(edgeStatus(new Date(now - EDGE_OFFLINE_AFTER_MS), now)).toBe('ONLINE');
    expect(edgeStatus(new Date(now - EDGE_OFFLINE_AFTER_MS - 1), now)).toBe('OFFLINE');
  });
});

describe('EdgeService', () => {
  const prisma = {
    edgeAgent: {
      create: jest.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'e1', ...args.data })),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  const bus = { publish: jest.fn(() => Promise.resolve(0)), subscribe: jest.fn(), unsubscribe: jest.fn() };
  const service = new EdgeService(prisma as never, bus as unknown as EdgeBusService);

  it('crea el token nexoedge_ y guarda solo su SHA-256 y prefijo', async () => {
    const res = await service.create('w1', 'Sede');
    expect(res.token).toMatch(/^nexoedge_[A-Za-z0-9_-]{40,}$/);
    const data = prisma.edgeAgent.create.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(CryptoService.sha256(res.token));
    expect(data.tokenPrefix).toBe(res.token.slice(0, 13));
    expect(JSON.stringify(data)).not.toContain(res.token);
  });

  it('authenticate ignora tokens sin prefijo o demasiado largos', async () => {
    expect(await service.authenticate(undefined)).toBeNull();
    expect(await service.authenticate('nexo_apikey')).toBeNull();
    expect(await service.authenticate(`nexoedge_${'x'.repeat(300)}`)).toBeNull();
    expect(prisma.edgeAgent.findUnique).not.toHaveBeenCalled();
  });

  it('request exige que el Edge pertenezca al workspace', async () => {
    prisma.edgeAgent.findFirst.mockResolvedValueOnce(null);
    await expect(service.request('w2', 'e1', { type: 'test', connectionKey: 'x' }, 1000)).rejects.toThrow(
      /Edge no encontrado/,
    );
    expect(prisma.edgeAgent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'e1', workspaceId: 'w2' } }),
    );
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it('request falla rápido si ninguna instancia tiene el socket', async () => {
    prisma.edgeAgent.findFirst.mockResolvedValueOnce({ id: 'e1', name: 'Sede', connections: ['x'] });
    await expect(service.request('w1', 'e1', { type: 'test', connectionKey: 'x' }, 1000)).rejects.toThrow(
      /no está conectado/,
    );
    expect(bus.unsubscribe).toHaveBeenCalled();
  });
});
