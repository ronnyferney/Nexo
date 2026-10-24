import type { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { RedisThrottlerStorage } from '../infrastructure/throttler/redis-throttler.storage';
import { EdgeBusService } from '../modules/edge/edge-bus.service';
import { redisConfigFrom } from './configuration';

jest.mock('ioredis', () => {
  const Redis = jest.fn().mockImplementation(() => ({
    defineCommand: jest.fn(),
    on: jest.fn(),
    disconnect: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
    status: 'wait',
  }));
  return { Redis };
});

const configWith = (env: NodeJS.ProcessEnv) => ({ getOrThrow: () => redisConfigFrom(env) }) as unknown as ConfigService;

describe('Conexión a Redis (B8: REDIS_TLS)', () => {
  beforeEach(() => jest.mocked(Redis).mockClear());

  it('sin REDIS_TLS conecta sin TLS (desarrollo local, docker compose)', () => {
    const cfg = redisConfigFrom({ REDIS_HOST: 'redis', REDIS_PORT: '6380', REDIS_PASSWORD: '' });
    expect(cfg).toEqual({ host: 'redis', port: 6380, password: undefined });
    expect('tls' in cfg).toBe(false);
    expect('tls' in redisConfigFrom({ REDIS_TLS: 'false' })).toBe(false);
    expect('tls' in redisConfigFrom({ REDIS_TLS: '' })).toBe(false);
  });

  it('con REDIS_TLS=true agrega `tls` y conserva la contraseña (ElastiCache con AUTH)', () => {
    expect(
      redisConfigFrom({ REDIS_HOST: 'master.nexo.cache.amazonaws.com', REDIS_PASSWORD: 's3cr3t', REDIS_TLS: ' TRUE ' }),
    ).toEqual({ host: 'master.nexo.cache.amazonaws.com', port: 6379, password: 's3cr3t', tls: {} });
  });

  it('el limitador y el bus del Edge pasan TLS y contraseña a ioredis', () => {
    const config = configWith({ REDIS_PASSWORD: 's3cr3t', REDIS_TLS: 'true' });
    new RedisThrottlerStorage(config);
    new EdgeBusService(config);
    const calls = jest.mocked(Redis).mock.calls as unknown as [Record<string, unknown>][];
    expect(calls).toHaveLength(3);
    for (const [options] of calls) expect(options).toMatchObject({ password: 's3cr3t', tls: {} });
  });

  it('sin REDIS_TLS el limitador no activa TLS', () => {
    new RedisThrottlerStorage(configWith({}));
    const [[options]] = jest.mocked(Redis).mock.calls as unknown as [Record<string, unknown>][];
    expect(options.tls).toBeUndefined();
  });
});
