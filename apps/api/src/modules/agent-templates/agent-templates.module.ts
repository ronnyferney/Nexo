import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { AgentTemplatesController } from './agent-templates.controller';
import { AgentTemplatesService } from './agent-templates.service';

/**
 * Agent Hub · plantillas de empleado digital (ADR 0019 · Inc.1): publicar, descubrir e instalar plantillas gobernadas.
 * Importa `AgentsModule` para reutilizar `AgentsService` al crear el agente BORRADOR (no duplica la lógica de alta).
 * `PrismaService` y `AuditService` (E13) llegan por módulos `@Global`.
 */
@Module({
  imports: [AgentsModule],
  controllers: [AgentTemplatesController],
  providers: [AgentTemplatesService],
  exports: [AgentTemplatesService],
})
export class AgentTemplatesModule {}
