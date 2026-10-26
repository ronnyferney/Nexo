import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { AceptarHandoffDto, ProponerHandoffDto, RechazarHandoffDto } from './dto/handoff.dto';
import { HandoffService } from './handoff.service';

/**
 * Continuidad de tarea / handoff (E5 · RF09/RF33). Proponer un handoff sobre una tarea y aceptarlo/rechazarlo requieren
 * EDITOR+. Aceptar encola el siguiente segmento desde el estado persistido (sin rehacer); rechazar devuelve al emisor.
 */
@ApiTags('handoff')
@ApiBearerAuth()
@Controller()
export class HandoffController {
  constructor(private readonly handoff: HandoffService) {}

  @Get('tareas/:id/transferencias')
  listPorTarea(@CurrentAuth() a: AuthContext, @Param('id') tareaId: string) {
    return this.handoff.listPorTarea(a.workspaceId, tareaId);
  }

  @MinRole('EDITOR')
  @Post('tareas/:id/handoff')
  proponer(@CurrentAuth() a: AuthContext, @Param('id') tareaId: string, @Body() dto: ProponerHandoffDto) {
    return this.handoff.proponer(a.workspaceId, tareaId, dto);
  }

  @MinRole('EDITOR')
  @Post('transferencias/:id/aceptar')
  aceptar(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: AceptarHandoffDto) {
    return this.handoff.aceptar(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Post('transferencias/:id/rechazar')
  rechazar(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: RechazarHandoffDto) {
    return this.handoff.rechazar(a.workspaceId, id, dto);
  }
}
