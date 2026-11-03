import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ActorMisionEvento, MisionEvento, TipoMisionEvento } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import {
  clasificarBloqueo,
  clasificarCompromiso,
  delegacionPermitida,
  evaluarCambioPresupuesto,
  proyectarSupervision,
  requiereAprobacionHumana,
  resolverContradiccion,
  validarAprobacion,
  type EntradaBloqueo,
  type EntradaCompromiso,
  type OrdenCoordinacion,
  type ResultadoAprobacion,
  type ResultadoBloqueo,
  type ResultadoContradiccion,
  type ResultadoDelegacion,
  type ResultadoPresupuesto,
  type SolicitudAprobacion,
  type SolicitudPresupuesto,
} from './mission.governance';
import { conSchemaVersion } from './mission.payload';

/**
 * Cableado del **gobierno de la continuidad del coordinador** de misiones transversales (ADR 0016 · Inc.3 · compuerta
 * E-B). Es el punto de INTEGRACIÓN entre la lógica pura (`mission.governance.ts`, especificación viva), el estado
 * persistido (Postgres: `MisionEvento` append-only) y la auditoría inmutable (E13). NO introduce cola ni base nueva.
 *
 * GATED / NO OPERATIVO POR DEFECTO. Cada capacidad se habilita por `Workspace.coordinadorGobiernoActivo` (opt-in,
 * **apagado por defecto**). Con el flag APAGADO, TODA llamada devuelve `{ aplicado: false, motivo: 'GOBIERNO_COORDINADOR_
 * DESACTIVADO' }` y **no produce ningún efecto**: no persiste eventos, no escribe auditoría, no toca jerarquía, gobierno
 * ni el reconciliador. Activar el flag es la HABILITACIÓN OPERATIVA por etapas (decisión del patrocinador), no de este
 * código.
 *
 * Invariantes (D4/D5 del ADR 0016; QA10/QA13/QA14). Incluso con el flag ENCENDIDO, este servicio:
 *  - **No autoaprueba ni amplía permisos/presupuesto** (QA13): lo irreversible/alto impacto solo PROPONE y SOLICITA
 *    decisión humana (bandeja E6); nunca ejecuta el efecto, nunca mueve presupuesto, nunca concede accesos.
 *  - **Detiene y escala** ante contradicción sin regla inequívoca (QA10); nunca "elige por su cuenta".
 *  - **No pierde estado** al suspender al coordinador (QA14): el trabajo autorizado vive en Postgres; aquí solo se
 *    registra la suplencia/continuidad; reasignar/suspender de verdad es acción humana (E6).
 *  - **Supervisar no concede acceso** (ADR 0007): solo proyecta metadatos de desempeño a la lista blanca.
 *  - **No borra auditoría**: `AuditService` es append-only; este servicio solo `append`.
 */
@Injectable()
export class MissionCoordinatorGovernanceService {
  private readonly logger = new Logger(MissionCoordinatorGovernanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Motivo único y auditable cuando el gobierno del coordinador está apagado (compuerta E-B, opt-in por workspace). */
  static readonly MOTIVO_GATED = 'GOBIERNO_COORDINADOR_DESACTIVADO' as const;

  /** ¿Está activado el opt-in del gobierno del coordinador para este workspace? Apagado por defecto. */
  async gobiernoActivo(workspaceId: string): Promise<boolean> {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { coordinadorGobiernoActivo: true },
    });
    return ws?.coordinadorGobiernoActivo === true;
  }

  private gated<T extends object>(
    extra: T,
  ): { aplicado: false; motivo: typeof MissionCoordinatorGovernanceService.MOTIVO_GATED } & T {
    return { aplicado: false, motivo: MissionCoordinatorGovernanceService.MOTIVO_GATED, ...extra };
  }

  /** Verifica que la misión exista en el workspace (y así todo filtra por tenant). */
  private async assertMision(workspaceId: string, misionId: string): Promise<void> {
    const m = await this.prisma.misionTransversal.findFirst({
      where: { id: misionId, workspaceId },
      select: { id: true },
    });
    if (!m) throw new NotFoundException('Misión no encontrada');
  }

  /** Persiste un hecho de coordinación append-only, con `schemaVersion` en el payload saneado. */
  private async registrarEvento(
    workspaceId: string,
    misionId: string,
    tipo: TipoMisionEvento,
    actorTipo: ActorMisionEvento,
    actorId: string | null,
    payload: Record<string, unknown>,
    requiereDecision: boolean,
  ): Promise<MisionEvento> {
    return this.prisma.misionEvento.create({
      data: {
        workspaceId,
        misionId,
        tipo,
        actorTipo,
        actorId,
        payload: conSchemaVersion(payload) as Prisma.InputJsonValue,
        requiereDecision,
      },
    });
  }

  /** Mapea el actor del evento al tipo de actor de la auditoría (E13). */
  private actorAuditoria(actorTipo: ActorMisionEvento): 'USER' | 'AGENT' | 'SYSTEM' {
    return actorTipo === 'HUMANO' ? 'USER' : actorTipo === 'AGENTE' ? 'AGENT' : 'SYSTEM';
  }

  private auditar(
    workspaceId: string,
    action: string,
    misionId: string,
    actorTipo: ActorMisionEvento,
    actorId: string | null,
    resumen: string,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.append(workspaceId, {
      actorType: this.actorAuditoria(actorTipo),
      actorId,
      action,
      targetType: 'MisionTransversal',
      targetId: misionId,
      resumen,
      metadata,
    });
  }

  // --- Seguimiento de compromisos (lectura/correlación; no ejecuta efecto) ------------------------------------------

  async seguimientoCompromisos(
    workspaceId: string,
    misionId: string,
    coordinadorAgentId: string,
    compromisos: readonly (EntradaCompromiso & { vinculoId?: string })[],
  ) {
    if (!(await this.gobiernoActivo(workspaceId))) return this.gated({ estados: [] as string[] });
    await this.assertMision(workspaceId, misionId);
    const estados = compromisos.map((c) => ({ vinculoId: c.vinculoId ?? null, estado: clasificarCompromiso(c) }));
    const enRiesgo = estados.filter((e) => e.estado === 'EN_RIESGO' || e.estado === 'VENCIDO').length;
    await this.registrarEvento(
      workspaceId,
      misionId,
      'SEGUIMIENTO',
      'AGENTE',
      coordinadorAgentId,
      { estados, enRiesgo },
      false,
    );
    await this.auditar(
      workspaceId,
      AUDIT_ACTIONS.MISION_COORDINADOR_SEGUIMIENTO,
      misionId,
      'AGENTE',
      coordinadorAgentId,
      `Seguimiento de ${estados.length} compromisos (${enRiesgo} en riesgo/vencidos)`,
      { total: estados.length, enRiesgo },
    );
    return { aplicado: true as const, estados };
  }

  // --- Detección de bloqueos (correlación; escala si no hay regla inequívoca) ---------------------------------------

  async evaluarBloqueo(
    workspaceId: string,
    misionId: string,
    coordinadorAgentId: string,
    entrada: EntradaBloqueo,
    refs: Record<string, unknown> = {},
  ): Promise<{ aplicado: false; motivo: string } | ({ aplicado: true } & ResultadoBloqueo)> {
    if (!(await this.gobiernoActivo(workspaceId))) return this.gated({});
    await this.assertMision(workspaceId, misionId);
    const resultado = clasificarBloqueo(entrada);
    await this.registrarEvento(
      workspaceId,
      misionId,
      'BLOQUEO_DETECTADO',
      'AGENTE',
      coordinadorAgentId,
      { origen: entrada.origen, severidad: resultado.severidad, refs },
      resultado.requiereDecisionHumana,
    );
    await this.auditar(
      workspaceId,
      AUDIT_ACTIONS.MISION_COORDINADOR_BLOQUEO,
      misionId,
      'AGENTE',
      coordinadorAgentId,
      `Bloqueo ${entrada.origen} severidad ${resultado.severidad}`,
      {
        origen: entrada.origen,
        severidad: resultado.severidad,
        requiereDecisionHumana: resultado.requiereDecisionHumana,
      },
    );
    // Sin regla inequívoca → además se solicita decisión humana (QA10): se detiene la parte afectada, no se fuerza.
    if (resultado.requiereDecisionHumana) {
      await this.solicitarDecisionHumana(workspaceId, misionId, coordinadorAgentId, 'BLOQUEO_SIN_REGLA', {
        origen: entrada.origen,
      });
    }
    return { aplicado: true, ...resultado };
  }

  // --- Solicitud de aprobación de una acción de alto impacto (no autoaprobación, QA13) ------------------------------

  /**
   * El coordinador PROPONE una acción. Si es de alto impacto, SOLO crea la solicitud de decisión humana (bandeja E6) y
   * nunca ejecuta el efecto. Si la "aprobación" la intenta el propio coordinador (autoaprobación), se BLOQUEA y audita
   * (QA13). Nunca aprueba por su cuenta.
   */
  async proponerAccion(
    workspaceId: string,
    misionId: string,
    solicitud: SolicitudAprobacion,
  ): Promise<
    | { aplicado: false; motivo: string }
    | { aplicado: true; requiereAprobacionHumana: boolean; validacion: ResultadoAprobacion }
  > {
    if (!(await this.gobiernoActivo(workspaceId))) return this.gated({});
    await this.assertMision(workspaceId, misionId);

    const altoImpacto = requiereAprobacionHumana(solicitud.accion);
    const validacion = validarAprobacion(solicitud);

    // Autoaprobación o aprobador no humano de una acción de alto impacto → BLOQUEO + auditoría (QA13).
    if (altoImpacto && !validacion.valida && validacion.motivo !== 'NO_REQUIERE_APROBACION') {
      await this.auditar(
        workspaceId,
        AUDIT_ACTIONS.MISION_COORDINADOR_AUTOAPROBACION_BLOQUEADA,
        misionId,
        'AGENTE',
        solicitud.solicitanteId,
        `Aprobación inválida de ${solicitud.accion}: ${validacion.motivo}`,
        { accion: solicitud.accion, motivo: validacion.motivo },
      );
      throw new ForbiddenException(
        `El coordinador no aprueba acciones de alto impacto por su cuenta (${validacion.motivo}); exige decisión humana (QA13)`,
      );
    }

    // Acción de alto impacto bien planteada: se registra la SOLICITUD de decisión humana; el efecto no se ejecuta aquí.
    if (altoImpacto) {
      await this.solicitarDecisionHumana(workspaceId, misionId, solicitud.solicitanteId, solicitud.accion, {
        aprobadorId: solicitud.aprobadorId,
      });
    }
    return { aplicado: true, requiereAprobacionHumana: altoImpacto, validacion };
  }

  // --- Presupuesto: el coordinador no amplía ni mueve (RF40/QA13) ---------------------------------------------------

  async evaluarPresupuesto(
    workspaceId: string,
    misionId: string,
    coordinadorAgentId: string,
    solicitud: SolicitudPresupuesto,
  ): Promise<{ aplicado: false; motivo: string } | ({ aplicado: true } & ResultadoPresupuesto)> {
    if (!(await this.gobiernoActivo(workspaceId))) return this.gated({});
    await this.assertMision(workspaceId, misionId);
    const resultado = evaluarCambioPresupuesto(solicitud);
    // El servicio NUNCA aplica el cambio de presupuesto: si exige aprobación humana, solo la solicita.
    if (resultado.requiereAprobacionHumana) {
      await this.solicitarDecisionHumana(workspaceId, misionId, coordinadorAgentId, 'MOVER_PRESUPUESTO', {
        motivo: resultado.motivo,
      });
    }
    return { aplicado: true, ...resultado };
  }

  // --- Delegación por subconjunto (ADR 0014/E5): asignar/supervisar nunca amplía ------------------------------------

  delegarPermisos(permisosDelegante: readonly string[], permisosSolicitados: readonly string[]): ResultadoDelegacion {
    // Función determinista y pura: no persiste ni requiere flag. Nunca amplía (solo intersección).
    return delegacionPermitida(permisosDelegante, permisosSolicitados);
  }

  // --- Supervisión: proyecta metadatos; NO concede acceso (ADR 0007) ------------------------------------------------

  async supervisar(
    workspaceId: string,
    misionId: string,
    coordinadorAgentId: string,
    objetivoAgentId: string,
    vista: Record<string, unknown>,
  ) {
    if (!(await this.gobiernoActivo(workspaceId))) return this.gated({ metadatos: {} });
    await this.assertMision(workspaceId, misionId);
    const metadatos = proyectarSupervision(vista); // descarta todo lo que no sea metadato permitido
    await this.registrarEvento(
      workspaceId,
      misionId,
      'SUPERVISION',
      'AGENTE',
      coordinadorAgentId,
      { objetivoAgentId, metadatos },
      false,
    );
    await this.auditar(
      workspaceId,
      AUDIT_ACTIONS.MISION_COORDINADOR_SUPERVISION,
      misionId,
      'AGENTE',
      coordinadorAgentId,
      `Supervisión de metadatos del agente ${objetivoAgentId}`,
      { objetivoAgentId, campos: Object.keys(metadatos) },
    );
    return { aplicado: true as const, metadatos };
  }

  // --- Resolución de contradicciones (QA10): o gana una orden, o se detiene y escala --------------------------------

  async resolverContradiccion(
    workspaceId: string,
    misionId: string,
    coordinadorAgentId: string,
    ordenes: readonly OrdenCoordinacion[],
  ): Promise<{ aplicado: false; motivo: string } | ({ aplicado: true } & ResultadoContradiccion)> {
    if (!(await this.gobiernoActivo(workspaceId))) return this.gated({});
    await this.assertMision(workspaceId, misionId);
    const resultado = resolverContradiccion(ordenes);
    if (resultado.decision === 'DETENER_Y_ESCALAR') {
      await this.registrarEvento(
        workspaceId,
        misionId,
        'CONTRADICCION',
        'AGENTE',
        coordinadorAgentId,
        { ordenes: ordenes.map((o) => o.id), decision: resultado.decision },
        true,
      );
      await this.auditar(
        workspaceId,
        AUDIT_ACTIONS.MISION_COORDINADOR_CONTRADICCION,
        misionId,
        'AGENTE',
        coordinadorAgentId,
        'Contradicción sin regla inequívoca: se detiene y se pide decisión humana (QA10)',
        { ordenes: ordenes.map((o) => o.id) },
      );
      await this.solicitarDecisionHumana(workspaceId, misionId, coordinadorAgentId, 'RESOLVER_CONTRADICCION', {});
    }
    return { aplicado: true, ...resultado };
  }

  // --- Escalamiento / solicitud de decisión humana (no ejecuta efecto) ----------------------------------------------

  /** Crea la solicitud de decisión humana (bandeja E6): registra el hecho y audita; NO ejecuta ningún efecto. */
  async solicitarDecisionHumana(
    workspaceId: string,
    misionId: string,
    coordinadorAgentId: string,
    /** Código auditable del motivo (una `AccionCoordinador` o un código corto como `BLOQUEO_SIN_REGLA`). */
    motivo: string,
    detalle: Record<string, unknown>,
  ): Promise<MisionEvento> {
    const evento = await this.registrarEvento(
      workspaceId,
      misionId,
      'DECISION_HUMANA_SOLICITADA',
      'AGENTE',
      coordinadorAgentId,
      { motivo, ...detalle },
      true,
    );
    await this.auditar(
      workspaceId,
      AUDIT_ACTIONS.MISION_COORDINADOR_DECISION_SOLICITADA,
      misionId,
      'AGENTE',
      coordinadorAgentId,
      `Solicitud de decisión humana: ${motivo}`,
      { motivo },
    );
    return evento;
  }

  // --- Continuidad: suplencia al suspender al coordinador (QA14) -----------------------------------------------------

  /**
   * Al SUSPENDER al coordinador (acción humana E6, fuera de aquí), registra la CONTINUIDAD: resuelve el suplente humano
   * (`Agent.suplenteUserId`) o el supervisor (`reportaAAgentId`) de E3 y deja constancia de que el trabajo autorizado
   * SIGUE (su estado vive en Postgres). NO reasigna ni suspende por su cuenta: eso es acción humana.
   */
  async continuidadPorSuspension(workspaceId: string, misionId: string, coordinadorAgentId: string) {
    if (!(await this.gobiernoActivo(workspaceId)))
      return this.gated({ suplenteUserId: null as string | null, supervisorAgentId: null as string | null });
    await this.assertMision(workspaceId, misionId);
    const coordinador = await this.prisma.agent.findFirst({
      where: { id: coordinadorAgentId, workspaceId },
      select: { suplenteUserId: true, reportaAAgentId: true },
    });
    const suplenteUserId = coordinador?.suplenteUserId ?? null;
    const supervisorAgentId = coordinador?.reportaAAgentId ?? null;
    await this.registrarEvento(
      workspaceId,
      misionId,
      'CONTINUIDAD',
      'SISTEMA',
      coordinadorAgentId,
      { coordinadorAgentId, suplenteUserId, supervisorAgentId },
      // Si no hay suplente ni supervisor, hace falta decisión humana para dar continuidad.
      !suplenteUserId && !supervisorAgentId,
    );
    await this.auditar(
      workspaceId,
      AUDIT_ACTIONS.MISION_COORDINADOR_CONTINUIDAD,
      misionId,
      'SISTEMA',
      coordinadorAgentId,
      'Continuidad del coordinador: suplencia registrada (el trabajo autorizado sigue)',
      { suplenteUserId, supervisorAgentId },
    );
    return { aplicado: true as const, suplenteUserId, supervisorAgentId };
  }
}
