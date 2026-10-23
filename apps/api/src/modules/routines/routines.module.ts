import { BullModule } from '@nestjs/bullmq';
import { Module, type Provider } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { RoutineProcessor } from './routine.processor';
import { ROUTINE_QUEUE } from './routine-queue.constants';
import { RoutineRunnerService } from './routine-runner.service';
import { AgentRoutinesController, RoutinesController } from './routines.controller';
import { RoutinesService } from './routines.service';

/** El worker se puede desactivar (WORKER_ENABLED=false) para separar API y workers en despliegue. */
const workers: Provider[] = process.env.WORKER_ENABLED === 'false' ? [] : [RoutineProcessor];

/** ADR 0003 · D5 — rutinas programadas por agente (cola BullMQ `routines`). */
@Module({
  imports: [BullModule.registerQueue({ name: ROUTINE_QUEUE }), AgentsModule],
  controllers: [RoutinesController, AgentRoutinesController],
  providers: [RoutinesService, RoutineRunnerService, ...workers],
  exports: [RoutinesService],
})
export class RoutinesModule {}
