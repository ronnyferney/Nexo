import type { ConfigService } from '@nestjs/config';
import { SingleUseService } from './single-use.service';

/** Redis falso con la semántica de `SET key value PX ttl NX`. */
function fakeRedis() {
  const keys = new Map<string, number>();
  return {
    keys,
    set: jest.fn(async (key: string, _v: string, _px: 'PX', ttl: number, nx: 'NX') => {
      const exp = keys.get(key);
      if (nx === 'NX' && exp !== undefined && exp > Date.now()) return null;
      keys.set(key, Date.now() + ttl);
      return 'OK';
    }),
  };
}

function service(redis: unknown) {
  const svc = new SingleUseService({
    getOrThrow: () => ({ host: '127.0.0.1', port: 1 }),
  } as unknown as ConfigService);
  const real = (svc as unknown as { redis: { disconnect(): void } }).redis;
  real.disconnect();
  (svc as unknown as { redis: unknown }).redis = redis;
  return svc;
}

describe('SingleUseService (B2: uso único compartido en Redis)', () => {
  it('SET NX PX: solo la primera reclamación gana, también desde otra instancia con el mismo Redis', async () => {
    const redis = fakeRedis();
    const a = service(redis);
    const b = service(redis);
    expect(await a.claim('oauth-state', 'jti-1', 60_000)).toBe(true);
    expect(await b.claim('oauth-state', 'jti-1', 60_000)).toBe(false);
    expect(await a.claim('oauth-state', 'jti-1', 60_000)).toBe(false);
    expect(await b.claim('oauth-state', 'jti-2', 60_000)).toBe(true);
    expect(redis.set).toHaveBeenCalledWith('oauth-state:jti-1', '1', 'PX', 60_000, 'NX');
  });

  it('falla cerrado: si Redis no responde, rechaza', async () => {
    const svc = service({ set: jest.fn().mockRejectedValue(new Error('Connection is closed.')) });
    expect(await svc.claim('oauth-state', 'jti-1', 60_000)).toBe(false);
  });

  it('rechaza identificadores vacíos o con caracteres fuera del formato de clave', async () => {
    const redis = fakeRedis();
    const svc = service(redis);
    expect(await svc.claim('oauth-state', '', 1000)).toBe(false);
    expect(await svc.claim('oauth-state', 'a b', 1000)).toBe(false);
    expect(await svc.claim('oauth-state', 'x'.repeat(300), 1000)).toBe(false);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('sin Redis real alcanzable (puerto cerrado) también rechaza', async () => {
    const svc = new SingleUseService({
      getOrThrow: () => ({ host: '127.0.0.1', port: 1 }),
    } as unknown as ConfigService);
    expect(await svc.claim('oauth-state', 'jti-x', 1000)).toBe(false);
    (svc as unknown as { redis: { disconnect(): void } }).redis.disconnect();
  });
});
