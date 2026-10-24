import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { BudgetsService } from './budgets.service';
import {
  AddMemberDto,
  CreateOrgUnitDto,
  UpdateMemberDto,
  UpdateOrgUnitDto,
  UpsertBudgetDto,
  UsageQueryDto,
} from './dto/governance.dto';
import { OrgService } from './org.service';
import { UsageService } from './usage.service';

/** Endpoints de lectura para cualquier rol (selectores y "Mi consumo"). */
@ApiTags('governance')
@ApiBearerAuth()
@Controller()
export class GovernancePublicController {
  constructor(
    private readonly org: OrgService,
    private readonly usage: UsageService,
  ) {}

  @Get('org/units')
  async units(@CurrentAuth() a: AuthContext) {
    return (await this.org.units(a.workspaceId)).map((u) => ({ id: u.id, name: u.name, parentId: u.parentId }));
  }

  @Get('me/usage')
  me(@CurrentAuth() a: AuthContext) {
    return this.usage.me(a.workspaceId, a.userId);
  }
}

@ApiTags('admin-governance')
@ApiBearerAuth()
@MinRole('ADMIN')
@Controller('admin')
export class GovernanceAdminController {
  constructor(
    private readonly org: OrgService,
    private readonly budgets: BudgetsService,
    private readonly usage: UsageService,
  ) {}

  // Organización
  @Get('org/units')
  units(@CurrentAuth() a: AuthContext) {
    return this.org.list(a.workspaceId);
  }

  @Post('org/units')
  createUnit(@CurrentAuth() a: AuthContext, @Body() dto: CreateOrgUnitDto) {
    return this.org.create(a.workspaceId, dto);
  }

  @Patch('org/units/:id')
  updateUnit(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateOrgUnitDto) {
    return this.org.update(a.workspaceId, id, dto);
  }

  @Delete('org/units/:id')
  removeUnit(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.org.remove(a.workspaceId, id);
  }

  @Get('org/members')
  members(@CurrentAuth() a: AuthContext) {
    return this.org.members(a.workspaceId);
  }

  @Post('org/members')
  addMember(@CurrentAuth() a: AuthContext, @Body() dto: AddMemberDto) {
    return this.org.addMember(a.workspaceId, dto, a);
  }

  @Patch('org/members/:id')
  updateMember(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdateMemberDto) {
    return this.org.updateMember(a.workspaceId, id, dto, a);
  }

  @Delete('org/members/:id')
  removeMember(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.org.removeMember(a.workspaceId, id, a);
  }

  // Presupuestos
  @Get('budgets')
  listBudgets(@CurrentAuth() a: AuthContext) {
    return this.budgets.list(a.workspaceId);
  }

  @Put('budgets/:orgUnitId')
  upsertBudget(@CurrentAuth() a: AuthContext, @Param('orgUnitId') id: string, @Body() dto: UpsertBudgetDto) {
    return this.budgets.upsert(a.workspaceId, id, dto);
  }

  @Delete('budgets/:orgUnitId')
  removeBudget(@CurrentAuth() a: AuthContext, @Param('orgUnitId') id: string) {
    return this.budgets.remove(a.workspaceId, id);
  }

  @Get('alerts')
  alerts(@CurrentAuth() a: AuthContext) {
    return this.budgets.alerts(a.workspaceId);
  }

  // Consumo
  @Get('usage/summary')
  summary(@CurrentAuth() a: AuthContext, @Query() q: UsageQueryDto) {
    return this.usage.summary(a.workspaceId, q.from, q.to, q.groupBy);
  }

  @Get('usage/records')
  records(@CurrentAuth() a: AuthContext, @Query('take') take = '25', @Query('cursor') cursor?: string) {
    return this.usage.records(a.workspaceId, parseInt(take, 10) || 25, cursor);
  }
}
