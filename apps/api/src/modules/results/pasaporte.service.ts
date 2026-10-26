import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import { componerDocumento, type AgenteInput, type PasaporteComposerInput } from './pasaporte.composer';

/**
 * Pasaporte de resultado (ADR 0014 · E14): emisión, lectura, verificación y exportación de la cadena de custodia
 * verificable de un `ContratoResultado` ACEPTADO. Se compone por REFERENCIAS + HASHES (nunca copia datos sensibles,
 * RF35) con el algoritmo determinista de `pasaporte.composer`, y se ANCLA a la cadena de hash del `AuditLog` (E13)
 * registrando el hecho `PASAPORTE_EMITIDO`: el pasaporte hereda el `seq`/`hash` de esa entrada. Append-only: una
 * reapertura emite un pasaporte nuevo con `reemplazaAId`, nunca reescribe el anterior. Multi-tenant: todo filtra por
 * `workspaceId` (de `@CurrentAuth`, nunca del cuerpo).
 *
 * Nota de rendimiento: para el MVP la emisión corre SÍNCRONA en el endpoint (lecturas acotadas al workspace). El ADR
 * prevé encolarla en BullMQ (`WORKFLOW_QUEUE`) cuando el volumen lo exija; se deja fuera del endpoint de aceptación para
 * no bloquearlo.
 */
@Injectable()
export class PasaporteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Emite el pasaporte de un contrato ACEPTADO. 404 si no existe en el workspace; 409 si no está ACEPTADO. */
  async emitir(auth: AuthContext, contratoId: string) {
    const contrato = await this.prisma.contratoResultado.findFirst({
      where: { id: contratoId, workspaceId: auth.workspaceId },
      include: { tarea: true },
    });
    if (!contrato) throw new NotFoundException('Contrato de resultado no encontrado');
    if (contrato.estado !== 'ACEPTADO') {
      throw new ConflictException(
        `Solo se emite pasaporte de un resultado ACEPTADO (estado actual: ${contrato.estado})`,
      );
    }

    const entrada = await this.reunirReferencias(auth.workspaceId, contrato.id);
    const { documentoRef, documentHash } = componerDocumento(entrada);

    // Pasaporte anterior (si el resultado se reabrió/corrigió): la reemisión es append-only.
    const previo = await this.prisma.pasaporteResultado.findFirst({
      where: { workspaceId: auth.workspaceId, contratoResultadoId: contrato.id },
      orderBy: { createdAt: 'desc' },
    });

    // Id explícito para poder anclar la entrada de auditoría al pasaporte ANTES de persistirlo (la entrada necesita el
    // targetId; el pasaporte necesita el seq/id de la entrada). El orden es: auditar -> persistir con el ancla.
    const pasaporteId = randomUUID();
    const ancla = await this.audit.append(auth.workspaceId, {
      actorType: auth.userId ? 'USER' : 'SYSTEM',
      actorId: auth.userId ?? null,
      action: AUDIT_ACTIONS.PASAPORTE_EMITIDO,
      targetType: 'PasaporteResultado',
      targetId: pasaporteId,
      resumen: `Pasaporte de resultado emitido para el contrato "${contrato.resultadoEsperado}"`,
      metadata: { documentHash, contratoResultadoId: contrato.id },
    });

    try {
      return await this.prisma.pasaporteResultado.create({
        data: {
          id: pasaporteId,
          workspaceId: auth.workspaceId,
          contratoResultadoId: contrato.id,
          tareaId: contrato.tareaId,
          documentoRef: documentoRef as unknown as Prisma.InputJsonValue,
          documentHash,
          auditSeq: ancla.seq,
          auditEntryId: ancla.id,
          reemplazaAId: previo?.id ?? null,
          emitidoPorUserId: auth.userId ?? null,
        },
      });
    } catch (e) {
      // `@@unique([workspaceId, contratoResultadoId, documentHash])`: emitir sin que nada haya cambiado desde el último
      // pasaporte es un no-op que se rechaza (no se duplica una hoja de vida idéntica). La entrada de auditoría ya
      // quedó registrada (append-only), lo que deja traza del intento.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('El resultado no ha cambiado desde el último pasaporte emitido');
      }
      throw e;
    }
  }

  async get(workspaceId: string, id: string) {
    const pasaporte = await this.prisma.pasaporteResultado.findFirst({ where: { id, workspaceId } });
    if (!pasaporte) throw new NotFoundException('Pasaporte de resultado no encontrado');
    return pasaporte;
  }

  /**
   * Lista los pasaportes emitidos para un `ContratoResultado`, el más reciente primero. Puede haber varios
   * (append-only: cada reemisión encadena con `reemplazaAId`). Cada elemento tiene el mismo shape que `get`. Valida que
   * el contrato pertenezca al workspace: si no existe en el workspace responde 404 (nunca filtra recursos ajenos).
   * Devuelve `[]` cuando el contrato existe pero aún no tiene pasaportes.
   */
  async listarPorContrato(workspaceId: string, contratoId: string) {
    const contrato = await this.prisma.contratoResultado.findFirst({
      where: { id: contratoId, workspaceId },
      select: { id: true },
    });
    if (!contrato) throw new NotFoundException('Contrato de resultado no encontrado');

    return this.prisma.pasaporteResultado.findMany({
      where: { workspaceId, contratoResultadoId: contratoId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Verifica el pasaporte de extremo a extremo: (1) recompone el `documentHash` desde las referencias VIGENTES y lo
   * compara con el almacenado (detecta alteración de lo referenciado o de la propia fila); (2) comprueba que la entrada
   * de ancla existe y que su `seq`/acción/`targetId`/`documentHash` cuadran; (3) comprueba que la cadena de auditoría
   * del workspace está intacta (reusa `AuditService.verificarCadena`).
   */
  async verify(workspaceId: string, id: string) {
    const pasaporte = await this.get(workspaceId, id);
    const ancla = {
      auditSeq: pasaporte.auditSeq,
      auditEntryId: pasaporte.auditEntryId,
      hash: null as string | null,
    };

    const contrato = await this.prisma.contratoResultado.findFirst({
      where: { id: pasaporte.contratoResultadoId, workspaceId },
    });
    if (!contrato) {
      return { ok: false, motivo: 'CONTRATO_FALTANTE', emitidoEl: pasaporte.createdAt, ancla };
    }

    // (1) Recomputar desde las referencias vigentes.
    const entrada = await this.reunirReferencias(workspaceId, contrato.id);
    const { documentHash: recomputado } = componerDocumento(entrada);
    if (recomputado !== pasaporte.documentHash) {
      return { ok: false, motivo: 'REFERENCIA_ALTERADA', emitidoEl: pasaporte.createdAt, ancla };
    }

    // (2) La entrada de ancla existe y cuadra.
    const entry = await this.prisma.auditLog.findFirst({ where: { id: pasaporte.auditEntryId, workspaceId } });
    if (!entry) {
      return { ok: false, motivo: 'ANCLA_FALTANTE', emitidoEl: pasaporte.createdAt, ancla };
    }
    ancla.hash = entry.hash;
    const metadata = (entry.metadata ?? {}) as { documentHash?: string };
    const anclaCuadra =
      entry.seq === pasaporte.auditSeq &&
      entry.action === AUDIT_ACTIONS.PASAPORTE_EMITIDO &&
      entry.targetId === pasaporte.id &&
      metadata.documentHash === pasaporte.documentHash;
    if (!anclaCuadra) {
      return { ok: false, motivo: 'ANCLA_NO_CUADRA', emitidoEl: pasaporte.createdAt, ancla };
    }

    // (3) La cadena del workspace está intacta.
    const cadena = await this.audit.verificarCadena(workspaceId);
    if (!cadena.ok) {
      return {
        ok: false,
        motivo: `CADENA_${cadena.motivo ?? 'ROTA'}`,
        emitidoEl: pasaporte.createdAt,
        ancla,
      };
    }

    return { ok: true, emitidoEl: pasaporte.createdAt, ancla };
  }

  /**
   * Exporta el cuerpo canónico + ancla + instrucciones para que un tercero recompute el `documentHash` SIN acceso a los
   * datos sensibles (solo ve referencias y hashes). Legible por `VIEWER`+ con alcance al recurso.
   */
  async export(workspaceId: string, id: string) {
    const pasaporte = await this.get(workspaceId, id);
    const entry = await this.prisma.auditLog.findFirst({ where: { id: pasaporte.auditEntryId, workspaceId } });
    return {
      pasaporte: {
        id: pasaporte.id,
        contratoResultadoId: pasaporte.contratoResultadoId,
        tareaId: pasaporte.tareaId,
        reemplazaAId: pasaporte.reemplazaAId,
        emitidoPorUserId: pasaporte.emitidoPorUserId,
        emitidoEl: pasaporte.createdAt,
      },
      documentoRef: pasaporte.documentoRef,
      documentHash: pasaporte.documentHash,
      ancla: {
        auditSeq: pasaporte.auditSeq,
        auditEntryId: pasaporte.auditEntryId,
        auditHash: entry?.hash ?? null,
        prevHash: entry?.prevHash ?? null,
      },
      instrucciones: {
        algoritmo: 'sha256(canonicalize(documentoRef)) === documentHash',
        descripcion:
          'Serialice `documentoRef` de forma canónica (claves ordenadas recursivamente, mismas reglas que audit.hashing) ' +
          'y calcule su sha256: debe coincidir con `documentHash`. Luego confirme que la entrada `auditEntryId` existe ' +
          'en el AuditLog del workspace, que su metadata.documentHash coincide y que la cadena verifica (GET .../verify). ' +
          'Solo se exponen referencias y hashes: nunca datos sensibles.',
      },
    };
  }

  /**
   * Reúne, acotadas al workspace, todas las referencias que componen el pasaporte. No copia contenidos sensibles: por
   * cada entidad extrae solo los campos que identifican la referencia y su estado relevante (de los que el composer
   * calcula el hash). El resultado es determinista para el mismo estado de la BD.
   */
  private async reunirReferencias(workspaceId: string, contratoId: string): Promise<PasaporteComposerInput> {
    const contrato = await this.prisma.contratoResultado.findFirstOrThrow({
      where: { id: contratoId, workspaceId },
      include: { tarea: true, validaciones: { orderBy: { createdAt: 'asc' } } },
    });
    const tareaId = contrato.tareaId;

    const [transferencias, mensajes, ejecuciones, aprobaciones] = await Promise.all([
      tareaId ? this.prisma.contratoTransferencia.findMany({ where: { workspaceId, tareaId } }) : Promise.resolve([]),
      tareaId ? this.prisma.mensajeAgente.findMany({ where: { workspaceId, tareaId } }) : Promise.resolve([]),
      tareaId ? this.prisma.execution.findMany({ where: { workspaceId, tareaId } }) : Promise.resolve([]),
      tareaId ? this.prisma.aprobacion.findMany({ where: { workspaceId, tareaId } }) : Promise.resolve([]),
    ]);

    const executionIds = ejecuciones.map((e) => e.id);
    const usageRecords =
      executionIds.length > 0
        ? await this.prisma.usageRecord.findMany({ where: { workspaceId, executionId: { in: executionIds } } })
        : [];

    // Entradas de auditoría relevantes (contrato/tarea). Las entradas PASAPORTE_EMITIDO apuntan al pasaporte
    // (targetId = pasaporteId), no al contrato/tarea, así que quedan excluidas: el ancla es estable entre emisiones.
    const targetIds = [contratoId, ...(tareaId ? [tareaId] : [])];
    const auditEntries = await this.prisma.auditLog.findMany({
      where: { workspaceId, targetId: { in: targetIds } },
      select: { seq: true },
    });

    const agentes = await this.componerAgentes(workspaceId, contrato, transferencias, mensajes);

    return {
      contrato: {
        id: contrato.id,
        version: contrato.version,
        estado: contrato.estado,
        tipoResultado: contrato.tipoResultado,
        nivelRiesgo: contrato.nivelRiesgo,
        resultadoEsperado: contrato.resultadoEsperado,
        indicador: contrato.indicador,
        responsableAgentId: contrato.responsableAgentId,
        duenoUserId: contrato.duenoUserId,
        comprometidoAt: contrato.comprometidoAt?.toISOString() ?? null,
      },
      tarea: contrato.tarea
        ? {
            id: contrato.tarea.id,
            titulo: contrato.tarea.titulo,
            estado: contrato.tarea.estado,
            responsableAgentId: contrato.tarea.responsableAgentId,
            duenoUserId: contrato.tarea.duenoUserId,
            criterioAceptacion: contrato.tarea.criterioAceptacion,
          }
        : null,
      agentes,
      transferencias: transferencias.map((t) => ({
        id: t.id,
        secuenciaSegmento: t.secuenciaSegmento,
        fromAgentId: t.fromAgentId,
        toAgentId: t.toAgentId,
        estado: t.estado,
        createdAt: t.createdAt.toISOString(),
        decididoAt: t.decididoAt?.toISOString() ?? null,
      })),
      mensajes: mensajes.map((m) => ({
        id: m.id,
        messageId: m.messageId,
        tipo: m.tipo,
        emisorAgentId: m.emisorAgentId,
        destinatarioAgentId: m.destinatarioAgentId,
        enviadoAt: m.enviadoAt.toISOString(),
        resueltoAt: m.resueltoAt?.toISOString() ?? null,
      })),
      ejecuciones: ejecuciones.map((e) => ({
        id: e.id,
        status: e.status,
        workflowId: e.workflowId,
        secuenciaSegmento: e.secuenciaSegmento,
        finishedAt: e.finishedAt?.toISOString() ?? null,
      })),
      // Vínculo directo Tarea->ConnectorOperation aún no existe en el runtime (ver comentario en el composer): lista
      // vacía a propósito; NO se inventan datos. Se poblará cuando el runtime enlace la operación con la ejecución.
      conectores: [],
      aprobaciones: aprobaciones.map((a) => ({
        id: a.id,
        estado: a.estado,
        tipoAccion: a.tipoAccion,
        riesgo: a.riesgo,
        contentHash: a.contentHash,
      })),
      validaciones: contrato.validaciones.map((v) => ({
        id: v.id,
        modo: v.modo,
        veredicto: v.veredicto,
        verificadorAgentId: v.verificadorAgentId,
        validadorUserId: v.validadorUserId,
        motivo: v.motivo,
        version: v.version,
        createdAt: v.createdAt.toISOString(),
      })),
      usageRecords: usageRecords.map((u) => ({
        id: u.id,
        executionId: u.executionId,
        model: u.model,
        providerId: u.providerId,
        costUsd: u.costUsd.toString(),
        createdAt: u.createdAt.toISOString(),
      })),
      auditSeqs: auditEntries.map((e) => e.seq),
    };
  }

  /** Reúne los empleados digitales que intervinieron (referencias blandas), enriquecidos con versión/responsable. */
  private async componerAgentes(
    workspaceId: string,
    contrato: { responsableAgentId: string | null; tarea: { responsableAgentId: string | null } | null },
    transferencias: { fromAgentId: string | null; toAgentId: string | null }[],
    mensajes: { emisorAgentId: string | null; destinatarioAgentId: string | null }[],
  ): Promise<AgenteInput[]> {
    const roles = new Map<string, Set<string>>();
    const agregar = (agentId: string | null, rol: string) => {
      if (!agentId) return;
      if (!roles.has(agentId)) roles.set(agentId, new Set());
      roles.get(agentId)!.add(rol);
    };
    agregar(contrato.responsableAgentId, 'ejecutor');
    agregar(contrato.tarea?.responsableAgentId ?? null, 'ejecutor');
    for (const t of transferencias) {
      agregar(t.fromAgentId, 'transferencia_origen');
      agregar(t.toAgentId, 'transferencia_destino');
    }
    for (const m of mensajes) {
      agregar(m.emisorAgentId, 'mensaje_emisor');
      agregar(m.destinatarioAgentId, 'mensaje_destinatario');
    }

    const agentIds = [...roles.keys()];
    // Referencias blandas: un `agentId` puede no corresponder a un `Agent` real (p. ej. identificadores de prueba o
    // agentes ya borrados). Solo se enriquece version/responsable cuando el `Agent` existe en el workspace.
    const existentes =
      agentIds.length > 0
        ? await this.prisma.agent.findMany({
            where: { id: { in: agentIds }, workspaceId },
            select: { id: true, responsableUserId: true, versions: { orderBy: { version: 'desc' }, take: 1 } },
          })
        : [];
    const mapa = new Map(existentes.map((a) => [a.id, a]));

    return agentIds.map((agentId) => {
      const a = mapa.get(agentId);
      return {
        agentId,
        roles: [...roles.get(agentId)!].sort(),
        responsableUserId: a?.responsableUserId ?? null,
        agentVersionId: a?.versions[0]?.id ?? null,
      };
    });
  }
}
