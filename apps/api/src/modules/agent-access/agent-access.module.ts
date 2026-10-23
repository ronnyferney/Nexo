import { Global, Module } from '@nestjs/common';
import { AgentAccessService } from './agent-access.service';
import { AgentHealthService } from './agent-health.service';

/**
 * ADR 0006 (salud y lanzamiento) + ADR 0007 (visibilidad y permisos). Módulo global: cualquier módulo puede inyectar
 * `AgentAccessService` y `AgentHealthService`. Implementación: nexo-backend-platform.
 */
@Global()
@Module({ providers: [AgentAccessService, AgentHealthService], exports: [AgentAccessService, AgentHealthService] })
export class AgentAccessModule {}
