import { BadRequestException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { CanalCuenta, EstadoMensajeCanal, Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ActionGatewayService } from '../governance/actions/action-gateway.service';
import { SecretsService } from '../workspaces/secrets.service';
import { CHANNEL_ADAPTERS, type ChannelAdapter } from './domain/channel-adapter';
import type { CanalRuntime, WebhookSolicitud } from './domain/channel.types';
import type { CreateCanalCuentaDto, EnviarMensajeDto, UpdateCanalCuentaDto } from './dto/channel.dto';

const json = (v: unknown) => (v ?? {}) as Prisma.InputJsonValue;
/** Tipo de acción de gobierno (E6) para el envío de correo; abierto y extensible por canal. */
const TIPO_ACCION_POR_CANAL: Record<string, string> = {
  CORREO: 'EMAIL_SEND',
  WHATSAPP: 'WHATSAPP_SEND',
  VOZ: 'VOICE_CALL',
};

/**
 * Servicio del dominio "canal externo" (ADR 0015 D1/D4/D5). CRUD de cuentas de canal por empresa y envío idempotente
 * de mensajes a través del adaptador del proveedor de la cuenta. Multi-tenant estricto: todo filtra por `workspaceId`
 * de `@CurrentAuth()`. Las credenciales se referencian por `secretRef` (bóveda), nunca en claro.
 *
 * Gobierno (E6): los envíos PRODUCTIVOS (proveedor distinto de `simulado`) pasan por el `ActionGateway`, que evalúa la
 * política del proceso: DENEGADA → mensaje FALLIDO sin salir a la red; REQUIERE_APROBACION → mensaje PENDIENTE con la
 * aprobación asociada (no se despacha hasta que E6 la apruebe); PERMITIDA → se despacha por el adaptador. El sandbox
 * (`simulado`) no sale a la red y queda en SIMULADO sin pasar por la pasarela.
 */
@Injectable()
export class ChannelsService {
  private readonly adapters: Map<string, ChannelAdapter>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly gateway: ActionGatewayService,
    private readonly audit: AuditService,
    @Inject(CHANNEL_ADAPTERS) adapters: ChannelAdapter[],
  ) {
    // Registro por `proveedor` y por `alias` (p. ej. `meta` → `whatsapp_meta`), sin ramas `if (proveedor === ...)`.
    this.adapters = new Map();
    for (const a of adapters) {
      for (const clave of [a.proveedor, ...(a.alias ?? [])]) {
        if (this.adapters.has(clave)) throw new Error(`Clave de proveedor de canal duplicada: ${clave}`);
        this.adapters.set(clave, a);
      }
    }
  }

  // ---------- Cuentas de canal ----------
  list(workspaceId: string) {
    return this.prisma.canalCuenta.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async get(workspaceId: string, id: string): Promise<CanalCuenta> {
    const cuenta = await this.prisma.canalCuenta.findFirst({ where: { id, workspaceId } });
    if (!cuenta) throw new NotFoundException('Cuenta de canal no encontrada');
    return cuenta;
  }

  async create(a: AuthContext, dto: CreateCanalCuentaDto) {
    const adapter = this.adapterFor(dto.proveedor);
    if (!adapter.tipos.includes(dto.tipo)) {
      throw new BadRequestException(`El proveedor ${dto.proveedor} no soporta canales de tipo ${dto.tipo}`);
    }
    return this.prisma.canalCuenta.create({
      data: {
        workspaceId: a.workspaceId,
        empresaId: dto.empresaId,
        tipo: dto.tipo,
        proveedor: dto.proveedor,
        estado: dto.estado ?? 'ACTIVA',
        secretRef: dto.secretRef ?? null,
        config: json(dto.config),
      },
    });
  }

  async update(workspaceId: string, id: string, dto: UpdateCanalCuentaDto) {
    const cuenta = await this.get(workspaceId, id);
    const proveedor = dto.proveedor ?? cuenta.proveedor;
    const tipo = dto.tipo ?? cuenta.tipo;
    const adapter = this.adapterFor(proveedor);
    if (!adapter.tipos.includes(tipo)) {
      throw new BadRequestException(`El proveedor ${proveedor} no soporta canales de tipo ${tipo}`);
    }
    return this.prisma.canalCuenta.update({
      where: { id },
      data: {
        empresaId: dto.empresaId,
        tipo: dto.tipo,
        proveedor: dto.proveedor,
        estado: dto.estado,
        secretRef: dto.secretRef,
        config: dto.config !== undefined ? json(dto.config) : undefined,
      },
    });
  }

  async remove(workspaceId: string, id: string) {
    await this.get(workspaceId, id);
    await this.prisma.canalCuenta.delete({ where: { id } });
    return { removed: true };
  }

  async test(workspaceId: string, id: string) {
    const cuenta = await this.get(workspaceId, id);
    const adapter = this.adapterFor(cuenta.proveedor);
    if (!adapter.test) return { ok: false, message: `El proveedor ${cuenta.proveedor} no soporta prueba` };
    try {
      return await adapter.test(await this.runtime(cuenta));
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  // ---------- Mensajes ----------
  listMensajes(workspaceId: string, cuentaId: string, estado?: string) {
    return this.get(workspaceId, cuentaId).then(() =>
      this.prisma.mensajeCanal.findMany({
        where: { workspaceId, canalCuentaId: cuentaId, ...(estado ? { estado: estado as EstadoMensajeCanal } : {}) },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  /**
   * Envía un mensaje por el adaptador del proveedor de la cuenta. Idempotente por `(workspaceId, idempotencyKey)`: un
   * reenvío con la misma clave devuelve el mensaje existente sin duplicar el efecto. Validaciones de pertenencia y de
   * capacidades ANTES de reclamar la clave; el gobierno E6 y el despacho ocurren solo para envíos nuevos.
   */
  async enviar(a: AuthContext, cuentaId: string, dto: EnviarMensajeDto) {
    const cuenta = await this.get(a.workspaceId, cuentaId);
    if (cuenta.estado === 'RETIRADA') throw new BadRequestException('La cuenta de canal está retirada');
    const adapter = this.adapterFor(cuenta.proveedor);
    if (!adapter.capabilities.includes('ENVIAR')) {
      throw new BadRequestException(`El proveedor ${cuenta.proveedor} no soporta envío`);
    }
    if (dto.tareaId) await this.assertTareaEnWorkspace(a.workspaceId, dto.tareaId);

    // Idempotencia: reclama la clave creando el mensaje en PENDIENTE; si ya existe, devuelve el previo sin despachar.
    const existente = await this.prisma.mensajeCanal.findUnique({
      where: { workspaceId_idempotencyKey: { workspaceId: a.workspaceId, idempotencyKey: dto.idempotencyKey } },
    });
    if (existente) return existente;

    let mensaje;
    try {
      mensaje = await this.prisma.mensajeCanal.create({
        data: {
          workspaceId: a.workspaceId,
          canalCuentaId: cuenta.id,
          direccion: 'SALIENTE',
          idempotencyKey: dto.idempotencyKey,
          tareaId: dto.tareaId ?? null,
          misionId: dto.misionId ?? null,
          destino: dto.destino,
          asunto: dto.asunto ?? null,
          cuerpo: dto.cuerpo,
          estado: 'PENDIENTE',
        },
      });
    } catch (err) {
      // Carrera: otro envío concurrente reclamó la misma clave. Devuelve el ganador (idempotencia).
      if ((err as { code?: string }).code === 'P2002') {
        return this.prisma.mensajeCanal.findUniqueOrThrow({
          where: { workspaceId_idempotencyKey: { workspaceId: a.workspaceId, idempotencyKey: dto.idempotencyKey } },
        });
      }
      throw err;
    }

    const resultado = await this.despachar(a, cuenta, dto);
    return this.prisma.mensajeCanal.update({ where: { id: mensaje.id }, data: resultado });
  }

  /**
   * Gobierno + despacho. El sandbox (`simulado`) no pasa por la pasarela ni sale a la red. Los envíos productivos
   * pasan por `ActionGateway`: DENEGADA / REQUIERE_APROBACION no salen a la red; solo PERMITIDA se despacha.
   */
  private async despachar(
    a: AuthContext,
    cuenta: CanalCuenta,
    dto: EnviarMensajeDto,
  ): Promise<{
    estado: EstadoMensajeCanal;
    proveedorMensajeId?: string | null;
    error?: string | null;
    aprobacionId?: string | null;
  }> {
    const adapter = this.adapterFor(cuenta.proveedor);

    if (cuenta.proveedor !== 'simulado') {
      const outcome = await this.gateway.requestAction(
        a.workspaceId,
        {
          tipoAccion: TIPO_ACCION_POR_CANAL[cuenta.tipo] ?? 'CHANNEL_SEND',
          empresaId: cuenta.empresaId,
          herramienta: `canal:${cuenta.proveedor}`,
          recurso: cuenta.id,
          tareaId: dto.tareaId,
          destinatarios: [dto.destino],
          contenido: { asunto: dto.asunto ?? null, cuerpo: dto.cuerpo },
          idempotencyKey: `canal:${cuenta.id}:${dto.idempotencyKey}`,
        },
        a,
      );
      if (outcome.estado === 'DENEGADA') {
        return { estado: 'FALLIDO', error: `Envío denegado por política de gobierno: ${outcome.motivo}` };
      }
      if (outcome.estado === 'REQUIERE_APROBACION') {
        return {
          estado: 'PENDIENTE',
          aprobacionId: outcome.aprobacionId,
          error: 'Envío pendiente de aprobación (E6); no se despacha hasta aprobarse',
        };
      }
    }

    const res = await adapter.enviar(await this.runtime(cuenta), {
      destino: dto.destino,
      asunto: dto.asunto,
      cuerpo: dto.cuerpo,
      idempotencyKey: dto.idempotencyKey,
      plantilla: dto.plantilla,
      adjunto: dto.adjunto,
    });
    return { estado: res.estado, proveedorMensajeId: res.proveedorMensajeId ?? null, error: res.error ?? null };
  }

  // ---------- Webhooks entrantes ----------
  /**
   * Recepción de webhook (ADR 0015 D1/D6). Endpoint PÚBLICO: la "autenticación" es la VERIFICACIÓN DE FIRMA del
   * proveedor con el secreto de la cuenta (no hay sesión). Secuencia: localizar la cuenta por id → confirmar que el
   * `:proveedor` de la ruta selecciona el mismo adaptador → verificar firma (firma inválida ⇒ 401 + auditoría, sin
   * registrar nada) → traducir el payload a eventos → registrar `MensajeCanal` ENTRANTE idempotente por
   * `proveedorMensajeId` y aplicar actualizaciones de estado a los salientes. El contenido entrante es dato NO
   * confiable (no habilita herramientas ni cambia políticas).
   */
  async recibirWebhook(proveedor: string, cuentaId: string, solicitud: WebhookSolicitud) {
    const cuenta = await this.prisma.canalCuenta.findUnique({ where: { id: cuentaId } });
    // No se filtra la existencia de la cuenta a un no autenticado: 404 genérico salvo que todo cuadre.
    if (!cuenta) throw new NotFoundException('Webhook no reconocido');
    const adapter = this.adapters.get(proveedor);
    if (!adapter || adapter !== this.adapters.get(cuenta.proveedor))
      throw new NotFoundException('Webhook no reconocido');
    if (!adapter.verificarFirma || !adapter.traducirWebhook) {
      throw new NotFoundException('Webhook no reconocido');
    }

    const runtime = await this.runtime(cuenta);
    if (!adapter.verificarFirma(runtime, solicitud)) {
      await this.audit.append(cuenta.workspaceId, {
        actorType: 'SYSTEM',
        action: 'canal.webhook.firma_invalida',
        targetType: 'CanalCuenta',
        targetId: cuenta.id,
        resumen: `Webhook de ${cuenta.proveedor} rechazado: firma inválida`,
      });
      throw new UnauthorizedException('Firma de webhook inválida');
    }

    const eventos = adapter.traducirWebhook(solicitud);
    let entrantes = 0;
    let estados = 0;
    for (const ev of eventos) {
      if (ev.tipo === 'MENSAJE') {
        if (await this.registrarEntrante(cuenta, ev.proveedorMensajeId, ev.origen ?? 'desconocido', ev.cuerpo ?? '')) {
          entrantes += 1;
        }
      } else if (ev.tipo === 'ESTADO' && ev.estado) {
        const res = await this.prisma.mensajeCanal.updateMany({
          where: {
            workspaceId: cuenta.workspaceId,
            canalCuentaId: cuenta.id,
            direccion: 'SALIENTE',
            proveedorMensajeId: ev.proveedorMensajeId,
          },
          data: { estado: ev.estado },
        });
        estados += res.count;
      }
    }
    return { ok: true, entrantes, estados };
  }

  /** Registra un entrante idempotente por `proveedorMensajeId` (redelivery no duplica). `destino` = remitente externo. */
  private async registrarEntrante(
    cuenta: CanalCuenta,
    proveedorMensajeId: string,
    origen: string,
    cuerpo: string,
  ): Promise<boolean> {
    try {
      await this.prisma.mensajeCanal.create({
        data: {
          workspaceId: cuenta.workspaceId,
          canalCuentaId: cuenta.id,
          direccion: 'ENTRANTE',
          idempotencyKey: `in:${cuenta.proveedor}:${proveedorMensajeId}`,
          destino: origen,
          cuerpo,
          estado: 'ENTREGADO',
          proveedorMensajeId,
        },
      });
      return true;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') return false; // redelivery idempotente
      throw err;
    }
  }

  // ---------- Internos ----------
  private adapterFor(proveedor: string): ChannelAdapter {
    const adapter = this.adapters.get(proveedor);
    if (!adapter) throw new BadRequestException(`Proveedor de canal no soportado: ${proveedor}`);
    return adapter;
  }

  private async assertTareaEnWorkspace(workspaceId: string, tareaId: string): Promise<void> {
    const tarea = await this.prisma.tarea.findFirst({ where: { id: tareaId, workspaceId }, select: { id: true } });
    if (!tarea) throw new BadRequestException('La tarea no pertenece al workspace');
  }

  /** Resuelve el `secretRef` (si lo hay) y construye el contexto del adaptador. El secreto nunca sale del servicio. */
  private async runtime(cuenta: CanalCuenta): Promise<CanalRuntime> {
    let secretValue: string | undefined;
    if (cuenta.secretRef) {
      const resolved = await this.secrets.resolveMany(cuenta.workspaceId, [cuenta.secretRef]);
      secretValue = resolved[cuenta.secretRef];
    }
    return {
      cuentaId: cuenta.id,
      workspaceId: cuenta.workspaceId,
      empresaId: cuenta.empresaId,
      tipo: cuenta.tipo,
      proveedor: cuenta.proveedor,
      config: (cuenta.config as Record<string, unknown>) ?? {},
      secretValue,
    };
  }
}
