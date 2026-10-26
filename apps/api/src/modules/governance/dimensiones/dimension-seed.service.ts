import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Las 3 dimensiones integradas de D3 (línea de negocio, sede, centro de costo) expuestas como `Dimension` de sistema
 * (`esSistema=true`, `tipoValor=REFERENCIA`), para que las consolas las traten igual que las del cliente. NO duplican
 * datos: apuntan a la entidad real (`LineaNegocio`/`Sede`/`CentroCosto`) por `referenciaEntidad`; sus "valores" son las
 * filas de esas tablas, no `DimensionValue`. Son de organización (empresaId = null).
 */
export const DIMENSIONES_SISTEMA: ReadonlyArray<{
  codigo: string;
  nombre: string;
  referenciaEntidad: string;
}> = [
  { codigo: 'linea_negocio', nombre: 'Línea de negocio', referenciaEntidad: 'LineaNegocio' },
  { codigo: 'sede', nombre: 'Sede', referenciaEntidad: 'Sede' },
  { codigo: 'centro_costo', nombre: 'Centro de costo', referenciaEntidad: 'CentroCosto' },
];

/** Entidades etiquetables por defecto de las dimensiones integradas. */
const APLICA_A_SISTEMA = ['ejecucion', 'tarea', 'costo'];

/**
 * Siembra idempotente de las dimensiones de sistema (ADR 0011 D8). Al arranque las garantiza en todos los workspaces
 * existentes; además se expone `ensureForWorkspace` para sembrarlas de forma perezosa en el primer acceso de un
 * workspace creado después del arranque (igual que `OrgService.ensureRoot`). La idempotencia la respalda el índice
 * parcial único `Dimension_codigo_org_wide` (empresaId IS NULL): un alta duplicada concurrente choca con P2002 y se
 * ignora, nunca duplica.
 */
@Injectable()
export class DimensionSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DimensionSeedService.name);
  /**
   * Caché process-local de workspaces cuyo catálogo de sistema ya está garantizado. Evita el SELECT repetido de
   * `ensureForWorkspace` en cada evaluación/listado. Invalidación trivial: un workspace nuevo entra al set en su
   * primer acceso. No cambia el comportamiento observable (la BD sigue siendo la fuente de verdad e idempotente).
   */
  private readonly sembrados = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Siembra al arranque SIN barrer en serie los workspaces: una sola consulta de diferencia de conjuntos trae los que
   * no tienen las 3 dimensiones de sistema y se siembran en un único `createMany` idempotente. En régimen estable
   * (todos sembrados) es una sola consulta y cero inserciones; el tiempo ya no escala con el nº de workspaces.
   */
  async onApplicationBootstrap(): Promise<void> {
    const t0 = Date.now();
    const pendientes = await this.workspacesSinCatalogo();
    const total = pendientes.length ? await this.seedLote(pendientes) : 0;
    this.logger.log(
      `Bootstrap dimensiones de sistema: ${total} creada(s) en ${pendientes.length} workspace(s) pendiente(s) ` +
        `(${Date.now() - t0}ms)`,
    );
  }

  /** Workspaces que NO tienen las 3 dimensiones de sistema (empresaId IS NULL). Una sola consulta de diferencia. */
  private async workspacesSinCatalogo(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT w."id"
      FROM "Workspace" w
      WHERE (
        SELECT COUNT(*) FROM "Dimension" d
        WHERE d."workspaceId" = w."id" AND d."esSistema" = true AND d."empresaId" IS NULL
      ) < ${DIMENSIONES_SISTEMA.length}
    `;
    return rows.map((r) => r.id);
  }

  /** Inserta en un solo `createMany` las dimensiones de sistema que falten en el lote (ON CONFLICT DO NOTHING). */
  private async seedLote(workspaceIds: string[]): Promise<number> {
    const data: Prisma.DimensionCreateManyInput[] = workspaceIds.flatMap((workspaceId) =>
      DIMENSIONES_SISTEMA.map((def) => ({
        workspaceId,
        empresaId: null,
        codigo: def.codigo,
        nombre: def.nombre,
        tipoValor: 'REFERENCIA' as const,
        referenciaEntidad: def.referenciaEntidad,
        esSistema: true,
        aplicaA: APLICA_A_SISTEMA,
      })),
    );
    try {
      const { count } = await this.prisma.dimension.createMany({ data, skipDuplicates: true });
      for (const id of workspaceIds) this.sembrados.add(id);
      return count;
    } catch (err) {
      // Alta concurrente desde otra réplica: el índice parcial único ya las creó. No es un error.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 0;
      throw err;
    }
  }

  /** Garantiza las 3 dimensiones de sistema del workspace. Devuelve cuántas creó (0 si ya estaban todas). */
  async ensureForWorkspace(workspaceId: string): Promise<number> {
    // Red de seguridad perezosa: si ya lo garantizamos en este proceso, no consultamos de nuevo.
    if (this.sembrados.has(workspaceId)) return 0;
    const existentes = await this.prisma.dimension.findMany({
      where: { workspaceId, esSistema: true, empresaId: null },
      select: { codigo: true },
    });
    const yaHay = new Set(existentes.map((d) => d.codigo));
    let creadas = 0;
    for (const def of DIMENSIONES_SISTEMA) {
      if (yaHay.has(def.codigo)) continue;
      try {
        await this.prisma.dimension.create({
          data: {
            workspaceId,
            empresaId: null,
            codigo: def.codigo,
            nombre: def.nombre,
            tipoValor: 'REFERENCIA',
            referenciaEntidad: def.referenciaEntidad,
            esSistema: true,
            aplicaA: APLICA_A_SISTEMA,
          },
        });
        creadas += 1;
      } catch (err) {
        // Alta concurrente desde otra réplica: el índice parcial único ya la creó. No es un error.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
    // Catálogo garantizado (lo creamos o ya estaba): entra a la caché para no repetir el SELECT.
    this.sembrados.add(workspaceId);
    return creadas;
  }
}
