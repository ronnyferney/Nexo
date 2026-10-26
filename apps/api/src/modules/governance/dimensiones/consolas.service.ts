import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { DimensionSeedService } from './dimension-seed.service';

export interface GrupoAnalisis {
  key: string;
  label: string;
  costUsd: number;
  calls: number;
}

const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/**
 * Consola de análisis mínima (ADR 0011 D7/D8): pivota el consumo (`UsageRecord.dimensiones`) por CUALQUIER dimensión
 * configurada, leyendo el snapshot histórico. Respeta el tenant (`workspaceId`) y NO hace doble conteo: el costo medido
 * es uno solo y cada `UsageRecord` se cuenta una vez; las dimensiones son etiquetas, no libros mayores paralelos
 * (regla de no doble conteo de D5). Los valores inactivos/fuera de vigencia siguen en el histórico (el snapshot no se
 * revalida): reorganizar dimensiones no altera los hechos pasados.
 */
@Injectable()
export class ConsolasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seed: DimensionSeedService,
  ) {}

  async analisis(workspaceId: string, groupByCodigo: string, fromIso?: string, toIso?: string) {
    await this.seed.ensureForWorkspace(workspaceId);
    const dimension = await this.prisma.dimension.findFirst({
      where: { workspaceId, codigo: groupByCodigo },
    });
    if (!dimension) throw new BadRequestException(`No existe una dimensión con código "${groupByCodigo}"`);

    const from = fromIso ? new Date(fromIso) : monthStart();
    const to = toIso ? new Date(toIso) : new Date();

    const total = await this.prisma.usageRecord.aggregate({
      where: { workspaceId, createdAt: { gte: from, lte: to } },
      _sum: { costUsd: true },
      _count: true,
    });

    // Pivot por la clave del snapshot. Cada registro aporta a un único grupo: no hay doble conteo.
    const rows = await this.prisma.$queryRaw<{ key: string | null; cost: Prisma.Decimal | null; calls: bigint }[]>`
      SELECT "dimensiones" ->> ${groupByCodigo} AS key, SUM("costUsd") AS cost, COUNT(*) AS calls
        FROM "UsageRecord"
       WHERE "workspaceId" = ${workspaceId} AND "createdAt" >= ${from} AND "createdAt" <= ${to}
       GROUP BY 1
       ORDER BY 2 DESC NULLS LAST`;

    const labels = await this.etiquetas(
      workspaceId,
      dimension.id,
      rows.map((r) => r.key).filter((k): k is string => !!k),
    );
    const groups: GrupoAnalisis[] = rows.map((r) => ({
      key: r.key ?? '',
      label: r.key ? (labels.get(r.key) ?? r.key) : 'Sin asignar',
      costUsd: Number(r.cost ?? 0),
      calls: Number(r.calls),
    }));

    return {
      dimension: {
        id: dimension.id,
        codigo: dimension.codigo,
        nombre: dimension.nombre,
        tipoValor: dimension.tipoValor,
      },
      from: from.toISOString(),
      to: to.toISOString(),
      totalCostUsd: Number(total._sum.costUsd ?? 0),
      calls: total._count,
      groups,
    };
  }

  /** Traduce los códigos de valor a nombres legibles cuando la dimensión es LISTA (sus valores viven en `DimensionValue`). */
  private async etiquetas(workspaceId: string, dimensionId: string, codigos: string[]): Promise<Map<string, string>> {
    const unicos = [...new Set(codigos)];
    if (!unicos.length) return new Map();
    const valores = await this.prisma.dimensionValue.findMany({
      where: { workspaceId, dimensionId, codigo: { in: unicos } },
      select: { codigo: true, nombre: true },
    });
    return new Map(valores.map((v) => [v.codigo, v.nombre]));
  }
}
