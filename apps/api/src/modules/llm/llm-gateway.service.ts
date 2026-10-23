import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LlmConnection, LlmKind, LlmModel } from '@prisma/client';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LLM_DRIVERS, type AuthHeaderStyle, type LlmClient, type LlmCredentials, type LlmDriver } from './llm-provider';
import { SYSTEM_ANTHROPIC_MODELS, SYSTEM_MOCK_MODELS, type CatalogModel, type ModelPricing } from './pricing';

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
  };
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
    config: ConfigService,
    @Inject(LLM_DRIVERS) drivers: LlmDriver[],
  ) {
    this.drivers = new Map(drivers.map((d) => [d.kind, d]));
    this.anthropicKey = config.get<string>('llm.anthropicApiKey');
  }

  /** La plataforma tiene `ANTHROPIC_API_KEY` (conexión de sistema «Incluido por Nexo»). */
  get platformAnthropicConfigured(): boolean {
    return !!this.anthropicKey;
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
        configured: !!this.anthropicKey,
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
      configured: c.enabled && (c.kind !== 'ANTHROPIC' || !!c.apiKeyCipher),
      models: c.models.map((m) => strip(toCatalogModel(m))),
    }));
    return [...system, ...custom];
  }

  async resolve(workspaceId: string, providerId: string, model: string): Promise<ResolvedModel> {
    if (providerId === SYSTEM_PROVIDERS.anthropic || providerId === SYSTEM_PROVIDERS.mock) {
      const isMock = providerId === SYSTEM_PROVIDERS.mock;
      if (!isMock && !this.anthropicKey)
        throw new BadRequestException('ANTHROPIC_API_KEY no está configurada en la plataforma');
      const entry = (isMock ? SYSTEM_MOCK_MODELS : SYSTEM_ANTHROPIC_MODELS).find((m) => m.id === model);
      if (!entry) throw new BadRequestException(`Modelo no disponible en ${providerId}: ${model}`);
      const kind: LlmKind = isMock ? 'MOCK' : 'ANTHROPIC';
      return {
        providerId,
        providerLabel: isMock ? 'Mock' : 'Anthropic Claude (plataforma)',
        kind,
        model,
        pricing: entry,
        client: this.client(`system:${providerId}`, kind, { apiKey: this.anthropicKey }),
      };
    }

    const connection = await this.prisma.llmConnection.findFirst({
      where: { id: providerId, workspaceId },
      include: { models: { where: { modelId: model } } },
    });
    if (!connection) throw new BadRequestException('Proveedor LLM no encontrado');
    if (!connection.enabled) throw new BadRequestException(`El proveedor "${connection.name}" está deshabilitado`);
    const row = connection.models[0];
    if (!row || !row.enabled)
      throw new BadRequestException(`El modelo "${model}" no está habilitado en "${connection.name}"`);
    return {
      providerId,
      providerLabel: connection.name,
      kind: connection.kind,
      model,
      pricing: toCatalogModel(row),
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

  /** Cliente (cacheado por versión) de una conexión del workspace. */
  clientFor(c: LlmConnection): LlmClient {
    return this.client(`${c.id}:${c.updatedAt.getTime()}`, c.kind, {
      apiKey: c.apiKeyCipher ? this.crypto.decrypt(c.apiKeyCipher) : undefined,
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
      client = this.createClient(kind, credentials);
      this.clients.set(cacheKey, client);
    }
    return client;
  }
}
