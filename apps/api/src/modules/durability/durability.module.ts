import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { WORKFLOW_QUEUE } from '../workflows/queue/workflow-queue.constants';
import { ExcepcionesController } from './excepciones/excepciones.controller';
import { ExcepcionesService } from './excepciones/excepciones.service';
import { IdempotencyService } from './idempotency/idempotency.service';
import { ReconciliationService } from './reconciliation/reconciliation.service';

/**
 * Durabilidad avanzada (E7 · ADR 0012/0013). Idempotencia por operación de negocio (`IdempotencyService`, reutilizada
 * por el `ActionGateway` en su punto de despacho), clasificación de fallos y conciliación de escrituras inciertas
 * (`ReconciliationService`, RF20) y la bandeja de excepciones (`ExcepcionesService`, RF21). Reutiliza el motor durable,
 * la cola BullMQ y el `schedule-reconciler` existentes: no introduce cola ni infraestructura nueva. Es `@Global` para
 * que el gateway de gobierno, el motor de flujos y el worker puedan inyectar estos servicios sin ciclos de módulos.
 */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: WORKFLOW_QUEUE })],
  controllers: [ExcepcionesController],
  providers: [IdempotencyService, ReconciliationService, ExcepcionesService],
  exports: [IdempotencyService, ReconciliationService, ExcepcionesService],
})
export class DurabilityModule {}
