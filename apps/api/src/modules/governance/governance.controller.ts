import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../common/decorators/current-user.decorator';
import { OptionalAuth, Public } from '../../common/decorators/public.decorator';
import { MinRole } from '../../common/decorators/roles.decorator';
import { SessionCookieService } from '../../common/guards/session-cookie.service';
import { BudgetsService } from './budgets.service';
import {
  AcceptInvitationDto,
  AddMemberDto,
  CreateOrgUnitDto,
  UpdateMemberDto,
  UpdateOrgUnitDto,
  UpsertBudgetDto,
  UsageQueryDto,
} from './dto/governance.dto';
import { InvitationsService } from './invitations.service';
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
    private readonly invitations: InvitationsService,
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

  /** Invita a un miembro: responde la invitación y el enlace de aceptación (se muestra una sola vez). */
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

  @Get('org/invitations')
  listInvitations(@CurrentAuth() a: AuthContext) {
    return this.invitations.list(a.workspaceId);
  }

  @Delete('org/invitations/:id')
  revokeInvitation(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.invitations.revoke(a.workspaceId, id, a);
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

/** Página pública de la invitación (C1): ver y aceptar con el enlace de un solo uso. */
@ApiTags('auth')
@Controller('auth/invitations')
export class InvitationsPublicController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly cookies: SessionCookieService,
  ) {}

  /**
   * Vista previa pública. `accountExists`/`requiresLogin` revelan si el correo invitado tiene cuenta, lo cual se
   * acepta (B4): solo los ve quien tiene el enlace de un solo uso, que se envía a ese correo (o lo comparte el
   * administrador que invitó, que ya conoce el correo); el token de 256 bits no se puede adivinar ni enumerar, y la
   * página necesita el dato para pedir contraseña nueva o inicio de sesión. El correo se muestra enmascarado.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  preview(@Param('token') token: string) {
    return this.invitations.preview(token);
  }

  /**
   * Sin sesión crea o recupera la cuenta; con sesión (cuenta verificada) acepta como ese usuario. Deja iniciada la
   * sesión de la web en el workspace que invitó (cookie, M6).
   */
  @OptionalAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':token/accept')
  async accept(
    @Param('token') token: string,
    @Body() dto: AcceptInvitationDto,
    @Res({ passthrough: true }) res: Response,
    @CurrentAuth() a?: AuthContext,
  ) {
    const result = await this.invitations.accept(token, dto, a?.via === 'jwt' ? a : undefined);
    this.cookies.set(res, result.accessToken);
    return result;
  }
}
