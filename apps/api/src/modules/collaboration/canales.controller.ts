import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { CanalesService } from './canales.service';
import { ConvertirEnTareaDto, CrearCanalDto, CrearHiloDto } from './dto/canal.dto';

/**
 * Coordinación transversal (E5 · RF36): canales/hilos por misión/proceso/área. Lectura para cualquier miembro; crear
 * canales/hilos y convertir una solicitud en tarea autorizada requieren EDITOR+ (autoridad). Todo filtra por workspace.
 */
@ApiTags('canales')
@ApiBearerAuth()
@Controller()
export class CanalesController {
  constructor(private readonly canales: CanalesService) {}

  @Get('canales')
  listCanales(@CurrentAuth() a: AuthContext) {
    return this.canales.listCanales(a.workspaceId);
  }

  @Get('canales/:id')
  getCanal(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.canales.getCanal(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post('canales')
  crearCanal(@CurrentAuth() a: AuthContext, @Body() dto: CrearCanalDto) {
    return this.canales.crearCanal(a.workspaceId, dto);
  }

  @Get('canales/:id/hilos')
  listHilos(@CurrentAuth() a: AuthContext, @Param('id') canalId: string) {
    return this.canales.listHilos(a.workspaceId, canalId);
  }

  @MinRole('EDITOR')
  @Post('canales/:id/hilos')
  crearHilo(@CurrentAuth() a: AuthContext, @Param('id') canalId: string, @Body() dto: CrearHiloDto) {
    return this.canales.crearHilo(a.workspaceId, canalId, dto);
  }

  @MinRole('EDITOR')
  @Post('hilos/:id/intercambio')
  registrarIntercambio(@CurrentAuth() a: AuthContext, @Param('id') hiloId: string) {
    return this.canales.registrarIntercambio(a.workspaceId, hiloId);
  }

  @MinRole('EDITOR')
  @Post('hilos/:id/convertir-en-tarea')
  convertirEnTarea(@CurrentAuth() a: AuthContext, @Param('id') hiloId: string, @Body() dto: ConvertirEnTareaDto) {
    return this.canales.convertirEnTarea(a.workspaceId, hiloId, dto);
  }
}
