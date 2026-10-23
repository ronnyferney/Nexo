import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { CreateRoutineDto, UpdateRoutineDto } from './dto/routine.dto';
import { RoutinesService } from './routines.service';

@ApiTags('routines')
@ApiBearerAuth()
@Controller('routines')
export class RoutinesController {
  constructor(private readonly routines: RoutinesService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext) {
    return this.routines.list(a.workspaceId);
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.routines.describe(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Patch(':id')
  update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateRoutineDto) {
    return this.routines.update(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete(':id')
  remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.routines.remove(a.workspaceId, id);
  }

  /** Ejecución inmediata: espera el resultado hasta 60 s. */
  @MinRole('EDITOR')
  @HttpCode(200)
  @Post(':id/run')
  run(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.routines.runNow(a.workspaceId, id);
  }

  /** Últimas 50 corridas, de la más reciente a la más antigua. */
  @Get(':id/runs')
  runs(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.routines.runs(a.workspaceId, id);
  }
}

@ApiTags('routines')
@ApiBearerAuth()
@Controller('agents')
export class AgentRoutinesController {
  constructor(private readonly routines: RoutinesService) {}

  @Get(':id/routines')
  list(@CurrentAuth() a: AuthContext, @Param('id') agentId: string) {
    return this.routines.list(a.workspaceId, agentId);
  }

  @MinRole('EDITOR')
  @Post(':id/routines')
  create(@CurrentAuth() a: AuthContext, @Param('id') agentId: string, @Body() dto: CreateRoutineDto) {
    return this.routines.create(a.workspaceId, agentId, dto);
  }
}
