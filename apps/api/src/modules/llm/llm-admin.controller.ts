import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { LlmConnection } from '@prisma/client';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  CreateLlmConnectionDto,
  CreateLlmModelDto,
  UpdateLlmConnectionDto,
  UpdateLlmModelDto,
} from './dto/llm-admin.dto';
import { LlmGatewayService } from './llm-gateway.service';
import { serializeConnection, serializeModel } from './llm-serializers';
import { LlmTokenService } from './llm-token.service';
import { LlmUsageService } from './llm-usage.service';

/** Catálogo visible para todos los roles (selectores de modelo). */
@ApiTags('llm')
@ApiBearerAuth()
@Controller('llm')
export class LlmCatalogController {
  constructor(private readonly gateway: LlmGatewayService) {}

  @Get('catalog')
  catalog(@CurrentAuth() a: AuthContext) {
    return this.gateway.catalog(a.workspaceId);
  }
}

/**
 * Las credenciales guardadas (clave cifrada o token OAuth) nunca viajan a un destino distinto del que se verificó al
 * conectarlas: un administrador no debe poder redirigir hacia un host propio una clave que la consola no le muestra.
 * - Conexiones del catálogo (`providerId`) o con inicio de sesión: URL y tipo inmutables (se vuelven a conectar).
 * - Conexiones manuales: cambiar URL o tipo exige ingresar de nuevo la clave en la misma petición.
 * - Una conexión OAuth no acepta una clave de API (sus tokens los gestiona el inicio de sesión).
 */
export function assertSafeDestinationChange(
  c: Pick<LlmConnection, 'providerId' | 'credentialType' | 'baseUrl' | 'kind'>,
  dto: UpdateLlmConnectionDto,
): void {
  const baseUrlChanges = dto.baseUrl !== undefined && (dto.baseUrl || null) !== (c.baseUrl || null);
  const kindChanges = dto.kind !== undefined && dto.kind !== c.kind;
  if (c.credentialType === 'OAUTH' && dto.apiKey) {
    throw new BadRequestException('Esta conexión usa inicio de sesión: no admite una clave de API');
  }
  if (!baseUrlChanges && !kindChanges) return;
  if (c.providerId || c.credentialType === 'OAUTH') {
    throw new BadRequestException(
      'La URL y el tipo de una conexión del catálogo no se pueden cambiar: conecte el proveedor de nuevo',
    );
  }
  if (!dto.apiKey) {
    throw new BadRequestException(
      'Para cambiar la URL o el tipo de la conexión ingrese de nuevo la clave: la guardada no se envía a un destino nuevo',
    );
  }
}

/** Administración de proveedores y tarifas (solo ADMIN/OWNER). */
@ApiTags('admin-llm')
@ApiBearerAuth()
@MinRole('ADMIN')
@Controller('admin/llm')
export class LlmAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly gateway: LlmGatewayService,
    private readonly tokens: LlmTokenService,
    private readonly usage: LlmUsageService,
  ) {}

  @Get('connections')
  async list(@CurrentAuth() a: AuthContext) {
    const rows = await this.prisma.llmConnection.findMany({
      where: { workspaceId: a.workspaceId },
      include: { models: { orderBy: { label: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    return rows.map(serializeConnection);
  }

  @Post('connections')
  async create(@CurrentAuth() a: AuthContext, @Body() dto: CreateLlmConnectionDto) {
    const { apiKey, ...rest } = dto;
    const row = await this.prisma.llmConnection.create({
      data: { ...rest, workspaceId: a.workspaceId, apiKeyCipher: apiKey ? this.crypto.encrypt(apiKey) : null },
      include: { models: true },
    });
    return serializeConnection(row);
  }

  @Patch('connections/:id')
  async update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateLlmConnectionDto) {
    const c = await this.connection(a.workspaceId, id);
    const { apiKey, ...rest } = dto;
    assertSafeDestinationChange(c, dto);
    const row = await this.prisma.llmConnection.update({
      where: { id },
      data: { ...rest, ...(apiKey ? { apiKeyCipher: this.crypto.encrypt(apiKey) } : {}) },
      include: { models: { orderBy: { label: 'asc' } } },
    });
    return serializeConnection(row);
  }

  /** Borra la conexión; si es OAuth y el proveedor documenta revocación (Google), revoca antes el grant. */
  @Delete('connections/:id')
  async remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    const c = await this.connection(a.workspaceId, id);
    await this.usage.assertUnused(a.workspaceId, id);
    const revoked = await this.tokens.revoke(c);
    await this.prisma.llmConnection.delete({ where: { id } });
    return { deleted: true, revoked };
  }

  /**
   * «Cerrar sesión» de una conexión OAuth: revoca el grant si el proveedor lo permite y borra los tokens, pero conserva
   * la conexión, sus modelos y tarifas y los agentes que la usan. Mientras la sesión esté cerrada, las llamadas fallan
   * con un mensaje claro; «Volver a iniciar sesión» (`oauth/start` o `device/start` con `connectionId`) la reactiva.
   */
  @HttpCode(200)
  @Post('connections/:id/sign-out')
  async signOut(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    const c = await this.connection(a.workspaceId, id);
    if (c.credentialType !== 'OAUTH') {
      throw new BadRequestException(
        'Solo las conexiones con inicio de sesión admiten «Cerrar sesión»; use «Desconectar»',
      );
    }
    const revoked = await this.tokens.revoke(c);
    const row = await this.prisma.llmConnection.update({
      where: { id },
      data: { apiKeyCipher: null, oauthRefreshCipher: null, oauthExpiresAt: null },
      include: { models: { orderBy: { label: 'asc' } } },
    });
    return { connection: serializeConnection(row), revoked };
  }

  /** Agentes que usan la conexión (principal o respaldo): la consola los muestra antes de deshabilitar o borrar. */
  @Get('connections/:id/usage')
  async connectionUsage(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.connection(a.workspaceId, id);
    return this.usage.usage(a.workspaceId, id);
  }

  /** Modelos de la conexión con nivel, especialidades, contexto y tarifas (filtros de la consola). */
  @Get('connections/:id/models')
  async models(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.connection(a.workspaceId, id);
    const rows = await this.prisma.llmModel.findMany({ where: { connectionId: id }, orderBy: { label: 'asc' } });
    return rows.map(serializeModel);
  }

  @HttpCode(200)
  @Post('connections/:id/test')
  async test(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.gateway.test(await this.connection(a.workspaceId, id));
  }

  @Post('connections/:id/models')
  async createModel(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CreateLlmModelDto) {
    await this.connection(a.workspaceId, id);
    const row = await this.prisma.llmModel.create({ data: { ...dto, connectionId: id } });
    await this.touch(id);
    return serializeModel(row);
  }

  @Patch('models/:id')
  async updateModel(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateLlmModelDto) {
    const model = await this.model(a.workspaceId, id);
    // Al fijar una tarifa, el modelo deja de estar pendiente de precio.
    const priced = dto.inputUsdPerMTok !== undefined || dto.outputUsdPerMTok !== undefined;
    const row = await this.prisma.llmModel.update({
      where: { id },
      data: { ...dto, ...(priced ? { needsPricing: false } : {}) },
    });
    await this.touch(model.connectionId);
    return serializeModel(row);
  }

  @Delete('models/:id')
  async removeModel(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    const model = await this.model(a.workspaceId, id);
    await this.usage.assertUnused(a.workspaceId, model.connectionId, model.modelId);
    await this.prisma.llmModel.delete({ where: { id } });
    await this.touch(model.connectionId);
  }

  private async connection(workspaceId: string, id: string) {
    const c = await this.prisma.llmConnection.findFirst({ where: { id, workspaceId } });
    if (!c) throw new NotFoundException('Conexión no encontrada');
    return c;
  }

  private async model(workspaceId: string, id: string) {
    const m = await this.prisma.llmModel.findFirst({ where: { id, connection: { workspaceId } } });
    if (!m) throw new NotFoundException('Modelo no encontrado');
    return m;
  }

  /** Invalida la caché de clientes del gateway (la clave incluye updatedAt). */
  private async touch(connectionId: string) {
    await this.prisma.llmConnection.update({ where: { id: connectionId }, data: { updatedAt: new Date() } });
  }
}
