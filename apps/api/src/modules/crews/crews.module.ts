import { Module } from '@nestjs/common';
import { CrewsController } from './crews.controller';
import { CrewsService } from './crews.service';

/**
 * Cuadrillas (ADR 0014 · D1 · E11): plantillas de equipo gobernadas, versionadas y declarativas. `AuditService` (E13) y
 * `PrismaService` llegan por módulos `@Global`, así que no hace falta importarlos aquí.
 */
@Module({
  controllers: [CrewsController],
  providers: [CrewsService],
  exports: [CrewsService],
})
export class CrewsModule {}
