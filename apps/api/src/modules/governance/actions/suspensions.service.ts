import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Suspension } from '@prisma/client';
import type { AuthContext } from '../../../common/decorators/current-user.decorator';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { ActionContext } from '../policy/policy.types';
import type { CreateSuspensionDto } from './dto/actions.dto';

/**
 * Suspensión de emergencia (RF13). Bloquea nuevas acciones y pendientes de despacho cuyo alcance caiga bajo una
 * suspensión activa. La reactivación exige actor + motivo. El `ActionGateway` consulta `isActionSuspended` antes de
 * cada efecto (no es un chequeo disperso).
 */
@Injectable()
export class SuspensionsService {
  constructor(private readonly prisma: PrismaService) {}

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

  create(workspaceId: string, dto: CreateSuspensionDto, actor: AuthContext) {
    return this.prisma.suspension.create({
      data: {
        workspaceId,
        alcance: dto.alcance,
        targetId: dto.targetId,
        motivo: dto.motivo.trim(),
        actorUserId: actor.userId ?? null,
        activa: true,
      },
    });
  }

  async reactivate(workspaceId: string, id: string, actor: AuthContext, motivo: string) {
    const s = await this.get(workspaceId, id);
    if (!s.activa) throw new BadRequestException('La suspensión ya está inactiva');
    return this.prisma.suspension.update({
      where: { id: s.id },
      data: {
        activa: false,
        reactivadaPor: actor.userId ?? null,
        reactivadaMotivo: motivo.trim(),
        reactivadaAt: new Date(),
      },
    });
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
