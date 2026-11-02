import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { CreateMemoriaDto, UpdateMemoriaDto } from './dto/memoria.dto';
import { ProfilesService } from './profiles.service';

/**
 * Memoria operativa por proceso (ADR 0018 Inc.1 + Inc.3). Lectura para cualquier miembro; las mutaciones y la
 * confirmación/purga requieren EDITOR+. Es CONTEXTO gobernado: nace PROPUESTO y requiere revisión humana para
 * CONFIRMADO; confirmar/descartar/caducar se auditan (auditoría inmutable). La memoria NO cambia la versión del agente
 * ni dispara aprendizaje automático (ADR 0004): es solo dato de contexto. Todo filtra por el workspace autenticado.
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

  /** Hechos vigentes: solo CONFIRMADO y no caducados. Se declara antes de `:id` para no colisionar con la ruta. */
  @Get('vigentes')
  @ApiQuery({ name: 'procesoClave', required: false, description: 'Filtra los hechos vigentes por proceso' })
  listVigentes(@CurrentAuth() a: AuthContext, @Query('procesoClave') procesoClave?: string) {
    return this.profiles.listMemoriasVigentes(a.workspaceId, procesoClave);
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

  /** Purga de caducados: elimina los hechos vencidos y audita cada baja. Se declara antes de `:id`/`:id/...`. */
  @MinRole('EDITOR')
  @Post('purgar-caducados')
  purgarCaducados(@CurrentAuth() a: AuthContext) {
    return this.profiles.purgarCaducados(a.workspaceId, a);
  }

  /** Confirmación gobernada: PROPUESTO → CONFIRMADO con auditoría. No altera la versión del agente (ADR 0004). */
  @MinRole('EDITOR')
  @Post(':id/confirmar')
  confirmar(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.profiles.confirmarMemoria(a.workspaceId, id, a);
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
    return this.profiles.removeMemoria(a.workspaceId, id, a);
  }
}
