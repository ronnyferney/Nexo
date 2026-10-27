import { Module } from '@nestjs/common';
import { MissionsController } from './missions.controller';
import { MissionsService } from './missions.service';

/**
 * Misiones transversales (ADR 0016 · E3 · Incremento 1): capa delgada de coordinación sobre el trabajo por resultados
 * (E4). `AuditService` (E13) y `PrismaService` llegan por módulos `@Global`, así que no hace falta importarlos aquí.
 */
@Module({
  controllers: [MissionsController],
  providers: [MissionsService],
  exports: [MissionsService],
})
export class MissionsModule {}
