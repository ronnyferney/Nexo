import {
  Body,
  ConflictException,
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
    await this.connection(a.workspaceId, id);
    const { apiKey, ...rest } = dto;
    const row = await this.prisma.llmConnection.update({
      where: { id },
      data: { ...rest, ...(apiKey ? { apiKeyCipher: this.crypto.encrypt(apiKey) } : {}) },
      include: { models: { orderBy: { label: 'asc' } } },
    });
    return serializeConnection(row);
  }

  @Delete('connections/:id')
  async remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.connection(a.workspaceId, id);
    const inUse = await this.prisma.agent.count({ where: { workspaceId: a.workspaceId, provider: id } });
    if (inUse) throw new ConflictException(`La conexión está en uso por ${inUse} agente(s); reasígnelos primero`);
    await this.prisma.llmConnection.delete({ where: { id } });
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
