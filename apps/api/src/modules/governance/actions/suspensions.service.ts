import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Suspension } from '@prisma/client';
import type { AuthContext } from '../../../common/decorators/current-user.decorator';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AUDIT_ACTIONS } from '../../audit/audit.types';
import type { ActionContext } from '../policy/policy.types';
import type { CreateSuspensionDto } from './dto/actions.dto';

/**
 * Suspensión de emergencia (RF13). Bloquea nuevas acciones y pendientes de despacho cuyo alcance caiga bajo una
 * suspensión activa. La reactivación exige actor + motivo. El `ActionGateway` consulta `isActionSuspended` antes de
 * cada efecto (no es un chequeo disperso).
 */
@Injectable()
export class SuspensionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(workspaceId: string, soloActivas = false) {
    return this.prisma.suspension.findMany({
      where: { workspaceId, ...(soloActivas ? { activa: true } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(workspaceId: string, id: string) {
    const s = await this.prisma.suspension.findFirst({ where: { id, workspaceId } });
    if (!s) throw new NotFoundException('Suspensión no encontrada');
    return s;
  }

  async create(workspaceId: string, dto: CreateSuspensionDto, actor: AuthContext) {
    const suspension = await this.prisma.suspension.create({
      data: {
        workspaceId,
        alcance: dto.alcance,
        targetId: dto.targetId,
        motivo: dto.motivo.trim(),
        actorUserId: actor.userId ?? null,
        activa: true,
      },
    });
    await this.audit.append(workspaceId, {
      actorType: actor.userId ? 'USER' : 'SYSTEM',
      actorId: actor.userId ?? null,
      action: AUDIT_ACTIONS.SUSPENSION_ACTIVADA,
      targetType: 'Suspension',
      targetId: suspension.id,
      resumen: `Suspensión de emergencia activada (${dto.alcance}) sobre ${dto.targetId}`,
      metadata: { alcance: dto.alcance, targetId: dto.targetId, motivo: suspension.motivo },
    });
    return suspension;
  }

  async reactivate(workspaceId: string, id: string, actor: AuthContext, motivo: string) {
    const s = await this.get(workspaceId, id);
    if (!s.activa) throw new BadRequestException('La suspensión ya está inactiva');
    const updated = await this.prisma.suspension.update({
      where: { id: s.id },
      data: {
        activa: false,
        reactivadaPor: actor.userId ?? null,
        reactivadaMotivo: motivo.trim(),
        reactivadaAt: new Date(),
      },
    });
    await this.audit.append(workspaceId, {
      actorType: actor.userId ? 'USER' : 'SYSTEM',
      actorId: actor.userId ?? null,
      action: AUDIT_ACTIONS.SUSPENSION_LEVANTADA,
      targetType: 'Suspension',
      targetId: s.id,
      resumen: `Suspensión de emergencia levantada (${s.alcance}) sobre ${s.targetId}`,
      metadata: { alcance: s.alcance, targetId: s.targetId, motivo: updated.reactivadaMotivo },
    });
    return updated;
  }

  /** ¿Una suspensión activa alcanza esta acción? Reutilizable por el gateway para nuevas y pendientes. */
  async isActionSuspended(workspaceId: string, ctx: ActionContext): Promise<boolean> {
    const activas = await this.prisma.suspension.findMany({ where: { workspaceId, activa: true } });
    return activas.some((s) => suspensionMatches(s, ctx));
  }
}

/** Coincidencia pura entre una suspensión y el contexto de una acción. */
export function suspensionMatches(
  s: Pick<Suspension, 'alcance' | 'targetId' | 'workspaceId'>,
  ctx: ActionContext,
): boolean {
  switch (s.alcance) {
    case 'AGENTE':
      return !!ctx.agentId && s.targetId === ctx.agentId;
    case 'PROCESO':
      return !!ctx.procesoId && s.targetId === ctx.procesoId;
    case 'CONECTOR':
      return (!!ctx.conectorId && s.targetId === ctx.conectorId) || (!!ctx.recurso && s.targetId === ctx.recurso);
    case 'ORGANIZACION':
      // Alcanza por empresa o por el workspace completo.
      return s.targetId === ctx.empresaId || s.targetId === ctx.workspaceId;
    default:
      return false;
  }
}
