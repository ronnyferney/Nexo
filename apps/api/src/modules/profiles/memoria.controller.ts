import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { CreateMemoriaDto, UpdateMemoriaDto } from './dto/memoria.dto';
import { ProfilesService } from './profiles.service';

/**
 * Memoria operativa por proceso (ADR 0018 Inc.1, esquema base). Lectura para cualquier miembro; las mutaciones
 * requieren EDITOR+. Es CONTEXTO gobernado: nace PROPUESTO y requiere revisión para CONFIRMADO. La lógica de
 * enriquecimiento y caducidad vive en Inc.3. Todo filtra por el workspace del contexto autenticado (multi-tenant).
 */
@ApiTags('profiles-memoria')
@ApiBearerAuth()
@Controller('profiles/memoria')
export class MemoriaController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  @ApiQuery({ name: 'procesoClave', required: false, description: 'Filtra los hechos por proceso' })
  list(@CurrentAuth() a: AuthContext, @Query('procesoClave') procesoClave?: string) {
    return this.profiles.listMemorias(a.workspaceId, procesoClave);
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.profiles.getMemoria(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateMemoriaDto) {
    return this.profiles.createMemoria(a.workspaceId, dto);
  }

  @MinRole('EDITOR')
  @Patch(':id')
  update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateMemoriaDto) {
    return this.profiles.updateMemoria(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.profiles.removeMemoria(a.workspaceId, id);
  }
}
