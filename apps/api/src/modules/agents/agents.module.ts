import { Module } from '@nestjs/common';
import { ConnectorsModule } from '../connectors/connectors.module';
import { ExecutionParamsModule } from '../execution-params/execution-params.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AgentAnalyticsService } from './agent-analytics.service';
import { AgentLifecycleService } from './agent-lifecycle.service';
import { AgentRunsController } from './agent-runs.controller';
import { AgentRunsService } from './agent-runs.service';
import { AgentRuntimeService } from './agent-runtime.service';
import { AgentVerificationService } from './agent-verification.service';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

@Module({
  imports: [ConnectorsModule, KnowledgeModule, ExecutionParamsModule],
  controllers: [AgentsController, AgentRunsController],
  providers: [
    AgentsService,
    AgentRuntimeService,
    AgentVerificationService,
    AgentLifecycleService,
    AgentAnalyticsService,
    AgentRunsService,
  ],
  exports: [AgentsService, AgentLifecycleService],
})
export class AgentsModule {}
