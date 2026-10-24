import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LlmConnection, LlmKind, LlmModel } from '@prisma/client';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  LLM_DRIVERS,
  type AuthHeaderStyle,
  type ClaudeChannelOptions,
  type LlmClient,
  type LlmCredentials,
  type LlmDriver,
} from './llm-provider';
import { LlmTokenService } from './llm-token.service';
import { quotaPeriod } from '../copilot/copilot-quota.service';
import { ConnectionUnavailableException } from './llm-errors';
import {
  longContextPricing,
  SYSTEM_ANTHROPIC_MODELS,
  SYSTEM_MOCK_MODELS,
  type CatalogModel,
  type ModelPricing,
} from './pricing';

export interface CatalogEntry {
  id: string;
  label: string;
  kind: LlmKind;
  system: boolean;
  configured: boolean;
  models: Omit<CatalogModel, 'cacheReadUsdPerMTok'>[];
}

export interface ResolvedModel {
  providerId: string;
  providerLabel: string;
  kind: LlmKind;
  model: string;
  pricing: ModelPricing;
  client: LlmClient;
}

/** Ids de las conexiones de sistema (configuradas por variables de entorno, sin fila en BD). */
export const SYSTEM_PROVIDERS = { anthropic: 'anthropic', mock: 'mock' } as const;

const num = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? null : Number(d));

const AUTH_STYLES: AuthHeaderStyle[] = ['bearer', 'api-key', 'none', 'both'];

/** Cabeceras y opciones de driver guardadas en la conexión (JSON validado al leer). */
export function connectionDriverOptions(
  c: Pick<LlmConnection, 'headers' | 'driverOptions'>,
): Omit<LlmCredentials, 'apiKey' | 'baseUrl'> {
  const headers: Record<string, string> = {};
  if (c.headers && typeof c.headers === 'object' && !Array.isArray(c.headers)) {
    for (const [k, v] of Object.entries(c.headers as Record<string, unknown>))
      if (typeof v === 'string') headers[k] = v;
  }
  const o = (c.driverOptions && typeof c.driverOptions === 'object' ? c.driverOptions : {}) as Record<string, unknown>;
  return {
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(AUTH_STYLES.includes(o.authHeader as AuthHeaderStyle) ? { authHeader: o.authHeader as AuthHeaderStyle } : {}),
    ...(typeof o.verifyPath === 'string' && o.verifyPath.startsWith('/') ? { verifyPath: o.verifyPath } : {}),
    ...(o.replayReasoning === true ? { replayReasoning: true } : {}),
    ...(parseClaudeOptions(o.claude) ? { claude: parseClaudeOptions(o.claude)! } : {}),
  };
}

const CLAUDE_CHANNELS = ['anthropic', 'google-cloud', 'vertex', 'foundry'] as const;

/** `driverOptions.claude` guardado al conectar un canal de Claude (solo valores no secretos). */
export function parseClaudeOptions(raw: unknown): ClaudeChannelOptions | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!CLAUDE_CHANNELS.includes(o.channel as ClaudeChannelOptions['channel'])) return null;
  const s = (v: unknown) => (typeof v === 'string' && v.length <= 200 ? v : undefined);
  return {
    channel: o.channel as ClaudeChannelOptions['channel'],
    ...(s(o.project) ? { project: s(o.project) } : {}),
    ...(s(o.region) ? { region: s(o.region) } : {}),
    ...(s(o.workspaceId) ? { workspaceId: s(o.workspaceId) } : {}),
    ...(s(o.resource) ? { resource: s(o.resource) } : {}),
  };
}

/**
 * Tarifas para medir una llamada: agrega la tarifa escalonada por longitud del prompt (`LONG_CONTEXT_PRICING`) cuando el
 * modelo la tiene y la conexión cobra sus tarifas base estándar.
 */
export function withLongContext(modelId: string, p: ModelPricing): ModelPricing {
  const longContext = longContextPricing(modelId, p);
  return longContext ? { ...p, longContext } : p;
}

export function toCatalogModel(m: LlmModel): CatalogModel {
  return {
    id: m.modelId,
    label: m.label,
    description: `${m.tier} · $${num(m.inputUsdPerMTok)} / $${num(m.outputUsdPerMTok)} por MTok`,
    tier: m.tier,
    inputUsdPerMTok: num(m.inputUsdPerMTok)!,
    outputUsdPerMTok: num(m.outputUsdPerMTok)!,
    cacheReadUsdPerMTok: num(m.cacheReadUsdPerMTok),
  };
}

/**
 * Punto único de acceso a los LLM: catálogo por workspace (conexiones de sistema + conexiones del administrador),
 * resolución de proveedor/modelo con su tarifa y caché de clientes por versión de la conexión.
 */
@Injectable()
export class LlmGatewayService {
  private readonly drivers: Map<LlmKind, LlmDriver>;
  private readonly clients = new Map<string, LlmClient>();
  private readonly anthropicKey?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    @Inject(LLM_DRIVERS) drivers: LlmDriver[],
    private readonly tokens: LlmTokenService,
  ) {
    this.drivers = new Map(drivers.map((d) => [d.kind, d]));
    this.anthropicKey = config.get<string>('llm.anthropicApiKey');
  }

  /** La plataforma tiene `ANTHROPIC_API_KEY` (conexión de sistema «Incluido por Nexo»). */
  get platformAnthropicConfigured(): boolean {
    return !!this.anthropicKey;
  }

  /** Cupo mensual del workspace en la conexión de la plataforma (`null` = sin tope). */
  platformQuotaUsd(workspaceId: string): number | null {
    const unlimited = this.config.get<string[]>('llm.platformUnlimitedWorkspaces') ?? [];
    if (unlimited.includes(workspaceId)) return null;
    return this.config.get<number>('llm.platformMonthlyUsd') ?? 5;
  }

  /**
   * La clave de plataforma la paga Nexo: cada workspace tiene un cupo mensual (como el Copilot, ADR 0006 D2) para que
   * un registro gratuito no consuma la cuenta sin tope. Agotado, la conexión queda no disponible y el agente usa su
   * cadena de respaldo. No cuenta el consumo del Copilot, que tiene su propio cupo.
   */
  private async assertPlatformQuota(workspaceId: string): Promise<void> {
    const limit = this.platformQuotaUsd(workspaceId);
    if (limit === null) return;
    const used =
      limit > 0
        ? Number(
            (
              await this.prisma.usageRecord.aggregate({
                where: {
                  workspaceId,
                  providerId: SYSTEM_PROVIDERS.anthropic,
                  source: { not: 'COPILOT' },
                  createdAt: { gte: quotaPeriod().start },
                },
                _sum: { costUsd: true },
              })
            )._sum.costUsd ?? 0,
          )
        : 0;
    if (limit <= 0 || used >= limit) {
      throw new ConnectionUnavailableException(
        limit <= 0
          ? 'Claude incluido por Nexo no está habilitado para este workspace: conecte su propia cuenta en Proveedores IA'
          : `Se agotó el cupo mensual de Claude incluido por Nexo (${limit} USD): conecte su propia cuenta en Proveedores IA`,
        'disabled',
      );
    }
  }

  async catalog(workspaceId: string, includeDisabled = false): Promise<CatalogEntry[]> {
    const strip = (m: CatalogModel) => {
      const { cacheReadUsdPerMTok, ...rest } = m;
      void cacheReadUsdPerMTok;
      return rest;
    };
    const system: CatalogEntry[] = [
      {
        id: SYSTEM_PROVIDERS.anthropic,
        label: 'Anthropic Claude (plataforma)',
        kind: 'ANTHROPIC',
        system: true,
        // Con cupo 0 (o sin clave) la conexión de plataforma no está disponible para este workspace.
        configured: !!this.anthropicKey && this.platformQuotaUsd(workspaceId) !== 0,
        models: SYSTEM_ANTHROPIC_MODELS.map(strip),
      },
      {
        id: SYSTEM_PROVIDERS.mock,
        label: 'Mock (desarrollo)',
        kind: 'MOCK',
        system: true,
        configured: true,
        models: SYSTEM_MOCK_MODELS.map(strip),
      },
    ];
    const connections = await this.prisma.llmConnection.findMany({
      where: { workspaceId, ...(includeDisabled ? {} : { enabled: true }) },
      include: { models: { where: includeDisabled ? {} : { enabled: true }, orderBy: { label: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    const custom: CatalogEntry[] = connections.map((c) => ({
      id: c.id,
      label: c.name,
      kind: c.kind,
      system: false,
      configured: c.enabled && ((c.kind !== 'ANTHROPIC' && c.credentialType !== 'OAUTH') || !!c.apiKeyCipher),
      models: c.models.map((m) => strip(toCatalogModel(m))),
    }));
    return [...system, ...custom];
  }

  /**
   * Proveedor y modelo listos para llamar. `platformQuota: false` solo para el Copilot, que tiene su propio cupo
   * (ADR 0006 D2) y no consume el de la conexión «Incluido por Nexo».
   */
  async resolve(
    workspaceId: string,
    providerId: string,
    model: string,
    opts: { platformQuota?: boolean } = {},
  ): Promise<ResolvedModel> {
    if (providerId === SYSTEM_PROVIDERS.anthropic || providerId === SYSTEM_PROVIDERS.mock) {
      const isMock = providerId === SYSTEM_PROVIDERS.mock;
      if (!isMock && !this.anthropicKey)
        throw new BadRequestException('ANTHROPIC_API_KEY no está configurada en la plataforma');
      if (!isMock && opts.platformQuota !== false) await this.assertPlatformQuota(workspaceId);
      const entry = (isMock ? SYSTEM_MOCK_MODELS : SYSTEM_ANTHROPIC_MODELS).find((m) => m.id === model);
      if (!entry) throw new BadRequestException(`Modelo no disponible en ${providerId}: ${model}`);
      const kind: LlmKind = isMock ? 'MOCK' : 'ANTHROPIC';
      return {
        providerId,
        providerLabel: isMock ? 'Mock' : 'Anthropic Claude (plataforma)',
        kind,
        model,
        pricing: withLongContext(model, entry),
        client: this.client(`system:${providerId}`, kind, { apiKey: this.anthropicKey }),
      };
    }

    const connection = await this.prisma.llmConnection.findFirst({
      where: { id: providerId, workspaceId },
      include: { models: { where: { modelId: model } } },
    });
    if (!connection) throw new BadRequestException('Proveedor LLM no encontrado');
    if (!connection.enabled) {
      throw new ConnectionUnavailableException(`El proveedor "${connection.name}" está deshabilitado`, 'disabled');
    }
    if (connection.credentialType === 'OAUTH' && !connection.apiKeyCipher) {
      throw new ConnectionUnavailableException(
        `La sesión de "${connection.name}" está cerrada: vuelva a iniciar sesión en Administración → Proveedores IA`,
        'signed_out',
      );
    }
    const row = connection.models[0];
    if (!row) {
      throw new BadRequestException(`El modelo "${model}" no existe en "${connection.name}"`);
    }
    if (!row.enabled) {
      throw new ConnectionUnavailableException(
        `El modelo "${model}" no está habilitado en "${connection.name}"`,
        'model_disabled',
      );
    }
    return {
      providerId,
      providerLabel: connection.name,
      kind: connection.kind,
      model,
      pricing: withLongContext(model, toCatalogModel(row)),
      client: this.clientFor(connection),
    };
  }

  async test(connection: LlmConnection) {
    try {
      return await this.clientFor(connection).test();
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  /**
   * Cliente (cacheado por versión) de una conexión del workspace. En conexiones OAuth el token se pide en cada llamada
   * al servicio de tokens, que lo renueva antes de expirar.
   */
  clientFor(c: LlmConnection): LlmClient {
    const oauth = c.credentialType === 'OAUTH';
    return this.client(`${c.id}:${c.updatedAt.getTime()}`, c.kind, {
      ...(oauth
        ? { getAccessToken: () => this.tokens.accessToken(c.id) }
        : { apiKey: c.apiKeyCipher ? this.crypto.decrypt(c.apiKeyCipher) : undefined }),
      baseUrl: c.baseUrl ?? undefined,
      ...connectionDriverOptions(c),
    });
  }

  /** Cliente sin caché para probar credenciales antes de guardar una conexión. */
  createClient(kind: LlmKind, credentials: LlmCredentials): LlmClient {
    const driver = this.drivers.get(kind);
    if (!driver) throw new BadRequestException(`Tipo de proveedor no soportado: ${kind}`);
    return driver.create(credentials);
  }

  private client(cacheKey: string, kind: LlmKind, credentials: LlmCredentials): LlmClient {
    let client = this.clients.get(cacheKey);
    if (!client) {
      // Descarta las versiones anteriores de la misma conexión (la renovación OAuth cambia `updatedAt` cada hora).
      if (!cacheKey.startsWith('system:')) {
        const prefix = `${cacheKey.slice(0, cacheKey.lastIndexOf(':'))}:`;
        for (const key of this.clients.keys()) if (key.startsWith(prefix)) this.clients.delete(key);
      }
      client = this.createClient(kind, credentials);
      this.clients.set(cacheKey, client);
    }
    return client;
  }
}
