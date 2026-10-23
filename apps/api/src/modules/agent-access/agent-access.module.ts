import { Global, Module } from '@nestjs/common';
import { AgentAccessService } from './agent-access.service';
import { AgentHealthService } from './agent-health.service';
import { SharePrincipalsService } from './share-principals.service';

/**
 * ADR 0006 (salud y lanzamiento) + ADR 0007 (visibilidad y permisos). Módulo global: cualquier módulo puede inyectar
 * `AgentAccessService`, `AgentHealthService` y
 * `SharePrincipalsService` (destinatarios de shares: usuarios, unidades y grupos). Implementación: nexo-backend-platform.
 */
@Global()
@Module({
  providers: [AgentAccessService, AgentHealthService, SharePrincipalsService],
  exports: [AgentAccessService, AgentHealthService, SharePrincipalsService],
})
export class AgentAccessModule {}
