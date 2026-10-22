import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { API_KEY_PREFIX } from '../../common/guards/auth.guard';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateApiKeyDto, UpsertSecretDto } from './dto/workspace.dto';
import { SecretsService } from './secrets.service';

@ApiTags('workspace')
@ApiBearerAuth()
@Controller('workspace')
export class WorkspacesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
  ) {}

  @Get('stats')
  async stats(@CurrentAuth() { workspaceId }: AuthContext) {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const [connectors, agents, workflows, executions, failed] = await Promise.all([
      this.prisma.connector.count({ where: { workspaceId } }),
      this.prisma.agent.count({ where: { workspaceId } }),
      this.prisma.workflow.count({ where: { workspaceId } }),
      this.prisma.execution.count({ where: { workspaceId, createdAt: { gte: since } } }),
      this.prisma.execution.count({ where: { workspaceId, createdAt: { gte: since }, status: 'FAILED' } }),
    ]);
    return { connectors, agents, workflows, executionsLast7d: executions, failedLast7d: failed };
  }

  @Get('secrets')
  listSecrets(@CurrentAuth() { workspaceId }: AuthContext) {
    return this.secrets.list(workspaceId);
  }

  @MinRole('ADMIN')
  @Put('secrets')
  upsertSecret(@CurrentAuth() { workspaceId }: AuthContext, @Body() dto: UpsertSecretDto) {
    return this.secrets.upsert(workspaceId, dto.name, dto.value);
  }

  @MinRole('ADMIN')
  @Delete('secrets/:id')
  removeSecret(@CurrentAuth() { workspaceId }: AuthContext, @Param('id') id: string) {
    return this.secrets.remove(workspaceId, id);
  }

  @Get('api-keys')
  listKeys(@CurrentAuth() { workspaceId }: AuthContext) {
    return this.prisma.apiKey.findMany({
      where: { workspaceId },
      select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** La llave completa solo se muestra una vez, al crearla. */
  @MinRole('ADMIN')
  @Post('api-keys')
  async createKey(@CurrentAuth() { workspaceId }: AuthContext, @Body() dto: CreateApiKeyDto) {
    const key = `${API_KEY_PREFIX}${CryptoService.randomToken(32)}`;
    const row = await this.prisma.apiKey.create({
      data: { workspaceId, name: dto.name, prefix: key.slice(0, 12), hash: CryptoService.sha256(key) },
    });
    return { id: row.id, name: row.name, key };
  }

  @MinRole('ADMIN')
  @Delete('api-keys/:id')
  async removeKey(@CurrentAuth() { workspaceId }: AuthContext, @Param('id') id: string) {
    await this.prisma.apiKey.deleteMany({ where: { id, workspaceId } });
  }
}
