import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../../../common/decorators/current-user.decorator';
import { MinRole } from '../../../../common/decorators/roles.decorator';
import { GrabacionConfigQueryDto, PutGrabacionConfigDto } from './dto/grabacion-config.dto';
import { GrabacionConfigService } from './grabacion-config.service';

/**
 * Controles configurables de grabación/retención por empresa (E14 · ADR 0015 D3/D4 · decisión Jurídica D7). TODO
 * OFF/null por defecto. Leer basta con VIEWER; modificar exige ADMIN+ (es un cambio sensible, auditado en E13).
 * `workspaceId` siempre de `@CurrentAuth()`. No declara cumplimiento normativo ni valor probatorio: solo controles
 * técnicos.
 */
@ApiTags('voz')
@ApiBearerAuth()
@Controller('grabacion-config')
export class GrabacionConfigController {
  constructor(private readonly grabacion: GrabacionConfigService) {}

  @Get()
  get(@CurrentAuth() a: AuthContext, @Query() query: GrabacionConfigQueryDto) {
    return this.grabacion.get(a.workspaceId, query.empresaId);
  }

  @MinRole('ADMIN')
  @Put(':empresaId')
  upsert(@CurrentAuth() a: AuthContext, @Param('empresaId') empresaId: string, @Body() dto: PutGrabacionConfigDto) {
    return this.grabacion.upsert(a, empresaId, dto);
  }
}
