import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { CreateOrganizacionDto, UpdateOrganizacionDto } from './dto/organizacion.dto';
import { ProfilesService } from './profiles.service';

/**
 * Perfiles de organización (ADR 0018 Inc.1). Lectura para cualquier miembro; las mutaciones requieren EDITOR+.
 * Todo filtra por el workspace del contexto autenticado (multi-tenant).
 */
@ApiTags('profiles-organizaciones')
@ApiBearerAuth()
@Controller('profiles/organizaciones')
export class OrganizacionesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext) {
    return this.profiles.listOrganizaciones(a.workspaceId);
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.profiles.getOrganizacion(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateOrganizacionDto) {
    return this.profiles.createOrganizacion(a.workspaceId, dto);
  }

  @MinRole('EDITOR')
  @Patch(':id')
  update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateOrganizacionDto) {
    return this.profiles.updateOrganizacion(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.profiles.removeOrganizacion(a.workspaceId, id);
  }
}
