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

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const workspaces = await this.prisma.workspace.findMany({ select: { id: true } });
    let total = 0;
    for (const w of workspaces) total += await this.ensureForWorkspace(w.id);
    if (total) this.logger.log(`Dimensiones de sistema sembradas: ${total} en ${workspaces.length} workspace(s)`);
  }

  /** Garantiza las 3 dimensiones de sistema del workspace. Devuelve cuántas creó (0 si ya estaban todas). */
  async ensureForWorkspace(workspaceId: string): Promise<number> {
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
    return creadas;
  }
}
