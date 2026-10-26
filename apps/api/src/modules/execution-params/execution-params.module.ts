import { Module } from '@nestjs/common';
import { EstacionesVirtualesController } from './estaciones-virtuales.controller';
import { EstacionesVirtualesService } from './estaciones-virtuales.service';
import { ExecutionParamsController } from './execution-params.controller';
import { ExecutionParamsService } from './execution-params.service';

/**
 * Parámetros de ejecución del empleado digital (E8): estación virtual + candado de salida a internet segmentado
 * (`navegacionWeb` + `sistemasAutorizados`). Módulo propio para no acoplar esta capa de configuración al módulo de
 * agentes (de otra cédula). `AuditService` llega por el `@Global` de `AuditModule`. Exporta `ExecutionParamsService`
 * para que el runtime y los ejecutores de conectores consulten el gate de egress (E8-2, ya cableado en el runtime).
 */
@Module({
  controllers: [EstacionesVirtualesController, ExecutionParamsController],
  providers: [EstacionesVirtualesService, ExecutionParamsService],
  exports: [EstacionesVirtualesService, ExecutionParamsService],
})
export class ExecutionParamsModule {}
