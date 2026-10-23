import { Module } from '@nestjs/common';
import { EdgeBusService } from './edge-bus.service';
import { EdgeAdminController, EdgeController } from './edge.controller';
import { EdgeGateway } from './edge.gateway';
import { EdgeService } from './edge.service';

/**
 * Nexo Edge (ADR 0005, D5): administración de agentes on-premise, gateway WebSocket (`/api/edge/ws`) y
 * enrutamiento de solicitudes entre instancias por Redis pub/sub. Protocolo en docs/edge-protocol.md.
 */
@Module({
  controllers: [EdgeController, EdgeAdminController],
  providers: [EdgeBusService, EdgeService, EdgeGateway],
  exports: [EdgeService],
})
export class EdgeModule {}
