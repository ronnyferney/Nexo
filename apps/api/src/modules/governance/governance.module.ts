import { Global, Module } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { AuthModule } from '../auth/auth.module';
import {
  GovernanceAdminController,
  GovernancePublicController,
  InvitationsPublicController,
} from './governance.controller';
import { InvitationsService } from './invitations.service';
import { OrgService } from './org.service';
import { UsageService } from './usage.service';

/** Gobierno de IA (ADR 0002): organización, presupuestos jerárquicos y medición de consumo. */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [GovernancePublicController, GovernanceAdminController, InvitationsPublicController],
  providers: [OrgService, BudgetsService, UsageService, InvitationsService],
  exports: [OrgService, BudgetsService],
})
export class GovernanceModule {}
