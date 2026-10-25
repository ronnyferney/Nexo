import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { AgentRunsService } from './agent-runs.service';
import { ListAgentRunsQueryDto } from './dto/agent-run.dto';

/**
 * Historial de ejecuciones de agente (RX-14). Transversal y de solo lectura: lista las corridas de todos los agentes
 * visibles para el solicitante, con filtros, orden por `startedAt` desc y paginación por cursor. El alcance por rol y
 * el filtrado por `workspaceId` los resuelve `AgentRunsService` (mismo criterio que el tablero/observabilidad).
 */
@ApiTags('agent-runs')
@ApiBearerAuth()
@Controller('agent-runs')
export class AgentRunsController {
  constructor(private readonly runs: AgentRunsService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext, @Query() q: ListAgentRunsQueryDto) {
    return this.runs.list(a, q);
  }
}
