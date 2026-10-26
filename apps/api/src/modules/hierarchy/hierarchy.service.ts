import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { NivelJerarquico } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import {
  cadenaDeMando,
  construirArbol,
  creariaCiclo,
  nivelSupervisorCoherente,
  resolverNivel,
  type NodoArbol,
} from './hierarchy.rules';

/** Vista de un nodo del organigrama. `nivel` es el nivel efectivo (resuelto con la política conservadora). */
export interface NodoOrganigrama {
  id: string;
  nombre: string;
  icono: string | null;
  reportaAAgentId: string | null;
  cargo: { id: string; nombre: string; nivel: NivelJerarquico } | null;
  nivel: NivelJerarquico;
  responsable: { id: string; nombre: string } | null;
}

interface AgentJerarquia {
  id: string;
  name: string;
  icon: string | null;
  reportaAAgentId: string | null;
  cargo: { id: string; nombre: string; nivel: NivelJerarquico } | null;
  responsableUser: { id: string; name: string } | null;
}

const SELECT_JERARQUIA = {
  id: true,
  name: true,
  icon: true,
  reportaAAgentId: true,
  cargo: { select: { id: true, nombre: true, nivel: true } },
  responsableUser: { select: { id: true, name: true } },
} as const;

/**
 * Jerarquía / organigrama de empleados digitales (E3/RF32). Modela la línea de mando (qué agente reporta a qué agente)
 * con reglas de integridad puras (`hierarchy.rules.ts`). Todo filtra por `workspaceId` (multi-tenant).
 *
 * Invariante (ADR 0007): la jerarquía NO concede acceso a datos. Fijar un supervisor no da permisos a nadie; el acceso
 * efectivo lo sigue resolviendo `AgentAccessService`. Este servicio solo escribe `Agent.reportaAAgentId` y audita.
 */
@Injectable()
export class HierarchyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private toNodo(a: AgentJerarquia): NodoOrganigrama {
    return {
      id: a.id,
      nombre: a.name,
      icono: a.icon,
      reportaAAgentId: a.reportaAAgentId,
      cargo: a.cargo,
      nivel: resolverNivel(a.cargo?.nivel),
      responsable: a.responsableUser ? { id: a.responsableUser.id, nombre: a.responsableUser.name } : null,
    };
  }

  /** Organigrama del workspace como árbol: raíces (agentes sin supervisor) con sus subordinados anidados. */
  async organigrama(workspaceId: string): Promise<NodoArbol<NodoOrganigrama>[]> {
    const agentes: AgentJerarquia[] = await this.prisma.agent.findMany({
      where: { workspaceId },
      select: SELECT_JERARQUIA,
    });
    return construirArbol(
      agentes.map((a) => {
        const datos = this.toNodo(a);
        return { id: a.id, reportaAAgentId: a.reportaAAgentId, datos };
      }),
      (x, y) => x.nombre.localeCompare(y.nombre),
    );
  }

  /** Cadena de mando ascendente de un agente (sus supervisores del directo hasta la raíz). */
  async cadenaMando(workspaceId: string, agentId: string): Promise<{ agentId: string; cadena: NodoOrganigrama[] }> {
    const agentes: AgentJerarquia[] = await this.prisma.agent.findMany({
      where: { workspaceId },
      select: SELECT_JERARQUIA,
    });
    const porId = new Map(agentes.map((a) => [a.id, a]));
    if (!porId.has(agentId)) throw new NotFoundException('Agente no encontrado');
    const padres = new Map<string, string | null>(agentes.map((a) => [a.id, a.reportaAAgentId]));
    const cadenaIds = cadenaDeMando(agentId, padres);
    return { agentId, cadena: cadenaIds.map((id) => this.toNodo(porId.get(id)!)) };
  }

  /**
   * Fija o cambia a quién reporta un agente. Valida (en este orden): existencia del agente y del supervisor en el
   * MISMO workspace (regla 3), ausencia de ciclos (regla 1) y coherencia de nivel (regla 2). Audita el cambio (E13).
   */
  async setSupervisor(auth: AuthContext, agentId: string, reportaAAgentId: string | null): Promise<NodoOrganigrama> {
    const { workspaceId } = auth;
    const agente: AgentJerarquia | null = await this.prisma.agent.findFirst({
      where: { id: agentId, workspaceId },
      select: SELECT_JERARQUIA,
    });
    if (!agente) throw new NotFoundException('Agente no encontrado');

    const supervisorId = reportaAAgentId ?? null;

    if (supervisorId) {
      if (supervisorId === agentId) {
        throw new BadRequestException('Un agente no puede reportar a sí mismo');
      }
      // Regla 3 (mismo workspace): el supervisor debe existir en el workspace del agente.
      const supervisor: AgentJerarquia | null = await this.prisma.agent.findFirst({
        where: { id: supervisorId, workspaceId },
        select: SELECT_JERARQUIA,
      });
      if (!supervisor) throw new NotFoundException('El agente supervisor no existe en este workspace');

      // Regla 1 (sin ciclos): el supervisor no puede ser descendiente del agente.
      const padres = new Map<string, string | null>(
        (await this.prisma.agent.findMany({ where: { workspaceId }, select: { id: true, reportaAAgentId: true } })).map(
          (a) => [a.id, a.reportaAAgentId],
        ),
      );
      if (creariaCiclo(agentId, supervisorId, padres)) {
        throw new BadRequestException('El supervisor indicado generaría un ciclo en la línea de mando');
      }

      // Regla 2 (coherencia de nivel): el nivel del supervisor debe ser >= el del subordinado.
      if (!nivelSupervisorCoherente(resolverNivel(supervisor.cargo?.nivel), resolverNivel(agente.cargo?.nivel))) {
        throw new BadRequestException(
          'El nivel jerárquico del supervisor debe ser mayor o igual que el del agente subordinado',
        );
      }
    }

    const supervisorPrevio = agente.reportaAAgentId;
    const actualizado: AgentJerarquia = await this.prisma.agent.update({
      where: { id: agentId },
      data: { reportaAAgentId: supervisorId },
      select: SELECT_JERARQUIA,
    });

    // Auditoría (E13): actor humano (la ruta exige ADMIN), agente y supervisor previo/nuevo.
    await this.audit.append(workspaceId, {
      actorType: auth.userId ? 'USER' : 'SYSTEM',
      actorId: auth.userId ?? null,
      action: AUDIT_ACTIONS.JERARQUIA_MODIFICADA,
      targetType: 'Agent',
      targetId: agentId,
      resumen: supervisorId
        ? `Línea de mando actualizada: el agente ${agentId} ahora reporta a ${supervisorId}`
        : `Línea de mando actualizada: el agente ${agentId} queda como raíz (sin supervisor)`,
      metadata: { agentId, supervisorPrevio, supervisorNuevo: supervisorId },
    });

    return this.toNodo(actualizado);
  }
}
