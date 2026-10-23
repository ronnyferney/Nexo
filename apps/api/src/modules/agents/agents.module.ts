import { Module } from '@nestjs/common';
import { ConnectorsModule } from '../connectors/connectors.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AgentRuntimeService } from './agent-runtime.service';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

@Module({
  imports: [ConnectorsModule, KnowledgeModule],
  controllers: [AgentsController],
  providers: [AgentsService, AgentRuntimeService],
  exports: [AgentsService],
})
export class AgentsModule {}
