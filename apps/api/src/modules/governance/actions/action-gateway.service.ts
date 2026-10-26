import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma, type Aprobacion } from '@prisma/client';
import type { AuthContext } from '../../../common/decorators/current-user.decorator';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BudgetsService } from '../budgets.service';
import { blockingUnit } from '../budget-policy';
import { executionCheck } from '../policy/approval.rules';
import { contentHash, type ContentHashParts } from '../policy/hashing';
import type { ActionContext } from '../policy/policy.types';
import { ACTION_DISPATCHERS, type ActionDispatcher, type DispatchResult } from './action-dispatcher';
import { ApprovalsService, toState } from './approvals.service';
import type { ActionRequestDto, ExecuteActionDto } from './dto/actions.dto';
import { PolicyService } from './policy.service';
import { SuspensionsService } from './suspensions.service';

const DEFAULT_APPROVAL_TTL_HOURS = 24;

export type ActionOutcome =
  | { estado: 'PERMITIDA'; decisionId: string; motivo: string; dispatch: DispatchResult }
  | {
      estado: 'REQUIERE_APROBACION';
      decisionId: string;
      motivo: string;
      aprobacionId: string;
      requiredApprovals: number;
    }
  | { estado: 'DENEGADA'; decisionId: string; motivo: string };

/**
 * Pasarela de acción (RF17 · ADR 0013 D2): punto ÚNICO por el que pasa toda acción con efecto externo. Secuencia:
 * validar → PolicyEngine.evaluate → si procede crear `Aprobacion` y detener → (al ejecutar) revalidar permisos +
 * presupuesto + suspensión → reservar presupuesto (reutiliza `budgets`) → despachar (seam) → conciliar. Ningún canal
 * llama al exterior sin pasar por aquí.
 */
@Injectable()
export class ActionGatewayService {
  private readonly logger = new Logger(ActionGatewayService.name);
  private readonly dispatchers: Map<string, ActionDispatcher>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly approvals: ApprovalsService,
    private readonly suspensions: SuspensionsService,
    private readonly budgets: BudgetsService,
    @Optional() @Inject(ACTION_DISPATCHERS) dispatchers?: ActionDispatcher[],
  ) {
    this.dispatchers = new Map((dispatchers ?? []).map((d) => [d.tipoAccion, d]));
  }

  /** Construye el contexto de evaluación con los insumos de plataforma (suspensión, presupuesto). */
  private async buildContext(workspaceId: string, dto: ActionRequestDto, actor: AuthContext): Promise<ActionContext> {
    const ctx: ActionContext = {
      workspaceId,
      empresaId: dto.empresaId ?? null,
      orgUnitId: dto.orgUnitId ?? null,
      agentId: dto.agentId ?? null,
      userId: actor.userId ?? null,
      tipoAccion: dto.tipoAccion,
      conectorId: dto.conectorId ?? null,
      recurso: dto.recurso ?? null,
      operacion: dto.operacion ?? null,
      procesoId: dto.procesoId ?? null,
      destinatarios: dto.destinatarios ?? [],
      monto: dto.importe ?? null,
      moneda: dto.moneda ?? null,
      clasificacionDato: dto.clasificacionDato ?? null,
      horaLocal: dto.horaLocal ?? null,
      diaSemana: dto.diaSemana ?? null,
      requiereRevisionCruzada: dto.requiereRevisionCruzada ?? false,
    };
    ctx.suspendido = await this.suspensions.isActionSuspended(workspaceId, ctx);
    ctx.presupuestoBloqueado = await this.isBudgetBlocked(workspaceId, dto.orgUnitId);
    return ctx;
  }

  private async isBudgetBlocked(workspaceId: string, orgUnitId?: string | null): Promise<boolean> {
    if (!orgUnitId) return false;
    const chain = await this.budgets.chainState(workspaceId, orgUnitId);
    return !!blockingUnit(chain);
  }

  private hashParts(dto: ActionRequestDto): ContentHashParts {
    return {
      tipoAccion: dto.tipoAccion,
      operacion: dto.operacionParams ?? { operacion: dto.operacion ?? null },
      herramienta: dto.herramienta ?? dto.conectorId ?? null,
      agentVersionId: dto.agentVersionId ?? null,
      destinatarios: dto.destinatarios ?? [],
      contenido: dto.contenido ?? null,
      adjuntos: dto.adjuntos ?? null,
      importe: dto.importe ?? null,
      moneda: dto.moneda ?? null,
    };
  }

  /** Paso 1: validar + evaluar política + (si procede) crear aprobación y detener. */
  async requestAction(workspaceId: string, dto: ActionRequestDto, actor: AuthContext): Promise<ActionOutcome> {
    const ctx = await this.buildContext(workspaceId, dto, actor);
    const { decision, decisionId } = await this.policy.evaluate(workspaceId, ctx);

    if (decision.efecto === 'DENY') {
      return { estado: 'DENEGADA', decisionId, motivo: decision.motivo };
    }

    if (decision.efecto === 'REQUIRE_APPROVAL') {
      const ttlH = dto.expiresInHours ?? DEFAULT_APPROVAL_TTL_HOURS;
      const aprobacion = await this.prisma.aprobacion.create({
        data: {
          workspaceId,
          empresaId: dto.empresaId ?? null,
          tareaId: dto.tareaId ?? null,
          proposito: dto.proposito ?? null,
          tipoAccion: dto.tipoAccion,
          operacion: (dto.operacionParams ?? { operacion: dto.operacion ?? null }) as Prisma.InputJsonValue,
          identidadEjec: {
            agentId: dto.agentId ?? null,
            agentVersionId: dto.agentVersionId ?? null,
            herramienta: dto.herramienta ?? dto.conectorId ?? null,
          },
          destinatarios: dto.destinatarios ?? [],
          contenido: (dto.contenido ?? {}) as Prisma.InputJsonValue,
          adjuntos: (dto.adjuntos ?? undefined) as Prisma.InputJsonValue | undefined,
          contentHash: contentHash(this.hashParts(dto)),
          importe: dto.importe != null ? new Prisma.Decimal(dto.importe) : null,
          moneda: dto.moneda ?? null,
          riesgo: dto.riesgo ?? 'MEDIO',
          requiredApprovals: decision.requiredApprovals,
          allowSelfApproval: decision.allowSelfApproval,
          solicitanteUserId: actor.userId ?? null,
          solicitanteAgentId: dto.agentId ?? null,
          orgUnitId: dto.orgUnitId ?? null,
          decisiones: [],
          estado: 'PENDIENTE',
          expiresAt: new Date(Date.now() + ttlH * 60 * 60 * 1000),
          decisionPoliticaId: decisionId,
        },
      });
      await this.prisma.decisionPolitica.update({ where: { id: decisionId }, data: { aprobacionId: aprobacion.id } });
      return {
        estado: 'REQUIERE_APROBACION',
        decisionId,
        motivo: decision.motivo,
        aprobacionId: aprobacion.id,
        requiredApprovals: decision.requiredApprovals,
      };
    }

    // ALLOW: revalida presupuesto + suspensión justo antes del efecto y despacha (seam).
    const dispatch = await this.guardedDispatch(workspaceId, ctx, undefined, decisionId);
    return { estado: 'PERMITIDA', decisionId, motivo: decision.motivo, dispatch };
  }

  /** Paso 2 (vía aprobación): revalidar TODO justo antes del efecto, reservar presupuesto y despachar. */
  async execute(workspaceId: string, aprobacionId: string, actor: AuthContext, override?: ExecuteActionDto) {
    const aprobacion = await this.prisma.aprobacion.findFirst({ where: { id: aprobacionId, workspaceId } });
    if (!aprobacion) throw new NotFoundException('Aprobación no encontrada');

    // Recompone el contexto desde la aprobación para revalidar la política y la suspensión.
    const ctx = this.ctxFromAprobacion(workspaceId, aprobacion, actor);
    ctx.suspendido = await this.suspensions.isActionSuspended(workspaceId, ctx);
    ctx.presupuestoBloqueado = await this.isBudgetBlocked(workspaceId, aprobacion.orgUnitId);

    const reeval = await this.policy.evaluate(workspaceId, ctx);
    if (reeval.decision.efecto === 'DENY') {
      await this.invalidate(aprobacion.id, 'INVALIDADA');
      throw new ForbiddenException(`La acción dejó de estar permitida al ejecutar: ${reeval.decision.motivo}`);
    }

    // Recomputa el contentHash sobre la propuesta ACTUAL (QA03) y verifica aprobadores con permiso (QA07).
    const recomputedHash = this.recomputeHash(aprobacion, override);
    const approversOk = await this.approvals.approversStillAuthorized(workspaceId, aprobacion);
    const check = executionCheck({ state: toState(aprobacion), recomputedHash, approversStillAuthorized: approversOk });
    if (!check.ok) {
      await this.invalidate(aprobacion.id, check.estado === 'RECHAZADA' ? aprobacion.estado : check.estado);
      throw new ForbiddenException(check.motivo);
    }

    // Reserva de presupuesto (reutiliza budgets): corta si una bolsa con bloqueo se agotó.
    if (aprobacion.orgUnitId) await this.budgets.assertCanSpend(workspaceId, aprobacion.orgUnitId);

    const dispatch = await this.guardedDispatch(workspaceId, ctx, aprobacion, aprobacion.id);
    const updated = await this.prisma.aprobacion.update({
      where: { id: aprobacion.id },
      data: { estado: 'EJECUTADA' },
    });
    return { aprobacion: updated, dispatch };
  }

  /** Revalida suspensión justo antes del efecto y delega en el despachador registrado (si existe). */
  private async guardedDispatch(
    workspaceId: string,
    ctx: ActionContext,
    aprobacion: Aprobacion | undefined,
    idempotencyKey: string,
  ): Promise<DispatchResult> {
    if (await this.suspensions.isActionSuspended(workspaceId, ctx)) {
      throw new ForbiddenException('Acción bloqueada por una suspensión de emergencia activa');
    }
    const dispatcher = this.dispatchers.get(ctx.tipoAccion);
    if (!dispatcher) {
      this.logger.debug(`Sin despachador para ${ctx.tipoAccion}: acción gobernada pero no despachada (seam E14/E8).`);
      return { status: 'SEAM', detalle: 'Despacho no implementado (canales E14 / herramientas E8)' };
    }
    return dispatcher.dispatch({ ctx, aprobacion, idempotencyKey });
  }

  private async invalidate(id: string, estado: 'INVALIDADA' | 'CADUCADA' | Aprobacion['estado']) {
    await this.prisma.aprobacion.update({ where: { id }, data: { estado: estado as never } });
  }

  private ctxFromAprobacion(workspaceId: string, a: Aprobacion, actor: AuthContext): ActionContext {
    const identidad = (a.identidadEjec as { agentId?: string; herramienta?: string }) ?? {};
    return {
      workspaceId,
      empresaId: a.empresaId,
      orgUnitId: a.orgUnitId,
      agentId: identidad.agentId ?? a.solicitanteAgentId ?? null,
      userId: actor.userId ?? null,
      tipoAccion: a.tipoAccion,
      conectorId: identidad.herramienta ?? null,
      recurso: identidad.herramienta ?? null,
      destinatarios: (a.destinatarios as string[]) ?? [],
      monto: a.importe != null ? Number(a.importe) : null,
      moneda: a.moneda,
    };
  }

  private recomputeHash(a: Aprobacion, override?: ExecuteActionDto): string {
    const identidad = (a.identidadEjec as { herramienta?: string; agentVersionId?: string }) ?? {};
    const parts: ContentHashParts = {
      tipoAccion: a.tipoAccion,
      operacion: override?.operacionParams ?? a.operacion,
      herramienta: override?.herramienta ?? identidad.herramienta ?? null,
      agentVersionId: override?.agentVersionId ?? identidad.agentVersionId ?? null,
      destinatarios: override?.destinatarios ?? (a.destinatarios as string[]) ?? [],
      contenido: override?.contenido ?? a.contenido,
      adjuntos: override?.adjuntos ?? a.adjuntos,
      importe: override?.importe ?? (a.importe != null ? Number(a.importe) : null),
      moneda: override?.moneda ?? a.moneda,
    };
    return contentHash(parts);
  }
}
