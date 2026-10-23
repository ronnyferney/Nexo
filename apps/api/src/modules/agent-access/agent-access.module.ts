import { Global, Module } from '@nestjs/common';

/**
 * ADR 0006 (salud y lanzamiento) + ADR 0007 (visibilidad y permisos) — esqueleto del orquestador.
 * nexo-backend-platform implementa `AgentAccessService` y `AgentHealthService` y los exporta (módulo global).
 */
@Global()
@Module({})
export class AgentAccessModule {}
