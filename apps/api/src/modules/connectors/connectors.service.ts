import { BadRequestException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Connector, ConnectorOperation, ConnectorType, Prisma } from '@prisma/client';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SecretsService } from '../workspaces/secrets.service';
import { CONNECTOR_ADAPTERS, type ConnectorAdapter, type DiscoverOptions } from './domain/connector-adapter';
import type { ConnectorAuth, ConnectorRuntime, InvocationResult } from './domain/connector.types';
import { assertSafeSchemaPatterns, safeRegExp, UnsafePatternError } from './domain/safe-pattern';
import { CreateConnectorDto, CreateOperationDto, UpdateConnectorDto, UpdateOperationDto } from './dto/connector.dto';

const json = (v: unknown) => v as Prisma.InputJsonValue;

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

  create(workspaceId: string, dto: CreateConnectorDto) {
    return this.prisma.connector.create({
      data: { ...dto, workspaceId, config: json(dto.config), auth: json(dto.auth ?? { type: 'none' }) },
    });
  }

  async update(workspaceId: string, id: string, dto: UpdateConnectorDto) {
    await this.get(workspaceId, id);
    return this.prisma.connector.update({
      where: { id },
      data: {
        ...dto,
        config: dto.config ? json(dto.config) : undefined,
        auth: dto.auth ? json(dto.auth) : undefined,
      },
    });
  }

  async remove(workspaceId: string, id: string) {
    await this.get(workspaceId, id);
    await this.prisma.connector.delete({ where: { id } });
  }

  // ---------- Operaciones ----------
  async createOperation(workspaceId: string, connectorId: string, dto: CreateOperationDto) {
    await this.get(workspaceId, connectorId);
    assertSchemaPatterns(dto.inputSchema);
    return this.prisma.connectorOperation.create({
      data: {
        ...dto,
        connectorId,
        definition: json(dto.definition),
        inputSchema: json(dto.inputSchema ?? { type: 'object', properties: {} }),
      },
    });
  }

  async updateOperation(workspaceId: string, connectorId: string, opId: string, dto: UpdateOperationDto) {
    await this.getOperation(workspaceId, opId, connectorId);
    assertSchemaPatterns(dto.inputSchema);
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
    let discovered;
    try {
      discovered = await adapter.discover(await this.runtime(connector), options);
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
    try {
      return await adapter.describeSchema(await this.runtime(connector));
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
    return this.adapter(op.connector.type).invoke(
      await this.runtime(op.connector),
      { key: op.key, definition: op.definition as Record<string, unknown> },
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

  private async runtime(c: Connector): Promise<ConnectorRuntime> {
    return {
      id: c.id,
      workspaceId: c.workspaceId,
      type: c.type,
      config: c.config as Record<string, unknown>,
      auth: c.auth as unknown as ConnectorAuth,
      secrets: await this.secrets.resolveAll(c.workspaceId),
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
