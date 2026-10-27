import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type EstadoMision, type MisionTransversal } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import type {
  AddParticipanteDto,
  AddVinculoDto,
  AuthorizeMisionDto,
  CancelMisionDto,
  CreateMisionDto,
  StopMisionDto,
} from './dto/mission.dto';
import {
  cumpleCondicionLograda,
  esTransicionValida,
  estadoOperativoSugerido,
  type ResumenMision,
} from './mission.state';

/** Estados de `Tarea` que cuentan como "trabajo en producción" para el avance operativo (D2). */
const ESTADOS_EN_PRODUCCION = ['EN_EJECUCION', 'EN_REVISION', 'ESPERANDO_APROBACION'] as const;

/**
 * Misiones transversales (ADR 0016 · E3 · Incremento 1). Capa DELGADA de coordinación sobre el trabajo por resultados
 * (E4). Invariantes que este servicio hace cumplir:
 *  - **Humano en el origen:** crear/autorizar/detener/cancelar exige `auth.userId` (nunca un agente ni una API key sin
 *    usuario), además del `@MinRole` del controlador (`AGENTE_NO_CREA_AGENTES`).
 *  - **No concede acceso (ADR 0007):** declarar un participante o vincular un objetivo/tarea NO crea ningún share,
 *    permiso ni conexión; solo nombra quién colabora/qué se agrupa. El acceso lo siguen resolviendo las capas de E7/E6.
 *  - **Multi-tenant:** todo filtra por `workspaceId` (de `@CurrentAuth`, nunca del cuerpo); cada referencia
 *    (dueño, coordinador, canal, orgUnit, objetivo, tarea) se valida DENTRO del workspace.
 *  - **Transiciones verificables:** el estado solo cambia por la máquina pura `mission.state.ts`; el avance operativo
 *    (EN_CURSO/EN_VALIDACION) y la condición de LOGRADA se DERIVAN del trabajo vinculado, no se imponen a mano.
 *  - **Auditado (E13):** crear/autorizar/detener/cancelar escriben al `AuditLog` inmutable con actor humano.
 */
@Injectable()
export class MissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Exige que el actor sea un humano identificado. Refuerza "humano en el origen" más allá del `@MinRole`. */
  private exigirHumano(auth: AuthContext): string {
    if (!auth.userId) {
      throw new ForbiddenException(
        'Solo un humano puede crear o gobernar misiones transversales (ningún agente lo hace)',
      );
    }
    return auth.userId;
  }

  // --- Lectura ------------------------------------------------------------------------------------------------------

  list(workspaceId: string, estado?: EstadoMision) {
    return this.prisma.misionTransversal.findMany({
      where: { workspaceId, ...(estado ? { estado } : {}) },
      include: { _count: { select: { participantes: true, vinculos: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** Detalle con participantes, vínculos y el seguimiento agregado mínimo (quién frena el resultado). */
  async get(workspaceId: string, id: string, confirmarLograda = false) {
    const mision = await this.prisma.misionTransversal.findFirst({
      where: { id, workspaceId },
      include: {
        participantes: { orderBy: { createdAt: 'asc' } },
        vinculos: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!mision) throw new NotFoundException('Misión no encontrada');
    const seguimiento = await this.seguimiento(workspaceId, mision, confirmarLograda);
    return { ...mision, seguimiento };
  }

  private async assertMision(workspaceId: string, id: string): Promise<MisionTransversal> {
    const mision = await this.prisma.misionTransversal.findFirst({ where: { id, workspaceId } });
    if (!mision) throw new NotFoundException('Misión no encontrada');
    return mision;
  }

  // --- Seguimiento agregado mínimo (D3) -----------------------------------------------------------------------------

  /**
   * Lectura agregada mínima por misión: estado del trabajo vinculado, bloqueos (incumplimiento/excepción abierta,
   * dependencia vencida o tarea BLOQUEADA) y el estado OPERATIVO sugerido. No persiste nada: solo observa/propone.
   */
  async seguimiento(workspaceId: string, mision: MisionTransversal, confirmarLograda = false) {
    const vinculos = await this.prisma.misionVinculo.findMany({ where: { workspaceId, misionId: mision.id } });
    const objetivoIds = vinculos.map((v) => v.objetivoId).filter((x): x is string => !!x);
    const tareaIdsDirectas = vinculos.map((v) => v.tareaId).filter((x): x is string => !!x);

    // Tareas vinculadas: directas + las de los objetivos vinculados. Se deduplican por id.
    const tareas = await this.prisma.tarea.findMany({
      where: {
        workspaceId,
        OR: [{ id: { in: tareaIdsDirectas } }, { objetivoId: { in: objetivoIds } }],
      },
      include: {
        contratoResultado: { select: { estado: true, tipoResultado: true } },
        incumplimientos: { where: { resuelto: false }, select: { id: true, causa: true } },
      },
    });

    const ahora = new Date();
    const bloqueos: { tareaId: string; titulo: string; motivo: string }[] = [];
    let tareasEnProduccion = 0;
    let tareasPresentadas = 0;
    let contratosNegocio = 0;
    let contratosNegocioAceptados = 0;

    for (const t of tareas) {
      if ((ESTADOS_EN_PRODUCCION as readonly string[]).includes(t.estado)) tareasEnProduccion++;
      const presentada =
        t.estado === 'COMPLETADA' ||
        t.contratoResultado?.estado === 'PENDIENTE_VALIDACION' ||
        t.contratoResultado?.estado === 'ACEPTADO';
      if (presentada) tareasPresentadas++;

      if (t.contratoResultado?.tipoResultado === 'RESULTADO_NEGOCIO') {
        contratosNegocio++;
        if (t.contratoResultado.estado === 'ACEPTADO') contratosNegocioAceptados++;
      }

      // Detección de bloqueos = quién frena el resultado.
      if (t.incumplimientos.length > 0) {
        bloqueos.push({ tareaId: t.id, titulo: t.titulo, motivo: `INCUMPLIMIENTO: ${t.incumplimientos[0].causa}` });
      } else if (t.estado === 'BLOQUEADA') {
        bloqueos.push({ tareaId: t.id, titulo: t.titulo, motivo: 'TAREA_BLOQUEADA' });
      } else if (
        t.fechaLimite &&
        t.fechaLimite < ahora &&
        t.estado !== 'COMPLETADA' &&
        t.estado !== 'FALLIDA_CANCELADA'
      ) {
        bloqueos.push({ tareaId: t.id, titulo: t.titulo, motivo: 'DEPENDENCIA_VENCIDA' });
      }
    }

    const resumen: ResumenMision = {
      totalTareas: tareas.length,
      tareasEnProduccion,
      tareasPresentadas,
      contratosNegocio,
      contratosNegocioAceptados,
      bloqueos: bloqueos.length,
    };

    return {
      resumen,
      bloqueos,
      estadoActual: mision.estado,
      estadoSugerido: estadoOperativoSugerido(mision.estado, resumen),
      // Propuesta de cierre: solo verdadera si los contratos de negocio están ACEPTADO y el dueño confirma (D5).
      puedeMarcarseLograda: cumpleCondicionLograda(resumen, confirmarLograda),
    };
  }

  // --- Ciclo de vida (solo humano) ----------------------------------------------------------------------------------

  async create(auth: AuthContext, dto: CreateMisionDto) {
    const userId = this.exigirHumano(auth);
    const duenoUserId = dto.duenoUserId ?? userId;
    await this.assertUsuarioEnWorkspace(auth.workspaceId, duenoUserId);
    if (dto.coordinadorAgentId) await this.assertAgenteEnWorkspace(auth.workspaceId, dto.coordinadorAgentId);
    if (dto.canalId) await this.assertCanalMisionEnWorkspace(auth.workspaceId, dto.canalId);

    const mision = await this.prisma.misionTransversal.create({
      data: {
        workspaceId: auth.workspaceId,
        nombre: dto.nombre.trim(),
        proposito: dto.proposito?.trim() || null,
        resultadoEsperado: dto.resultadoEsperado.trim(),
        indicador: dto.indicador?.trim() || null,
        lineaBase: dto.lineaBase?.trim() || null,
        meta: dto.meta?.trim() || null,
        plazo: dto.plazo ? new Date(dto.plazo) : null,
        estado: 'PROPUESTA',
        duenoUserId,
        coordinadorAgentId: dto.coordinadorAgentId ?? null,
        canalId: dto.canalId ?? null,
      },
    });
    await this.auditar(
      auth,
      userId,
      AUDIT_ACTIONS.MISION_CREADA,
      mision.id,
      `Misión "${mision.nombre}" creada en PROPUESTA`,
      {
        duenoUserId,
        coordinadorAgentId: mision.coordinadorAgentId,
      },
    );
    return this.get(auth.workspaceId, mision.id);
  }

  async authorize(auth: AuthContext, id: string, dto: AuthorizeMisionDto) {
    const userId = this.exigirHumano(auth);
    const mision = await this.assertMision(auth.workspaceId, id);
    this.assertTransicion(mision.estado, 'AUTORIZADA');

    const coordinadorAgentId = dto.coordinadorAgentId ?? mision.coordinadorAgentId;
    if (dto.coordinadorAgentId) await this.assertAgenteEnWorkspace(auth.workspaceId, dto.coordinadorAgentId);
    if (!coordinadorAgentId) {
      throw new BadRequestException('Autorizar exige un coordinador (superempleado) asignado');
    }

    const actualizada = await this.prisma.misionTransversal.update({
      where: { id },
      data: {
        estado: 'AUTORIZADA',
        coordinadorAgentId,
        autorizadaPorUserId: userId,
        autorizadaAt: new Date(),
      },
    });
    await this.auditar(auth, userId, AUDIT_ACTIONS.MISION_AUTORIZADA, id, `Misión "${actualizada.nombre}" autorizada`, {
      coordinadorAgentId,
      estadoPrevio: mision.estado,
    });
    return this.get(auth.workspaceId, id);
  }

  async stop(auth: AuthContext, id: string, dto: StopMisionDto) {
    const userId = this.exigirHumano(auth);
    const mision = await this.assertMision(auth.workspaceId, id);
    this.assertTransicion(mision.estado, 'DETENIDA');

    const actualizada = await this.prisma.misionTransversal.update({
      where: { id },
      data: { estado: 'DETENIDA', motivo: dto.motivo.trim() },
    });
    await this.auditar(auth, userId, AUDIT_ACTIONS.MISION_DETENIDA, id, `Misión "${actualizada.nombre}" detenida`, {
      motivo: dto.motivo.trim(),
      estadoPrevio: mision.estado,
    });
    return this.get(auth.workspaceId, id);
  }

  async cancel(auth: AuthContext, id: string, dto: CancelMisionDto) {
    const userId = this.exigirHumano(auth);
    const mision = await this.assertMision(auth.workspaceId, id);
    this.assertTransicion(mision.estado, 'CANCELADA');

    const actualizada = await this.prisma.misionTransversal.update({
      where: { id },
      data: { estado: 'CANCELADA', motivo: dto.motivo.trim() },
    });
    await this.auditar(auth, userId, AUDIT_ACTIONS.MISION_CANCELADA, id, `Misión "${actualizada.nombre}" cancelada`, {
      motivo: dto.motivo.trim(),
      estadoPrevio: mision.estado,
    });
    return this.get(auth.workspaceId, id);
  }

  // --- Participantes ------------------------------------------------------------------------------------------------

  /**
   * Declara un participante. Declarar participante NO concede acceso (ADR 0007): no crea ningún share/permiso. El
   * `orgUnitId` y el agente líder se validan dentro del workspace, pero nombrarlos no abre sus datos.
   */
  async addParticipante(workspaceId: string, misionId: string, dto: AddParticipanteDto) {
    await this.assertMision(workspaceId, misionId);
    await this.assertOrgUnitEnWorkspace(workspaceId, dto.orgUnitId);
    if (dto.duenoLocalUserId) await this.assertUsuarioEnWorkspace(workspaceId, dto.duenoLocalUserId);
    if (dto.agenteLiderId) await this.assertAgenteEnWorkspace(workspaceId, dto.agenteLiderId);

    try {
      await this.prisma.misionParticipante.create({
        data: {
          workspaceId,
          misionId,
          orgUnitId: dto.orgUnitId,
          duenoLocalUserId: dto.duenoLocalUserId ?? null,
          agenteLiderId: dto.agenteLiderId ?? null,
          alcance: (dto.alcance ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Esa empresa/área ya participa en la misión');
      }
      throw err;
    }
    return this.get(workspaceId, misionId);
  }

  async removeParticipante(workspaceId: string, misionId: string, participanteId: string) {
    await this.assertMision(workspaceId, misionId);
    const p = await this.prisma.misionParticipante.findFirst({
      where: { id: participanteId, workspaceId, misionId },
      select: { id: true },
    });
    if (!p) throw new NotFoundException('Participante no encontrado');
    await this.prisma.misionParticipante.delete({ where: { id: participanteId } });
  }

  // --- Vínculos a trabajo existente ---------------------------------------------------------------------------------

  /**
   * Agrupa por REFERENCIA un objetivo y/o tarea existentes. Vincular NO concede acceso ni redefine el trabajo: cada
   * objetivo/tarea conserva su dueño y autoridad. Exige al menos una referencia, validada dentro del workspace.
   */
  async addVinculo(workspaceId: string, misionId: string, dto: AddVinculoDto) {
    await this.assertMision(workspaceId, misionId);
    if (!dto.objetivoId && !dto.tareaId) {
      throw new BadRequestException('Un vínculo debe referir al menos un objetivo o una tarea');
    }
    if (dto.objetivoId) await this.assertObjetivoEnWorkspace(workspaceId, dto.objetivoId);
    if (dto.tareaId) await this.assertTareaEnWorkspace(workspaceId, dto.tareaId);

    await this.prisma.misionVinculo.create({
      data: {
        workspaceId,
        misionId,
        objetivoId: dto.objetivoId ?? null,
        tareaId: dto.tareaId ?? null,
      },
    });
    return this.get(workspaceId, misionId);
  }

  async removeVinculo(workspaceId: string, misionId: string, vinculoId: string) {
    await this.assertMision(workspaceId, misionId);
    const v = await this.prisma.misionVinculo.findFirst({
      where: { id: vinculoId, workspaceId, misionId },
      select: { id: true },
    });
    if (!v) throw new NotFoundException('Vínculo no encontrado');
    await this.prisma.misionVinculo.delete({ where: { id: vinculoId } });
  }

  // --- Validaciones por workspace (no conceden acceso; solo garantizan pertenencia al tenant) -----------------------

  private assertTransicion(desde: EstadoMision, hacia: EstadoMision): void {
    if (!esTransicionValida(desde, hacia)) {
      throw new ConflictException(`Transición de misión no permitida: ${desde} -> ${hacia}`);
    }
  }

  private async assertUsuarioEnWorkspace(workspaceId: string, userId: string): Promise<void> {
    const m = await this.prisma.membership.findFirst({ where: { userId, workspaceId }, select: { id: true } });
    if (!m) throw new NotFoundException('Usuario no pertenece al workspace');
  }

  private async assertAgenteEnWorkspace(workspaceId: string, agentId: string): Promise<void> {
    const a = await this.prisma.agent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } });
    if (!a) throw new NotFoundException('Agente no encontrado en el workspace');
  }

  private async assertCanalMisionEnWorkspace(workspaceId: string, canalId: string): Promise<void> {
    const c = await this.prisma.canal.findFirst({ where: { id: canalId, workspaceId }, select: { tipo: true } });
    if (!c) throw new NotFoundException('Canal no encontrado en el workspace');
    if (c.tipo !== 'MISION') throw new BadRequestException('El canal enlazado debe ser de tipo MISION');
  }

  private async assertOrgUnitEnWorkspace(workspaceId: string, orgUnitId: string): Promise<void> {
    const o = await this.prisma.orgUnit.findFirst({ where: { id: orgUnitId, workspaceId }, select: { id: true } });
    if (!o) throw new NotFoundException('Unidad organizacional no encontrada en el workspace');
  }

  private async assertObjetivoEnWorkspace(workspaceId: string, objetivoId: string): Promise<void> {
    const o = await this.prisma.objetivo.findFirst({ where: { id: objetivoId, workspaceId }, select: { id: true } });
    if (!o) throw new NotFoundException('Objetivo no encontrado en el workspace');
  }

  private async assertTareaEnWorkspace(workspaceId: string, tareaId: string): Promise<void> {
    const t = await this.prisma.tarea.findFirst({ where: { id: tareaId, workspaceId }, select: { id: true } });
    if (!t) throw new NotFoundException('Tarea no encontrada en el workspace');
  }

  private auditar(
    auth: AuthContext,
    userId: string,
    action: string,
    misionId: string,
    resumen: string,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.append(auth.workspaceId, {
      actorType: 'USER',
      actorId: userId,
      action,
      targetType: 'MisionTransversal',
      targetId: misionId,
      resumen,
      metadata,
    });
  }
}
