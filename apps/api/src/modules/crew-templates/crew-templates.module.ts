import { Module } from '@nestjs/common';
import { CrewsModule } from '../crews/crews.module';
import { CrewTemplatesController } from './crew-templates.controller';
import { CrewTemplatesService } from './crew-templates.service';

/**
 * Agent Hub · plantillas de CUADRILLA (ADR 0019 · Inc.3): publicar, descubrir e instalar composiciones gobernadas de
 * varios cargos/roles. Importa `CrewsModule` para reutilizar `CrewsService` al crear la cuadrilla BORRADOR y su versión
 * (no duplica la lógica de alta ni la validación declarativa). `PrismaService` y `AuditService` (E13) llegan por módulos
 * `@Global`.
 */
@Module({
  imports: [CrewsModule],
  controllers: [CrewTemplatesController],
  providers: [CrewTemplatesService],
  exports: [CrewTemplatesService],
})
export class CrewTemplatesModule {}
