import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { ContratosService } from './contratos.service';
import { CrearContratoDto } from './dto/contrato.dto';
import { CrearEvidenciaDto } from './dto/evidencia.dto';
import { CrearIncumplimientoDto } from './dto/incumplimiento.dto';
import { CambiarEstadoTareaDto, CreateTareaDto, UpdateTareaDto, type EstadoTareaDto } from './dto/tarea.dto';
import { IncumplimientosService } from './incumplimientos.service';
import { TareasService } from './tareas.service';

/** Tareas (E4 · RF08). Lectura para cualquier miembro; las mutaciones y transiciones requieren EDITOR+. */
@ApiTags('tareas')
@ApiBearerAuth()
@Controller('tareas')
export class TareasController {
  constructor(
    private readonly tareas: TareasService,
    private readonly contratos: ContratosService,
    private readonly incumplimientos: IncumplimientosService,
  ) {}

  @Get()
  list(
    @CurrentAuth() a: AuthContext,
    @Query('estado') estado?: EstadoTareaDto,
    @Query('objetivoId') objetivoId?: string,
  ) {
    return this.tareas.list(a.workspaceId, { estado, objetivoId });
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.tareas.get(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateTareaDto) {
    return this.tareas.create(a.workspaceId, dto);
  }

  @MinRole('EDITOR')
  @Patch(':id')
  update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateTareaDto) {
    return this.tareas.update(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.tareas.remove(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post(':id/estado')
  cambiarEstado(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CambiarEstadoTareaDto) {
    return this.tareas.cambiarEstado(a.workspaceId, id, dto);
  }

  /** Crea el contrato de resultado (RF29) de la tarea (relación 1-1). */
  @MinRole('EDITOR')
  @Post(':id/contrato')
  crearContrato(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CrearContratoDto) {
    return this.contratos.crearParaTarea(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Post(':id/evidencias')
  agregarEvidencia(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CrearEvidenciaDto) {
    return this.tareas.agregarEvidencia(a.workspaceId, id, dto);
  }

  @Get(':id/incumplimientos')
  listIncumplimientos(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.incumplimientos.listPorTarea(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post(':id/incumplimientos')
  crearIncumplimiento(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CrearIncumplimientoDto) {
    return this.incumplimientos.crearParaTarea(a.workspaceId, id, dto);
  }
}
