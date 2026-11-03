import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { ResolveRetentionPolicyDto, UpsertRetentionPolicyDto } from './dto/retention-policy.dto';
import { PrivacySettingsService } from './privacy-settings.service';
import { RetentionPolicyService } from './retention-policy.service';

/**
 * Políticas de retención/privacidad diferenciadas por organización/canal/tipo de información (P0.2 · decisión
 * Jurídica). Solo ADMIN/OWNER del cliente (cambios sensibles, auditados en E13). Todo filtra por `workspaceId` de
 * `@CurrentAuth()`: la consola de plataforma de Nexo no accede. No declara cumplimiento normativo ni valor probatorio.
 */
@ApiTags('data-protection')
@ApiBearerAuth()
@MinRole('ADMIN')
@Controller('admin/data-protection/retention-policies')
export class RetentionPolicyController {
  constructor(
    private readonly politicas: RetentionPolicyService,
    private readonly settings: PrivacySettingsService,
  ) {}

  @Get()
  list(@CurrentAuth() a: AuthContext) {
    return this.politicas.list(a.workspaceId);
  }

  /** Resuelve la política vigente de un alcance (la más específica aplicable; si no hay, la del workspace, 180 d). */
  @Get('resolve')
  async resolve(@CurrentAuth() a: AuthContext, @Query() q: ResolveRetentionPolicyDto) {
    const ws = await this.settings.get(a.workspaceId);
    return this.politicas.resolver(a.workspaceId, ws.conversationRetentionDays, {
      canal: q.canal,
      tipoInformacion: q.tipoInformacion,
    });
  }

  @Put()
  upsert(@CurrentAuth() a: AuthContext, @Body() dto: UpsertRetentionPolicyDto) {
    return this.politicas.upsert(a, dto);
  }

  @HttpCode(204)
  @Delete(':id')
  async remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.politicas.remove(a, id);
  }
}
