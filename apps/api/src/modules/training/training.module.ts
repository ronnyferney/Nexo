import { BullModule } from '@nestjs/bullmq';
import { Module, type Provider } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { EvalCasesService } from './eval-cases.service';
import { EvalRunnerService } from './eval-runner.service';
import { EvalsService } from './evals.service';
import { FeedbackService } from './feedback.service';
import { MeteredLlmService } from './metered-llm.service';
import { EvalProcessor } from './queue/eval.processor';
import { EVAL_QUEUE } from './queue/eval-queue.constants';
import { SuggestionsService } from './suggestions.service';
import {
  AgentTrainingController,
  EvalCasesController,
  EvalRunsController,
  FeedbackController,
} from './training.controller';
import { VersionsService } from './versions.service';

/** El worker se puede desactivar (WORKER_ENABLED=false) para separar API y workers en despliegue. */
const workers: Provider[] = process.env.WORKER_ENABLED === 'false' ? [] : [EvalProcessor];

/**
 * ADR 0004 — bucle de mejora supervisada: retroalimentación y bandeja de supervisión, casos y corridas de evaluación
 * (cola BullMQ `evals`, juez IA + revisión humana), versiones del agente y sugerencias de mejora con aprobación humana.
 */
@Module({
  imports: [BullModule.registerQueue({ name: EVAL_QUEUE }), AgentsModule],
  controllers: [AgentTrainingController, FeedbackController, EvalCasesController, EvalRunsController],
  providers: [
    FeedbackService,
    EvalCasesService,
    EvalsService,
    EvalRunnerService,
    VersionsService,
    SuggestionsService,
    MeteredLlmService,
    ...workers,
  ],
})
export class TrainingModule {}
