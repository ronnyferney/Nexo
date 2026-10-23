import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
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
import { VersionsService } from './versions.service';

/** Rutas del bucle de mejora anidadas bajo el agente (ADR 0004). */
@ApiTags('training')
@ApiBearerAuth()
@Controller('agents')
export class AgentTrainingController {
  constructor(
    private readonly feedback: FeedbackService,
    private readonly cases: EvalCasesService,
    private readonly evals: EvalsService,
    private readonly versions: VersionsService,
    private readonly suggestions: SuggestionsService,
  ) {}

  /** Cualquier rol con acceso al chat puede calificar. */
  @Post(':id/feedback')
  createFeedback(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CreateFeedbackDto) {
    return this.feedback.create(a.workspaceId, id, a.userId, dto);
  }

  @Get(':id/feedback')
  listFeedback(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Query() q: FeedbackQueryDto) {
    return this.feedback.list(a.workspaceId, { agentId: id, status: q.status });
  }

  @Get(':id/eval-cases')
  listCases(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.cases.list(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post(':id/eval-cases')
  createCase(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CreateEvalCaseDto) {
    return this.cases.create(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Post(':id/eval-runs')
  createRun(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CreateEvalRunDto) {
    return this.evals.create(a.workspaceId, id, a.userId, dto);
  }

  @Get(':id/eval-runs')
  listRuns(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.evals.list(a.workspaceId, id);
  }

  @Get(':id/versions')
  listVersions(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.versions.list(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post(':id/versions')
  createVersion(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CreateVersionDto) {
    return this.versions.create(a.workspaceId, id, a.userId, dto.note);
  }

  @MinRole('EDITOR')
  @HttpCode(200)
  @Post(':id/versions/:versionId/publish')
  publish(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Param('versionId') versionId: string) {
    return this.versions.publish(a.workspaceId, id, versionId, a.userId);
  }

  @Get(':id/suggestions')
  listSuggestions(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.suggestions.list(a.workspaceId, id);
  }

  @Get(':id/training-summary')
  summary(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.evals.summary(a.workspaceId, id);
  }
}

/** Bandeja de supervisión del workspace. */
@ApiTags('training')
@ApiBearerAuth()
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext, @Query() q: FeedbackQueryDto) {
    return this.feedback.list(a.workspaceId, { status: q.status });
  }

  @MinRole('EDITOR')
  @HttpCode(200)
  @Post(':id/review')
  review(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: ReviewFeedbackDto) {
    return this.feedback.review(a.workspaceId, id, a.userId, dto);
  }
}

@ApiTags('training')
@ApiBearerAuth()
@Controller('eval-cases')
export class EvalCasesController {
  constructor(private readonly cases: EvalCasesService) {}

  @MinRole('EDITOR')
  @Patch(':id')
  update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateEvalCaseDto) {
    return this.cases.update(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Delete(':id')
  remove(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.cases.remove(a.workspaceId, id);
  }
}

@ApiTags('training')
@ApiBearerAuth()
@Controller()
export class EvalRunsController {
  constructor(
    private readonly evals: EvalsService,
    private readonly suggestions: SuggestionsService,
  ) {}

  @Get('eval-runs/:id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.evals.get(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Patch('eval-results/:id')
  reviewResult(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: ReviewEvalResultDto) {
    return this.evals.reviewResult(a.workspaceId, id, dto);
  }

  @MinRole('EDITOR')
  @Post('eval-runs/:id/suggestions')
  suggest(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: CreateSuggestionDto) {
    return this.suggestions.create(a.workspaceId, id, a.userId, dto);
  }

  @MinRole('EDITOR')
  @HttpCode(200)
  @Post('suggestions/:id/apply')
  apply(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.suggestions.apply(a.workspaceId, id, a.userId);
  }

  @MinRole('EDITOR')
  @HttpCode(200)
  @Post('suggestions/:id/reject')
  reject(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.suggestions.reject(a.workspaceId, id, a.userId);
  }
}
