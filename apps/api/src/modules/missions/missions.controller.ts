import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import type { EstadoMision } from '@prisma/client';
import {
  AddParticipanteDto,
  AddVinculoDto,
  AuthorizeMisionDto,
  CancelMisionDto,
  CreateMisionDto,
  StopMisionDto,
} from './dto/mission.dto';
import { MissionsService } from './missions.service';

/**
 * Misiones transversales (ADR 0016 · E3 · Incremento 1). Coordinación de resultados que cruzan empresas/áreas.
 * Lectura para cualquier miembro (VIEWER+, filtrada por `workspaceId`). Crear/autorizar/detener/cancelar:
 * `@MinRole('ADMIN')` —son actos de gobierno que SOLO hace una persona con nivel suficiente; además el servicio exige
 * `auth.userId` (ningún agente crea/autoriza misiones, `AGENTE_NO_CREA_AGENTES`). Participantes y vínculos:
 * `@MinRole('EDITOR')`; declararlos NO concede acceso (ADR 0007). `workspaceId` siempre de `@CurrentAuth`, nunca del
 * cuerpo. Mismo prefijo de ruta plano que el resto de controladores (sin versión), p. ej. `objetivos`, `crews`.
 */
@ApiTags('misiones')
@ApiBearerAuth()
@Controller('missions')
export class MissionsController {
  constructor(private readonly missions: MissionsService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext, @Query('estado') estado?: EstadoMision) {
    return this.missions.list(a.workspaceId, estado);
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Query('confirmarLograda') confirmar?: string) {
    return this.missions.get(a.workspaceId, id, confirmar === 'true');
  }

  @MinRole('ADMIN')
  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateMisionDto) {
    return this.missions.create(a, dto);
  }

  @MinRole('ADMIN')
  @Post(':id/authorize')
  authorize(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: AuthorizeMisionDto) {
    return this.missions.authorize(a, id, dto);
  }

  @MinRole('ADMIN')
  @Post(':id/stop')
  stop(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: StopMisionDto) {
    return this.missions.stop(a, id, dto);
  }

  @MinRole('ADMIN')
  @Post(':id/cancel')
  cancel(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CancelMisionDto) {
    return this.missions.cancel(a, id, dto);
  }

  @MinRole('EDITOR')
  @Post(':id/participants')
  addParticipante(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: AddParticipanteDto) {
    return this.missions.addParticipante(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete(':id/participants/:pid')
  @HttpCode(204)
  removeParticipante(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Param('pid') pid: string) {
    return this.missions.removeParticipante(a.workspaceId, id, pid);
  }

  @MinRole('EDITOR')
  @Post(':id/links')
  addVinculo(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: AddVinculoDto) {
    return this.missions.addVinculo(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete(':id/links/:lid')
  @HttpCode(204)
  removeVinculo(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Param('lid') lid: string) {
    return this.missions.removeVinculo(a.workspaceId, id, lid);
  }
}
