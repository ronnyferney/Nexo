import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { Redis } from 'ioredis';

/** Registro que espera `ThrottlerGuard` (tiempos en segundos). */
export interface ThrottlerRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Contador atómico de ventana fija con bloqueo. KEYS[1] = contador, KEYS[2] = bloqueo;
 * ARGV = ttl (ms), límite, duración del bloqueo (ms). Devuelve { aciertos, ms para expirar, bloqueado, ms de bloqueo }.
 */
const INCREMENT_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
  return { hits, math.max(redis.call('PTTL', KEYS[1]), 0), 1, blockTtl }
end
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  redis.call('DEL', KEYS[1])
  return { hits, ttl, 1, tonumber(ARGV[3]) }
end
return { hits, ttl, 0, 0 }
`;

type RedisWithThrottle = Redis & {
  nexoThrottle(hitsKey: string, blockKey: string, ttl: number, limit: number, block: number): Promise<number[]>;
};

/**
 * Almacenamiento del limitador de peticiones en Redis: los contadores se comparten entre todas las réplicas de la API
 * (en memoria, cada instancia contaba por separado). Usa la misma configuración de Redis que BullMQ (`redis`) con una
 * conexión propia y perezosa: no conecta hasta la primera petición (las pruebas E2E sustituyen el almacenamiento).
 * Si Redis no responde, no bloquea el tráfico (falla abierto) y lo registra: la caída ya la detectan la cola y /health.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly redis: RedisWithThrottle;
  private lastWarning = 0;

  constructor(config: ConfigService) {
    const redis = config.getOrThrow<{ host: string; port: number; password?: string; db?: number }>('redis');
    this.redis = new Redis({
      host: redis.host,
      port: redis.port,
      password: redis.password,
      db: redis.db,
      lazyConnect: true,
      connectionName: 'nexo-throttler',
      keyPrefix: 'nexo:throttle:',
      maxRetriesPerRequest: 1,
      commandTimeout: 1_000,
    }) as RedisWithThrottle;
    this.redis.defineCommand('nexoThrottle', { numberOfKeys: 2, lua: INCREMENT_SCRIPT });
    this.redis.on('error', (err: Error) => this.warn(`Redis (limitador): ${err.message}`));
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerRecord> {
    const base = `${throttlerName}:${key}`;
    try {
      const [hits, ttlMs, blocked, blockMs] = await this.redis.nexoThrottle(
        `${base}:hits`,
        `${base}:block`,
        Math.max(1, Math.ceil(ttl)),
        limit,
        Math.max(1, Math.ceil(blockDuration)),
      );
      return {
        totalHits: Number(hits),
        timeToExpire: Math.ceil(Number(ttlMs) / 1000),
        isBlocked: Number(blocked) === 1,
        timeToBlockExpire: Math.ceil(Number(blockMs) / 1000),
      };
    } catch (err) {
      this.warn(`Limitador sin Redis, la petición continúa: ${(err as Error).message}`);
      return { totalHits: 0, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    }
  }

  /** Una advertencia por minuto como máximo: una caída de Redis no debe inundar los registros. */
  private warn(message: string): void {
    const now = Date.now();
    if (now - this.lastWarning < 60_000) return;
    this.lastWarning = now;
    this.logger.warn(message);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status === 'wait' || this.redis.status === 'end') {
      this.redis.disconnect();
      return;
    }
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
