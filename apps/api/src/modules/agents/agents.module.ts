import { Module } from '@nestjs/common';
import { ConnectorsModule } from '../connectors/connectors.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AgentAnalyticsService } from './agent-analytics.service';
import { AgentLifecycleService } from './agent-lifecycle.service';
import { AgentRunsController } from './agent-runs.controller';
import { AgentRunsService } from './agent-runs.service';
import { AgentRuntimeService } from './agent-runtime.service';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

@Module({
  imports: [ConnectorsModule, KnowledgeModule],
  controllers: [AgentsController, AgentRunsController],
  providers: [AgentsService, AgentRuntimeService, AgentLifecycleService, AgentAnalyticsService, AgentRunsService],
  exports: [AgentsService, AgentLifecycleService],
})
export class AgentsModule {}
