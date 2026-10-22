import { Global, Module } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { GovernanceAdminController, GovernancePublicController } from './governance.controller';
import { OrgService } from './org.service';
import { UsageService } from './usage.service';

/** Gobierno de IA (ADR 0002): organización, presupuestos jerárquicos y medición de consumo. */
@Global()
@Module({
  controllers: [GovernancePublicController, GovernanceAdminController],
  providers: [OrgService, BudgetsService, UsageService],
  exports: [OrgService, BudgetsService],
})
export class GovernanceModule {}
