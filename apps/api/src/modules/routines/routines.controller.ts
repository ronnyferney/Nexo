import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { AgentAccessService } from '../agent-access/agent-access.service';
import { isWorkspaceAdmin } from '../agent-access/agent-permissions';
import { CreateRoutineDto, UpdateRoutineDto } from './dto/routine.dto';
import { RoutinesService } from './routines.service';

/**
 * Rutinas (ADR 0003 D5) con autorización por agente (ADR 0007): ver requiere USE sobre el agente y gestionar
 * (crear, editar, eliminar, ejecutar) requiere EDIT. El rol del workspace actúa como tope dentro de
 * `AgentAccessService`, por eso no hay `@MinRole`.
 */
@ApiTags('routines')
@ApiBearerAuth()
@Controller('routines')
export class RoutinesController {
  constructor(
    private readonly routines: RoutinesService,
    private readonly access: AgentAccessService,
  ) {}

  /** ADMIN/OWNER: todas las del workspace (gobierno). Resto: las de los agentes que puede usar. */
  @Get()
  async list(@CurrentAuth() a: AuthContext) {
    const agentIds = isWorkspaceAdmin(a) ? undefined : await this.access.usableAgentIds(a);
    return this.routines.list(a.workspaceId, undefined, agentIds);
  }

  @Get(':id')
  async get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.authorize(a, id, 'USE');
    return this.routines.describe(a.workspaceId, id);
  }

  @Patch(':id')
  async update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateRoutineDto) {
    await this.authorize(a, id, 'EDIT');
    return this.routines.update(a.workspaceId, id, dto);
  }

  @Delete(':id')
  async remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.authorize(a, id, 'EDIT');
    return this.routines.remove(a.workspaceId, id);
  }

  /** Ejecución inmediata: espera el resultado hasta 60 s. */
  @HttpCode(200)
  @Post(':id/run')
  async run(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.authorize(a, id, 'EDIT');
    return this.routines.runNow(a.workspaceId, id);
  }

  /** Últimas 50 corridas, de la más reciente a la más antigua. */
  @Get(':id/runs')
  async runs(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.authorize(a, id, 'USE');
    return this.routines.runs(a.workspaceId, id);
  }

  private async authorize(a: AuthContext, routineId: string, need: 'USE' | 'EDIT') {
    const routine = await this.routines.get(a.workspaceId, routineId);
    await this.access.assert(a, routine.agentId, need);
  }
}

@ApiTags('routines')
@ApiBearerAuth()
@Controller('agents')
export class AgentRoutinesController {
  constructor(
    private readonly routines: RoutinesService,
    private readonly access: AgentAccessService,
  ) {}

  @Get(':id/routines')
  async list(@CurrentAuth() a: AuthContext, @Param('id') agentId: string) {
    await this.access.assert(a, agentId, 'USE');
    return this.routines.list(a.workspaceId, agentId);
  }

  @Post(':id/routines')
  async create(@CurrentAuth() a: AuthContext, @Param('id') agentId: string, @Body() dto: CreateRoutineDto) {
    await this.access.assert(a, agentId, 'EDIT');
    return this.routines.create(a.workspaceId, agentId, dto);
  }
}
