import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { SetParametrosEjecucionDto } from './dto/parametros-ejecucion.dto';
import { ExecutionParamsService } from './execution-params.service';

/**
 * Parámetros de ejecución del empleado digital (E8): estación virtual, salida a internet y parámetros extensibles.
 * Lectura para cualquier miembro (VIEWER+); fijarlos exige EDITOR (quien edita el expediente del empleado digital,
 * coherente con la asignación de cargo). Ruta propia `/execution-params/:agentId` para no acoplar este módulo al
 * controlador de agentes (de otra cédula). `workspaceId` SIEMPRE de `@CurrentAuth()` (multi-tenant).
 */
@ApiTags('execution-params')
@ApiBearerAuth()
@Controller('execution-params')
export class ExecutionParamsController {
  constructor(private readonly params: ExecutionParamsService) {}

  @MinRole('VIEWER')
  @Get(':agentId')
  get(@CurrentAuth() a: AuthContext, @Param('agentId') agentId: string) {
    return this.params.get(a.workspaceId, agentId);
  }

  @MinRole('EDITOR')
  @Put(':agentId')
  set(@CurrentAuth() a: AuthContext, @Param('agentId') agentId: string, @Body() dto: SetParametrosEjecucionDto) {
    return this.params.set(a, agentId, dto);
  }
}
