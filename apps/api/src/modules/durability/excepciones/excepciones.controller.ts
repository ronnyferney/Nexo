import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../../common/decorators/current-user.decorator';
import { MinRole } from '../../../common/decorators/roles.decorator';
import {
  AportarInfoDto,
  CancelarExcepcionDto,
  ConciliarExcepcionDto,
  ExcepcionesQueryDto,
  ReasignarExcepcionDto,
} from './dto/excepcion.dto';
import { ExcepcionesService } from './excepciones.service';

/**
 * Bandeja de excepciones (E7 · RF21). Consultar para cualquier miembro del workspace; las acciones (aportar info,
 * reintentar, reasignar, cancelar, conciliar) exigen EDITOR+. Todo filtra por `workspaceId` de `@CurrentAuth()`.
 */
@ApiTags('durability-exceptions')
@ApiBearerAuth()
@Controller('excepciones')
export class ExcepcionesController {
  constructor(private readonly excepciones: ExcepcionesService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext, @Query() q: ExcepcionesQueryDto) {
    return this.excepciones.list(a.workspaceId, q);
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.excepciones.get(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post(':id/info')
  @HttpCode(200)
  aportarInfo(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: AportarInfoDto) {
    return this.excepciones.aportarInfo(a.workspaceId, id, dto, a.userId);
  }

  @MinRole('EDITOR')
  @Post(':id/reintentar')
  @HttpCode(200)
  reintentar(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.excepciones.reintentar(a.workspaceId, id, a.userId);
  }

  @MinRole('EDITOR')
  @Post(':id/reasignar')
  @HttpCode(200)
  reasignar(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: ReasignarExcepcionDto) {
    return this.excepciones.reasignar(a.workspaceId, id, dto, a.userId);
  }

  @MinRole('EDITOR')
  @Post(':id/cancelar')
  @HttpCode(200)
  cancelar(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CancelarExcepcionDto) {
    return this.excepciones.cancelar(a.workspaceId, id, dto, a.userId);
  }

  @MinRole('EDITOR')
  @Post(':id/conciliar')
  @HttpCode(200)
  conciliar(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: ConciliarExcepcionDto) {
    return this.excepciones.conciliar(a.workspaceId, id, dto, a.userId);
  }
}
