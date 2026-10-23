import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { AgentAccessService } from '../agent-access/agent-access.service';
import {
  CreateEvalCaseDto,
  CreateEvalRunDto,
  CreateFeedbackDto,
  CreateSuggestionDto,
  CreateVersionDto,
  FeedbackQueryDto,
  ReviewEvalResultDto,
  ReviewFeedbackDto,
  UpdateEvalCaseDto,
} from './dto/training.dto';
import { EvalCasesService } from './eval-cases.service';
import { EvalsService } from './evals.service';
import { FeedbackService } from './feedback.service';
import { SuggestionsService } from './suggestions.service';
import { TrainingRefsService } from './training-refs.service';
import { VersionsService } from './versions.service';

/**
 * Rutas del bucle de mejora anidadas bajo el agente (ADR 0004). Autorización por agente (ADR 0007): leer requiere
 * USE y toda escritura (casos, corridas, versiones, sugerencias, revisión) requiere EDIT. El rol del workspace es un
 * tope dentro de `AgentAccessService` (un VIEWER solo gestiona sus agentes PRIVATE), por eso no hay `@MinRole`.
 */
@ApiTags('training')
@ApiBearerAuth()
@Controller('agents')
export class AgentTrainingController {
  constructor(
    private readonly access: AgentAccessService,
    private readonly feedback: FeedbackService,
    private readonly cases: EvalCasesService,
    private readonly evals: EvalsService,
    private readonly versions: VersionsService,
    private readonly suggestions: SuggestionsService,
  ) {}

  /** Cualquier usuario con USE puede calificar. */
  @Post(':id/feedback')
  async createFeedback(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CreateFeedbackDto) {
    await this.access.assert(a, id, 'USE');
    return this.feedback.create(a, id, dto);
  }

  /** Con EDIT: toda la retroalimentación del agente. Con USE: solo la propia. */
  @Get(':id/feedback')
  async listFeedback(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Query() q: FeedbackQueryDto) {
    const access = await this.access.assert(a, id, 'USE');
    const own = !this.access.canEdit(a, access);
    return this.feedback.list(a.workspaceId, {
      agentIds: [id],
      status: q.status,
      ...(own ? { userId: a.userId ?? null } : {}),
    });
  }

  @Get(':id/eval-cases')
  async listCases(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.access.assert(a, id, 'USE');
    return this.cases.list(a.workspaceId, id);
  }

  @Post(':id/eval-cases')
  async createCase(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CreateEvalCaseDto) {
    await this.access.assert(a, id, 'EDIT');
    return this.cases.create(a.workspaceId, id, dto);
  }

  @Post(':id/eval-runs')
  async createRun(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CreateEvalRunDto) {
    await this.access.assert(a, id, 'EDIT');
    return this.evals.create(a.workspaceId, id, a.userId, dto);
  }

  @Get(':id/eval-runs')
  async listRuns(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.access.assert(a, id, 'USE');
    return this.evals.list(a.workspaceId, id);
  }

  @Get(':id/versions')
  async listVersions(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.access.assert(a, id, 'USE');
    return this.versions.list(a.workspaceId, id);
  }

  @Post(':id/versions')
  async createVersion(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CreateVersionDto) {
    await this.access.assert(a, id, 'EDIT');
    return this.versions.create(a.workspaceId, id, a.userId, dto.note);
  }

  @HttpCode(200)
  @Post(':id/versions/:versionId/publish')
  async publish(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Param('versionId') versionId: string) {
    await this.access.assert(a, id, 'EDIT');
    return this.versions.publish(a.workspaceId, id, versionId, a.userId);
  }

  @Get(':id/suggestions')
  async listSuggestions(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.access.assert(a, id, 'USE');
    return this.suggestions.list(a.workspaceId, id);
  }

  @Get(':id/training-summary')
  async summary(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.access.assert(a, id, 'USE');
    return this.evals.summary(a.workspaceId, id);
  }
}

/** Bandeja de supervisión: retroalimentación de los agentes que el usuario puede editar (ADR 0007 D4). */
@ApiTags('training')
@ApiBearerAuth()
@Controller('feedback')
export class FeedbackController {
  constructor(
    private readonly access: AgentAccessService,
    private readonly refs: TrainingRefsService,
    private readonly feedback: FeedbackService,
  ) {}

  @Get()
  async list(@CurrentAuth() a: AuthContext, @Query() q: FeedbackQueryDto) {
    const agentIds = await this.access.editableAgentIds(a);
    return this.feedback.list(a.workspaceId, { agentIds, status: q.status });
  }

  /** Revisar requiere EDIT sobre el agente. */
  @HttpCode(200)
  @Post(':id/review')
  async review(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: ReviewFeedbackDto) {
    await this.access.assert(a, await this.refs.feedbackAgent(a.workspaceId, id), 'EDIT');
    return this.feedback.review(a.workspaceId, id, a.userId, dto);
  }
}

@ApiTags('training')
@ApiBearerAuth()
@Controller('eval-cases')
export class EvalCasesController {
  constructor(
    private readonly access: AgentAccessService,
    private readonly refs: TrainingRefsService,
    private readonly cases: EvalCasesService,
  ) {}

  @Patch(':id')
  async update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateEvalCaseDto) {
    await this.access.assert(a, await this.refs.caseAgent(a.workspaceId, id), 'EDIT');
    return this.cases.update(a.workspaceId, id, dto);
  }

  @Delete(':id')
  async remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.access.assert(a, await this.refs.caseAgent(a.workspaceId, id), 'EDIT');
    return this.cases.remove(a.workspaceId, id);
  }
}

@ApiTags('training')
@ApiBearerAuth()
@Controller()
export class EvalRunsController {
  constructor(
    private readonly access: AgentAccessService,
    private readonly refs: TrainingRefsService,
    private readonly evals: EvalsService,
    private readonly suggestions: SuggestionsService,
  ) {}

  @Get('eval-runs/:id')
  async get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.access.assert(a, await this.refs.runAgent(a.workspaceId, id), 'USE');
    return this.evals.get(a.workspaceId, id);
  }

  @Patch('eval-results/:id')
  async reviewResult(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: ReviewEvalResultDto) {
    await this.access.assert(a, await this.refs.resultAgent(a.workspaceId, id), 'EDIT');
    return this.evals.reviewResult(a.workspaceId, id, dto);
  }

  @Post('eval-runs/:id/suggestions')
  async suggest(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CreateSuggestionDto) {
    await this.access.assert(a, await this.refs.runAgent(a.workspaceId, id), 'EDIT');
    return this.suggestions.create(a.workspaceId, id, a.userId, dto);
  }

  @HttpCode(200)
  @Post('suggestions/:id/apply')
  async apply(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.access.assert(a, await this.refs.suggestionAgent(a.workspaceId, id), 'EDIT');
    return this.suggestions.apply(a.workspaceId, id, a.userId);
  }

  @HttpCode(200)
  @Post('suggestions/:id/reject')
  async reject(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    await this.access.assert(a, await this.refs.suggestionAgent(a.workspaceId, id), 'EDIT');
    return this.suggestions.reject(a.workspaceId, id, a.userId);
  }
}
