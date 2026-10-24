import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Connector, ConnectorOperation, ConnectorType, Prisma } from '@prisma/client';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { ROLE_RANK } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SecretsService } from '../workspaces/secrets.service';
import { CONNECTOR_ADAPTERS, type ConnectorAdapter, type DiscoverOptions } from './domain/connector-adapter';
import type { ConnectorAuth, ConnectorRuntime, InvocationResult } from './domain/connector.types';
import { assertSafeSchemaPatterns, safeRegExp, UnsafePatternError } from './domain/safe-pattern';
import {
  assertSecretRefsAllowed,
  collectSecretRefs,
  destinationFingerprint,
  disallowedSecretRefs,
} from './domain/secret-refs';
import { CreateConnectorDto, CreateOperationDto, UpdateConnectorDto, UpdateOperationDto } from './dto/connector.dto';

const json = (v: unknown) => v as Prisma.InputJsonValue;
const isAdmin = (a: AuthContext) => ROLE_RANK[a.role] >= ROLE_RANK.ADMIN;

/**
 * Secretos que un ADMIN/OWNER autoriza implícitamente al guardar: los que su propio cambio introduce (no estaban en la
 * versión guardada). Así un ADMIN que guarda una configuración donde un EDITOR dejó una referencia no la aprueba sin
 * querer; esa solo se aprueba de forma explícita en «Secretos permitidos».
 */
function introducedRefs(before: unknown[], after: unknown[]): string[] {
  const prev = new Set(collectSecretRefs(...before).names);
  return collectSecretRefs(...after).names.filter((n) => !prev.has(n));
}
const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])].sort();

@Injectable()
export class ConnectorsService {
  private readonly adapters: Map<ConnectorType, ConnectorAdapter>;
  // `safeRegExp`: los `pattern` de los esquemas se evalúan con límites anti-ReDoS (ver domain/safe-pattern.ts).
  private readonly ajv = addFormats(
    new Ajv({ allErrors: true, strict: false, coerceTypes: true, code: { regExp: safeRegExp } }),
  );
  private readonly validators = new Map<string, { updatedAt: number; fn: ValidateFunction }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    @Inject(CONNECTOR_ADAPTERS) adapters: ConnectorAdapter[],
  ) {
    this.adapters = new Map(adapters.map((a) => [a.type, a]));
  }

  // ---------- Conectores ----------
  list(workspaceId: string) {
    return this.prisma.connector.findMany({
      where: { workspaceId },
      include: { _count: { select: { operations: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async get(workspaceId: string, id: string) {
    const c = await this.prisma.connector.findFirst({
      where: { id, workspaceId },
      include: { operations: { orderBy: { name: 'asc' } } },
    });
    if (!c) throw new NotFoundException('Conector no encontrado');
    return c;
  }

  /** Detalle para la API: incluye las referencias a secretos y cuáles están bloqueadas (sin consultar la bóveda). */
  async usage(workspaceId: string, id: string) {
    const opIds = new Set((await this.get(workspaceId, id)).operations.map((o) => o.id));
    const agents = await this.prisma.agent.findMany({
      where: { workspaceId, tools: { some: { operation: { connectorId: id } } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    // Los flujos guardan la operación dentro de la definición (JSON): se revisan sus nodos de conector.
    const workflows = (
      await this.prisma.workflow.findMany({
        where: { workspaceId },
        select: { id: true, name: true, active: true, definition: true },
        orderBy: { name: 'asc' },
      })
    )
      .filter((w) =>
        (
          (w.definition as { nodes?: { type?: string; config?: { operationId?: unknown } }[] } | null)?.nodes ?? []
        ).some(
          (n) => n.type === 'connector' && typeof n.config?.operationId === 'string' && opIds.has(n.config.operationId),
        ),
      )
      .map((w) => ({ id: w.id, name: w.name, active: w.active }));
    return { agents, workflows };
  }

  async detail(workspaceId: string, id: string) {
    return this.withSecretStatus(await this.get(workspaceId, id));
  }

  /**
   * Un EDITOR (o una API key) crea el conector sin secretos permitidos: sus referencias quedan bloqueadas hasta que
   * un ADMIN las autorice. Si lo crea un ADMIN, se permiten las referencias que escribió.
   */
  async create(a: AuthContext, dto: CreateConnectorDto) {
    const auth = dto.auth ?? { type: 'none' };
    const created = await this.prisma.connector.create({
      data: {
        ...dto,
        workspaceId: a.workspaceId,
        config: json(dto.config),
        auth: json(auth),
        allowedSecrets: isAdmin(a) ? collectSecretRefs(dto.config, auth).names : [],
      },
    });
    return this.withSecretStatus({ ...created, operations: [] });
  }

  /** Editar nunca amplía la lista para un EDITOR; un ADMIN aprueba solo las referencias que su cambio introduce. */
  async update(a: AuthContext, id: string, dto: UpdateConnectorDto) {
    const current = await this.get(a.workspaceId, id);
    // Sin esto, un EDITOR apuntaría un conector ya autorizado a su servidor y recibiría sus secretos.
    if (
      !isAdmin(a) &&
      current.allowedSecrets.length &&
      destinationFingerprint(current.config, current.auth) !==
        destinationFingerprint(dto.config ?? current.config, dto.auth ?? current.auth)
    ) {
      throw new ForbiddenException(
        'Solo un administrador puede cambiar el destino (URL, host, puerto o URLs OAuth) de un conector con secretos ' +
          'permitidos: sus credenciales se enviarían a otro servidor',
      );
    }
    const allowedSecrets = isAdmin(a)
      ? union(
          current.allowedSecrets,
          introducedRefs([current.config, current.auth], [dto.config ?? current.config, dto.auth ?? current.auth]),
        )
      : undefined;
    await this.prisma.connector.update({
      where: { id },
      data: {
        ...dto,
        config: dto.config ? json(dto.config) : undefined,
        auth: dto.auth ? json(dto.auth) : undefined,
        allowedSecrets,
      },
    });
    return this.detail(a.workspaceId, id);
  }

  /** `PUT /connectors/:id/allowed-secrets` (ADMIN): reemplaza la lista de secretos que el conector puede resolver. */
  async setAllowedSecrets(workspaceId: string, id: string, names: string[]) {
    await this.get(workspaceId, id);
    await this.prisma.connector.update({ where: { id }, data: { allowedSecrets: union([], names) } });
    return this.detail(workspaceId, id);
  }

  async remove(workspaceId: string, id: string) {
    await this.get(workspaceId, id);
    await this.prisma.connector.delete({ where: { id } });
  }

  // ---------- Operaciones ----------
  async createOperation(a: AuthContext, connectorId: string, dto: CreateOperationDto) {
    const connector = await this.get(a.workspaceId, connectorId);
    assertSchemaPatterns(dto.inputSchema);
    if (isAdmin(a)) await this.allowIntroduced(connector, [], [dto.definition]);
    return this.prisma.connectorOperation.create({
      data: {
        ...dto,
        connectorId,
        definition: json(dto.definition),
        inputSchema: json(dto.inputSchema ?? { type: 'object', properties: {} }),
      },
    });
  }

  async updateOperation(a: AuthContext, connectorId: string, opId: string, dto: UpdateOperationDto) {
    const op = await this.getOperation(a.workspaceId, opId, connectorId);
    assertSchemaPatterns(dto.inputSchema);
    if (isAdmin(a) && dto.definition) await this.allowIntroduced(op.connector, [op.definition], [dto.definition]);
    return this.prisma.connectorOperation.update({
      where: { id: opId },
      data: {
        ...dto,
        definition: dto.definition ? json(dto.definition) : undefined,
        inputSchema: dto.inputSchema ? json(dto.inputSchema) : undefined,
      },
    });
  }

  async removeOperation(workspaceId: string, connectorId: string, opId: string) {
    await this.getOperation(workspaceId, opId, connectorId);
    await this.prisma.connectorOperation.delete({ where: { id: opId } });
  }

  async getOperation(workspaceId: string, opId: string, connectorId?: string) {
    const op = await this.prisma.connectorOperation.findFirst({
      where: { id: opId, ...(connectorId ? { connectorId } : {}), connector: { workspaceId } },
      include: { connector: true },
    });
    if (!op) throw new NotFoundException('Operación no encontrada');
    return op;
  }

  // ---------- Runtime ----------
  async test(workspaceId: string, id: string) {
    const connector = await this.get(workspaceId, id);
    try {
      return await this.adapter(connector.type).test(await this.runtime(connector));
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  /** Descubre operaciones (OpenAPI, WSDL o tools MCP) y las sincroniza por `key`. */
  async discover(workspaceId: string, id: string, options?: DiscoverOptions) {
    const connector = await this.get(workspaceId, id);
    const adapter = this.adapter(connector.type);
    if (!adapter.discover)
      throw new BadRequestException(`El tipo ${connector.type} no soporta descubrimiento automático`);
    // Fuera del try: un secreto no permitido responde 403 con su propio mensaje, no como fallo del descubrimiento.
    const runtime = await this.runtime(connector);
    let discovered;
    try {
      discovered = await adapter.discover(runtime, options);
    } catch (err) {
      throw new BadRequestException(`Descubrimiento fallido: ${(err as Error).message}`);
    }
    await this.prisma.$transaction(
      discovered.map((op) =>
        this.prisma.connectorOperation.upsert({
          where: { connectorId_key: { connectorId: id, key: op.key } },
          create: { ...op, connectorId: id, inputSchema: json(op.inputSchema), definition: json(op.definition) },
          update: {
            name: op.name,
            description: op.description,
            inputSchema: json(op.inputSchema),
            definition: json(op.definition),
          },
        }),
      ),
    );
    return { imported: discovered.length, operations: discovered.map((o) => o.key) };
  }

  /** Tablas, vistas y columnas de un conector de base de datos. */
  async schema(workspaceId: string, id: string) {
    const connector = await this.get(workspaceId, id);
    const adapter = this.adapter(connector.type);
    if (!adapter.describeSchema)
      throw new BadRequestException(`El tipo ${connector.type} no expone un esquema de datos`);
    const runtime = await this.runtime(connector);
    try {
      return await adapter.describeSchema(runtime);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new BadRequestException(`No se pudo leer el esquema: ${(err as Error).message}`);
    }
  }

  async invokeById(workspaceId: string, opId: string, input: Record<string, unknown>): Promise<InvocationResult> {
    return this.invoke(await this.getOperation(workspaceId, opId), input);
  }

  async invoke(
    op: ConnectorOperation & { connector: Connector },
    input: Record<string, unknown>,
  ): Promise<InvocationResult> {
    this.validateInput(op, input);
    const definition = op.definition as Record<string, unknown>;
    return this.adapter(op.connector.type).invoke(
      await this.runtime(op.connector, definition),
      { key: op.key, definition },
      input,
    );
  }

  private validateInput(op: ConnectorOperation, input: Record<string, unknown>): void {
    const cached = this.validators.get(op.id);
    let validate = cached?.updatedAt === op.updatedAt.getTime() ? cached.fn : undefined;
    let valid: boolean;
    try {
      if (!validate) {
        validate = this.ajv.compile(op.inputSchema as object);
        this.validators.set(op.id, { updatedAt: op.updatedAt.getTime(), fn: validate });
      }
      valid = validate(input);
    } catch (err) {
      if (err instanceof UnsafePatternError)
        throw new BadRequestException(`Entrada inválida para "${op.key}": ${err.message}`);
      throw err;
    }
    if (!valid) {
      const msg = (validate.errors ?? []).map((e) => `${e.instancePath || 'input'} ${e.message}`).join('; ');
      throw new BadRequestException(`Entrada inválida para "${op.key}": ${msg}`);
    }
  }

  private adapter(type: ConnectorType): ConnectorAdapter {
    const a = this.adapters.get(type);
    if (!a) throw new BadRequestException(`Tipo de conector no soportado: ${type}`);
    return a;
  }

  /**
   * Contexto de ejecución. Solo se descifran los secretos que la configuración, la autenticación y (si se invoca) la
   * definición de la operación referencian, y únicamente si están en `allowedSecrets` (A4): cualquier otra
   * referencia falla con 403 antes de leer la bóveda.
   */
  private async runtime(c: Connector, definition?: Record<string, unknown>): Promise<ConnectorRuntime> {
    const names = assertSecretRefsAllowed(collectSecretRefs(c.config, c.auth, definition), c.allowedSecrets);
    return {
      id: c.id,
      workspaceId: c.workspaceId,
      type: c.type,
      config: c.config as Record<string, unknown>,
      auth: c.auth as unknown as ConnectorAuth,
      secrets: await this.secrets.resolveMany(c.workspaceId, names),
    };
  }

  /** Agrega a la lista los secretos que introduce un cambio hecho por un ADMIN (ver `introducedRefs`). */
  private async allowIntroduced(c: Connector, before: unknown[], after: unknown[]): Promise<void> {
    const added = introducedRefs(before, after).filter((n) => !c.allowedSecrets.includes(n));
    if (!added.length) return;
    await this.prisma.connector.update({
      where: { id: c.id },
      data: { allowedSecrets: union(c.allowedSecrets, added) },
    });
  }

  /** Referencias a secretos del conector (configuración, autenticación y operaciones) y las que están bloqueadas. */
  private withSecretStatus<T extends Connector & { operations: ConnectorOperation[] }>(c: T) {
    const refs = collectSecretRefs(
      c.config,
      c.auth,
      c.operations.map((o) => o.definition),
    );
    return {
      ...c,
      secretReferences: refs.wholeVault ? ['secrets', ...refs.names] : refs.names,
      blockedSecrets: disallowedSecretRefs(refs, c.allowedSecrets),
    };
  }
}

/** Rechaza con 400 un `inputSchema` cuyos `pattern` no cumplen la política anti-ReDoS. */
function assertSchemaPatterns(schema: unknown): void {
  try {
    assertSafeSchemaPatterns(schema);
  } catch (err) {
    if (err instanceof UnsafePatternError) throw new BadRequestException(err.message);
    throw err;
  }
}
