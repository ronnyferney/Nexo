import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { IndicadoresQueryDto } from './dto/indicadores-query.dto';
import { costoPorResultado, ratioKpi, resumenCiclo } from './indicadores.formulas';

/** Ventana por defecto cuando el llamador no acota el período (alineada con el tablero de agentes). */
export const VENTANA_DIAS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Período y alcance ya resueltos (ids reales del workspace), para construir los `where` de cada KPI. */
interface Alcance {
  workspaceId: string;
  from: Date;
  to: Date;
  empresaId?: string;
  areaId?: string;
  agentId?: string;
  /** OrgUnits que pertenecen a la empresa (ella misma + sus unidades por `empresaId`). Vacío si no se filtra empresa. */
  empresaOrgUnitIds: string[];
  /** Filtro de alcance sobre `Tarea` (orgUnit/agente); `undefined` si no se acota. */
  tareaScope?: Prisma.TareaWhereInput;
  /** Agentes del alcance para `AgentRun` (ejecuciones); `undefined` = todos los del workspace. */
  agentIds?: string[];
  /** Ids de tareas del alcance (solo se resuelve cuando hay filtro de área/agente, para atribuir excepciones). */
  scopedTareaIds?: string[];
}

/**
 * Indicadores de resultado (E10 · RF27/RF28/RF30-métricas, sección 9). Agrega SOBRE DATOS REALES ya existentes (sin
 * migración): `Tarea`/`ContratoResultado`/`ValidacionResultado` (E4), `UsageRecord` (costos), `AgentRun` (ejecuciones) y
 * `Excepcion` (durabilidad). Multi-tenant estricto (`workspaceId` de `@CurrentAuth()`). Distingue el resultado ACEPTADO
 * del meramente generado y NO inventa cifras: donde falta la fuente devuelve `null` con la causa. Los cálculos puros
 * viven en `indicadores.formulas.ts` (ratios, percentiles) para poder probarse sin BD.
 */
@Injectable()
export class IndicadoresService {
  constructor(private readonly prisma: PrismaService) {}

  async resultados(workspaceId: string, query: IndicadoresQueryDto) {
    const alcance = await this.resolverAlcance(workspaceId, query);

    const [cumplimiento, cicloYCosto, calidad, excepciones, costoUsd] = await Promise.all([
      this.cumplimiento(alcance),
      this.cicloYResultadosAceptados(alcance),
      this.calidad(alcance),
      this.excepciones(alcance),
      this.costoAtribuible(alcance),
    ]);

    return {
      periodo: { from: alcance.from.toISOString(), to: alcance.to.toISOString() },
      filtros: {
        empresaId: alcance.empresaId ?? null,
        areaId: alcance.areaId ?? null,
        agentId: alcance.agentId ?? null,
      },
      kpis: {
        cumplimiento,
        calidad,
        tiempoCiclo: cicloYCosto.ciclo,
        costoPorResultado: costoPorResultado(costoUsd, cicloYCosto.resultadosAceptados),
        excepciones,
        horasLiberadas: this.horasLiberadas(),
        beneficioValidado: this.beneficioValidado(),
      },
    };
  }

  /** Resuelve período y alcance a ids reales del workspace (nada llega del cuerpo: empresa/área/agente se validan por pertenencia). */
  private async resolverAlcance(workspaceId: string, query: IndicadoresQueryDto): Promise<Alcance> {
    const now = new Date();
    const from = query.from ? new Date(query.from) : new Date(now.getTime() - VENTANA_DIAS * DAY_MS);
    const to = query.to ? new Date(query.to) : now;

    let empresaOrgUnitIds: string[] = [];
    if (query.empresaId) {
      const unidades = await this.prisma.orgUnit.findMany({
        where: { workspaceId, OR: [{ id: query.empresaId }, { empresaId: query.empresaId }] },
        select: { id: true },
      });
      empresaOrgUnitIds = unidades.map((u) => u.id);
    }

    const tareaScope: Prisma.TareaWhereInput = {};
    if (query.areaId) tareaScope.orgUnitId = query.areaId;
    else if (query.empresaId) tareaScope.orgUnitId = { in: empresaOrgUnitIds };
    if (query.agentId) tareaScope.responsableAgentId = query.agentId;
    const hasTareaScope = Object.keys(tareaScope).length > 0;

    let agentIds: string[] | undefined;
    if (query.agentId) {
      agentIds = [query.agentId];
    } else if (query.areaId || query.empresaId) {
      const orgIds = query.areaId ? [query.areaId] : empresaOrgUnitIds;
      const agentes = await this.prisma.agent.findMany({
        where: { workspaceId, costCenterId: { in: orgIds } },
        select: { id: true },
      });
      agentIds = agentes.map((a) => a.id);
    }

    // Las excepciones no tienen dimensión de área/agente: para atribuirlas bajo ese filtro se cruzan por `tareaId`.
    let scopedTareaIds: string[] | undefined;
    if (query.areaId || query.agentId) {
      const tareas = await this.prisma.tarea.findMany({
        where: { workspaceId, ...tareaScope },
        select: { id: true },
      });
      scopedTareaIds = tareas.map((t) => t.id);
    }

    return {
      workspaceId,
      from,
      to,
      empresaId: query.empresaId,
      areaId: query.areaId,
      agentId: query.agentId,
      empresaOrgUnitIds,
      tareaScope: hasTareaScope ? tareaScope : undefined,
      agentIds,
      scopedTareaIds,
    };
  }

  /**
   * Cumplimiento (sección 9): tareas aceptadas dentro del plazo / tareas con vencimiento en el período. "Aceptada
   * dentro del plazo" = su `ContratoResultado` está ACEPTADO y la aceptación (última validación ACEPTA) ocurrió en o
   * antes de `fechaLimite`. Denominador 0 (sin vencimientos en el período) → `null`.
   */
  private async cumplimiento(a: Alcance) {
    const tareas = await this.prisma.tarea.findMany({
      where: { workspaceId: a.workspaceId, ...(a.tareaScope ?? {}), fechaLimite: { gte: a.from, lt: a.to } },
      select: {
        fechaLimite: true,
        contratoResultado: {
          select: {
            estado: true,
            validaciones: {
              where: { veredicto: 'ACEPTA' },
              select: { createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    let aTiempo = 0;
    for (const t of tareas) {
      const contrato = t.contratoResultado;
      const aceptadaAt = contrato?.validaciones[0]?.createdAt;
      if (contrato?.estado === 'ACEPTADO' && aceptadaAt && t.fechaLimite && aceptadaAt <= t.fechaLimite) {
        aTiempo += 1;
      }
    }
    return { ...ratioKpi(aTiempo, tareas.length), vencimientosEnPeriodo: tareas.length };
  }

  /**
   * Tiempo de ciclo (mediana/p95) y conteo de resultados ACEPTADOS en el período (denominador de costo por resultado).
   * El ciclo va desde la creación de la tarea (o del contrato si no hay tarea) hasta la aceptación. Solo cuentan los
   * resultados ACEPTADOS cuya aceptación cae dentro del período: un resultado generado-no-aceptado NO cuenta (sección 9).
   */
  private async cicloYResultadosAceptados(a: Alcance) {
    const contratos = await this.prisma.contratoResultado.findMany({
      where: { workspaceId: a.workspaceId, estado: 'ACEPTADO', ...(a.tareaScope ? { tarea: a.tareaScope } : {}) },
      select: {
        createdAt: true,
        tarea: { select: { createdAt: true } },
        validaciones: { where: { veredicto: 'ACEPTA' }, select: { createdAt: true }, orderBy: { createdAt: 'desc' } },
      },
    });

    const muestrasMs: number[] = [];
    let resultadosAceptados = 0;
    for (const c of contratos) {
      const aceptadaAt = c.validaciones[0]?.createdAt;
      if (!aceptadaAt || aceptadaAt < a.from || aceptadaAt >= a.to) continue;
      resultadosAceptados += 1;
      const inicio = c.tarea?.createdAt ?? c.createdAt;
      muestrasMs.push(Math.max(0, aceptadaAt.getTime() - inicio.getTime()));
    }
    return { ciclo: resumenCiclo(muestrasMs), resultadosAceptados };
  }

  /**
   * Calidad (sección 9): entregables aceptados sin corrección / entregables revisados. "Revisado" = contrato con al
   * menos una validación en el período; "aceptado sin corrección" = tiene una validación ACEPTA y ninguna DEVUELVE
   * (nunca fue devuelto para corregir). Denominador 0 (nada revisado) → `null`.
   */
  private async calidad(a: Alcance) {
    const contratos = await this.prisma.contratoResultado.findMany({
      where: {
        workspaceId: a.workspaceId,
        ...(a.tareaScope ? { tarea: a.tareaScope } : {}),
        validaciones: { some: { createdAt: { gte: a.from, lt: a.to } } },
      },
      select: { validaciones: { select: { veredicto: true } } },
    });

    let sinCorreccion = 0;
    for (const c of contratos) {
      const tieneAcepta = c.validaciones.some((v) => v.veredicto === 'ACEPTA');
      const fueDevuelto = c.validaciones.some((v) => v.veredicto === 'DEVUELVE');
      if (tieneAcepta && !fueDevuelto) sinCorreccion += 1;
    }
    return { ...ratioKpi(sinCorreccion, contratos.length), revisadosEnPeriodo: contratos.length };
  }

  /**
   * Excepciones (sección 9): ejecuciones que requieren intervención / ejecuciones iniciadas. Numerador = `Excepcion`
   * del período (fallos del motor durable / escrituras inciertas, RF21); denominador = `AgentRun` iniciadas. Bajo filtro
   * de área/agente las excepciones se atribuyen por `tareaId` (no tienen dimensión propia): las que no cuelgan de una
   * tarea del alcance no se cuentan. Denominador 0 (sin ejecuciones) → `null`.
   */
  private async excepciones(a: Alcance) {
    const excepcionWhere: Prisma.ExcepcionWhereInput = {
      workspaceId: a.workspaceId,
      createdAt: { gte: a.from, lt: a.to },
    };
    if (a.empresaId) excepcionWhere.empresaId = a.empresaId;
    if (a.scopedTareaIds) excepcionWhere.tareaId = { in: a.scopedTareaIds };

    const [intervenciones, ejecucionesIniciadas] = await Promise.all([
      this.prisma.excepcion.count({ where: excepcionWhere }),
      this.prisma.agentRun.count({
        where: {
          workspaceId: a.workspaceId,
          createdAt: { gte: a.from, lt: a.to },
          ...(a.agentIds ? { agentId: { in: a.agentIds } } : {}),
        },
      }),
    ]);
    return { ...ratioKpi(intervenciones, ejecucionesIniciadas), ejecucionesIniciadas };
  }

  /** Costo atribuible (USD) del alcance y período: suma de `UsageRecord.costUsd` (ADR 0002 intacto; no es un libro mayor paralelo). */
  private async costoAtribuible(a: Alcance): Promise<number> {
    const where: Prisma.UsageRecordWhereInput = {
      workspaceId: a.workspaceId,
      createdAt: { gte: a.from, lt: a.to },
    };
    if (a.agentId) where.agentId = a.agentId;
    if (a.empresaId) where.empresaId = a.empresaId;
    if (a.areaId) where.OR = [{ areaEjecutoraId: a.areaId }, { orgUnitId: a.areaId }];
    const agg = await this.prisma.usageRecord.aggregate({ where, _sum: { costUsd: true } });
    return Number(agg._sum.costUsd ?? 0);
  }

  /**
   * Horas liberadas ESTIMADAS (sección 9): se marca explícitamente como estimación y NO como resultado confirmado. Hoy
   * NO existe un tiempo de referencia configurado por cargo/tarea en el modelo (sería aditivo en una noche futura), así
   * que se devuelve `null` con la causa en vez de inventar un número.
   */
  private horasLiberadas() {
    return {
      estimacion: true as const,
      horas: null,
      causa: 'SIN_TIEMPO_REFERENCIA',
      nota: 'Estimación, no resultado confirmado. Requiere un tiempo de referencia por cargo/tarea aún no modelado.',
    };
  }

  /**
   * Beneficio validado (sección 9): separado de proyecciones; solo lo aceptado por el dueño del proceso. Aún no hay una
   * fuente de captura del beneficio económico en el modelo (se capturará en E4/aceptación), así que se devuelve la
   * estructura con `null` y la causa, sin mezclar con proyecciones.
   */
  private beneficioValidado() {
    return {
      validadoUsd: null,
      proyectadoUsd: null,
      moneda: null,
      causa: 'SIN_FUENTE_BENEFICIO',
      nota: 'Separado de proyecciones. Se captura en la aceptación del resultado (E4) por el dueño del proceso; fuente aún no modelada.',
    };
  }
}
