import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { RedisConnectionConfig } from '../../config/configuration';

/**
 * Reclama un identificador de un solo uso (p. ej. el `jti` de un `state` OAuth) para todas las réplicas de la API.
 * Devuelve `true` solo la primera vez dentro de `ttlMs`; un replay, otra réplica que ya lo reclamó o un fallo del
 * almacén devuelven `false` (falla cerrado).
 */
export interface ReplayGuard {
  claim(scope: string, id: string, ttlMs: number): Promise<boolean>;
}

/**
 * Uso único compartido entre instancias (auditoría B2): `SET <scope>:<id> 1 NX PX <ttl>` en el Redis de la aplicación
 * (misma configuración que BullMQ y el limitador, conexión propia y perezosa con prefijo `nexo:once:`).
 *
 * A diferencia del limitador y de la revocación de sesiones, **falla cerrado**: si Redis no responde, el identificador
 * se rechaza. Un `state` OAuth rechazado solo obliga a iniciar sesión de nuevo; aceptarlo sin garantía de uso único
 * permitiría reutilizar un consentimiento capturado en otra réplica.
 *
 * Reutilizable: cualquier flujo con `jti` o nonce de un solo uso lo adopta con `claim(scope, id, ttlMs)`; el OAuth de
 * conectores puede pasarlo a `OAuthStateService.consume(state, { replayGuard })`.
 */
@Injectable()
export class SingleUseService implements ReplayGuard, OnModuleDestroy {
  private readonly logger = new Logger(SingleUseService.name);
  private readonly redis: Redis;
  private lastWarning = 0;

  constructor(config: ConfigService) {
    const redis = config.getOrThrow<RedisConnectionConfig & { db?: number }>('redis');
    this.redis = new Redis({
      host: redis.host,
      port: redis.port,
      password: redis.password,
      db: redis.db,
      tls: redis.tls,
      lazyConnect: true,
      connectionName: 'nexo-single-use',
      keyPrefix: 'nexo:once:',
      maxRetriesPerRequest: 1,
      commandTimeout: 1_000,
    });
    this.redis.on('error', (err: Error) => this.warn(`Redis (uso único): ${err.message}`));
  }

  async claim(scope: string, id: string, ttlMs: number): Promise<boolean> {
    if (!scope || !id || !/^[\w:.-]{1,200}$/.test(`${scope}:${id}`)) return false;
    try {
      const res = await this.redis.set(`${scope}:${id}`, '1', 'PX', Math.max(1, Math.ceil(ttlMs)), 'NX');
      return res === 'OK';
    } catch (err) {
      this.warn(`Sin Redis para garantizar el uso único, se rechaza (${scope}): ${(err as Error).message}`);
      return false;
    }
  }

  /** Una advertencia por minuto como máximo. */
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
