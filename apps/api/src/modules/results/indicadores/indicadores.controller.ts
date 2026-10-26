import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../../common/decorators/current-user.decorator';
import { MinRole } from '../../../common/decorators/roles.decorator';
import { IndicadoresQueryDto } from './dto/indicadores-query.dto';
import { IndicadoresService } from './indicadores.service';

/**
 * Indicadores de resultado (E10 · RF27/RF28/RF30-métricas, sección 9). Solo lectura (VIEWER+). El alcance (empresa/
 * área/agente) y el período llegan por query; el `workspaceId` SIEMPRE de `@CurrentAuth()` (multi-tenant). Alimenta el
 * dashboard de resultados y las consolas gerenciales (E12).
 */
@ApiTags('indicadores')
@ApiBearerAuth()
@Controller('indicadores')
export class IndicadoresController {
  constructor(private readonly indicadores: IndicadoresService) {}

  /** KPIs de resultado del alcance/período: cumplimiento, calidad, tiempo de ciclo, costo por resultado, excepciones, etc. */
  @MinRole('VIEWER')
  @Get('resultados')
  resultados(@CurrentAuth() a: AuthContext, @Query() query: IndicadoresQueryDto) {
    return this.indicadores.resultados(a.workspaceId, query);
  }
}
