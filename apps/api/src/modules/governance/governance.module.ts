import { Global, Module } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { AuthModule } from '../auth/auth.module';
import { AsignacionesService } from './estructura/asignaciones.service';
import { CatalogosService } from './estructura/catalogos.service';
import { EstructuraController } from './estructura/estructura.controller';
import {
  GovernanceAdminController,
  GovernancePublicController,
  InvitationsPublicController,
} from './governance.controller';
import { InvitationsService } from './invitations.service';
import { OrgService } from './org.service';
import { UsageService } from './usage.service';

/**
 * Gobierno de IA (ADR 0002): organización, presupuestos jerárquicos y medición de consumo. Incluye la estructura
 * empresarial (ADR 0011 E1): líneas de negocio, sedes, centros de costo y la matriz de asignaciones.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [
    GovernancePublicController,
    GovernanceAdminController,
    InvitationsPublicController,
    EstructuraController,
  ],
  providers: [OrgService, BudgetsService, UsageService, InvitationsService, CatalogosService, AsignacionesService],
  exports: [OrgService, BudgetsService, CatalogosService, AsignacionesService],
})
export class GovernanceModule {}
