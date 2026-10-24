import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { RedisConnectionConfig } from '../../config/configuration';

/**
 * Sesiones cerradas con `POST /auth/logout` (M6): lista de `jti` revocados en Redis hasta que el token vence. Cierra
 * solo esa sesión; `User.tokenVersion` sigue cerrando todas (cambio de contraseña, cuenta recuperada).
 *
 * Conexión propia y perezosa, como el limitador. Si Redis no responde, la consulta falla abierta y lo registra: el
 * navegador ya borró la cookie, la revocación protege solo frente a una copia del token, y bloquear toda la web por
 * una caída de Redis sería peor (la caída ya la detectan la cola y /health).
 */
@Injectable()
export class SessionRevocationService implements OnModuleDestroy {
  private readonly logger = new Logger(SessionRevocationService.name);
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
      connectionName: 'nexo-sessions',
      keyPrefix: 'nexo:session-revoked:',
      maxRetriesPerRequest: 1,
      commandTimeout: 1_000,
    });
    this.redis.on('error', (err: Error) => this.warn(`Redis (sesiones): ${err.message}`));
  }

  /** Revoca el `jti` hasta `exp` (segundos epoch). */
  async revoke(jti: string, exp: number | undefined): Promise<void> {
    const ttlMs = exp ? exp * 1000 - Date.now() : 24 * 3600 * 1000;
    if (ttlMs <= 0) return;
    try {
      await this.redis.set(jti, '1', 'PX', Math.ceil(ttlMs));
    } catch (err) {
      this.warn(`No se pudo registrar el cierre de sesión en Redis: ${(err as Error).message}`);
    }
  }

  async isRevoked(jti: string): Promise<boolean> {
    try {
      return (await this.redis.exists(jti)) === 1;
    } catch (err) {
      this.warn(`Sin Redis para consultar sesiones cerradas, la petición continúa: ${(err as Error).message}`);
      return false;
    }
  }

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
