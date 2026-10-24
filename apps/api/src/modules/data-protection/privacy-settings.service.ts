import { Injectable, Logger, ServiceUnavailableException, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { RedisConnectionConfig } from '../../config/configuration';
import { DATA_GUARD_MODES, DEFAULT_DATA_GUARD_MODE, type DataGuardMode } from '../llm/data-guard/mask-session';

/** Ajustes de protección de datos de un workspace (ADR 0008 D2 y D7). */
export interface PrivacySettings {
  /** Política de DataGuard hacia los modelos de IA. */
  dataGuardMode: DataGuardMode;
  /** Días que se conservan conversaciones y mensajes (null = sin límite). */
  conversationRetentionDays: number | null;
}

export interface PrivacySettingsView extends PrivacySettings {
  /** El workspace aún no guardó ajustes: se aplican los valores por defecto de la plataforma. */
  isDefault: boolean;
}

interface StoredSettings {
  mode: DataGuardMode;
  retentionDays: number | null;
  updatedAt: string;
  updatedBy?: string;
}

/** Hash de Redis con los ajustes por workspace (campo = id del workspace). */
const SETTINGS_KEY = 'settings';

/**
 * Almacén de los ajustes de protección de datos por workspace.
 *
 * PROVISIONAL (ADR 0008, sección «Estado de la implementación»): el esquema de Prisma aún no tiene columnas para estos
 * ajustes y su migración la hace el dueño del esquema. Mientras tanto se guardan en el Redis de la aplicación (hash
 * `nexo:privacy:settings`, sin expiración). Si Redis no responde, la lectura falla hacia el valor seguro: modo `mask`
 * (el dato personal nunca sale en claro) y la purga de conversaciones se omite (no borra con una política desconocida).
 * Al migrar, solo cambia esta clase: `Workspace.dataGuardMode` y `Workspace.conversationRetentionDays`.
 */
@Injectable()
export class PrivacySettingsService implements OnModuleDestroy {
  private readonly logger = new Logger(PrivacySettingsService.name);
  private readonly redis: Redis;
  readonly defaultRetentionDays: number | null;
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
      connectionName: 'nexo-privacy-settings',
      keyPrefix: 'nexo:privacy:',
      maxRetriesPerRequest: 1,
      commandTimeout: 1_000,
    });
    this.redis.on('error', (err: Error) => this.warn(`Redis (protección de datos): ${err.message}`));
    this.defaultRetentionDays = config.get<number | null>('conversations.retentionDays') ?? null;
  }

  get defaults(): PrivacySettings {
    return { dataGuardMode: DEFAULT_DATA_GUARD_MODE, conversationRetentionDays: this.defaultRetentionDays };
  }

  private parse(raw: string | null | undefined): StoredSettings | null {
    if (!raw) return null;
    try {
      const o = JSON.parse(raw) as Partial<StoredSettings>;
      const mode = DATA_GUARD_MODES.includes(o.mode as DataGuardMode) ? (o.mode as DataGuardMode) : null;
      if (!mode) return null;
      const days = typeof o.retentionDays === 'number' && o.retentionDays >= 1 ? Math.floor(o.retentionDays) : null;
      return { mode, retentionDays: days, updatedAt: String(o.updatedAt ?? ''), updatedBy: o.updatedBy };
    } catch {
      return null;
    }
  }

  private view(s: StoredSettings | null): PrivacySettingsView {
    if (!s) return { ...this.defaults, isDefault: true };
    return { dataGuardMode: s.mode, conversationRetentionDays: s.retentionDays, isDefault: false };
  }

  /** Ajustes vigentes; ante un fallo del almacén, los valores por defecto (modo `mask`). */
  async get(workspaceId: string): Promise<PrivacySettingsView> {
    try {
      return this.view(this.parse(await this.redis.hget(SETTINGS_KEY, workspaceId)));
    } catch (err) {
      this.warn(`No se pudieron leer los ajustes de protección de datos; se aplica «mask»: ${(err as Error).message}`);
      return { ...this.defaults, isDefault: true };
    }
  }

  async update(workspaceId: string, patch: Partial<PrivacySettings>, userId?: string): Promise<PrivacySettingsView> {
    const current = await this.get(workspaceId);
    const next: StoredSettings = {
      mode: patch.dataGuardMode ?? current.dataGuardMode,
      retentionDays:
        patch.conversationRetentionDays !== undefined
          ? patch.conversationRetentionDays
          : current.conversationRetentionDays,
      updatedAt: new Date().toISOString(),
      ...(userId ? { updatedBy: userId } : {}),
    };
    try {
      await this.redis.hset(SETTINGS_KEY, workspaceId, JSON.stringify(next));
    } catch (err) {
      this.logger.error(`No se pudieron guardar los ajustes de protección de datos: ${(err as Error).message}`);
      throw new ServiceUnavailableException('No se pudieron guardar los ajustes; intente de nuevo en unos minutos');
    }
    return this.view(next);
  }

  /** Ajustes guardados de todos los workspaces (purga diaria). Lanza si el almacén no responde. */
  async all(): Promise<Map<string, PrivacySettings>> {
    const raw = await this.redis.hgetall(SETTINGS_KEY);
    const out = new Map<string, PrivacySettings>();
    for (const [ws, value] of Object.entries(raw)) {
      const s = this.parse(value);
      if (s) out.set(ws, { dataGuardMode: s.mode, conversationRetentionDays: s.retentionDays });
    }
    return out;
  }

  /** Elimina los ajustes guardados de un workspace (vuelve a los valores por defecto). */
  async reset(workspaceId: string): Promise<void> {
    await this.redis.hdel(SETTINGS_KEY, workspaceId);
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
