import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CanalCuenta, EstadoLlamadaVoz, Prisma, VoiceCall } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { AuthContext } from '../../../common/decorators/current-user.decorator';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ActionGatewayService } from '../../governance/actions/action-gateway.service';
import { SecretsService } from '../../workspaces/secrets.service';
import { VOICE_ADAPTERS, type VoiceProvider } from './domain/voice-provider';
import type { VoiceAccionSensible, VoiceRequisitos, VoiceRuntime } from './domain/voice.types';
import type { CreateVoiceCuentaDto, IniciarLlamadaDto, TransferirLlamadaDto, TurnoLlamadaDto } from './dto/voice.dto';
import { validarCapabilitiesVoz } from './voice-capabilities';

const json = (v: unknown) => (v ?? {}) as Prisma.InputJsonValue;

/** Resultado de gobierno (E6) de una acción sensible surgida en la llamada (capa d). */
export interface GobiernoLlamada {
  tipoAccion: string;
  estado: 'PERMITIDA' | 'REQUIERE_APROBACION' | 'DENEGADA';
  motivo: string;
  aprobacionId?: string;
}

/**
 * Servicio del dominio "voz" (ADR 0015 D2), sandbox SIN gasto. Gestiona cuentas de voz (reusa `CanalCuenta` tipo VOZ,
 * identidad/credenciales por empresa) y el ciclo de una llamada por el adaptador del proveedor: iniciar → turnos →
 * transferir → finalizar. Multi-tenant estricto: todo filtra por `workspaceId` de `@CurrentAuth()`. Las credenciales se
 * referencian por `secretRef` (bóveda), nunca en claro.
 *
 * Capa (d) de gobierno: toda ACCIÓN SENSIBLE que el motor conversacional proponga durante un turno pasa por el
 * `ActionGateway` (E6) ANTES de tener efecto; el proveedor nunca ejecuta negocio. Esto aplica incluso al proveedor
 * `simulado`: la llamada no sale a la red, pero la acción con efecto sigue gobernada. El audio/transcripción son dato NO
 * confiable y NO se persisten crudos (grabación OFF por defecto; `transcripcionRef` es solo referencia).
 */
@Injectable()
export class VoiceService {
  private readonly adapters: Map<string, VoiceProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly gateway: ActionGatewayService,
    private readonly audit: AuditService,
    @Inject(VOICE_ADAPTERS) adapters: VoiceProvider[],
  ) {
    this.adapters = new Map();
    for (const a of adapters) {
      for (const clave of [a.proveedor, ...(a.alias ?? [])]) {
        if (this.adapters.has(clave)) throw new Error(`Clave de proveedor de voz duplicada: ${clave}`);
        this.adapters.set(clave, a);
      }
    }
  }

  // ---------- Cuentas de voz (CanalCuenta tipo VOZ) ----------
  listCuentas(workspaceId: string) {
    return this.prisma.canalCuenta.findMany({ where: { workspaceId, tipo: 'VOZ' }, orderBy: { updatedAt: 'desc' } });
  }

  async getCuenta(workspaceId: string, id: string): Promise<CanalCuenta> {
    const cuenta = await this.prisma.canalCuenta.findFirst({ where: { id, workspaceId, tipo: 'VOZ' } });
    if (!cuenta) throw new NotFoundException('Cuenta de voz no encontrada');
    return cuenta;
  }

  async createCuenta(a: AuthContext, dto: CreateVoiceCuentaDto) {
    this.adapterFor(dto.proveedor); // valida que el proveedor de voz exista en el registro
    return this.prisma.canalCuenta.create({
      data: {
        workspaceId: a.workspaceId,
        empresaId: dto.empresaId,
        tipo: 'VOZ',
        proveedor: dto.proveedor,
        estado: dto.estado ?? 'ACTIVA',
        secretRef: dto.secretRef ?? null,
        config: json(dto.config),
      },
    });
  }

  // ---------- Llamadas ----------
  listLlamadas(workspaceId: string, cuentaId: string, estado?: string) {
    return this.getCuenta(workspaceId, cuentaId).then(() =>
      this.prisma.voiceCall.findMany({
        where: {
          workspaceId,
          canalCuentaId: cuentaId,
          ...(estado ? { estado: estado as EstadoLlamadaVoz } : {}),
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async getLlamada(workspaceId: string, id: string): Promise<VoiceCall> {
    const call = await this.prisma.voiceCall.findFirst({ where: { id, workspaceId } });
    if (!call) throw new NotFoundException('Llamada no encontrada');
    return call;
  }

  /**
   * Inicia una llamada. Valida capabilities y BLOQUEA combinaciones incompatibles en configuración (400, invariante 5)
   * ANTES de llamar al adaptador. Idempotente por `(workspaceId, proveedor, proveedorCallId)`: un reinicio con la misma
   * clave devuelve la llamada existente. El adaptador simulado no sale a la red; los stubs sin credenciales devuelven
   * FALLIDA sin tocar la red.
   */
  async iniciar(a: AuthContext, dto: IniciarLlamadaDto): Promise<VoiceCall> {
    const cuenta = await this.getCuenta(a.workspaceId, dto.cuentaId);
    if (cuenta.estado === 'RETIRADA') throw new BadRequestException('La cuenta de voz está retirada');
    const adapter = this.adapterFor(cuenta.proveedor);

    const requisitos: VoiceRequisitos = {
      direccion: dto.direccion,
      transferencia: dto.requisitos?.transferencia,
      bargeIn: dto.requisitos?.bargeIn,
      dialogo: dto.requisitos?.dialogo,
    };
    const problemas = validarCapabilitiesVoz(adapter.capabilities, requisitos);
    if (problemas.length) {
      throw new BadRequestException(`Configuración de voz incompatible: ${problemas.join(' ')}`);
    }

    if (dto.tareaId) await this.assertTareaEnWorkspace(a.workspaceId, dto.tareaId);

    const runtime = await this.runtime(cuenta);
    const res = await adapter.iniciar(runtime, {
      direccion: dto.direccion,
      numero: dto.numero,
      idempotencyKey: dto.idempotencyKey,
      requisitos,
    });
    const proveedorCallId = res.proveedorCallId || this.callIdLocal(cuenta.id, dto.idempotencyKey);

    const existente = await this.prisma.voiceCall.findUnique({
      where: {
        workspaceId_proveedor_proveedorCallId: {
          workspaceId: a.workspaceId,
          proveedor: cuenta.proveedor,
          proveedorCallId,
        },
      },
    });
    if (existente) return existente;

    let call: VoiceCall;
    try {
      call = await this.prisma.voiceCall.create({
        data: {
          workspaceId: a.workspaceId,
          empresaId: cuenta.empresaId,
          canalCuentaId: cuenta.id,
          proveedor: cuenta.proveedor,
          proveedorCallId,
          direccion: dto.direccion,
          estado: res.estado,
          tareaId: dto.tareaId ?? null,
          misionId: dto.misionId ?? null,
          duracionSeg: res.duracionSeg ?? null,
          // transcripcionRef y costoEstimado quedan null: grabación OFF por defecto; sin tarifas no se inventa coste.
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        return this.prisma.voiceCall.findUniqueOrThrow({
          where: {
            workspaceId_proveedor_proveedorCallId: {
              workspaceId: a.workspaceId,
              proveedor: cuenta.proveedor,
              proveedorCallId,
            },
          },
        });
      }
      throw err;
    }

    await this.audit.append(a.workspaceId, {
      actorType: 'SYSTEM',
      action: 'voz.llamada.iniciar',
      targetType: 'VoiceCall',
      targetId: call.id,
      resumen: `Llamada ${dto.direccion} ${cuenta.proveedor} en estado ${res.estado}`,
    });
    return call;
  }

  /**
   * Un turno conversacional (STT→diálogo→TTS). Si el motor propone una ACCIÓN SENSIBLE (capa d), la enruta al
   * `ActionGateway` (E6) y devuelve su resolución; nada se ejecuta por fuera del gobierno. La transcripción es dato NO
   * confiable: se devuelve al runtime pero NO se persiste cruda. Actualiza el estado de la llamada.
   */
  async turno(a: AuthContext, callId: string, dto: TurnoLlamadaDto) {
    const { call, adapter, runtime } = await this.cargarLlamadaActiva(a.workspaceId, callId);
    const res = await adapter.turno(runtime, {
      proveedorCallId: call.proveedorCallId,
      entrada: dto.entrada,
      bargeIn: dto.bargeIn,
    });

    let gobierno: GobiernoLlamada | undefined;
    if (res.accionSensible) {
      gobierno = await this.gobernarAccion(a, call, res.accionSensible, dto.entrada);
    }

    const estado = this.estadoTras(call, res.estado);
    const actualizada = await this.prisma.voiceCall.update({ where: { id: call.id }, data: { estado } });
    return {
      id: actualizada.id,
      estado: actualizada.estado,
      respuesta: res.respuesta,
      transcripcion: res.transcripcion,
      bargeIn: res.bargeIn ?? false,
      gobierno,
    };
  }

  /** Transferencia a humano. */
  async transferir(a: AuthContext, callId: string, dto: TransferirLlamadaDto) {
    const { call, adapter, runtime } = await this.cargarLlamadaActiva(a.workspaceId, callId);
    const res = await adapter.transferir(runtime, { proveedorCallId: call.proveedorCallId, destino: dto.destino });
    const actualizada = await this.prisma.voiceCall.update({
      where: { id: call.id },
      data: { estado: res.estado },
    });
    await this.audit.append(a.workspaceId, {
      actorType: 'SYSTEM',
      action: 'voz.llamada.transferir',
      targetType: 'VoiceCall',
      targetId: call.id,
      resumen: `Llamada transferida a ${dto.destino}`,
    });
    return { id: actualizada.id, estado: actualizada.estado, respuesta: res.respuesta };
  }

  /** Cierra la llamada y fija la duración (determinista en el simulado); el coste estimado queda null (sin tarifas). */
  async finalizar(a: AuthContext, callId: string) {
    const { call, adapter, runtime } = await this.cargarLlamadaActiva(a.workspaceId, callId);
    const res = await adapter.finalizar(runtime, { proveedorCallId: call.proveedorCallId });
    const actualizada = await this.prisma.voiceCall.update({
      where: { id: call.id },
      data: { estado: res.estado, duracionSeg: res.duracionSeg ?? call.duracionSeg ?? null },
    });
    await this.audit.append(a.workspaceId, {
      actorType: 'SYSTEM',
      action: 'voz.llamada.finalizar',
      targetType: 'VoiceCall',
      targetId: call.id,
      resumen: `Llamada finalizada en estado ${res.estado}`,
    });
    return {
      id: actualizada.id,
      estado: actualizada.estado,
      respuesta: res.respuesta,
      duracionSeg: actualizada.duracionSeg,
    };
  }

  // ---------- Internos ----------
  private async gobernarAccion(
    a: AuthContext,
    call: VoiceCall,
    accion: VoiceAccionSensible,
    entrada: string,
  ): Promise<GobiernoLlamada> {
    const outcome = await this.gateway.requestAction(
      a.workspaceId,
      {
        tipoAccion: accion.tipoAccion,
        empresaId: call.empresaId ?? undefined,
        herramienta: `voz:${call.proveedor}`,
        recurso: call.id,
        tareaId: call.tareaId ?? undefined,
        destinatarios: accion.destinatarios ?? [],
        contenido: { descripcion: accion.descripcion },
        importe: accion.importe,
        moneda: accion.moneda,
        // Idempotencia de la acción: estable por llamada + contenido del turno (no se reejecuta el efecto).
        idempotencyKey: `voz:${call.id}:${createHash('sha256').update(entrada).digest('hex').slice(0, 16)}`,
      },
      a,
    );
    await this.audit.append(a.workspaceId, {
      actorType: 'SYSTEM',
      action: 'voz.llamada.accion_sensible',
      targetType: 'VoiceCall',
      targetId: call.id,
      resumen: `Acción ${accion.tipoAccion} en llamada → ${outcome.estado}`,
    });
    return {
      tipoAccion: accion.tipoAccion,
      estado: outcome.estado,
      motivo: outcome.motivo,
      aprobacionId: outcome.estado === 'REQUIERE_APROBACION' ? outcome.aprobacionId : undefined,
    };
  }

  private async cargarLlamadaActiva(workspaceId: string, callId: string) {
    const call = await this.getLlamada(workspaceId, callId);
    if (call.estado === 'FINALIZADA' || call.estado === 'FALLIDA') {
      throw new BadRequestException(`La llamada ya está ${call.estado}; no admite más operaciones`);
    }
    const adapter = this.adapterFor(call.proveedor);
    const cuenta = call.canalCuentaId
      ? await this.prisma.canalCuenta.findFirst({ where: { id: call.canalCuentaId, workspaceId } })
      : null;
    const runtime = cuenta
      ? await this.runtime(cuenta)
      : {
          cuentaId: '',
          workspaceId,
          empresaId: call.empresaId ?? '',
          proveedor: call.proveedor,
          config: {},
          secretValue: undefined,
        };
    return { call, adapter, runtime };
  }

  /** Transición de estado: una llamada ya TRANSFERIDA no vuelve a EN_CURSO por un turno posterior. */
  private estadoTras(call: VoiceCall, estadoTurno: EstadoLlamadaVoz): EstadoLlamadaVoz {
    if (call.estado === 'TRANSFERIDA') return 'TRANSFERIDA';
    // El proveedor simulado marca la llamada como SIMULADA al iniciar; el primer turno la pasa a EN_CURSO.
    return estadoTurno;
  }

  private adapterFor(proveedor: string): VoiceProvider {
    const adapter = this.adapters.get(proveedor);
    if (!adapter) throw new BadRequestException(`Proveedor de voz no soportado: ${proveedor}`);
    return adapter;
  }

  private callIdLocal(cuentaId: string, idempotencyKey: string): string {
    return `local_${createHash('sha256').update(`${cuentaId}:${idempotencyKey}`).digest('hex').slice(0, 24)}`;
  }

  private async assertTareaEnWorkspace(workspaceId: string, tareaId: string): Promise<void> {
    const tarea = await this.prisma.tarea.findFirst({ where: { id: tareaId, workspaceId }, select: { id: true } });
    if (!tarea) throw new BadRequestException('La tarea no pertenece al workspace');
  }

  /** Resuelve el `secretRef` (si lo hay) y construye el contexto del adaptador. El secreto nunca sale del servicio. */
  private async runtime(cuenta: CanalCuenta): Promise<VoiceRuntime> {
    let secretValue: string | undefined;
    if (cuenta.secretRef) {
      const resolved = await this.secrets.resolveMany(cuenta.workspaceId, [cuenta.secretRef]);
      secretValue = resolved[cuenta.secretRef];
    }
    return {
      cuentaId: cuenta.id,
      workspaceId: cuenta.workspaceId,
      empresaId: cuenta.empresaId,
      proveedor: cuenta.proveedor,
      config: (cuenta.config as Record<string, unknown>) ?? {},
      secretValue,
    };
  }
}
