import { BullModule } from '@nestjs/bullmq';
import { Module, type Provider } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { ConnectorsModule } from '../connectors/connectors.module';
import { WorkflowProcessor } from './queue/workflow.processor';
import { WORKFLOW_QUEUE } from './queue/workflow-queue.constants';
import { RetentionService } from './retention.service';
import { WorkflowRunnerService } from './workflow-runner.service';
import { ExecutionsController, WebhooksController, WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

/** El worker se puede desactivar (WORKER_ENABLED=false) para separar API y workers en despliegue. */
const workers: Provider[] = process.env.WORKER_ENABLED === 'false' ? [] : [WorkflowProcessor];

@Module({
  imports: [BullModule.registerQueue({ name: WORKFLOW_QUEUE }), ConnectorsModule, AgentsModule],
  controllers: [WorkflowsController, ExecutionsController, WebhooksController],
  providers: [WorkflowsService, WorkflowRunnerService, RetentionService, ...workers],
  exports: [WorkflowsService, RetentionService],
})
export class WorkflowsModule {}
