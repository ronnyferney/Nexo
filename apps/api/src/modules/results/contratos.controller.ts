import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { ContratosService } from './contratos.service';
import { ActualizarContratoDto, AvanzarContratoDto, CrearContratoDto } from './dto/contrato.dto';
import { CrearEvidenciaDto } from './dto/evidencia.dto';
import { ValidarResultadoDto } from './dto/validacion.dto';
import { IncumplimientosService } from './incumplimientos.service';
import { RegistrarIntentoDto } from './dto/incumplimiento.dto';

/** Contratos de resultado y su verificación (E4 · RF29/RF30). Las mutaciones y la validación requieren EDITOR+. */
@ApiTags('contratos-resultado')
@ApiBearerAuth()
@Controller('contratos')
export class ContratosController {
  constructor(
    private readonly contratos: ContratosService,
    private readonly incumplimientos: IncumplimientosService,
  ) {}

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.contratos.get(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Patch(':id')
  actualizar(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: ActualizarContratoDto) {
    return this.contratos.actualizar(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Post(':id/comprometer')
  comprometer(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.contratos.comprometer(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post(':id/avanzar')
  avanzar(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: AvanzarContratoDto) {
    return this.contratos.avanzar(a.workspaceId, id, dto);
  }

  /** Verificación (RF30): el servicio garantiza verificador ≠ ejecutor. Acepta o devuelve el resultado. */
  @MinRole('EDITOR')
  @Post(':id/validar')
  validar(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: ValidarResultadoDto) {
    return this.contratos.validar(a.workspaceId, id, dto);
  }

  /** Nueva versión de un contrato comprometido (inmutable, RF29). */
  @MinRole('EDITOR')
  @Post(':id/versiones')
  nuevaVersion(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CrearContratoDto) {
    return this.contratos.nuevaVersion(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Post(':id/evidencias')
  agregarEvidencia(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CrearEvidenciaDto) {
    return this.contratos.agregarEvidencia(a.workspaceId, id, dto);
  }
}

/** Incumplimientos y su recuperación (E4 · RF31). */
@ApiTags('incumplimientos')
@ApiBearerAuth()
@Controller('incumplimientos')
export class IncumplimientosController {
  constructor(private readonly incumplimientos: IncumplimientosService) {}

  /** Registra un intento/ciclo de corrección; al agotar los límites, el incumplimiento se declara (RF31). */
  @MinRole('EDITOR')
  @Post(':id/intento')
  registrarIntento(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: RegistrarIntentoDto) {
    return this.incumplimientos.registrarIntento(a.workspaceId, id, dto);
  }
}
