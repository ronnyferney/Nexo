import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CipherContexts } from '../../common/crypto/cipher-context';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OAUTH_PROVIDERS, platformEnvName } from './oauth.providers';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Las demás réplicas toman los cambios de la consola en, como mucho, este intervalo. */
const REFRESH_MS = 60_000;

export interface PlatformApp {
  clientId: string;
  clientSecret: string;
  /** `console`: guardada desde la consola de plataforma (base de datos); `env`: variables de entorno. */
  source: 'console' | 'env';
}

/**
 * Apps OAuth de la plataforma por proveedor. Se configuran una vez desde la consola de plataforma (cifradas en la base de
 * datos) y tienen prioridad sobre `OAUTH_<PROVEEDOR>_CLIENT_ID/SECRET`, que quedan como respaldo para despliegues. Se
 * mantienen en memoria para que resolver la app al conectar sea síncrono.
 */
@Injectable()
export class PlatformOAuthAppsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformOAuthAppsService.name);
  private cache = new Map<string, { clientId: string; clientSecret: string }>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** App de la plataforma para el proveedor, o null si no hay ninguna configurada. */
  get(provider: string): PlatformApp | null {
    const stored = this.cache.get(provider);
    if (stored) return { ...stored, source: 'console' };
    const id = this.env(platformEnvName(provider, 'CLIENT_ID'));
    const secret = this.env(platformEnvName(provider, 'CLIENT_SECRET'));
    return id && secret ? { clientId: id, clientSecret: secret, source: 'env' } : null;
  }

  async save(provider: string, clientId: string, clientSecret: string, userId: string | undefined) {
    if (!OAUTH_PROVIDERS[provider]) throw new BadRequestException('Proveedor OAuth desconocido');
    const id = clientId.trim();
    const secret = clientSecret.trim();
    if (!id || !secret) throw new BadRequestException('Ingrese el client ID y el client secret');
    if (provider === 'microsoft') {
      if (!GUID.test(id)) {
        throw new BadRequestException(
          'El client ID es el "Id. de aplicación (cliente)" de la página Información general de la app en Entra ID',
        );
      }
      if (GUID.test(secret)) {
        throw new BadRequestException(
          'Ese valor parece el "Id. de secreto": copie la columna "Valor" del secreto en Certificados y secretos',
        );
      }
    }
    const cipher = this.crypto.encrypt(secret, CipherContexts.platformOAuthSecret(provider));
    await this.prisma.platformOAuthApp.upsert({
      where: { provider },
      create: { provider, clientId: id, clientSecretCipher: cipher, updatedById: userId ?? null },
      update: { clientId: id, clientSecretCipher: cipher, updatedById: userId ?? null },
    });
    this.cache.set(provider, { clientId: id, clientSecret: secret });
  }

  async remove(provider: string) {
    await this.prisma.platformOAuthApp.deleteMany({ where: { provider } });
    this.cache.delete(provider);
  }

  private async refresh() {
    try {
      const rows = await this.prisma.platformOAuthApp.findMany();
      const next = new Map<string, { clientId: string; clientSecret: string }>();
      for (const r of rows) {
        try {
          next.set(r.provider, {
            clientId: r.clientId,
            clientSecret: this.crypto.decrypt(r.clientSecretCipher, CipherContexts.platformOAuthSecret(r.provider)),
          });
        } catch {
          this.logger.warn(`No se pudo descifrar el secreto de la app OAuth de la plataforma "${r.provider}"`);
        }
      }
      this.cache = next;
    } catch (err) {
      // Sin base de datos se conserva lo último conocido (y el respaldo del entorno).
      this.logger.warn(`No se pudieron leer las apps OAuth de la plataforma: ${(err as Error).message}`);
    }
  }

  private env(name: string): string {
    const v = this.config.get<string>(name);
    return typeof v === 'string' ? v.trim() : '';
  }
}
