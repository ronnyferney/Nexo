import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AgentVerificationService } from '../agents/agent-verification.service';
import { WORKFLOW_QUEUE } from '../workflows/queue/workflow-queue.constants';
import { ContratosController, IncumplimientosController } from './contratos.controller';
import { ContratosService } from './contratos.service';
import { IncumplimientosService } from './incumplimientos.service';
import { IndicadoresController } from './indicadores/indicadores.controller';
import { IndicadoresService } from './indicadores/indicadores.service';
import { ObjetivosController } from './objetivos.controller';
import { ObjetivosService } from './objetivos.service';
import { ContractPassportController, PassportsController } from './pasaporte.controller';
import { PasaporteService } from './pasaporte.service';
import { TareasController } from './tareas.controller';
import { TareasService } from './tareas.service';
import { ValidacionService } from './validacion.service';

/**
 * Trabajo por resultados (E4 · ADR 0012): objetivos, tareas, contrato de resultado, verificación/aceptación
 * (verificador ≠ ejecutor) e incumplimientos. Reutiliza la cola BullMQ existente para el barrido de vencimientos
 * (`JOB_RESULTS_SWEEP`) y la verificación cruzada pura del ADR 0010 D4 (`AgentVerificationService`), no las reimplementa.
 * La comunicación entre agentes, el handoff y los canales (E5) son una cédula aparte.
 */
@Module({
  imports: [BullModule.registerQueue({ name: WORKFLOW_QUEUE })],
  controllers: [
    ObjetivosController,
    TareasController,
    ContratosController,
    IncumplimientosController,
    IndicadoresController,
    ContractPassportController,
    PassportsController,
  ],
  providers: [
    ObjetivosService,
    TareasService,
    ContratosService,
    ValidacionService,
    IncumplimientosService,
    IndicadoresService,
    AgentVerificationService,
    PasaporteService,
  ],
  exports: [IncumplimientosService],
})
export class ResultsModule {}
