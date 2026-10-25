import { BullModule } from '@nestjs/bullmq';
import { Module, type Provider } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { ConnectorsModule } from '../connectors/connectors.module';
import { ResultsModule } from '../results/results.module';
import { RoutinesModule } from '../routines/routines.module';
import { WorkflowProcessor } from './queue/workflow.processor';
import { WORKFLOW_QUEUE } from './queue/workflow-queue.constants';
import { RetentionService } from './retention.service';
import { ScheduleReconcilerService } from './schedule-reconciler.service';
import { WorkflowRunnerService } from './workflow-runner.service';
import { ExecutionsController, WebhooksController, WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

/** El worker se puede desactivar (WORKER_ENABLED=false) para separar API y workers en despliegue. */
const workers: Provider[] = process.env.WORKER_ENABLED === 'false' ? [] : [WorkflowProcessor];

@Module({
  imports: [
    BullModule.registerQueue({ name: WORKFLOW_QUEUE }),
    ConnectorsModule,
    AgentsModule,
    RoutinesModule,
    ResultsModule,
  ],
  controllers: [WorkflowsController, ExecutionsController, WebhooksController],
  providers: [WorkflowsService, WorkflowRunnerService, RetentionService, ScheduleReconcilerService, ...workers],
  exports: [WorkflowsService, RetentionService, ScheduleReconcilerService],
})
export class WorkflowsModule {}
