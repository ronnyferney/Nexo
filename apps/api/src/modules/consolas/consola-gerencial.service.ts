import { Injectable } from '@nestjs/common';
import { EstadoExcepcion } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConsolidacionService } from '../governance/imputacion/consolidacion.service';
import { IndicadoresService, VENTANA_DIAS } from '../results/indicadores/indicadores.service';
import type { ConsolaGerencialQueryDto } from './dto/consola-gerencial-query.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Estados terminales de una excepción: las que NO están abiertas (cerradas operativamente). */
const EXCEPCIONES_CERRADAS: EstadoExcepcion[] = [
  EstadoExcepcion.CANCELADA,
  EstadoExcepcion.RESUELTA,
  EstadoExcepcion.CONCILIADA,
];

/**
 * Consola gerencial (E12 · vista ejecutiva para dirección). Solo lectura. NO reimplementa ninguna métrica: AGREGA sobre
 * lo ya existente combinando servicios por composición —
 *   - Resultados (E10): inyecta `IndicadoresService.resultados` (cumplimiento, calidad, ciclo, costo por resultado,
 *     excepciones del período). El costo atribuible al alcance sale de ese mismo cálculo (`costoPorResultado.costoTotalUsd`),
 *     que ya suma `UsageRecord` del alcance: no se reabre un libro paralelo (ADR 0002 intacto).
 *   - Economía (E9): reusa `ConsolidacionService.consolidar` para el libro consolidado del período por empresa. Su firma
 *     solo acota por empresa, así que bajo un alcance de área/agente el consolidado se devuelve `null` con causa (honesto)
 *     y queda el `costoAtribuibleUsd` exacto del alcance que ya aporta E10.
 *   - Gobierno/durabilidad: conteos de ESTADO OPERATIVO ACTUAL (no acotados al período): aprobaciones pendientes (E6),
 *     suspensiones activas (E6) y excepciones abiertas (E7). Simples `count` por `workspaceId` (+ empresa donde el modelo
 *     lleva esa columna); no se reimplementa la lógica de esas bandejas.
 *   - Auditoría (E13): nº de hechos de gobierno del período y el flag de integridad de la cadena (`verificarCadena.ok`).
 *
 * Multi-tenant estricto: el `workspaceId` viene de `@CurrentAuth()`, jamás del cuerpo. Honesto con el dato: donde una
 * fuente no aplica, se refleja `null` con causa; nunca se inventan cifras.
 */
@Injectable()
export class ConsolaGerencialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indicadores: IndicadoresService,
    private readonly consolidacion: ConsolidacionService,
    private readonly audit: AuditService,
  ) {}

  async gerencial(workspaceId: string, query: ConsolaGerencialQueryDto) {
    const now = new Date();
    const from = query.from ? new Date(query.from) : new Date(now.getTime() - VENTANA_DIAS * DAY_MS);
    const to = query.to ? new Date(query.to) : now;
    // Período explícito para que E10 y el libro consolidado usen la MISMA ventana que la cabecera de la consola.
    const scopedQuery: ConsolaGerencialQueryDto = { ...query, from: from.toISOString(), to: to.toISOString() };

    // El libro consolidado (E9) solo acota por empresa; un alcance de área/agente no es consolidable sin inventar.
    const esConsolidable = !query.areaId && !query.agentId;

    const [
      resultados,
      consolidado,
      aprobacionesPendientes,
      suspensionesActivas,
      excepcionesAbiertas,
      hechosEnPeriodo,
      cadena,
    ] = await Promise.all([
      this.indicadores.resultados(workspaceId, scopedQuery),
      esConsolidable
        ? this.consolidacion.consolidar(workspaceId, {
            dimension: 'empresa',
            from: from.toISOString(),
            to: to.toISOString(),
            empresaId: query.empresaId,
          })
        : Promise.resolve(null),
      this.prisma.aprobacion.count({
        where: { workspaceId, estado: 'PENDIENTE', ...(query.empresaId ? { empresaId: query.empresaId } : {}) },
      }),
      this.prisma.suspension.count({ where: { workspaceId, activa: true } }),
      this.prisma.excepcion.count({
        where: {
          workspaceId,
          estado: { notIn: EXCEPCIONES_CERRADAS },
          ...(query.empresaId ? { empresaId: query.empresaId } : {}),
        },
      }),
      this.prisma.auditLog.count({ where: { workspaceId, createdAt: { gte: from, lt: to } } }),
      this.audit.verificarCadena(workspaceId),
    ]);

    return {
      periodo: { from: from.toISOString(), to: to.toISOString() },
      alcance: {
        empresaId: query.empresaId ?? null,
        areaId: query.areaId ?? null,
        agentId: query.agentId ?? null,
      },
      resultados: resultados.kpis,
      economia: {
        // Costo atribuible EXACTO del alcance (empresa/área/agente), tomado del cálculo de E10 (suma de `UsageRecord`).
        costoAtribuibleUsd: resultados.kpis.costoPorResultado.costoTotalUsd,
        // Libro consolidado del período por empresa (medido + estimado por reparto de servicios compartidos, E9).
        consolidado: consolidado
          ? {
              dimension: consolidado.dimension,
              totalMedidoUsd: consolidado.totalMedidoUsd,
              totalEstimadoUsd: consolidado.totalEstimadoUsd,
              grupos: consolidado.groups,
            }
          : null,
        consolidadoCausa: consolidado ? null : 'ALCANCE_NO_CONSOLIDABLE',
        consolidadoNota: consolidado
          ? null
          : 'El libro consolidado (E9) solo acota por empresa; para un alcance de área/agente use `costoAtribuibleUsd`.',
      },
      gobierno: { aprobacionesPendientes, suspensionesActivas, excepcionesAbiertas },
      auditoria: {
        hechosEnPeriodo,
        totalHechos: cadena.total,
        cadenaIntegra: cadena.ok,
        ...(cadena.ok ? {} : { rotaEnSeq: cadena.rotaEnSeq ?? null, motivo: cadena.motivo ?? null }),
      },
    };
  }
}
