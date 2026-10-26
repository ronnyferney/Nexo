import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { ClaseFallo } from '../classification/failure-classification';
import type {
  AportarInfoDto,
  CancelarExcepcionDto,
  ConciliarExcepcionDto,
  ExcepcionesQueryDto,
  ReasignarExcepcionDto,
} from './dto/excepcion.dto';

/** Estados terminales: una excepción cerrada no admite más acciones operativas. */
const CERRADAS: readonly string[] = ['CANCELADA', 'RESUELTA', 'CONCILIADA'];

export interface AbrirExcepcionInput {
  causa: string;
  clase?: ClaseFallo | null;
  impacto?: string | null;
  procesoId?: string | null;
  tareaId?: string | null;
  executionId?: string | null;
  paso?: string | null;
  empresaId?: string | null;
  evidencia?: Record<string, unknown>;
  duenoUserId?: string | null;
  siguienteAccion?: string | null;
  /** MOTOR_DURABLE | ESCRITURA_INCIERTA | MANUAL. */
  origen?: string;
  idempotencyKeyId?: string | null;
  actorUserId?: string | null;
}

/**
 * Bandeja de excepciones (E7 · RF21). Recoge los fallos del motor durable y las escrituras inciertas (RF20) que
 * requieren intervención humana. Expone el CRUD de consulta y las acciones operativas: aportar info, reintentar
 * (conserva historial y no duplica acciones ya confirmadas, QA06), reasignar, cancelar y conciliar. Todo el historial
 * es append-only en `ExcepcionEvento`; el estado de la excepción resume la última situación.
 */
@Injectable()
export class ExcepcionesService {
  private readonly logger = new Logger(ExcepcionesService.name);

  constructor(private readonly prisma: PrismaService) {}

  private evento(
    workspaceId: string,
    excepcionId: string,
    tipo: string,
    detalle: unknown,
    actorUserId?: string | null,
  ) {
    return this.prisma.excepcionEvento.create({
      data: {
        workspaceId,
        excepcionId,
        tipo,
        detalle: detalle ?? {},
        actorUserId: actorUserId ?? null,
      },
    });
  }

  private async getOrThrow(workspaceId: string, id: string) {
    const exc = await this.prisma.excepcion.findFirst({ where: { id, workspaceId } });
    if (!exc) throw new NotFoundException('Excepción no encontrada');
    return exc;
  }

  /** Abre una excepción y registra su evento CREADA. Todo el filtrado va por `workspaceId` (multi-tenant). */
  async abrir(workspaceId: string, input: AbrirExcepcionInput) {
    const excepcion = await this.prisma.excepcion.create({
      data: {
        workspaceId,
        empresaId: input.empresaId ?? null,
        causa: input.causa,
        clase: input.clase ?? null,
        impacto: input.impacto ?? null,
        procesoId: input.procesoId ?? null,
        tareaId: input.tareaId ?? null,
        executionId: input.executionId ?? null,
        paso: input.paso ?? null,
        evidencia: (input.evidencia ?? {}) as Prisma.InputJsonValue,
        duenoUserId: input.duenoUserId ?? null,
        siguienteAccion: input.siguienteAccion ?? null,
        origen: input.origen ?? 'MANUAL',
        idempotencyKeyId: input.idempotencyKeyId ?? null,
        estado: 'ABIERTA',
      },
    });
    await this.evento(
      workspaceId,
      excepcion.id,
      'CREADA',
      { causa: input.causa, origen: excepcion.origen },
      input.actorUserId,
    );
    this.logger.warn(`Excepción abierta (${excepcion.origen}) para workspace ${workspaceId}: ${input.causa}`);
    return excepcion;
  }

  /**
   * Abre una excepción solo si no hay ya una ABIERTA/EN_PROGRESO para el mismo origen de fallo (misma ejecución o misma
   * clave de idempotencia). Idempotente: un redelivery del mismo fallo no llena la bandeja de duplicados.
   */
  async abrirUnica(workspaceId: string, input: AbrirExcepcionInput) {
    const where: Prisma.ExcepcionWhereInput = {
      workspaceId,
      estado: { in: ['ABIERTA', 'EN_PROGRESO'] },
      ...(input.idempotencyKeyId
        ? { idempotencyKeyId: input.idempotencyKeyId }
        : input.executionId
          ? { executionId: input.executionId }
          : { causa: input.causa, procesoId: input.procesoId ?? null }),
    };
    const existente = await this.prisma.excepcion.findFirst({ where });
    if (existente) return existente;
    return this.abrir(workspaceId, input);
  }

  list(workspaceId: string, q: ExcepcionesQueryDto = {}) {
    return this.prisma.excepcion.findMany({
      where: {
        workspaceId,
        ...(q.estado ? { estado: q.estado } : {}),
        ...(q.tareaId ? { tareaId: q.tareaId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(workspaceId: string, id: string) {
    const excepcion = await this.getOrThrow(workspaceId, id);
    const eventos = await this.prisma.excepcionEvento.findMany({
      where: { workspaceId, excepcionId: id },
      orderBy: { createdAt: 'asc' },
    });
    return { ...excepcion, eventos };
  }

  /** Aporta información/evidencia (RF21): no ejecuta ningún efecto, solo enriquece la excepción y su historial. */
  async aportarInfo(workspaceId: string, id: string, dto: AportarInfoDto, actorUserId?: string | null) {
    const exc = await this.getOrThrow(workspaceId, id);
    if (CERRADAS.includes(exc.estado)) throw new BadRequestException('La excepción está cerrada');
    await this.evento(workspaceId, id, 'INFO', { nota: dto.nota, evidencia: dto.evidencia ?? null }, actorUserId);
    return this.prisma.excepcion.update({
      where: { id },
      data: {
        estado: exc.estado === 'ABIERTA' ? 'EN_PROGRESO' : exc.estado,
        siguienteAccion: dto.siguienteAccion ?? exc.siguienteAccion,
        ...(dto.evidencia
          ? { evidencia: { ...(exc.evidencia as object), ...dto.evidencia } as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  /**
   * Reintenta la acción (RF21/QA06): CONSERVA el historial y NO duplica una acción ya confirmada. Si la excepción tiene
   * una clave de idempotencia asociada y esa clave está COMPLETADA, el efecto YA ocurrió: no se re-ejecuta; se registra
   * el intento y la excepción pasa a CONCILIADA. En caso contrario se marca EN_PROGRESO para que el reintento ocurra
   * protegido por la misma clave de idempotencia (el efecto no se duplica).
   */
  async reintentar(workspaceId: string, id: string, actorUserId?: string | null) {
    const exc = await this.getOrThrow(workspaceId, id);
    if (CERRADAS.includes(exc.estado)) throw new BadRequestException('La excepción está cerrada');

    let yaConfirmada = false;
    if (exc.idempotencyKeyId) {
      const key = await this.prisma.idempotencyKey.findFirst({ where: { id: exc.idempotencyKeyId, workspaceId } });
      yaConfirmada = key?.estado === 'COMPLETADA';
    }

    await this.evento(workspaceId, id, 'REINTENTO', { yaConfirmada }, actorUserId);
    return this.prisma.excepcion.update({
      where: { id },
      data: yaConfirmada
        ? { estado: 'CONCILIADA', siguienteAccion: 'Acción ya confirmada: conciliada sin re-ejecutar (QA06)' }
        : { estado: 'EN_PROGRESO', siguienteAccion: 'Reintento solicitado (protegido por idempotencia)' },
    });
  }

  /** Reasigna el dueño (RF21). */
  async reasignar(workspaceId: string, id: string, dto: ReasignarExcepcionDto, actorUserId?: string | null) {
    const exc = await this.getOrThrow(workspaceId, id);
    if (CERRADAS.includes(exc.estado)) throw new BadRequestException('La excepción está cerrada');
    await this.evento(
      workspaceId,
      id,
      'REASIGNACION',
      { de: exc.duenoUserId, a: dto.duenoUserId, motivo: dto.motivo ?? null },
      actorUserId,
    );
    return this.prisma.excepcion.update({
      where: { id },
      data: { duenoUserId: dto.duenoUserId, estado: exc.estado === 'ABIERTA' ? 'EN_PROGRESO' : exc.estado },
    });
  }

  /** Cancela la excepción (RF21): la cierra sin conciliar; el historial se conserva. */
  async cancelar(workspaceId: string, id: string, dto: CancelarExcepcionDto, actorUserId?: string | null) {
    const exc = await this.getOrThrow(workspaceId, id);
    if (CERRADAS.includes(exc.estado)) throw new BadRequestException('La excepción ya está cerrada');
    await this.evento(workspaceId, id, 'CANCELACION', { motivo: dto.motivo }, actorUserId);
    return this.prisma.excepcion.update({ where: { id }, data: { estado: 'CANCELADA', siguienteAccion: null } });
  }

  /**
   * Concilia (RF20/RF21): registra el estado verificado contra el destino. CONFIRMADO cierra como CONCILIADA (el efecto
   * ocurrió una sola vez); NO_OCURRIO deja EN_PROGRESO para que un reintento seguro recupere el trabajo.
   */
  async conciliar(workspaceId: string, id: string, dto: ConciliarExcepcionDto, actorUserId?: string | null) {
    const exc = await this.getOrThrow(workspaceId, id);
    if (['CANCELADA', 'RESUELTA'].includes(exc.estado)) throw new BadRequestException('La excepción está cerrada');
    await this.evento(
      workspaceId,
      id,
      'CONCILIACION',
      { resultado: dto.resultado, detalle: dto.detalle ?? null },
      actorUserId,
    );
    return this.prisma.excepcion.update({
      where: { id },
      data:
        dto.resultado === 'CONFIRMADO'
          ? { estado: 'CONCILIADA', siguienteAccion: 'Efecto confirmado en el destino' }
          : { estado: 'EN_PROGRESO', siguienteAccion: 'Efecto no ocurrió: habilitar reintento seguro' },
    });
  }
}
