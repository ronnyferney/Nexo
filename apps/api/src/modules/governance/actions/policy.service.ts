import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { actionContextHash } from '../policy/hashing';
import { evaluate } from '../policy/policy-engine';
import type { ActionContext, PolicyDecision, PolicyRule, PolicySelector } from '../policy/policy.types';
import type { CreatePoliticaDto, UpdatePoliticaDto } from './dto/actions.dto';

export interface EvaluateResult {
  decision: PolicyDecision;
  decisionId: string;
}

/**
 * Políticas versionadas (RF11) y evaluación server-side. El motor es puro (`policy-engine`); este servicio solo carga
 * las reglas ACTIVAS y vigentes de BD, invoca el motor y persiste la `DecisionPolitica` inmutable con la versión de
 * cada política que disparó. Un cambio de política NO reescribe: archiva la vigente y crea una versión nueva.
 */
@Injectable()
export class PolicyService {
  constructor(private readonly prisma: PrismaService) {}

  list(workspaceId: string, filtro: { tipoAccion?: string; estado?: string } = {}) {
    return this.prisma.politica.findMany({
      where: {
        workspaceId,
        ...(filtro.tipoAccion ? { tipoAccion: filtro.tipoAccion } : {}),
        ...(filtro.estado ? { estado: filtro.estado as never } : {}),
      },
      orderBy: [{ nombre: 'asc' }, { version: 'desc' }],
    });
  }

  async get(workspaceId: string, id: string) {
    const p = await this.prisma.politica.findFirst({ where: { id, workspaceId } });
    if (!p) throw new NotFoundException('Política no encontrada');
    return p;
  }

  create(workspaceId: string, dto: CreatePoliticaDto) {
    return this.prisma.politica.create({
      data: {
        workspaceId,
        nombre: dto.nombre.trim(),
        tipoAccion: dto.tipoAccion.trim(),
        empresaId: dto.empresaId ?? null,
        selector: (dto.selector ?? {}) as Prisma.InputJsonValue,
        efecto: dto.efecto,
        requiredApprovals: dto.requiredApprovals ?? 1,
        allowSelfApproval: dto.allowSelfApproval ?? false,
        version: 1,
        estado: (dto.estado ?? 'ACTIVA') as never,
      },
    });
  }

  /** Un cambio archiva la versión vigente y crea otra con `version + 1` (inmutabilidad del historial, RF11). */
  async update(workspaceId: string, id: string, dto: UpdatePoliticaDto) {
    const actual = await this.get(workspaceId, id);
    return this.prisma.$transaction(async (tx) => {
      await tx.politica.update({ where: { id: actual.id }, data: { estado: 'ARCHIVADA', vigenteHasta: new Date() } });
      return tx.politica.create({
        data: {
          workspaceId,
          nombre: (dto.nombre ?? actual.nombre).trim(),
          tipoAccion: (dto.tipoAccion ?? actual.tipoAccion).trim(),
          empresaId: dto.empresaId !== undefined ? dto.empresaId : actual.empresaId,
          selector: dto.selector ?? (actual.selector as object),
          efecto: dto.efecto ?? actual.efecto,
          requiredApprovals: dto.requiredApprovals ?? actual.requiredApprovals,
          allowSelfApproval: dto.allowSelfApproval ?? actual.allowSelfApproval,
          version: actual.version + 1,
          estado: (dto.estado ?? 'ACTIVA') as never,
        },
      });
    });
  }

  async archive(workspaceId: string, id: string) {
    const actual = await this.get(workspaceId, id);
    return this.prisma.politica.update({
      where: { id: actual.id },
      data: { estado: 'ARCHIVADA', vigenteHasta: new Date() },
    });
  }

  /** Evalúa el contexto y registra la decisión inmutable. Devuelve la decisión y el id del registro. */
  async evaluate(workspaceId: string, ctx: ActionContext): Promise<EvaluateResult> {
    const now = new Date();
    const activas = await this.prisma.politica.findMany({
      where: {
        workspaceId,
        tipoAccion: ctx.tipoAccion,
        estado: 'ACTIVA',
        vigenteDesde: { lte: now },
        OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: now } }],
      },
    });
    const rules: PolicyRule[] = activas.map((p) => ({
      id: p.id,
      version: p.version,
      tipoAccion: p.tipoAccion,
      empresaId: p.empresaId,
      selector: (p.selector ?? {}) as PolicySelector,
      efecto: p.efecto,
      requiredApprovals: p.requiredApprovals,
      allowSelfApproval: p.allowSelfApproval,
    }));

    const decision = evaluate({ ctx, rules });

    const registro = await this.prisma.decisionPolitica.create({
      data: {
        workspaceId,
        tipoAccion: ctx.tipoAccion,
        actionContextHash: actionContextHash(ctx),
        efecto: decision.efecto,
        requiredApprovals: decision.requiredApprovals,
        policyVersions: decision.matched as unknown as Prisma.InputJsonValue,
        motivo: decision.motivo,
      },
    });
    return { decision, decisionId: registro.id };
  }

  /** Decisiones registradas (auditoría); inmutables. */
  decisions(workspaceId: string, take = 50) {
    return this.prisma.decisionPolitica.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
