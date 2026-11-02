import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { BuscarOrganizacionPorDominioDto, CreateOrganizacionDto, UpdateOrganizacionDto } from './dto/organizacion.dto';
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

  // Ruta estática ANTES de `:id`. La consume la ficha del buzón (Inc.4) para resolver la organización de un dominio.
  @ApiOperation({ summary: 'Resuelve el perfil de organización por su dominio (ficha del buzón)' })
  @Get('por-dominio')
  porDominio(@CurrentAuth() a: AuthContext, @Query() query: BuscarOrganizacionPorDominioDto) {
    return this.profiles.getOrganizacionPorDominio(a.workspaceId, query.dominio);
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
