import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { BuscarContactoPorCorreoDto, CreateContactoDto, UpdateContactoDto } from './dto/contacto.dto';
import { ProfilesService } from './profiles.service';

/**
 * Perfiles de contacto/persona (ADR 0018 Inc.1). Lectura para cualquier miembro; las mutaciones requieren EDITOR+.
 * Todo filtra por el workspace del contexto autenticado (multi-tenant). Son CONTEXTO, no conceden permisos.
 */
@ApiTags('profiles-contactos')
@ApiBearerAuth()
@Controller('profiles/contactos')
export class ContactosController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext) {
    return this.profiles.listContactos(a.workspaceId);
  }

  // Ruta estática ANTES de `:id` para que `por-correo` no se interprete como un id. La consume la ficha del buzón
  // (Inc.4) para resolver a quién escribe un remitente. Lectura para cualquier miembro del workspace.
  @ApiOperation({ summary: 'Resuelve el perfil de contacto por su correo (ficha del buzón)' })
  @Get('por-correo')
  porCorreo(@CurrentAuth() a: AuthContext, @Query() query: BuscarContactoPorCorreoDto) {
    return this.profiles.getContactoPorCorreo(a.workspaceId, query.correo);
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.profiles.getContacto(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateContactoDto) {
    return this.profiles.createContacto(a.workspaceId, dto);
  }

  @MinRole('EDITOR')
  @Patch(':id')
  update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateContactoDto) {
    return this.profiles.updateContacto(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.profiles.removeContacto(a.workspaceId, id);
  }
}
