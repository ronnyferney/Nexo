import { Module } from '@nestjs/common';
import { MissionCoordinatorGovernanceService } from './mission-coordinator-governance.service';
import { MissionExecutiveReportService } from './mission-executive-report.service';
import { MissionsController } from './missions.controller';
import { MissionsService } from './missions.service';

/**
 * Misiones transversales (ADR 0016 · E3). Incremento 1: capa delgada de coordinación sobre el trabajo por resultados
 * (E4). Incremento 3 (compuerta E-B): `MissionCoordinatorGovernanceService` cablea el gobierno de la continuidad del
 * coordinador (seguimiento/bloqueos/escalamiento/supervisión/continuidad/contradicciones), GATED por el opt-in
 * `Workspace.coordinadorGobiernoActivo` (apagado por defecto). `AuditService` (E13) y `PrismaService` llegan por
 * módulos `@Global`, así que no hace falta importarlos aquí.
 */
@Module({
  controllers: [MissionsController],
  providers: [MissionsService, MissionCoordinatorGovernanceService, MissionExecutiveReportService],
  exports: [MissionsService, MissionCoordinatorGovernanceService, MissionExecutiveReportService],
})
export class MissionsModule {}
