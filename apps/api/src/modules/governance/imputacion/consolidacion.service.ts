import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { DimensionConsolidacion } from './dto/imputacion.dto';
import { repartirCosto, type PesoDestino } from './imputacion.rules';

const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/** Columna de snapshot de `UsageRecord` por dimensión (lista blanca: seguro para interpolar en SQL crudo). */
const COLUMNA: Record<DimensionConsolidacion, string> = {
  empresa: 'empresaId',
  linea: 'lineaBeneficiariaId',
  area: 'areaEjecutoraId',
  centro: 'centroCostoId',
};

/** Tipo de destino del reparto que aporta costo ESTIMADO a cada dimensión de consolidación. */
const DESTINO_DE_DIMENSION: Record<DimensionConsolidacion, 'lineaNegocioId' | 'orgUnitId' | 'centroCostoId' | null> = {
  empresa: null, // la empresa es la dueña del gasto medido; el reparto no reasigna entre empresas
  linea: 'lineaNegocioId',
  area: 'orgUnitId',
  centro: 'centroCostoId',
};

interface GrupoConsolidado {
  key: string;
  label: string;
  costoMedidoUsd: number;
  costoEstimadoUsd: number;
  calls: number;
}

/** Rango [desde, hasta] (UTC, inclusive) del mes de un periodoKey mensual `YYYY-MM`; `null` si no es mensual. */
function rangoMensual(periodoKey: string): { desde: Date; hasta: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(periodoKey);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  if (month < 0 || month > 11) return null;
  const desde = new Date(Date.UTC(year, month, 1));
  const hasta = new Date(Date.UTC(year, month + 1, 1) - 1);
  return { desde, hasta };
}

/**
 * Consolidación económica (ADR 0011 D7 / E9 · RF47 parcial). Agrega el costo MEDIDO por empresa / línea de negocio /
 * área / centro de costo leyendo el snapshot histórico de `UsageRecord` (RF46/QA16: no recomputa el pasado) y, aparte,
 * el costo ESTIMADO que resulta de repartir el gasto de los servicios compartidos (RF44/RF45). El total medido es la
 * suma ÚNICA del costo (cada `UsageRecord` cuenta una vez); el estimado es una REASIGNACIÓN de reporte que suma 100 %
 * por servicio (sin doble conteo) y NO infla el total medido ni toca presupuestos (ADR 0002 intacto).
 */
@Injectable()
export class ConsolidacionService {
  constructor(private readonly prisma: PrismaService) {}

  async consolidar(
    workspaceId: string,
    q: { dimension: DimensionConsolidacion; from?: string; to?: string; empresaId?: string },
  ) {
    const from = q.from ? new Date(q.from) : monthStart();
    const to = q.to ? new Date(q.to) : new Date();
    const col = COLUMNA[q.dimension];

    // --- Costo MEDIDO: pivot del snapshot por la columna de la dimensión (cada registro aporta a un único grupo). ---
    const empresaFiltro = q.empresaId ? Prisma.sql` AND "empresaId" = ${q.empresaId}` : Prisma.empty;
    const medidoRows = await this.prisma.$queryRaw<
      { key: string | null; cost: Prisma.Decimal | null; calls: bigint }[]
    >`
      SELECT ${Prisma.raw(`"${col}"`)} AS key, SUM("costUsd") AS cost, COUNT(*) AS calls
        FROM "UsageRecord"
       WHERE "workspaceId" = ${workspaceId} AND "createdAt" >= ${from} AND "createdAt" <= ${to}${empresaFiltro}
       GROUP BY 1`;

    const grupos = new Map<string, GrupoConsolidado>();
    let totalMedidoUsd = 0;
    for (const r of medidoRows) {
      const key = r.key ?? '';
      const costo = Number(r.cost ?? 0);
      totalMedidoUsd += costo;
      grupos.set(key, { key, label: '', costoMedidoUsd: costo, costoEstimadoUsd: 0, calls: Number(r.calls) });
    }

    // --- Costo ESTIMADO: reparto de los servicios compartidos (RF44/RF45). ---
    const { serviciosCompartidos, estimadoPorDestino, totalEstimadoUsd } = await this.estimarServicios(
      workspaceId,
      q.dimension,
      from,
      to,
      q.empresaId,
    );
    for (const [key, monto] of estimadoPorDestino) {
      const g = grupos.get(key);
      if (g) g.costoEstimadoUsd += monto;
      else grupos.set(key, { key, label: '', costoMedidoUsd: 0, costoEstimadoUsd: monto, calls: 0 });
    }

    // --- Etiquetas legibles de cada grupo. ---
    const labels = await this.etiquetas(workspaceId, q.dimension, [...grupos.keys()].filter(Boolean));
    const groups = [...grupos.values()]
      .map((g) => ({ ...g, label: g.key ? (labels.get(g.key) ?? g.key) : 'Sin asignar' }))
      .sort((a, b) => b.costoMedidoUsd + b.costoEstimadoUsd - (a.costoMedidoUsd + a.costoEstimadoUsd));

    return {
      dimension: q.dimension,
      from: from.toISOString(),
      to: to.toISOString(),
      totalMedidoUsd,
      totalEstimadoUsd,
      groups,
      serviciosCompartidos,
    };
  }

  /**
   * Para cada servicio compartido y cada periodo con reparto dentro del rango, calcula el pool MEDIDO (consumo del área
   * dueña en ese periodo) y lo reparte por los porcentajes. El reparto de cada servicio suma exactamente su pool (sin
   * doble conteo). Acumula el estimado por destino que corresponda a la dimensión consolidada.
   */
  private async estimarServicios(
    workspaceId: string,
    dimension: DimensionConsolidacion,
    from: Date,
    to: Date,
    empresaId?: string,
  ) {
    const campoDestino = DESTINO_DE_DIMENSION[dimension];
    const servicios = await this.prisma.servicioInterno.findMany({
      where: { workspaceId, ...(empresaId ? { empresaId } : {}) },
      include: { imputaciones: true },
    });

    const estimadoPorDestino = new Map<string, number>();
    let totalEstimadoUsd = 0;
    const serviciosCompartidos: {
      servicioId: string;
      codigo: string;
      nombre: string;
      periodoKey: string;
      costoMedidoUsd: number;
      repartido: { tipo: string; destinoId: string; montoUsd: number }[];
    }[] = [];

    for (const servicio of servicios) {
      // Agrupa el reparto por periodo (cada periodo tiene su propio conjunto que suma 100 %).
      const porPeriodo = new Map<string, typeof servicio.imputaciones>();
      for (const imp of servicio.imputaciones) {
        const arr = porPeriodo.get(imp.periodoKey) ?? [];
        arr.push(imp);
        porPeriodo.set(imp.periodoKey, arr);
      }

      for (const [periodoKey, filas] of porPeriodo) {
        const rango = rangoMensual(periodoKey);
        if (!rango) continue; // periodos no mensuales: fuera del alcance P0 del estimado
        const desde = rango.desde > from ? rango.desde : from;
        const hasta = rango.hasta < to ? rango.hasta : to;
        if (desde > hasta) continue; // el periodo no cae dentro del rango consultado

        // Pool MEDIDO del servicio: consumo imputado al área dueña en ese periodo (snapshot `areaEjecutoraId`).
        const pool = await this.prisma.usageRecord.aggregate({
          where: {
            workspaceId,
            areaEjecutoraId: servicio.areaDuenoId,
            createdAt: { gte: desde, lte: hasta },
          },
          _sum: { costUsd: true },
        });
        const costoMedidoUsd = Number(pool._sum.costUsd ?? 0);

        const pesos: PesoDestino[] = filas.map((f) => ({
          key: f.id,
          porcentaje: Number(f.porcentaje),
        }));
        const montos = repartirCosto(costoMedidoUsd, pesos);
        const montoPorFila = new Map(montos.map((m) => [m.key, m.montoUsd]));

        const repartido = filas.map((f) => {
          const destinoId = f.lineaNegocioId ?? f.orgUnitId ?? f.centroCostoId ?? '';
          const tipo = f.lineaNegocioId ? 'linea' : f.orgUnitId ? 'area' : 'centro';
          const montoUsd = montoPorFila.get(f.id) ?? 0;
          // Acumula al estimado de la dimensión solo si el tipo de destino coincide con ella.
          const destino = campoDestino ? f[campoDestino] : null;
          if (destino) {
            estimadoPorDestino.set(destino, (estimadoPorDestino.get(destino) ?? 0) + montoUsd);
            totalEstimadoUsd += montoUsd;
          }
          return { tipo, destinoId, montoUsd };
        });

        serviciosCompartidos.push({
          servicioId: servicio.id,
          codigo: servicio.codigo,
          nombre: servicio.nombre,
          periodoKey,
          costoMedidoUsd,
          repartido,
        });
      }
    }

    return { serviciosCompartidos, estimadoPorDestino, totalEstimadoUsd };
  }

  /** Nombres legibles de las claves de grupo según la dimensión (OrgUnit, LineaNegocio o CentroCosto). */
  private async etiquetas(
    workspaceId: string,
    dimension: DimensionConsolidacion,
    ids: string[],
  ): Promise<Map<string, string>> {
    const unicos = [...new Set(ids)];
    if (!unicos.length) return new Map();
    if (dimension === 'linea') {
      const rows = await this.prisma.lineaNegocio.findMany({
        where: { workspaceId, id: { in: unicos } },
        select: { id: true, nombre: true },
      });
      return new Map(rows.map((r) => [r.id, r.nombre]));
    }
    if (dimension === 'centro') {
      const rows = await this.prisma.centroCosto.findMany({
        where: { workspaceId, id: { in: unicos } },
        select: { id: true, nombre: true },
      });
      return new Map(rows.map((r) => [r.id, r.nombre]));
    }
    // empresa y area son OrgUnit.
    const rows = await this.prisma.orgUnit.findMany({
      where: { workspaceId, id: { in: unicos } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
