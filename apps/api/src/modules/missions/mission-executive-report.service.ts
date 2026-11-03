import { Injectable, NotFoundException } from '@nestjs/common';
import type { EstadoMision } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { clasificarCompromiso, type EstadoCompromiso } from './mission.governance';
import { MissionCoordinatorGovernanceService } from './mission-coordinator-governance.service';

/** Estados de `Tarea` que cuentan como "trabajo en producción" para el avance (coherente con MissionsService). */
const ESTADOS_EN_PRODUCCION = ['EN_EJECUCION', 'EN_REVISION', 'ESPERANDO_APROBACION'] as const;

/** Un compromiso de la misión derivado de una `Tarea` vinculada (responsable + fecha + estado). Solo metadatos. */
export interface CompromisoInforme {
  tareaId: string;
  titulo: string;
  responsableAgentId: string | null;
  duenoUserId: string | null;
  plazo: string | null;
  estado: EstadoCompromiso;
}

/** Costo agregado de la misión imputado a un área (por referencia; NO mueve presupuesto). */
export interface CostoAreaInforme {
  orgUnitId: string | null;
  totalUsd: number;
}

/** Un bloqueo/excepción abierto que frena el resultado transversal. Solo metadatos (sin contenido sensible). */
export interface BloqueoInforme {
  origen: 'INCUMPLIMIENTO' | 'EXCEPCION' | 'TAREA_BLOQUEADA' | 'DEPENDENCIA_VENCIDA';
  tareaId: string | null;
  referenciaId: string | null;
  causa: string;
}

/** Un hecho de coordinación pendiente de decisión humana (bandeja E6). Solo metadatos. */
export interface PendienteDecisionInforme {
  eventoId: string;
  tipo: string;
  motivo: string | null;
  createdAt: string;
}

/** Informe ejecutivo de gestión por misión (ADR 0016). Derivado y de SOLO LECTURA: no persiste ni mueve nada. */
export interface InformeEjecutivo {
  disponible: true;
  mision: {
    id: string;
    nombre: string;
    estado: EstadoMision;
    resultadoEsperado: string;
    indicador: string | null;
    lineaBase: string | null;
    meta: string | null;
    plazo: string | null;
    duenoUserId: string;
    coordinadorAgentId: string | null;
  };
  avance: {
    objetivos: number;
    totalTareas: number;
    tareasEnProduccion: number;
    tareasPresentadas: number;
    contratosNegocio: number;
    contratosNegocioAceptados: number;
    /** % de tareas presentadas (0–100), derivado; 0 si no hay tareas. */
    porcentajePresentadas: number;
  };
  compromisos: CompromisoInforme[];
  vencimientos: CompromisoInforme[];
  bloqueos: BloqueoInforme[];
  costoPorArea: CostoAreaInforme[];
  costoTotalUsd: number;
  pendientesDecisionHumana: PendienteDecisionInforme[];
}

/**
 * Informe ejecutivo de gestión de una misión transversal (ADR 0016 · compuerta E-B). AGREGA, sin migración nueva ni
 * cómputo paralelo, lo ya existente: estado de la misión, objetivos/tareas y su avance (E4), compromisos y vencimientos
 * (derivados de `Tarea.fechaLimite`/`responsableAgentId`, clasificados con `clasificarCompromiso`), bloqueos/excepciones
 * (E4/E7: `Incumplimiento`/`Excepcion`/tarea bloqueada), costo agregado por área (imputación de `UsageRecord` de las
 * ejecuciones de las tareas vinculadas, por REFERENCIA; NO mueve presupuesto) y el bloque "pendiente de decisión humana"
 * (`MisionEvento.requiereDecision` sin resolver).
 *
 * De SOLO LECTURA: no persiste, no audita, no ejecuta efecto. GATED como el resto del gobierno del coordinador: con
 * `Workspace.coordinadorGobiernoActivo` APAGADO devuelve `{ disponible: false, motivo: 'GOBIERNO_COORDINADOR_DESACTIVADO' }`
 * y NO consulta datos. Expone SOLO metadatos: supervisar/coordinar no concede acceso a contenido ajeno (ADR 0007).
 */
@Injectable()
export class MissionExecutiveReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gov: MissionCoordinatorGovernanceService,
  ) {}

  async generar(
    workspaceId: string,
    misionId: string,
  ): Promise<InformeEjecutivo | { disponible: false; motivo: string }> {
    // GATED: con el flag apagado no se consulta nada (igual que el resto del gobierno del coordinador).
    if (!(await this.gov.gobiernoActivo(workspaceId))) {
      return { disponible: false, motivo: MissionCoordinatorGovernanceService.MOTIVO_GATED };
    }

    const mision = await this.prisma.misionTransversal.findFirst({
      where: { id: misionId, workspaceId },
      include: { vinculos: true },
    });
    if (!mision) throw new NotFoundException('Misión no encontrada');

    const objetivoIds = mision.vinculos.map((v) => v.objetivoId).filter((x): x is string => !!x);
    const tareaIdsDirectas = mision.vinculos.map((v) => v.tareaId).filter((x): x is string => !!x);

    const tareas =
      objetivoIds.length === 0 && tareaIdsDirectas.length === 0
        ? []
        : await this.prisma.tarea.findMany({
            where: { workspaceId, OR: [{ id: { in: tareaIdsDirectas } }, { objetivoId: { in: objetivoIds } }] },
            select: {
              id: true,
              titulo: true,
              estado: true,
              orgUnitId: true,
              fechaLimite: true,
              responsableAgentId: true,
              duenoUserId: true,
              contratoResultado: { select: { estado: true, tipoResultado: true } },
            },
          });

    const ahora = Date.now();
    const tareaIds = tareas.map((t) => t.id);

    const compromisos: CompromisoInforme[] = [];
    let tareasEnProduccion = 0;
    let tareasPresentadas = 0;
    let contratosNegocio = 0;
    let contratosNegocioAceptados = 0;

    for (const t of tareas) {
      if ((ESTADOS_EN_PRODUCCION as readonly string[]).includes(t.estado)) tareasEnProduccion++;
      const entregado =
        t.estado === 'COMPLETADA' ||
        t.contratoResultado?.estado === 'PENDIENTE_VALIDACION' ||
        t.contratoResultado?.estado === 'ACEPTADO';
      if (entregado) tareasPresentadas++;
      if (t.contratoResultado?.tipoResultado === 'RESULTADO_NEGOCIO') {
        contratosNegocio++;
        if (t.contratoResultado.estado === 'ACEPTADO') contratosNegocioAceptados++;
      }
      // Compromiso derivado: sin fecha límite no hay compromiso temporal verificable.
      if (t.fechaLimite) {
        compromisos.push({
          tareaId: t.id,
          titulo: t.titulo,
          responsableAgentId: t.responsableAgentId,
          duenoUserId: t.duenoUserId,
          plazo: t.fechaLimite.toISOString(),
          estado: clasificarCompromiso({ plazoMs: t.fechaLimite.getTime(), ahoraMs: ahora, entregado }),
        });
      }
    }

    const vencimientos = compromisos.filter((c) => c.estado === 'VENCIDO' || c.estado === 'EN_RIESGO');

    // Bloqueos/excepciones abiertos del trabajo vinculado (E4/E7).
    const bloqueos = tareaIds.length === 0 ? [] : await this.derivarBloqueos(workspaceId, tareas, ahora);

    // Costo agregado por área: imputación de `UsageRecord` de las ejecuciones de las tareas vinculadas (por referencia).
    const { costoPorArea, costoTotalUsd } = await this.derivarCosto(workspaceId, tareaIds);

    // Pendiente de decisión humana: eventos de coordinación que exigen decisión y aún no están resueltos (bandeja E6).
    const pendientes = await this.prisma.misionEvento.findMany({
      where: { workspaceId, misionId, requiereDecision: true, resueltoAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, tipo: true, payload: true, createdAt: true },
    });
    const pendientesDecisionHumana: PendienteDecisionInforme[] = pendientes.map((e) => ({
      eventoId: e.id,
      tipo: e.tipo,
      motivo:
        e.payload && typeof e.payload === 'object' && !Array.isArray(e.payload)
          ? (((e.payload as Record<string, unknown>).motivo as string | undefined) ?? null)
          : null,
      createdAt: e.createdAt.toISOString(),
    }));

    return {
      disponible: true,
      mision: {
        id: mision.id,
        nombre: mision.nombre,
        estado: mision.estado,
        resultadoEsperado: mision.resultadoEsperado,
        indicador: mision.indicador,
        lineaBase: mision.lineaBase,
        meta: mision.meta,
        plazo: mision.plazo ? mision.plazo.toISOString() : null,
        duenoUserId: mision.duenoUserId,
        coordinadorAgentId: mision.coordinadorAgentId,
      },
      avance: {
        objetivos: objetivoIds.length,
        totalTareas: tareas.length,
        tareasEnProduccion,
        tareasPresentadas,
        contratosNegocio,
        contratosNegocioAceptados,
        porcentajePresentadas: tareas.length === 0 ? 0 : Math.round((tareasPresentadas / tareas.length) * 100),
      },
      compromisos,
      vencimientos,
      bloqueos,
      costoPorArea,
      costoTotalUsd,
      pendientesDecisionHumana,
    };
  }

  /** Bloqueos abiertos del trabajo vinculado (incumplimiento/excepción/tarea bloqueada/dependencia vencida). */
  private async derivarBloqueos(
    workspaceId: string,
    tareas: { id: string; titulo: string; estado: string; fechaLimite: Date | null }[],
    ahoraMs: number,
  ): Promise<BloqueoInforme[]> {
    const tareaIds = tareas.map((t) => t.id);
    const [incumplimientos, excepciones] = await Promise.all([
      this.prisma.incumplimiento.findMany({
        where: { workspaceId, tareaId: { in: tareaIds }, resuelto: false },
        select: { id: true, tareaId: true, causa: true },
      }),
      this.prisma.excepcion.findMany({
        where: { workspaceId, tareaId: { in: tareaIds }, estado: 'ABIERTA' },
        select: { id: true, tareaId: true, causa: true },
      }),
    ]);

    const bloqueos: BloqueoInforme[] = [];
    for (const i of incumplimientos) {
      bloqueos.push({ origen: 'INCUMPLIMIENTO', tareaId: i.tareaId, referenciaId: i.id, causa: i.causa });
    }
    for (const x of excepciones) {
      bloqueos.push({ origen: 'EXCEPCION', tareaId: x.tareaId, referenciaId: x.id, causa: x.causa });
    }
    for (const t of tareas) {
      if (t.estado === 'BLOQUEADA') {
        bloqueos.push({ origen: 'TAREA_BLOQUEADA', tareaId: t.id, referenciaId: null, causa: t.titulo });
      } else if (
        t.fechaLimite &&
        t.fechaLimite.getTime() < ahoraMs &&
        t.estado !== 'COMPLETADA' &&
        t.estado !== 'FALLIDA_CANCELADA'
      ) {
        bloqueos.push({ origen: 'DEPENDENCIA_VENCIDA', tareaId: t.id, referenciaId: null, causa: t.titulo });
      }
    }
    return bloqueos;
  }

  /** Costo agregado por área, sumando `UsageRecord` de las ejecuciones de las tareas vinculadas (por referencia). */
  private async derivarCosto(
    workspaceId: string,
    tareaIds: string[],
  ): Promise<{ costoPorArea: CostoAreaInforme[]; costoTotalUsd: number }> {
    if (tareaIds.length === 0) return { costoPorArea: [], costoTotalUsd: 0 };

    const ejecuciones = await this.prisma.execution.findMany({
      where: { workspaceId, tareaId: { in: tareaIds } },
      select: { id: true },
    });
    const executionIds = ejecuciones.map((e) => e.id);
    if (executionIds.length === 0) return { costoPorArea: [], costoTotalUsd: 0 };

    const grupos = await this.prisma.usageRecord.groupBy({
      by: ['orgUnitId'],
      where: { workspaceId, executionId: { in: executionIds } },
      _sum: { costUsd: true },
    });

    let costoTotalUsd = 0;
    const costoPorArea: CostoAreaInforme[] = grupos.map((g) => {
      const total = g._sum.costUsd ? Number(g._sum.costUsd) : 0;
      costoTotalUsd += total;
      return { orgUnitId: g.orgUnitId, totalUsd: total };
    });
    costoPorArea.sort((a, b) => b.totalUsd - a.totalUsd);
    return { costoPorArea, costoTotalUsd };
  }
}
