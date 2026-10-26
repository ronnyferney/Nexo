import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { CrewsService } from './crews.service';
import { CreateCrewDto, CreateCrewVersionDto, InstantiateCrewDto } from './dto/crew.dto';

/**
 * Cuadrillas (ADR 0014 · D1 · E11): plantillas de equipo gobernadas y declarativas. Lectura del catálogo para cualquier
 * miembro (VIEWER+, filtrado por `workspaceId`). Definir/versionar/publicar/retirar: `@MinRole('ADMIN')` —la dotación de
 * empleados digitales la autoriza una persona con rol suficiente (ADR 0014 D1; "Nunca un agente"), más exigente que una
 * mutación de datos corriente. Instanciar: `@MinRole('EDITOR')`. `workspaceId` siempre de `@CurrentAuth`, nunca del cuerpo.
 */
@ApiTags('cuadrillas')
@ApiBearerAuth()
@Controller('crews')
export class CrewsController {
  constructor(private readonly crews: CrewsService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext, @Query('estado') estado?: string) {
    return this.crews.list(a.workspaceId, estado);
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.crews.get(a.workspaceId, id);
  }

  @Get(':id/instances')
  instances(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.crews.listInstancias(a.workspaceId, id);
  }

  @MinRole('ADMIN')
  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateCrewDto) {
    return this.crews.create(a, dto);
  }

  @MinRole('ADMIN')
  @Post(':id/versions')
  addVersion(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CreateCrewVersionDto) {
    return this.crews.addVersion(a, id, dto);
  }

  @MinRole('ADMIN')
  @Post(':id/publish')
  publish(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.crews.publish(a, id);
  }

  @MinRole('ADMIN')
  @Post(':id/retire')
  retire(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.crews.retire(a, id);
  }

  @MinRole('EDITOR')
  @Post(':id/instantiate')
  instantiate(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: InstantiateCrewDto) {
    return this.crews.instantiate(a, id, dto);
  }
}
