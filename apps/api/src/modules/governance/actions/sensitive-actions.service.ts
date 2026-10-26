import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Prisma, type TipoAccionSensible } from '@prisma/client';
import type { AuthContext } from '../../../common/decorators/current-user.decorator';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AUDIT_ACTIONS } from '../../audit/audit.types';
import type { CatalogoAccionEfectivo } from '../policy/policy.types';
import { CATALOGO_BASE_ACCIONES_SENSIBLES, CODIGOS_BASE_SISTEMA } from './sensitive-actions.catalog';
import type {
  ClasificarRiesgoDto,
  CreateTipoAccionSensibleDto,
  UpdateTipoAccionSensibleDto,
} from './dto/sensitive-actions.dto';
import { clasificarRiesgo, type EntradaClasificacionRiesgo, type ResultadoClasificacionRiesgo } from './riesgo.rules';

/**
 * Catálogo configurable de tipos de acción sensible + clasificación de riesgo (E6+ · puntos 7 y 8). Da a cada
 * empresa/workspace un catálogo que el `PolicyEngine`/`ActionGateway` CONSULTA (vía `efectivoParaTipo`) de forma
 * ADITIVA: sin romper lo existente. Siembra un catálogo base conservador de referencia (`esSistema=true`) de manera
 * idempotente, igual que `DimensionSeedService`: al arranque para los workspaces existentes y de forma perezosa en el
 * primer acceso de un workspace nuevo. La idempotencia la respalda el índice parcial único `TipoAccionSensible_codigo_
 * ws_wide` (empresaId IS NULL): un alta duplicada concurrente choca con P2002 y se ignora.
 */
@Injectable()
export class SensitiveActionsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SensitiveActionsService.name);
  /**
   * Caché process-local de workspaces cuyo catálogo base ya está garantizado. Evita el SELECT repetido de
   * `ensureForWorkspace` en cada evaluación de política/listado. Un workspace nuevo entra al set en su primer acceso;
   * la BD sigue siendo la fuente de verdad e idempotente, así que el comportamiento observable no cambia.
   */
  private readonly sembrados = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Siembra al arranque SIN barrer en serie los workspaces: una sola consulta de diferencia de conjuntos trae los que
   * no tienen el catálogo base de sistema y se siembran en un único `createMany` idempotente. En régimen estable es una
   * sola consulta y cero inserciones; el tiempo ya no escala con el nº de workspaces.
   */
  async onApplicationBootstrap(): Promise<void> {
    const t0 = Date.now();
    const pendientes = await this.workspacesSinCatalogo();
    const total = pendientes.length ? await this.seedLote(pendientes) : 0;
    this.logger.log(
      `Bootstrap acciones sensibles: ${total} entrada(s) en ${pendientes.length} workspace(s) pendiente(s) ` +
        `(${Date.now() - t0}ms)`,
    );
  }

  /** Workspaces que NO tienen el catálogo base de sistema completo (empresaId IS NULL). Una sola consulta. */
  private async workspacesSinCatalogo(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT w."id"
      FROM "Workspace" w
      WHERE (
        SELECT COUNT(*) FROM "TipoAccionSensible" t
        WHERE t."workspaceId" = w."id" AND t."esSistema" = true AND t."empresaId" IS NULL
      ) < ${CATALOGO_BASE_ACCIONES_SENSIBLES.length}
    `;
    return rows.map((r) => r.id);
  }

  /** Inserta en un solo `createMany` las entradas base que falten en el lote (ON CONFLICT DO NOTHING). */
  private async seedLote(workspaceIds: string[]): Promise<number> {
    const data: Prisma.TipoAccionSensibleCreateManyInput[] = workspaceIds.flatMap((workspaceId) =>
      CATALOGO_BASE_ACCIONES_SENSIBLES.map((def) => ({
        workspaceId,
        empresaId: null,
        codigo: def.codigo,
        nombre: def.nombre,
        requiereAprobacion: def.requiereAprobacion,
        requiereDobleAprobacion: def.requiereDobleAprobacion,
        nivelRiesgoPorDefecto: def.nivelRiesgoPorDefecto,
        esSistema: true,
        activo: true,
      })),
    );
    try {
      const { count } = await this.prisma.tipoAccionSensible.createMany({ data, skipDuplicates: true });
      for (const id of workspaceIds) this.sembrados.add(id);
      return count;
    } catch (err) {
      // Alta concurrente desde otra réplica: el índice parcial único ya las creó. No es un error.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 0;
      throw err;
    }
  }

  /** Garantiza el catálogo base de sistema del workspace (empresaId = null). Devuelve cuántas entradas creó. */
  async ensureForWorkspace(workspaceId: string): Promise<number> {
    // Red de seguridad perezosa: si ya lo garantizamos en este proceso, no consultamos de nuevo.
    if (this.sembrados.has(workspaceId)) return 0;
    const existentes = await this.prisma.tipoAccionSensible.findMany({
      where: { workspaceId, empresaId: null },
      select: { codigo: true },
    });
    const yaHay = new Set(existentes.map((e) => e.codigo));
    let creadas = 0;
    for (const def of CATALOGO_BASE_ACCIONES_SENSIBLES) {
      if (yaHay.has(def.codigo)) continue;
      try {
        await this.prisma.tipoAccionSensible.create({
          data: {
            workspaceId,
            empresaId: null,
            codigo: def.codigo,
            nombre: def.nombre,
            requiereAprobacion: def.requiereAprobacion,
            requiereDobleAprobacion: def.requiereDobleAprobacion,
            nivelRiesgoPorDefecto: def.nivelRiesgoPorDefecto,
            esSistema: true,
            activo: true,
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

  /**
   * Catálogo EFECTIVO: las entradas de workspace (empresaId=null) más, si se pide una empresa, sus entradas propias,
   * que tienen prioridad por `codigo`. Garantiza la semilla perezosamente antes de listar (idempotente).
   */
  async listarEfectivo(workspaceId: string, empresaId?: string | null): Promise<TipoAccionSensible[]> {
    await this.ensureForWorkspace(workspaceId);
    const filas = await this.prisma.tipoAccionSensible.findMany({
      where: { workspaceId, OR: [{ empresaId: null }, ...(empresaId ? [{ empresaId }] : [])] },
      orderBy: [{ codigo: 'asc' }, { empresaId: 'asc' }],
    });
    if (!empresaId) return filas;
    // La entrada específica de empresa sustituye a la de workspace del mismo codigo.
    const porCodigo = new Map<string, TipoAccionSensible>();
    for (const f of filas) {
      const previa = porCodigo.get(f.codigo);
      if (!previa || (f.empresaId === empresaId && previa.empresaId == null)) porCodigo.set(f.codigo, f);
    }
    return [...porCodigo.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  async get(workspaceId: string, id: string): Promise<TipoAccionSensible> {
    const fila = await this.prisma.tipoAccionSensible.findFirst({ where: { id, workspaceId } });
    if (!fila) throw new NotFoundException('Tipo de acción sensible no encontrado');
    return fila;
  }

  /**
   * Resuelve la entrada efectiva de un `codigo` para pasarla al motor (la de empresa gana sobre la de workspace). Solo
   * entradas activas. Garantiza la semilla perezosamente. Devuelve `null` si no hay entrada → el motor conserva el
   * comportamiento previo.
   */
  async efectivoParaTipo(
    workspaceId: string,
    empresaId: string | null | undefined,
    codigo: string,
  ): Promise<CatalogoAccionEfectivo | null> {
    await this.ensureForWorkspace(workspaceId);
    const filas = await this.prisma.tipoAccionSensible.findMany({
      where: { workspaceId, codigo, activo: true, OR: [{ empresaId: null }, ...(empresaId ? [{ empresaId }] : [])] },
    });
    if (filas.length === 0) return null;
    const especifica = empresaId ? filas.find((f) => f.empresaId === empresaId) : undefined;
    const fila = especifica ?? filas.find((f) => f.empresaId == null) ?? filas[0];
    return {
      codigo: fila.codigo,
      // La doble aprobación implica aprobación aunque la bandera simple quedara en false por configuración.
      requiereAprobacion: fila.requiereAprobacion || fila.requiereDobleAprobacion,
      requiereDobleAprobacion: fila.requiereDobleAprobacion,
      nivelRiesgoPorDefecto: fila.nivelRiesgoPorDefecto,
    };
  }

  async create(
    workspaceId: string,
    dto: CreateTipoAccionSensibleDto,
    actor?: AuthContext,
  ): Promise<TipoAccionSensible> {
    const codigo = dto.codigo.trim();
    if (CODIGOS_BASE_SISTEMA.has(codigo) && !dto.empresaId) {
      throw new BadRequestException(
        `El código "${codigo}" pertenece al catálogo base de sistema del workspace; configure sus banderas con PATCH ` +
          `o cree una entrada específica de empresa.`,
      );
    }
    try {
      const fila = await this.prisma.tipoAccionSensible.create({
        data: {
          workspaceId,
          empresaId: dto.empresaId ?? null,
          codigo,
          nombre: dto.nombre.trim(),
          requiereAprobacion: dto.requiereAprobacion ?? false,
          requiereDobleAprobacion: dto.requiereDobleAprobacion ?? false,
          nivelRiesgoPorDefecto: dto.nivelRiesgoPorDefecto ?? 'DESCONOCIDO',
          umbralMonto: dto.umbralMonto != null ? new Prisma.Decimal(dto.umbralMonto) : null,
          moneda: dto.moneda ?? null,
          limiteAcumuladoPeriodo:
            dto.limiteAcumuladoPeriodo != null ? new Prisma.Decimal(dto.limiteAcumuladoPeriodo) : null,
          esSistema: false,
          activo: dto.activo ?? true,
        },
      });
      await this.auditar(workspaceId, actor, fila, { operacion: 'ALTA' });
      return fila;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException(`Ya existe un tipo de acción sensible "${codigo}" para ese alcance`);
      }
      throw err;
    }
  }

  async update(
    workspaceId: string,
    id: string,
    dto: UpdateTipoAccionSensibleDto,
    actor?: AuthContext,
  ): Promise<TipoAccionSensible> {
    const actual = await this.get(workspaceId, id);
    const data: Prisma.TipoAccionSensibleUpdateInput = {};
    if (dto.nombre !== undefined) data.nombre = dto.nombre.trim();
    if (dto.requiereAprobacion !== undefined) data.requiereAprobacion = dto.requiereAprobacion;
    if (dto.requiereDobleAprobacion !== undefined) data.requiereDobleAprobacion = dto.requiereDobleAprobacion;
    if (dto.nivelRiesgoPorDefecto !== undefined) data.nivelRiesgoPorDefecto = dto.nivelRiesgoPorDefecto;
    if (dto.umbralMonto !== undefined)
      data.umbralMonto = dto.umbralMonto != null ? new Prisma.Decimal(dto.umbralMonto) : null;
    if (dto.moneda !== undefined) data.moneda = dto.moneda;
    if (dto.limiteAcumuladoPeriodo !== undefined)
      data.limiteAcumuladoPeriodo =
        dto.limiteAcumuladoPeriodo != null ? new Prisma.Decimal(dto.limiteAcumuladoPeriodo) : null;
    if (dto.activo !== undefined) data.activo = dto.activo;

    const fila = await this.prisma.tipoAccionSensible.update({ where: { id: actual.id }, data });
    await this.auditar(workspaceId, actor, fila, {
      operacion: 'CAMBIO',
      anterior: {
        requiereAprobacion: actual.requiereAprobacion,
        requiereDobleAprobacion: actual.requiereDobleAprobacion,
        nivelRiesgoPorDefecto: actual.nivelRiesgoPorDefecto,
        umbralMonto: actual.umbralMonto?.toString() ?? null,
        activo: actual.activo,
      },
    });
    return fila;
  }

  /** Clasificación de prueba: resuelve el nivel por defecto del catálogo (si hay tipoAccion) y aplica las reglas puras. */
  async clasificar(workspaceId: string, dto: ClasificarRiesgoDto): Promise<ResultadoClasificacionRiesgo> {
    let nivelPorDefecto = dto.nivelPorDefecto ?? null;
    if (dto.tipoAccion) {
      const efectivo = await this.efectivoParaTipo(workspaceId, dto.empresaId ?? null, dto.tipoAccion);
      if (efectivo) nivelPorDefecto = efectivo.nivelRiesgoPorDefecto;
    }
    const entrada: EntradaClasificacionRiesgo = {
      nivelPorDefecto,
      evidenciaSuficiente: dto.evidenciaSuficiente,
      señalesContradictorias: dto.señalesContradictorias,
      reversible: dto.reversible,
      impactoPotencial: dto.impactoPotencial,
      afectaProduccion: dto.afectaProduccion,
      datosSensibles: dto.datosSensibles,
      cumpleReglas: dto.cumpleReglas,
    };
    return clasificarRiesgo(entrada);
  }

  private auditar(
    workspaceId: string,
    actor: AuthContext | undefined,
    fila: TipoAccionSensible,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.append(workspaceId, {
      actorType: actor?.userId ? 'USER' : 'SYSTEM',
      actorId: actor?.userId ?? null,
      action: AUDIT_ACTIONS.ACCION_SENSIBLE_CONFIGURADA,
      targetType: 'TipoAccionSensible',
      targetId: fila.id,
      resumen: `Acción sensible configurada: "${fila.codigo}"`,
      metadata: {
        codigo: fila.codigo,
        empresaId: fila.empresaId,
        requiereAprobacion: fila.requiereAprobacion,
        requiereDobleAprobacion: fila.requiereDobleAprobacion,
        nivelRiesgoPorDefecto: fila.nivelRiesgoPorDefecto,
        ...metadata,
      },
    });
  }
}
