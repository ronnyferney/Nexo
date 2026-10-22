import { Module } from '@nestjs/common';
import { ConnectorsModule } from '../connectors/connectors.module';
import { AgentRuntimeService } from './agent-runtime.service';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

@Module({
  imports: [ConnectorsModule],
  controllers: [AgentsController],
  providers: [AgentsService, AgentRuntimeService],
  exports: [AgentsService],
})
export class AgentsModule {}
