import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { ConnectProviderDto } from './dto/llm-providers.dto';
import { LlmGatewayService } from './llm-gateway.service';
import { LlmHttpError, type LlmCredentials } from './llm-provider';
import { serializeConnection, serializeModel } from './llm-serializers';
import { SYSTEM_ANTHROPIC_MODELS } from './pricing';
import {
  findProvider,
  PROVIDER_CATALOG,
  ProviderFieldsError,
  validateProviderFields,
  type ProviderCatalogEntry,
  type ValidatedFields,
} from './providers';

/** Entrada del catálogo tal como la ve la web: sin los detalles internos del driver. */
export type ProviderPublicEntry = Omit<
  ProviderCatalogEntry,
  'authHeader' | 'verifyPath' | 'headers' | 'replayReasoning'
>;

export interface ProviderView extends ProviderPublicEntry {
  connected: { connectionId: string; name: string; modelCount: number; enabled: boolean }[];
  /** Cantidad de modelos sugeridos. */
  modelCount: number;
  /** Conexión de sistema de la plataforma («Incluido por Nexo»); solo en `anthropic`, null en el resto. */
  platform: { configured: boolean; models: number } | null;
}

export interface SaveConnectionInput {
  name?: string;
  validated: ValidatedFields;
  models?: string[];
  discovered: string[];
}

const MAX_DISCOVERED = 1000;
const dedupe = (ids: string[]) => [...new Set(ids.map((i) => i.trim()).filter(Boolean))];

export function publicEntry(entry: ProviderCatalogEntry): ProviderPublicEntry {
  const { authHeader, verifyPath, headers, replayReasoning, ...rest } = entry;
  void authHeader;
  void verifyPath;
  void headers;
  void replayReasoning;
  return rest;
}

/**
 * Traduce un fallo de la prueba de conexión a un mensaje claro en español (clave inválida, URL no alcanzable,
 * SSRF...). Nunca incluye la clave.
 */
export function describeProbeError(err: unknown, entry: ProviderCatalogEntry, baseUrl: string): string {
  let host = baseUrl;
  try {
    host = new URL(baseUrl).host;
  } catch {
    // se usa la URL tal cual
  }
  if (err instanceof LlmHttpError) {
    const keyRejected =
      err.status === 401 ||
      err.status === 403 ||
      (err.status === 400 && /api[ _-]?key|unauthori[sz]ed|invalid[^.]*(key|token)/i.test(err.message));
    if (keyRejected) {
      return entry.auth === 'NONE'
        ? `El servidor ${host} exige autenticación (HTTP ${err.status}); configúrelo como conexión manual con clave.`
        : `${entry.name} rechazó la clave de API (HTTP ${err.status}). Verifique que esté completa, activa y con permisos.`;
    }
    if (err.status === 404) {
      return `La URL base no responde como una API compatible (HTTP 404 en ${host}). Revise los datos de la conexión.`;
    }
    if (err.status === 429) return `${entry.name} limitó las peticiones (HTTP 429). Intente de nuevo en unos minutos.`;
    return `${entry.name} respondió HTTP ${err.status}: ${err.message}`;
  }
  const e = err as Error & { cause?: { code?: string }; code?: string };
  const message = e?.message ?? String(err);
  if (message.startsWith('Destino bloqueado por política de red')) {
    return (
      `La URL ${host} apunta a una red privada y la política SSRF de Nexo la bloquea. Use Nexo Edge o una URL ` +
      'pública; en instalaciones on-premise el administrador puede habilitar CONNECTOR_ALLOW_PRIVATE_NETWORKS=true.'
    );
  }
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || /timed? ?out/i.test(message)) {
    return `${host} no respondió a tiempo. Verifique que el servicio esté en línea y sea alcanzable desde Nexo.`;
  }
  const code = e?.cause?.code ?? e?.code;
  if (code || /fetch failed|connection error|ENOTFOUND|ECONNREFUSED/i.test(message)) {
    return `No se pudo alcanzar ${host}${code ? ` (${code})` : ''}. Verifique la URL y que el servicio sea alcanzable desde Nexo.`;
  }
  return `No se pudo validar la conexión con ${entry.name}: ${message}`;
}

/** Catálogo de proveedores "conectar en un clic" (ADR 0002, D8). */
@Injectable()
export class LlmProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly gateway: LlmGatewayService,
    private readonly config: ConfigService,
  ) {}

  async list(workspaceId: string): Promise<{ providers: ProviderView[] }> {
    const rows = await this.prisma.llmConnection.findMany({
      where: { workspaceId, providerId: { not: null } },
      select: { id: true, name: true, enabled: true, providerId: true, _count: { select: { models: true } } },
      orderBy: { name: 'asc' },
    });
    const providers = PROVIDER_CATALOG.map((entry): ProviderView => ({
      ...publicEntry(entry),
      connected: rows
        .filter((r) => r.providerId === entry.id)
        .map((r) => ({ connectionId: r.id, name: r.name, modelCount: r._count.models, enabled: r.enabled })),
      modelCount: entry.suggestedModels.length,
      platform:
        entry.id === 'anthropic'
          ? { configured: this.gateway.platformAnthropicConfigured, models: SYSTEM_ANTHROPIC_MODELS.length }
          : null,
    }));
    return { providers };
  }

  provider(id: string): ProviderCatalogEntry {
    const entry = findProvider(id);
    if (!entry) throw new NotFoundException('Proveedor no encontrado en el catálogo');
    return entry;
  }

  /** Valida los campos y renderiza la URL base (con el override de configuración, si existe). */
  validate(entry: ProviderCatalogEntry, fields: Record<string, unknown>): ValidatedFields {
    try {
      const validated = validateProviderFields(entry, fields ?? {});
      const override = this.config.get<Record<string, string>>('llm.providerUrlOverrides')?.[entry.id];
      return override ? { ...validated, baseUrl: override.replace(/\/+$/, '') } : validated;
    } catch (err) {
      if (err instanceof ProviderFieldsError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  credentials(entry: ProviderCatalogEntry, v: Pick<ValidatedFields, 'apiKey' | 'baseUrl'>): LlmCredentials {
    return {
      apiKey: v.apiKey,
      baseUrl: v.baseUrl,
      authHeader: entry.authHeader,
      ...(entry.headers ? { headers: entry.headers } : {}),
      ...(entry.verifyPath ? { verifyPath: entry.verifyPath } : {}),
      ...(entry.replayReasoning ? { replayReasoning: true } : {}),
    };
  }

  /** Prueba la conexión (sin consumir tokens) y devuelve los modelos que expone el proveedor. */
  async probe(entry: ProviderCatalogEntry, validated: ValidatedFields): Promise<string[]> {
    const client = this.gateway.createClient(entry.kind, this.credentials(entry, validated));
    try {
      if (client.verify) await client.verify();
      else {
        const t = await client.test();
        if (!t.ok) throw new Error(t.message);
      }
    } catch (err) {
      throw new BadRequestException(describeProbeError(err, entry, validated.baseUrl));
    }
    const ids = await (client.listModels?.() ?? Promise.resolve([])).catch(() => [] as string[]);
    return ids.slice(0, MAX_DISCOVERED);
  }

  async connect(workspaceId: string, providerId: string, dto: ConnectProviderDto) {
    const entry = this.provider(providerId);
    const validated = this.validate(entry, dto.fields);
    const discovered = await this.probe(entry, validated);
    return this.saveConnection(workspaceId, entry, { name: dto.name, validated, models: dto.models, discovered });
  }

  /** Crea la conexión (clave cifrada) e importa los modelos elegidos o, por defecto, los sugeridos disponibles. */
  async saveConnection(workspaceId: string, entry: ProviderCatalogEntry, input: SaveConnectionInput) {
    const { validated, discovered } = input;
    let ids = input.models?.length
      ? dedupe(input.models)
      : entry.suggestedModels.filter((m) => !discovered.length || discovered.includes(m.id)).map((m) => m.id);
    // Azure: el despliegue es el "modelo" de la API v1.
    if (validated.values.deployment) ids = dedupe([validated.values.deployment, ...ids]);

    const models = ids.map((modelId) => {
      const s = entry.suggestedModels.find((m) => m.id === modelId);
      const priced = s?.inputUsdPerMTok !== undefined && s?.outputUsdPerMTok !== undefined;
      return {
        modelId,
        label: (s?.label ?? modelId).slice(0, 120),
        tier: s?.tier ?? 'STANDARD',
        inputUsdPerMTok: priced ? s.inputUsdPerMTok! : 0,
        outputUsdPerMTok: priced ? s.outputUsdPerMTok! : 0,
        cacheReadUsdPerMTok: priced ? (s.cacheReadUsdPerMTok ?? null) : null,
        // Los modelos locales no tienen costo por token; el resto debe completarse en la consola.
        needsPricing: !priced && entry.billing !== 'LOCAL',
      } satisfies Prisma.LlmModelCreateWithoutConnectionInput;
    });

    const driverOptions: Prisma.InputJsonObject = {
      authHeader: entry.authHeader,
      ...(entry.verifyPath ? { verifyPath: entry.verifyPath } : {}),
      ...(entry.replayReasoning ? { replayReasoning: true } : {}),
    };
    // Anthropic directo: sin baseUrl, el SDK usa su endpoint oficial (y el fallback server-side).
    const baseUrl = entry.kind === 'ANTHROPIC' && validated.baseUrl === entry.baseUrl ? null : validated.baseUrl;

    const row = await this.prisma.llmConnection.create({
      data: {
        workspaceId,
        name: input.name?.trim() || entry.name,
        kind: entry.kind,
        baseUrl,
        apiKeyCipher: validated.apiKey ? this.crypto.encrypt(validated.apiKey) : null,
        providerId: entry.id,
        providerFields: validated.values,
        ...(entry.headers ? { headers: entry.headers } : {}),
        driverOptions,
        models: { create: models },
      },
      include: { models: { orderBy: { label: 'asc' } } },
    });
    return {
      connection: serializeConnection(row),
      models: row.models.map(serializeModel),
      discoveredModels: discovered,
    };
  }

  async discover(workspaceId: string, providerId: string, connectionId: string | undefined) {
    const entry = this.provider(providerId);
    if (!connectionId) throw new BadRequestException('Indique connectionId');
    const connection = await this.prisma.llmConnection.findFirst({
      where: { id: connectionId, workspaceId },
      include: { models: { select: { modelId: true } } },
    });
    if (!connection) throw new NotFoundException('Conexión no encontrada');
    if (connection.providerId !== entry.id) {
      throw new BadRequestException(`La conexión no pertenece al proveedor ${entry.name}`);
    }
    const client = this.gateway.clientFor(connection);
    let ids: string[];
    try {
      ids = client.listModels ? await client.listModels() : [];
    } catch (err) {
      throw new BadRequestException(describeProbeError(err, entry, connection.baseUrl ?? entry.baseUrl));
    }
    const discovered = ids.slice(0, MAX_DISCOVERED);
    return {
      connectionId: connection.id,
      /** Ids que expone el proveedor (`/models`); `discoveredModels` es el mismo listado. */
      models: discovered,
      discoveredModels: discovered,
      importedModels: connection.models.map((m) => m.modelId).sort(),
    };
  }
}
