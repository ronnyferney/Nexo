import { Module } from '@nestjs/common';
import { ComplianceSeedService } from './compliance-seed.service';
import { CumplimientoController, ReglasCumplimientoController } from './compliance.controller';
import { ReglasCumplimientoService } from './reglas-cumplimiento.service';

/**
 * Matriz de cumplimiento configurable y MULTISECTORIAL (P1.3 · ADR 0020). Define reglas de cumplimiento por
 * jurisdicción/sector/proceso/nivel de riesgo (cada una con campo obligatorio, tipo de dato, regla de validación y
 * control de protección de datos) y evalúa un resultado/pasaporte de forma ASESORA (no bloqueante). `AuditService` se
 * inyecta vía su módulo `@Global`. No afirma conformidad con ninguna norma: son controles técnicos configurables.
 */
@Module({
  controllers: [ReglasCumplimientoController, CumplimientoController],
  providers: [ReglasCumplimientoService, ComplianceSeedService],
  exports: [ReglasCumplimientoService, ComplianceSeedService],
})
export class ComplianceModule {}
