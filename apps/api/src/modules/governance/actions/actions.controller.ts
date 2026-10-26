import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../../../common/decorators/current-user.decorator';
import { MinRole } from '../../../common/decorators/roles.decorator';
import { ActionGatewayService } from './action-gateway.service';
import { ApprovalsService } from './approvals.service';
import {
  ActionRequestDto,
  ApprovalDecisionBodyDto,
  ApprovalsQueryDto,
  CreatePoliticaDto,
  CreateSuspensionDto,
  ExecuteActionDto,
  ReactivateSuspensionDto,
  UpdatePoliticaDto,
} from './dto/actions.dto';
import { PolicyService } from './policy.service';
import { SuspensionsService } from './suspensions.service';

/** Políticas (RF11). CRUD solo ADMIN; un cambio versiona (no reescribe). */
@ApiTags('governance-policies')
@ApiBearerAuth()
@MinRole('ADMIN')
@Controller('admin/policies')
export class PoliciesController {
  constructor(private readonly policy: PolicyService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext, @Query('tipoAccion') tipoAccion?: string, @Query('estado') estado?: string) {
    return this.policy.list(a.workspaceId, { tipoAccion, estado });
  }

  @Get('decisions')
  decisions(@CurrentAuth() a: AuthContext) {
    return this.policy.decisions(a.workspaceId);
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.policy.get(a.workspaceId, id);
  }

  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreatePoliticaDto) {
    return this.policy.create(a.workspaceId, dto);
  }

  @Patch(':id')
  update(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: UpdatePoliticaDto) {
    return this.policy.update(a.workspaceId, id, dto);
  }

  @Delete(':id')
  archive(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.policy.archive(a.workspaceId, id);
  }
}

/** Pasarela de acción (RF17). Punto de entrada para solicitar/ejecutar una acción con efecto externo. */
@ApiTags('governance-actions')
@ApiBearerAuth()
@Controller('actions')
export class ActionsController {
  constructor(private readonly gateway: ActionGatewayService) {}

  /** Evalúa la política y, si procede, crea una aprobación. EDITOR+ para solicitar una acción. */
  @MinRole('EDITOR')
  @Post()
  @HttpCode(200)
  request(@CurrentAuth() a: AuthContext, @Body() dto: ActionRequestDto) {
    return this.gateway.requestAction(a.workspaceId, dto, a);
  }

  /** Ejecuta una acción aprobada: revalida permisos + presupuesto + suspensión + hash justo antes del efecto. */
  @MinRole('EDITOR')
  @Post('approvals/:id/execute')
  @HttpCode(200)
  execute(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: ExecuteActionDto) {
    return this.gateway.execute(a.workspaceId, id, a, dto);
  }
}

/** Bandeja de aprobaciones (RF12). Listar para cualquier miembro; decidir requiere EDITOR+ (y nunca el solicitante). */
@ApiTags('governance-approvals')
@ApiBearerAuth()
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext, @Query() q: ApprovalsQueryDto) {
    return this.approvals.list(a.workspaceId, q);
  }

  @Get(':id')
  get(@CurrentAuth() a: AuthContext, @Param('id') id: string) {
    return this.approvals.get(a.workspaceId, id);
  }

  @MinRole('EDITOR')
  @Post(':id/decision')
  @HttpCode(200)
  decide(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: ApprovalDecisionBodyDto) {
    return this.approvals.decide(a.workspaceId, id, a, dto);
  }
}

/** Suspensión de emergencia (RF13). Crear/reactivar solo ADMIN; la reactivación exige motivo. */
@ApiTags('governance-suspensions')
@ApiBearerAuth()
@MinRole('ADMIN')
@Controller('admin/suspensions')
export class SuspensionsController {
  constructor(private readonly suspensions: SuspensionsService) {}

  @Get()
  list(@CurrentAuth() a: AuthContext, @Query('activas') activas?: string) {
    return this.suspensions.list(a.workspaceId, activas === 'true');
  }

  @Post()
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateSuspensionDto) {
    return this.suspensions.create(a.workspaceId, dto, a);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(@CurrentAuth() a: AuthContext, @Param('id') id: string, @Body() dto: ReactivateSuspensionDto) {
    return this.suspensions.reactivate(a.workspaceId, id, a, dto.motivo);
  }
}
