import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { ExecutionStatus } from '@prisma/client';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateWorkflowDto, RunWorkflowDto, SetActiveDto, TestNodeDto, UpdateWorkflowDto } from './dto/workflow.dto';
import { WorkflowRunnerService } from './workflow-runner.service';
import { WorkflowsService } from './workflows.service';

@ApiTags('workflows')
@ApiBearerAuth()
@Controller('workflows')
export class WorkflowsController {
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly runner: WorkflowRunnerService,
  ) {}

  @Get()
  list(@CurrentAuth() a: AuthContext) {
    return this.workflows.list(a.workspaceId);
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.workflows.get(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateWorkflowDto) {
    return this.workflows.create(a, dto);
  }

  @MinRole('EDITOR')
  @Patch(':id')
  update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateWorkflowDto) {
    return this.workflows.update(a, id, dto);
  }

  @MinRole('EDITOR')
  @Delete(':id')
  remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.workflows.remove(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @HttpCode(200)
  @Post(':id/active')
  setActive(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: SetActiveDto) {
    return this.workflows.setActive(a.workspaceId, id, dto.active);
  }

  @MinRole('ADMIN')
  @HttpCode(200)
  @Post(':id/webhook/regenerate')
  regenerate(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.workflows.regenerateWebhook(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @HttpCode(202)
  @Post(':id/run')
  run(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: RunWorkflowDto) {
    return this.workflows.run(a.workspaceId, id, dto.input ?? {}, 'MANUAL', dto.wait);
  }

  /** Historial de versiones: la actual primero (`current: true`), luego las anteriores. */
  @Get(':id/versions')
  versions(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.workflows.listVersions(a.workspaceId, id);
  }

  @Get(':id/versions/:version')
  version(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Param('version', ParseIntPipe) version: number) {
    return this.workflows.getVersion(a.workspaceId, id, version);
  }

  @MinRole('EDITOR')
  @HttpCode(200)
  @Post(':id/versions/:version/restore')
  restore(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Param('version', ParseIntPipe) version: number) {
    return this.workflows.restoreVersion(a, id, version);
  }

  /**
   * Prueba un nodo de la definición guardada con `input` y salidas fijadas (`pinned`). Los nodos conector,
   * agente, sub-flujo y bucle se ejecutan de verdad (llamadas y costos reales); no se crea una Execution.
   */
  @MinRole('EDITOR')
  @HttpCode(200)
  @Post(':id/nodes/:nodeId/test')
  testNode(
    @CurrentAuth() a: AuthContext,
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: TestNodeDto,
  ) {
    return this.runner.testNode(a.workspaceId, id, nodeId, dto.input ?? {}, dto.pinned ?? {});
  }
}

@ApiTags('executions')
@ApiBearerAuth()
@Controller('executions')
export class ExecutionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
  ) {}

  @Get()
  async list(
    @CurrentAuth() a: AuthContext,
    @Query('workflowId') workflowId?: string,
    @Query('status') status?: ExecutionStatus,
    @Query('take') take = '25',
    @Query('cursor') cursor?: string,
  ) {
    const limit = Math.min(Math.max(parseInt(take, 10) || 25, 1), 100);
    const items = await this.prisma.execution.findMany({
      where: { workspaceId: a.workspaceId, workflowId, status },
      select: {
        id: true,
        status: true,
        trigger: true,
        error: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
        workflow: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > limit;
    return { items: items.slice(0, limit), nextCursor: hasMore ? items[limit - 1].id : null };
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.prisma.execution.findFirstOrThrow({
      where: { id, workspaceId: a.workspaceId },
      include: { workflow: { select: { id: true, name: true } } },
    });
  }

  @MinRole('EDITOR')
  @HttpCode(200)
  @Post(':id/cancel')
  cancel(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.workflows.cancel(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @HttpCode(202)
  @Post(':id/retry')
  retry(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.workflows.retry(a.workspaceId, id);
  }
}

/** Disparo público por webhook: POST /api/hooks/:token[?wait=true] */
@ApiTags('webhooks')
@Controller('hooks')
export class WebhooksController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(202)
  @Post(':token')
  trigger(@Param('token') token: string, @Body() body: Record<string, unknown>, @Query('wait') wait?: string) {
    return this.workflows.runByWebhook(token, body ?? {}, wait === 'true');
  }
}
