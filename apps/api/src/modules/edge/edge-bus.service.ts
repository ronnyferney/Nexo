import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

type Handler = (message: string) => void;

/**
 * Pub/sub de Redis para enrutar solicitudes al Edge entre instancias de la API (y desde los workers):
 * `edge:req:<edgeId>` lo escucha la instancia que tiene el socket; la respuesta vuelve por `edge:res:<requestId>`.
 * Usa dos conexiones: una en modo suscriptor y otra para publicar.
 */
@Injectable()
export class EdgeBusService implements OnModuleDestroy {
  private readonly logger = new Logger(EdgeBusService.name);
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly handlers = new Map<string, Handler>();

  constructor(config: ConfigService) {
    const redis = config.getOrThrow<{ host: string; port: number; password?: string }>('redis');
    const options = { host: redis.host, port: redis.port, password: redis.password, lazyConnect: true };
    this.pub = new Redis({ ...options, connectionName: 'nexo-edge-pub' });
    this.sub = new Redis({ ...options, connectionName: 'nexo-edge-sub' });
    for (const client of [this.pub, this.sub]) {
      client.on('error', (err: Error) => this.logger.warn(`Redis (Edge): ${err.message}`));
    }
    this.sub.on('message', (channel: string, message: string) => {
      const handler = this.handlers.get(channel);
      if (!handler) return;
      try {
        handler(message);
      } catch (err) {
        this.logger.warn(`Mensaje de ${channel} no procesado: ${(err as Error).message}`);
      }
    });
  }

  async subscribe(channel: string, handler: Handler): Promise<void> {
    const isNew = !this.handlers.has(channel);
    this.handlers.set(channel, handler);
    if (isNew) await this.sub.subscribe(channel);
  }

  async unsubscribe(channel: string): Promise<void> {
    if (!this.handlers.delete(channel)) return;
    await this.sub.unsubscribe(channel).catch(() => undefined);
  }

  /** Devuelve cuántos suscriptores recibieron el mensaje (0 = nadie escucha ese canal). */
  publish(channel: string, message: unknown): Promise<number> {
    return this.pub.publish(channel, JSON.stringify(message));
  }

  async onModuleDestroy(): Promise<void> {
    this.handlers.clear();
    await Promise.all(
      [this.pub, this.sub].map(async (c) => {
        if (c.status === 'wait' || c.status === 'end') return c.disconnect();
        await c.quit().catch(() => c.disconnect());
      }),
    );
  }
}
