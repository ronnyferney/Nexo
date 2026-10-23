import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { CopilotFeedbackService } from './copilot-feedback.service';
import { CopilotProposalsService } from './copilot-proposals.service';
import { CopilotQuotaService } from './copilot-quota.service';
import { CopilotToolsService } from './copilot-tools.service';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { PlatformAdminGuard, PlatformAdminService } from './platform/platform-admin.guard';
import { PlatformController } from './platform/platform.controller';
import { PlatformMetricsService } from './platform/platform-metrics.service';

/**
 * Nexo Copilot (ADR 0006 D1, D2, D6): agente propiedad de Nexo (definición en `definition/`), sesiones, herramientas
 * internas, propuestas, cupo pagado por Nexo y consola de plataforma. Depende de módulos globales (Prisma, LLM,
 * acceso a agentes y salud).
 */
@Module({
  imports: [AgentsModule],
  controllers: [CopilotController, PlatformController],
  providers: [
    CopilotService,
    CopilotToolsService,
    CopilotProposalsService,
    CopilotQuotaService,
    CopilotFeedbackService,
    PlatformAdminService,
    PlatformAdminGuard,
    PlatformMetricsService,
  ],
})
export class CopilotModule {}
