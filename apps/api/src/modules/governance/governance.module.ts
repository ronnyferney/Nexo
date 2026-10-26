import { Global, Module } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { AuthModule } from '../auth/auth.module';
import { ActionGatewayService } from './actions/action-gateway.service';
import {
  ActionsController,
  ApprovalsController,
  PoliciesController,
  SuspensionsController,
} from './actions/actions.controller';
import { ApprovalsService } from './actions/approvals.service';
import { PolicyService } from './actions/policy.service';
import { SuspensionsService } from './actions/suspensions.service';
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
 * empresarial (ADR 0011 E1): líneas de negocio, sedes, centros de costo y la matriz de asignaciones. Y el gobierno de
 * acciones (E6 · ADR 0013): motor de políticas, pasarela de acción, bandeja de aprobaciones y suspensión de emergencia.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [
    GovernancePublicController,
    GovernanceAdminController,
    InvitationsPublicController,
    EstructuraController,
    PoliciesController,
    ActionsController,
    ApprovalsController,
    SuspensionsController,
  ],
  providers: [
    OrgService,
    BudgetsService,
    UsageService,
    InvitationsService,
    CatalogosService,
    AsignacionesService,
    PolicyService,
    ApprovalsService,
    SuspensionsService,
    ActionGatewayService,
  ],
  exports: [
    OrgService,
    BudgetsService,
    CatalogosService,
    AsignacionesService,
    PolicyService,
    ApprovalsService,
    SuspensionsService,
    ActionGatewayService,
  ],
})
export class GovernanceModule {}
