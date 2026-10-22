import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { McpServerController } from './mcp-server.controller';
import { McpServerService } from './mcp-server.service';

@Module({
  imports: [AgentsModule, WorkflowsModule],
  controllers: [McpServerController],
  providers: [McpServerService],
})
export class McpServerModule {}
