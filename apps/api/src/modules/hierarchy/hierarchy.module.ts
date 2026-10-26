import { Module } from '@nestjs/common';
import { HierarchyController } from './hierarchy.controller';
import { HierarchyService } from './hierarchy.service';

/**
 * Jerarquía / organigrama de empleados digitales (E3/RF32). Módulo propio para no acoplar la línea de mando al módulo de
 * agentes. `AuditService` llega por el `@Global` de `AuditModule`. La jerarquía NO concede acceso a datos (ADR 0007).
 */
@Module({
  controllers: [HierarchyController],
  providers: [HierarchyService],
  exports: [HierarchyService],
})
export class HierarchyModule {}
