import { Body, Controller, Get, HttpCode, Logger, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { DataGuardService } from '../llm/data-guard/data-guard.service';
import { CATEGORY_LABELS, DATA_CATEGORIES } from '../llm/data-guard/detector';
import { TestDataPolicyDto, UpdateDataPolicyDto } from './dto/data-protection.dto';
import { PrivacySettingsService } from './privacy-settings.service';

/**
 * Política de protección de datos del workspace (ADR 0008 D2 y D7). Solo ADMIN/OWNER del cliente: la consola de
 * plataforma de Nexo no tiene acceso a estos endpoints ni al contenido de las conversaciones.
 */
@ApiTags('data-protection')
@ApiBearerAuth()
@MinRole('ADMIN')
@Controller('admin/data-protection')
export class DataProtectionController {
  private readonly logger = new Logger(DataProtectionController.name);

  constructor(
    private readonly settings: PrivacySettingsService,
    private readonly guard: DataGuardService,
  ) {}

  private async policyView(workspaceId: string) {
    const s = await this.settings.get(workspaceId);
    return {
      ...s,
      platformDefaultRetentionDays: this.settings.defaultRetentionDays,
      /** Las credenciales se ocultan siempre, en cualquier modo (no configurable). */
      credentials: 'BLOCK' as const,
      categories: DATA_CATEGORIES.map((id) => ({ id, label: CATEGORY_LABELS[id] })),
    };
  }

  @Get('policy')
  policy(@CurrentAuth() a: AuthContext) {
    return this.policyView(a.workspaceId);
  }

  @Put('policy')
  async update(@CurrentAuth() a: AuthContext, @Body() dto: UpdateDataPolicyDto) {
    await this.settings.update(
      a.workspaceId,
      {
        ...(dto.dataGuardMode !== undefined ? { dataGuardMode: dto.dataGuardMode } : {}),
        ...(dto.conversationRetentionDays !== undefined
          ? { conversationRetentionDays: dto.conversationRetentionDays ?? null }
          : {}),
      },
      a.userId,
    );
    // Trazabilidad sin contenido: quién cambió la política y a qué valores.
    this.logger.log(
      `Política de datos del workspace ${a.workspaceId} actualizada por ${a.userId ?? a.apiKeyId ?? 'desconocido'}: ` +
        `${JSON.stringify(dto)}`,
    );
    return this.policyView(a.workspaceId);
  }

  /** Prueba la política sobre un texto: hallazgos (posiciones, sin valores) y la vista que recibiría el modelo. */
  @HttpCode(200)
  @Post('test')
  test(@CurrentAuth() a: AuthContext, @Body() dto: TestDataPolicyDto) {
    return this.guard.preview(a.workspaceId, dto.text);
  }
}
