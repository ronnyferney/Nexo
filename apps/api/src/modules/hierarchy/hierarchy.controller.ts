import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { SetSupervisorDto } from './dto/hierarchy.dto';
import { HierarchyService } from './hierarchy.service';

/**
 * Jerarquía / organigrama de empleados digitales (E3/RF32). La estructura la define un humano con rol alto: fijar la
 * línea de mando exige ADMIN (respeta `AGENTE_NO_CREA_AGENTES`, E5); la lectura es para cualquier miembro (VIEWER+).
 * `workspaceId` SIEMPRE de `@CurrentAuth()` (multi-tenant). La jerarquía NO concede acceso a datos (ADR 0007).
 */
@ApiTags('hierarchy')
@ApiBearerAuth()
@Controller('hierarchy')
export class HierarchyController {
  constructor(private readonly hierarchy: HierarchyService) {}

  /** Organigrama del workspace como árbol (raíces con subordinados anidados). */
  @MinRole('VIEWER')
  @Get()
  organigrama(@CurrentAuth() a: AuthContext) {
    return this.hierarchy.organigrama(a.workspaceId);
  }

  /** Cadena de mando ascendente de un agente (sus supervisores del directo hasta la raíz). */
  @MinRole('VIEWER')
  @Get(':agentId/cadena-mando')
  cadenaMando(@CurrentAuth() a: AuthContext, @Param('agentId') agentId: string) {
    return this.hierarchy.cadenaMando(a.workspaceId, agentId);
  }

  /** Fija o cambia a quién reporta un agente (null = quitar supervisor / raíz). */
  @MinRole('ADMIN')
  @Put(':agentId/reporta-a')
  setSupervisor(@CurrentAuth() a: AuthContext, @Param('agentId') agentId: string, @Body() dto: SetSupervisorDto) {
    return this.hierarchy.setSupervisor(a, agentId, dto.reportaAAgentId ?? null);
  }
}
