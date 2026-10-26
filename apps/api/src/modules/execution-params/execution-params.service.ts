import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import type { SetParametrosEjecucionDto } from './dto/parametros-ejecucion.dto';
import { puedeSalirAInternet } from './egress-policy.rules';
import { EstacionesVirtualesService } from './estaciones-virtuales.service';

/** Vista de los parámetros de ejecución de un agente (E8). */
export interface ParametrosEjecucionView {
  agentId: string;
  estacionVirtualId: string | null;
  salidaInternet: boolean;
  parametrosEjecucion: Record<string, unknown>;
}

const SELECT_PARAMS = {
  id: true,
  estacionVirtualId: true,
  salidaInternet: true,
  parametrosEjecucion: true,
} as const;

/** Tamaño máximo del JSON extensible de parámetros (evita abusar de la columna). */
const MAX_PARAMETROS_BYTES = 16 * 1024;

/**
 * Parámetros de ejecución del empleado digital (E8): estación virtual asignada, salida a internet y parámetros
 * extensibles. Todo filtra por `workspaceId` (multi-tenant). Cambiar los parámetros queda auditado (E13), con el valor
 * anterior/nuevo de `salidaInternet` cuando cambia (hecho sensible que dirección debe poder auditar).
 */
@Injectable()
export class ExecutionParamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly estaciones: EstacionesVirtualesService,
  ) {}

  private toView(a: {
    id: string;
    estacionVirtualId: string | null;
    salidaInternet: boolean;
    parametrosEjecucion: Prisma.JsonValue;
  }): ParametrosEjecucionView {
    return {
      agentId: a.id,
      estacionVirtualId: a.estacionVirtualId,
      salidaInternet: a.salidaInternet,
      parametrosEjecucion: (a.parametrosEjecucion ?? {}) as Record<string, unknown>,
    };
  }

  async get(workspaceId: string, agentId: string): Promise<ParametrosEjecucionView> {
    const agent = await this.prisma.agent.findFirst({ where: { id: agentId, workspaceId }, select: SELECT_PARAMS });
    if (!agent) throw new NotFoundException('Agente no encontrado');
    return this.toView(agent);
  }

  /**
   * Fija los parámetros de ejecución de un agente. Solo actualiza lo presente en el cuerpo. Valida que la estación
   * exista en el MISMO workspace (404 si no). Audita el cambio, resaltando el cambio sensible de `salidaInternet`.
   */
  async set(auth: AuthContext, agentId: string, dto: SetParametrosEjecucionDto): Promise<ParametrosEjecucionView> {
    const { workspaceId } = auth;
    const previo = await this.prisma.agent.findFirst({ where: { id: agentId, workspaceId }, select: SELECT_PARAMS });
    if (!previo) throw new NotFoundException('Agente no encontrado');

    const data: Prisma.AgentUpdateInput = {};

    if (dto.estacionVirtualId !== undefined) {
      if (dto.estacionVirtualId === null) {
        data.estacionVirtual = { disconnect: true };
      } else {
        // La estación debe existir en el mismo workspace (NotFound si no): nunca se asigna una estación ajena.
        await this.estaciones.assertInWorkspace(workspaceId, dto.estacionVirtualId);
        data.estacionVirtual = { connect: { id: dto.estacionVirtualId } };
      }
    }

    if (dto.salidaInternet !== undefined) {
      data.salidaInternet = dto.salidaInternet;
    }

    if (dto.parametrosEjecucion !== undefined) {
      if (JSON.stringify(dto.parametrosEjecucion).length > MAX_PARAMETROS_BYTES) {
        throw new BadRequestException('Los parámetros de ejecución exceden el tamaño máximo permitido');
      }
      data.parametrosEjecucion = dto.parametrosEjecucion as Prisma.InputJsonValue;
    }

    const actualizado = await this.prisma.agent.update({ where: { id: agentId }, data, select: SELECT_PARAMS });

    const salidaCambio = dto.salidaInternet !== undefined && dto.salidaInternet !== previo.salidaInternet;
    await this.audit.append(workspaceId, {
      actorType: auth.userId ? 'USER' : 'SYSTEM',
      actorId: auth.userId ?? null,
      action: AUDIT_ACTIONS.PARAMETROS_EJECUCION_MODIFICADOS,
      targetType: 'Agent',
      targetId: agentId,
      resumen: salidaCambio
        ? `Parámetros de ejecución del agente ${agentId} actualizados; salida a internet: ${previo.salidaInternet} → ${actualizado.salidaInternet}`
        : `Parámetros de ejecución del agente ${agentId} actualizados`,
      metadata: {
        agentId,
        estacionVirtualPrevia: previo.estacionVirtualId,
        estacionVirtualNueva: actualizado.estacionVirtualId,
        salidaInternetPrevia: previo.salidaInternet,
        salidaInternetNueva: actualizado.salidaInternet,
      },
    });

    return this.toView(actualizado);
  }

  /**
   * Punto de verificación del gate de egress (E8). Lanza `ForbiddenException` si el agente NO tiene habilitada la
   * salida a internet. Es un gate ADICIONAL: cuando permite, la llamada saliente DEBE seguir pasando por
   * `HttpClientService` (SSRF, allowlist, timeout, tamaño). NUNCA desactiva esas protecciones.
   *
   * TODO (E8-2 / runtime): invocar este punto desde los ejecutores de conectores y el runtime del agente ANTES de
   * cualquier egress, de modo que `salidaInternet = false` bloquee la llamada antes de intentarla. El cableado del
   * runtime y los ejecutores vive en otra cédula; aquí queda la bandera + este punto de verificación reutilizable.
   */
  async assertSalidaInternetPermitida(workspaceId: string, agentId: string): Promise<void> {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, workspaceId },
      select: { salidaInternet: true },
    });
    if (!agent) throw new NotFoundException('Agente no encontrado');
    if (!puedeSalirAInternet(agent)) {
      throw new ForbiddenException('El agente no tiene habilitada la salida a internet');
    }
  }
}
