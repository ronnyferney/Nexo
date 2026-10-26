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
import { ConsolasService } from './dimensiones/consolas.service';
import { DimensionSeedService } from './dimensiones/dimension-seed.service';
import { ConsolasController, DimensionesController } from './dimensiones/dimensiones.controller';
import { DimensionesService } from './dimensiones/dimensiones.service';
import { AsignacionesService } from './estructura/asignaciones.service';
import { CatalogosService } from './estructura/catalogos.service';
import { EstructuraController } from './estructura/estructura.controller';
import { ConsolidacionService } from './imputacion/consolidacion.service';
import { ConsolidacionController, ServiciosInternosController } from './imputacion/imputacion.controller';
import { ServiciosInternosService } from './imputacion/servicios-internos.service';
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
    ServiciosInternosController,
    ConsolidacionController,
    DimensionesController,
    ConsolasController,
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
    ServiciosInternosService,
    ConsolidacionService,
    DimensionSeedService,
    DimensionesService,
    ConsolasService,
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
    ServiciosInternosService,
    ConsolidacionService,
    DimensionesService,
    PolicyService,
    ApprovalsService,
    SuspensionsService,
    ActionGatewayService,
  ],
})
export class GovernanceModule {}
