import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { WORKFLOW_QUEUE } from '../workflows/queue/workflow-queue.constants';
import { HandoffController } from './handoff.controller';
import { HandoffService } from './handoff.service';
import { MensajesController } from './mensajes.controller';
import { MensajesService } from './mensajes.service';

/**
 * Comunicación entre agentes, handoff y control de delegación (E5 · ADR 0012 D3/D4). Reutiliza la cola BullMQ existente
 * para el despacho de mensajes y de segmentos de handoff, y su programador para el barrido de vencimientos (suplencia/
 * escalamiento); no crea cola nueva. Las reglas de delegación/ciclos son puras (`delegacion.rules.ts`). El disparo del
 * runtime del agente destinatario (seam LLM) lo cubre nexo-backend-ai sobre `MensajesService.encolarDespacho`.
 */
@Module({
  imports: [BullModule.registerQueue({ name: WORKFLOW_QUEUE })],
  controllers: [MensajesController, HandoffController],
  providers: [MensajesService, HandoffService],
  exports: [MensajesService, HandoffService],
})
export class MessagingModule {}
