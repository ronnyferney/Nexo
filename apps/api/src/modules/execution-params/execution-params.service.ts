import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import type { SetParametrosEjecucionDto } from './dto/parametros-ejecucion.dto';
import { puedeConectarSistemasAutorizados, puedeNavegarWeb } from './egress-policy.rules';
import { EstacionesVirtualesService } from './estaciones-virtuales.service';

/** Vista de los parámetros de ejecución de un agente (E8). */
export interface ParametrosEjecucionView {
  agentId: string;
  estacionVirtualId: string | null;
  /** LEGADO: espejo de lectura, coherente con las categorías. Se retira en un incremento posterior. */
  salidaInternet: boolean;
  /** Navegación/fetch web general (categoría del candado segmentado). */
  navegacionWeb: boolean;
  /** Conexión a conectores/sistemas de negocio autorizados (categoría del candado segmentado). */
  sistemasAutorizados: boolean;
  parametrosEjecucion: Record<string, unknown>;
}

const SELECT_PARAMS = {
  id: true,
  estacionVirtualId: true,
  salidaInternet: true,
  navegacionWeb: true,
  sistemasAutorizados: true,
  parametrosEjecucion: true,
} as const;

/** Tamaño máximo del JSON extensible de parámetros (evita abusar de la columna). */
const MAX_PARAMETROS_BYTES = 16 * 1024;

type AgentParams = {
  id: string;
  estacionVirtualId: string | null;
  salidaInternet: boolean;
  navegacionWeb: boolean;
  sistemasAutorizados: boolean;
  parametrosEjecucion: Prisma.JsonValue;
};

/**
 * Parámetros de ejecución del empleado digital (E8): estación virtual asignada, candado de salida a internet
 * segmentado (`navegacionWeb` + `sistemasAutorizados`, corrección Opción A) y parámetros extensibles. Todo filtra por
 * `workspaceId` (multi-tenant). Cambiar los parámetros queda auditado (E13), con los valores anterior/nuevo de las
 * categorías del candado (hecho sensible que dirección debe poder auditar).
 *
 * Compatibilidad: el campo legado `salidaInternet` se conserva como espejo de lectura una versión. `set()` mantiene las
 * tres banderas coherentes, acepte el cliente las categorías nuevas o el campo legado, para no romper la UI anterior.
 */
@Injectable()
export class ExecutionParamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly estaciones: EstacionesVirtualesService,
  ) {}

  private toView(a: AgentParams): ParametrosEjecucionView {
    return {
      agentId: a.id,
      estacionVirtualId: a.estacionVirtualId,
      salidaInternet: a.salidaInternet,
      navegacionWeb: a.navegacionWeb,
      sistemasAutorizados: a.sistemasAutorizados,
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
   * exista en el MISMO workspace (404 si no). Audita el cambio, resaltando los cambios sensibles del candado.
   *
   * Puente de compatibilidad: si el cuerpo trae las categorías (`navegacionWeb`/`sistemasAutorizados`), se escriben y
   * el legado `salidaInternet` queda como `navegacionWeb || sistemasAutorizados`. Si el cuerpo solo trae el legado
   * `salidaInternet`, se escribe y se refleja en AMBAS categorías (toggle único anterior). Así ninguna vía queda inerte.
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

    // Resolución del candado: las categorías nuevas tienen prioridad; el legado `salidaInternet` es el puente.
    const categoriasEnCuerpo = dto.navegacionWeb !== undefined || dto.sistemasAutorizados !== undefined;
    if (categoriasEnCuerpo) {
      const navegacionWeb = dto.navegacionWeb ?? previo.navegacionWeb;
      const sistemasAutorizados = dto.sistemasAutorizados ?? previo.sistemasAutorizados;
      data.navegacionWeb = navegacionWeb;
      data.sistemasAutorizados = sistemasAutorizados;
      data.salidaInternet = navegacionWeb || sistemasAutorizados;
    } else if (dto.salidaInternet !== undefined) {
      // Vía legada (toggle único): refleja el valor en ambas categorías.
      data.salidaInternet = dto.salidaInternet;
      data.navegacionWeb = dto.salidaInternet;
      data.sistemasAutorizados = dto.salidaInternet;
    }

    if (dto.parametrosEjecucion !== undefined) {
      if (JSON.stringify(dto.parametrosEjecucion).length > MAX_PARAMETROS_BYTES) {
        throw new BadRequestException('Los parámetros de ejecución exceden el tamaño máximo permitido');
      }
      data.parametrosEjecucion = dto.parametrosEjecucion as Prisma.InputJsonValue;
    }

    const actualizado = await this.prisma.agent.update({ where: { id: agentId }, data, select: SELECT_PARAMS });

    const navCambio = actualizado.navegacionWeb !== previo.navegacionWeb;
    const sisCambio = actualizado.sistemasAutorizados !== previo.sistemasAutorizados;
    const candadoCambio = navCambio || sisCambio;
    await this.audit.append(workspaceId, {
      actorType: auth.userId ? 'USER' : 'SYSTEM',
      actorId: auth.userId ?? null,
      action: AUDIT_ACTIONS.PARAMETROS_EJECUCION_MODIFICADOS,
      targetType: 'Agent',
      targetId: agentId,
      resumen: candadoCambio
        ? `Parámetros de ejecución del agente ${agentId} actualizados; candado de salida a internet: ` +
          `navegación web ${previo.navegacionWeb} → ${actualizado.navegacionWeb}, ` +
          `sistemas autorizados ${previo.sistemasAutorizados} → ${actualizado.sistemasAutorizados}`
        : `Parámetros de ejecución del agente ${agentId} actualizados`,
      metadata: {
        agentId,
        estacionVirtualPrevia: previo.estacionVirtualId,
        estacionVirtualNueva: actualizado.estacionVirtualId,
        navegacionWebPrevia: previo.navegacionWeb,
        navegacionWebNueva: actualizado.navegacionWeb,
        sistemasAutorizadosPrevia: previo.sistemasAutorizados,
        sistemasAutorizadosNueva: actualizado.sistemasAutorizados,
        salidaInternetPrevia: previo.salidaInternet,
        salidaInternetNueva: actualizado.salidaInternet,
      },
    });

    return this.toView(actualizado);
  }

  /**
   * Punto de verificación reutilizable del gate de conexión a sistemas autorizados (E8). Lanza `ForbiddenException` si
   * el agente NO tiene habilitada la categoría `sistemasAutorizados`. Es un gate ADICIONAL: cuando permite, la llamada
   * saliente DEBE seguir pasando por `HttpClientService` (SSRF, allowlist, timeout, tamaño). NUNCA desactiva esas
   * protecciones. Aplica CON O SIN estación asignada (cierre de la elusión).
   */
  async assertSistemasAutorizadosPermitido(workspaceId: string, agentId: string): Promise<void> {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, workspaceId },
      select: { navegacionWeb: true, sistemasAutorizados: true },
    });
    if (!agent) throw new NotFoundException('Agente no encontrado');
    if (!puedeConectarSistemasAutorizados(agent)) {
      throw new ForbiddenException('El agente no tiene habilitada la conexión a sistemas autorizados');
    }
  }

  /**
   * Lectura ligera del gate de conexión a sistemas/conectores de negocio (E8-2), para el bucle de herramientas del
   * runtime, donde conviene decidir SIN lanzar excepciones por cada llamada.
   *
   * CIERRE DE LA ELUSIÓN (corrección Opción A): la política aplica CON O SIN estación asignada. Ya NO se concede el
   * egress por el solo hecho de no tener estación. Un agente sin la categoría `sistemasAutorizados` no alcanza los
   * conectores de red. Si el agente no existe (estado inesperado en el runtime), se DENIEGA por seguridad.
   *
   * Es un gate ADICIONAL: cuando permite, la llamada saliente DEBE seguir pasando por `HttpClientService` (SSRF,
   * allowlist, timeout, tamaño); este método nunca lo sustituye.
   */
  async puedeConectarSistemasAutorizados(workspaceId: string, agentId: string): Promise<boolean> {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, workspaceId },
      select: { navegacionWeb: true, sistemasAutorizados: true },
    });
    if (!agent) return false;
    return puedeConectarSistemasAutorizados(agent);
  }

  /**
   * Lectura ligera del gate de navegación/fetch web general (E8-2). Misma semántica de cierre de elusión: aplica con o
   * sin estación; agente inexistente DENIEGA. Queda disponible para el ejecutor de navegación web cuando exista una
   * herramienta dedicada; hoy ningún punto del runtime la consume (no hay herramienta de navegación web dedicada).
   */
  async puedeNavegarWeb(workspaceId: string, agentId: string): Promise<boolean> {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, workspaceId },
      select: { navegacionWeb: true, sistemasAutorizados: true },
    });
    if (!agent) return false;
    return puedeNavegarWeb(agent);
  }
}
