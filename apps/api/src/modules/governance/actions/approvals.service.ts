import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Aprobacion } from '@prisma/client';
import type { AuthContext } from '../../../common/decorators/current-user.decorator';
import { ROLE_RANK, type WorkspaceRole } from '../../../common/decorators/roles.decorator';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { applyDecision, canRegisterDecision, type ApprovalState, type DecisionRecord } from '../policy/approval.rules';
import type { ApprovalDecisionBodyDto, ApprovalsQueryDto } from './dto/actions.dto';

/** Rol mínimo que conserva atribuciones para aprobar acciones sensibles. */
const MIN_APPROVER_ROLE: WorkspaceRole = 'EDITOR';

/**
 * Bandeja de aprobaciones (RF12). Las reglas (hash, invalidación, doble aprobación, autoaprobación, caducidad) son
 * puras (`approval.rules`); este servicio persiste y aplica la autorización concreta del aprobador. El `ActionGateway`
 * crea las aprobaciones y las ejecuta; aquí se listan y se deciden.
 */
@Injectable()
export class ApprovalsService {
  constructor(private readonly prisma: PrismaService) {}

  list(workspaceId: string, q: ApprovalsQueryDto = {}) {
    return this.prisma.aprobacion.findMany({
      where: { workspaceId, ...(q.estado ? { estado: q.estado as never } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async get(workspaceId: string, id: string) {
    const a = await this.prisma.aprobacion.findFirst({ where: { id, workspaceId } });
    if (!a) throw new NotFoundException('Aprobación no encontrada');
    return a;
  }

  /** Registra una decisión (aprobar/rechazar/pedir ajuste) aplicando las reglas puras. */
  async decide(workspaceId: string, id: string, actor: AuthContext, dto: ApprovalDecisionBodyDto) {
    if (!actor.userId) throw new ForbiddenException('Solo un usuario puede decidir una aprobación');
    const aprobacion = await this.get(workspaceId, id);
    const state = toState(aprobacion);

    const check = canRegisterDecision(state, actor.userId, dto.decision);
    if (!check.ok) throw new BadRequestException(check.mensaje);

    const record: DecisionRecord = {
      actorUserId: actor.userId,
      decision: dto.decision,
      comentario: dto.comentario?.trim() || null,
      at: new Date().toISOString(),
    };
    const next = applyDecision(state, record);

    return this.prisma.aprobacion.update({
      where: { id: aprobacion.id },
      data: { estado: next.estado as never, decisiones: next.decisiones as unknown as Prisma.InputJsonValue },
    });
  }

  /** ¿Conservan todos los aprobadores (que APROBARON) el rol mínimo? (QA07, revalidación al ejecutar). */
  async approversStillAuthorized(workspaceId: string, aprobacion: Aprobacion): Promise<boolean> {
    const state = toState(aprobacion);
    const approverIds = [
      ...new Set(state.decisiones.filter((d) => d.decision === 'APRUEBA').map((d) => d.actorUserId)),
    ];
    if (approverIds.length === 0) return false;
    const memberships = await this.prisma.membership.findMany({
      where: { workspaceId, userId: { in: approverIds } },
      select: { userId: true, role: true },
    });
    const roleByUser = new Map(memberships.map((m) => [m.userId, m.role]));
    return approverIds.every((uid) => {
      const role = roleByUser.get(uid);
      return !!role && ROLE_RANK[role] >= ROLE_RANK[MIN_APPROVER_ROLE];
    });
  }
}

/** Proyecta una `Aprobacion` de Prisma al estado puro que consumen las reglas. */
export function toState(a: Aprobacion): ApprovalState {
  return {
    estado: a.estado,
    requiredApprovals: a.requiredApprovals,
    allowSelfApproval: a.allowSelfApproval,
    solicitanteUserId: a.solicitanteUserId,
    decisiones: (a.decisiones as unknown as DecisionRecord[]) ?? [],
    expiresAt: a.expiresAt,
    contentHash: a.contentHash,
  };
}
