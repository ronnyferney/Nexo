import { Injectable, Logger, NotFoundException, ServiceUnavailableException, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type DataGuardMode as DbDataGuardMode } from '@prisma/client';
import { Redis } from 'ioredis';
import type { RedisConnectionConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
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

/** Resultado de la migración única desde Redis (`migrateLegacyRedisSettings`). */
export interface LegacyMigrationResult {
  /** Workspaces cuyos ajustes se copiaron a PostgreSQL. */
  migrated: number;
  /** Entradas descartadas: workspace inexistente, ajustes ya guardados en BD o valor ilegible. */
  skipped: number;
  /** Entradas que no se pudieron copiar (se conservan en Redis para el próximo arranque). */
  failed: number;
}

const TO_DB: Record<DataGuardMode, DbDataGuardMode> = { off: 'OFF', mask: 'MASK', block: 'BLOCK' };
const FROM_DB: Record<DbDataGuardMode, DataGuardMode> = { OFF: 'off', MASK: 'mask', BLOCK: 'block' };

const SETTINGS_SELECT = {
  dataGuardMode: true,
  conversationRetentionDays: true,
  privacySettingsUpdatedAt: true,
} satisfies Prisma.WorkspaceSelect;

type SettingsRow = Prisma.WorkspaceGetPayload<{ select: typeof SETTINGS_SELECT }>;

/** Prefijo y campo del hash provisional de Redis (`nexo:privacy:settings`, campo = id del workspace). */
export const LEGACY_REDIS_PREFIX = 'nexo:privacy:';
export const LEGACY_REDIS_KEY = 'settings';

/**
 * Almacén de los ajustes de protección de datos por workspace (columnas `Workspace.dataGuardMode`,
 * `Workspace.conversationRetentionDays` y `Workspace.privacySettingsUpdatedAt`).
 *
 * `privacySettingsUpdatedAt = null` significa que el workspace nunca guardó ajustes: se aplican los valores por
 * defecto de la plataforma (modo `mask` y `CONVERSATIONS_RETENTION_DAYS`).
 *
 * Si la BD no responde, la lectura falla hacia el valor seguro: modo `mask` (el dato personal nunca sale en claro), y
 * `all()` lanza para que la purga de conversaciones se omita (no borra con una política desconocida).
 *
 * Hasta esta versión los ajustes vivían en el Redis de la aplicación (hash `nexo:privacy:settings`). Al arrancar se
 * copian una sola vez a PostgreSQL y se borran de Redis (`migrateLegacyRedisSettings`, idempotente).
 */
@Injectable()
export class PrivacySettingsService implements OnModuleInit {
  private readonly logger = new Logger(PrivacySettingsService.name);
  readonly defaultRetentionDays: number | null;
  private lastWarning = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.defaultRetentionDays = config.get<number | null>('conversations.retentionDays') ?? null;
  }

  get defaults(): PrivacySettings {
    return { dataGuardMode: DEFAULT_DATA_GUARD_MODE, conversationRetentionDays: this.defaultRetentionDays };
  }

  async onModuleInit(): Promise<void> {
    // Acotado por los timeouts de la conexión (1 s por comando); nunca impide el arranque.
    await this.migrateLegacyRedisSettings().catch((err: Error) =>
      this.logger.warn(`Migración de ajustes de protección de datos desde Redis pendiente: ${err.message}`),
    );
  }

  private view(row: SettingsRow | null): PrivacySettingsView {
    if (!row?.privacySettingsUpdatedAt) return { ...this.defaults, isDefault: true };
    return {
      dataGuardMode: FROM_DB[row.dataGuardMode] ?? DEFAULT_DATA_GUARD_MODE,
      conversationRetentionDays: row.conversationRetentionDays,
      isDefault: false,
    };
  }

  /** Ajustes vigentes; ante un fallo del almacén, los valores por defecto (modo `mask`). */
  async get(workspaceId: string): Promise<PrivacySettingsView> {
    try {
      return this.view(await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: SETTINGS_SELECT }));
    } catch (err) {
      this.warn(`No se pudieron leer los ajustes de protección de datos; se aplica «mask»: ${(err as Error).message}`);
      return { ...this.defaults, isDefault: true };
    }
  }

  /**
   * Guarda los ajustes. Los campos ausentes conservan su valor vigente; en el primer guardado, la retención por
   * defecto de la plataforma queda fijada para el workspace (igual que antes en Redis). La trazabilidad de los cambios
   * la registra el controlador; `userId` solo identifica al solicitante si el guardado falla.
   */
  async update(workspaceId: string, patch: Partial<PrivacySettings>, userId?: string): Promise<PrivacySettingsView> {
    try {
      const current = this.view(
        await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: SETTINGS_SELECT }),
      );
      const row = await this.prisma.workspace.update({
        where: { id: workspaceId },
        data: {
          dataGuardMode: TO_DB[patch.dataGuardMode ?? current.dataGuardMode],
          conversationRetentionDays:
            patch.conversationRetentionDays !== undefined
              ? patch.conversationRetentionDays
              : current.conversationRetentionDays,
          privacySettingsUpdatedAt: new Date(),
        },
        select: SETTINGS_SELECT,
      });
      return this.view(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundException('Workspace no encontrado');
      }
      this.logger.error(
        `No se pudieron guardar los ajustes de protección de datos del workspace ${workspaceId}` +
          `${userId ? ` (solicitados por ${userId})` : ''}: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException('No se pudieron guardar los ajustes; intente de nuevo en unos minutos');
    }
  }

  /** Ajustes guardados de todos los workspaces (purga diaria). Lanza si el almacén no responde. */
  async all(): Promise<Map<string, PrivacySettings>> {
    const rows = await this.prisma.workspace.findMany({
      where: { privacySettingsUpdatedAt: { not: null } },
      select: { id: true, ...SETTINGS_SELECT },
    });
    const out = new Map<string, PrivacySettings>();
    for (const row of rows) {
      const v = this.view(row);
      out.set(row.id, { dataGuardMode: v.dataGuardMode, conversationRetentionDays: v.conversationRetentionDays });
    }
    return out;
  }

  /** Elimina los ajustes guardados de un workspace (vuelve a los valores por defecto). */
  async reset(workspaceId: string): Promise<void> {
    await this.prisma.workspace.updateMany({
      where: { id: workspaceId },
      data: { dataGuardMode: 'MASK', conversationRetentionDays: null, privacySettingsUpdatedAt: null },
    });
  }

  /**
   * Migración única de los ajustes que versiones anteriores guardaban en Redis (hash `nexo:privacy:settings`).
   * Idempotente y segura con varias réplicas arrancando a la vez: solo escribe en workspaces que aún no tienen ajustes
   * en BD (`privacySettingsUpdatedAt = null`), así nunca pisa un cambio posterior. Cada entrada procesada se borra del
   * hash (Redis elimina la clave al quedar vacío); las que fallan en BD se conservan para el próximo arranque.
   */
  async migrateLegacyRedisSettings(): Promise<LegacyMigrationResult> {
    const result: LegacyMigrationResult = { migrated: 0, skipped: 0, failed: 0 };
    const redis = this.openLegacyRedis();
    try {
      const raw = await redis.hgetall(LEGACY_REDIS_KEY);
      const processed: string[] = [];
      for (const [workspaceId, value] of Object.entries(raw)) {
        const parsed = parseLegacy(value);
        if (!parsed) {
          result.skipped++;
          processed.push(workspaceId);
          continue;
        }
        try {
          const { count } = await this.prisma.workspace.updateMany({
            where: { id: workspaceId, privacySettingsUpdatedAt: null },
            data: {
              dataGuardMode: TO_DB[parsed.mode],
              conversationRetentionDays: parsed.retentionDays,
              privacySettingsUpdatedAt: parsed.updatedAt,
            },
          });
          if (count) result.migrated++;
          else result.skipped++;
          processed.push(workspaceId);
        } catch (err) {
          result.failed++;
          this.logger.warn(
            `No se pudieron migrar los ajustes de protección de datos del workspace ${workspaceId}: ` +
              `${(err as Error).message}`,
          );
        }
      }
      if (processed.length) await redis.hdel(LEGACY_REDIS_KEY, ...processed);
      if (processed.length || result.failed) {
        this.logger.log(
          `Ajustes de protección de datos migrados de Redis a PostgreSQL: ${result.migrated} copiados, ` +
            `${result.skipped} descartados, ${result.failed} pendientes`,
        );
      }
      return result;
    } finally {
      redis.disconnect();
    }
  }

  /** Conexión temporal al Redis de la aplicación, solo para la migración única. */
  protected openLegacyRedis(): Redis {
    const redis = this.config.getOrThrow<RedisConnectionConfig & { db?: number }>('redis');
    const client = new Redis({
      host: redis.host,
      port: redis.port,
      password: redis.password,
      db: redis.db,
      tls: redis.tls,
      lazyConnect: true,
      connectionName: 'nexo-privacy-settings-migration',
      keyPrefix: LEGACY_REDIS_PREFIX,
      maxRetriesPerRequest: 1,
      commandTimeout: 1_000,
      retryStrategy: () => null,
    });
    client.on('error', () => undefined);
    return client;
  }

  private warn(message: string): void {
    const now = Date.now();
    if (now - this.lastWarning < 60_000) return;
    this.lastWarning = now;
    this.logger.warn(message);
  }
}

/** Mismo tope que `UpdateDataPolicyDto.conversationRetentionDays`. */
const MAX_RETENTION_DAYS = 3650;

/** Valor guardado en Redis por versiones anteriores: `{ mode, retentionDays, updatedAt, updatedBy? }`. */
function parseLegacy(raw: string): { mode: DataGuardMode; retentionDays: number | null; updatedAt: Date } | null {
  try {
    const o = JSON.parse(raw) as { mode?: unknown; retentionDays?: unknown; updatedAt?: unknown };
    if (!DATA_GUARD_MODES.includes(o.mode as DataGuardMode)) return null;
    const days =
      typeof o.retentionDays === 'number' && Number.isFinite(o.retentionDays) && o.retentionDays >= 1
        ? Math.min(Math.floor(o.retentionDays), MAX_RETENTION_DAYS)
        : null;
    const at = typeof o.updatedAt === 'string' ? new Date(o.updatedAt) : new Date(NaN);
    return {
      mode: o.mode as DataGuardMode,
      retentionDays: days,
      updatedAt: Number.isNaN(at.getTime()) ? new Date() : at,
    };
  } catch {
    return null;
  }
}
