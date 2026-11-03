import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanalCuenta, EstadoMensajeCanal, MensajeCanal, Prisma } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import { ActionGatewayService } from '../governance/actions/action-gateway.service';
import { PolicyService } from '../governance/actions/policy.service';
import { SuspensionsService } from '../governance/actions/suspensions.service';
import type { ActionContext } from '../governance/policy/policy.types';
import { ProfilesEnrichmentService } from '../profiles/profiles-enrichment.service';
import { SecretsService } from '../workspaces/secrets.service';
import { CHANNEL_ADAPTERS, type ChannelAdapter } from './domain/channel-adapter';
import { evaluarGuardarrailes, leerGuardarrailes, superaTopeDiario } from './domain/channel-guardrails';
import type { CanalRuntime, WebhookSolicitud } from './domain/channel.types';
import type {
  CreateCanalCuentaDto,
  EnviarMensajeDto,
  PrepararPilotoCorreoDto,
  SimularEntranteDto,
  UpdateCanalCuentaDto,
} from './dto/channel.dto';

const json = (v: unknown) => (v ?? {}) as Prisma.InputJsonValue;
/** Proveedor (adaptador) del piloto interno controlado: SIMULADO (sin red, sin credenciales) pero gobernado por E6. */
const PILOTO_PROVEEDOR = 'simulado_piloto';
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
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly gateway: ActionGatewayService,
    private readonly policies: PolicyService,
    private readonly suspensions: SuspensionsService,
    private readonly audit: AuditService,
    private readonly enrichment: ProfilesEnrichmentService,
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

    if (adapter.requiereGobierno ?? true) {
      // Guardarraíl de la cuenta (defensa en profundidad, §2/§3 del diseño de controles de correo): lista blanca de
      // destinatarios, tamaño máximo del cuerpo y tope diario de envíos, configurables por empresa en
      // `CanalCuenta.config` (sin secretos). INERTE si no se configura; NUNCA aplica al sandbox PURO (`simulado`). Se
      // evalúa ANTES del ActionGateway: lo no listado, un cuerpo sobredimensionado o superar el tope diario se bloquea
      // SIN salir a la red y sin consumir la pasarela. La lista blanca canónica y versionada sigue viviendo en
      // `Politica` (E6); esto es un refuerzo local, no la sustituye.
      const config = (cuenta.config as Record<string, unknown>) ?? {};
      const guardarrailes = leerGuardarrailes(config);
      const guard = evaluarGuardarrailes(dto.destino, dto.cuerpo, guardarrailes);
      if (!guard.ok) {
        return this.bloquearPorGuardarrail(a, cuenta, dto.destino, guard.motivo!);
      }
      // Tope de volumen por día del piloto: cuenta los salientes NO fallidos de hoy (incluido el PENDIENTE recién
      // reclamado) y bloquea el excedente sin salir a la red.
      if (guardarrailes.maxEnviosPorDia != null) {
        const conteoHoy = await this.contarEnviosHoy(cuenta.id, a.workspaceId);
        if (superaTopeDiario(conteoHoy, guardarrailes.maxEnviosPorDia)) {
          return this.bloquearPorGuardarrail(a, cuenta, dto.destino, 'TOPE_DIARIO_SUPERADO');
        }
      }

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

  /**
   * Registra un mensaje ENTRANTE simulado (sandbox) y dispara el enganche de enriquecimiento de perfiles (ADR 0018
   * Inc.2). Punto de integración explícito mientras el sandbox no tiene recepción real por webhook: solo para cuentas
   * `simulado` (no sale a la red). Idempotente por `proveedorMensajeId` (reenviar el mismo no duplica ni el mensaje ni
   * el contacto). El `workspaceId` lo fija la cuenta del canal, nunca el cuerpo. Requiere EDITOR (lo exige el control).
   */
  async simularEntrante(a: AuthContext, cuentaId: string, dto: SimularEntranteDto) {
    const cuenta = await this.get(a.workspaceId, cuentaId);
    const adapter = this.adapterFor(cuenta.proveedor);
    if (!adapter.esSandbox) {
      throw new BadRequestException('Solo las cuentas sandbox (simulado/piloto) aceptan entrantes simulados');
    }
    const registrado = await this.registrarEntrante(cuenta, dto.proveedorMensajeId, dto.origen, dto.cuerpo ?? '');
    return { ok: true, registrado };
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
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') return false; // redelivery idempotente
      throw err;
    }
    // ADR 0018 Inc.2: enriquecer el perfil del remitente SOLO para canales de CORREO (el `origen` es una dirección de
    // correo). El `workspaceId` lo fija la cuenta del canal, nunca el cuerpo del webhook. El enriquecimiento es
    // contexto, no concede permisos; si falla, NO se revierte el registro del entrante (se traza y se sigue).
    await this.enriquecerDesdeCorreo(cuenta, origen);
    return true;
  }

  /**
   * Enganche de enriquecimiento de perfiles desde un correo entrante (ADR 0018 Inc.2). Punto único por el que pasa
   * TODO entrante persistido. Aislado del flujo del canal: un fallo del enriquecimiento no tumba la recepción.
   */
  private async enriquecerDesdeCorreo(cuenta: CanalCuenta, origen: string): Promise<void> {
    if (cuenta.tipo !== 'CORREO') return;
    try {
      await this.enrichment.enrichFromEmail({ workspaceId: cuenta.workspaceId, email: origen, fuente: 'correo' });
    } catch (err) {
      this.logger.warn(`Enriquecimiento de perfil desde correo falló (cuenta=${cuenta.id}): ${(err as Error).message}`);
    }
  }

  /**
   * Despacho SIMULADO de un saliente del piloto que quedó PENDIENTE de aprobación (bandeja E6). Precondición: la
   * `Aprobacion` ligada está APROBADA. Pasa por `ActionGateway.execute`, que REVALIDA justo antes del efecto la
   * política, los aprobadores y el kill-switch/suspensión, y marca la aprobación EJECUTADA (una sola vez). Además,
   * como refuerzo, se verifica la suspensión con el contexto fiel de la cuenta (CONECTOR = cuenta, ORGANIZACION =
   * empresa) ANTES de ejecutar. Solo entonces el adaptador simula el despacho (sin red). Idempotente: si el mensaje ya
   * no está PENDIENTE, se devuelve tal cual. Exige EDITOR (lo exige el controlador).
   */
  async despacharAprobado(a: AuthContext, cuentaId: string, mensajeId: string): Promise<MensajeCanal> {
    const cuenta = await this.get(a.workspaceId, cuentaId);
    const mensaje = await this.prisma.mensajeCanal.findFirst({
      where: { id: mensajeId, workspaceId: a.workspaceId, canalCuentaId: cuenta.id, direccion: 'SALIENTE' },
    });
    if (!mensaje) throw new NotFoundException('Mensaje saliente no encontrado');
    if (mensaje.estado !== 'PENDIENTE') return mensaje; // idempotente: ya despachado/fallido
    if (!mensaje.aprobacionId) {
      throw new BadRequestException('El mensaje no está pendiente de una aprobación de gobierno');
    }

    // Kill-switch fiel al contexto de la cuenta (el contexto recompuesto por el gateway pierde el id de la cuenta como
    // recurso): corte inmediato si hay una suspensión por CONECTOR (la cuenta) u ORGANIZACION (la empresa/workspace).
    if (await this.suspensions.isActionSuspended(a.workspaceId, this.ctxCuenta(cuenta, mensaje.destino))) {
      throw new ForbiddenException('Despacho bloqueado por una suspensión de emergencia activa (kill-switch)');
    }

    // Revalida E6 (política + aprobadores + suspensión) y marca la aprobación EJECUTADA. Lanza si dejó de estar
    // permitida (DENY/suspensión), si el contenido cambió (hash) o si un aprobador perdió atribuciones.
    await this.gateway.execute(a.workspaceId, mensaje.aprobacionId, a);

    // Despacho SIMULADO (sin red). El adaptador del piloto rechaza credenciales reales por construcción.
    const res = await this.adapterFor(cuenta.proveedor).enviar(await this.runtime(cuenta), {
      destino: mensaje.destino,
      asunto: mensaje.asunto ?? undefined,
      cuerpo: mensaje.cuerpo,
      idempotencyKey: mensaje.idempotencyKey,
    });
    return this.prisma.mensajeCanal.update({
      where: { id: mensaje.id },
      data: { estado: res.estado, proveedorMensajeId: res.proveedorMensajeId ?? null, error: res.error ?? null },
    });
  }

  // ---------- Preset de piloto interno controlado (ADR 0015 · controles de correo) ----------
  /**
   * Prepara (idempotente, auditado) el PILOTO INTERNO CONTROLADO de correo para una empresa. Deja el canal listo para un
   * piloto en ambiente controlado SIN activación productiva: proveedor SIMULADO (`simulado_piloto`, sin red, sin
   * credenciales), lista blanca de internos (denegación por defecto de lo no listado), límites de envío (tamaño y tope
   * diario), aprobación humana OBLIGATORIA de toda saliente (política `EMAIL_SEND` REQUIRE_APPROVAL) y trazabilidad
   * (auditoría inmutable E13). IMPIDE POR CONSTRUCCIÓN un proveedor productivo o credenciales reales: fuerza el
   * proveedor simulado y `secretRef = null`. Lo opera SIEMPRE un humano (el servicio exige `actor.userId`).
   */
  async prepararPilotoInterno(a: AuthContext, dto: PrepararPilotoCorreoDto) {
    if (!a.userId) {
      throw new ForbiddenException('El piloto interno solo lo prepara un usuario humano autenticado, nunca un agente');
    }
    const dominiosInternos = this.normalizarPatrones(dto.dominiosInternos);
    if (dominiosInternos.length === 0) {
      throw new BadRequestException('Indique al menos un destinatario/dominio interno para la lista blanca');
    }
    const externos = this.normalizarPatrones(dto.permitirExternosConAprobacion ?? []);
    // La lista blanca del guardarraíl = internos + externos con aprobación (defensa en profundidad; el canon vive en
    // Politica). Todo lo demás queda denegado por defecto en el guardarraíl, sin salir a la red.
    const destinatariosPermitidos = [...new Set([...dominiosInternos, ...externos])];

    const config: Record<string, unknown> = {
      piloto: true,
      ...(dto.remitente ? { remitente: dto.remitente } : {}),
      destinatariosPermitidos,
      ...(dto.maxCuerpoBytes != null ? { maxCuerpoBytes: dto.maxCuerpoBytes } : {}),
      ...(dto.maxEnviosPorDia != null ? { maxEnviosPorDia: dto.maxEnviosPorDia } : {}),
      ...(dto.ventanaHoraria ? { ventanaHoraria: { ...dto.ventanaHoraria } } : {}),
    };

    // Cuenta del piloto: proveedor SIMULADO forzado, SIN credenciales. Idempotente por (workspace, empresa, tipo,
    // proveedor). Un re-preparar actualiza la configuración y reafirma que no hay `secretRef`.
    const existente = await this.prisma.canalCuenta.findFirst({
      where: { workspaceId: a.workspaceId, empresaId: dto.empresaId, tipo: 'CORREO', proveedor: PILOTO_PROVEEDOR },
    });
    const cuenta = existente
      ? await this.prisma.canalCuenta.update({
          where: { id: existente.id },
          data: { estado: 'ACTIVA', secretRef: null, config: json(config) },
        })
      : await this.prisma.canalCuenta.create({
          data: {
            workspaceId: a.workspaceId,
            empresaId: dto.empresaId,
            tipo: 'CORREO',
            proveedor: PILOTO_PROVEEDOR,
            estado: 'ACTIVA',
            secretRef: null,
            config: json(config),
          },
        });

    // Políticas E6 (idempotentes por nombre + empresa + tipoAccion): aprobación humana obligatoria de internos y, si se
    // pidió, de externos admitidos. No se crea un DENY global (denegaría también a los internos): la denegación por
    // defecto la da la lista blanca del guardarraíl.
    const politicas: { nombre: string; id: string }[] = [];
    politicas.push(
      await this.asegurarPolitica(a, dto.empresaId, 'Piloto interno correo — aprobación de internos', dominiosInternos),
    );
    if (externos.length > 0) {
      politicas.push(
        await this.asegurarPolitica(a, dto.empresaId, 'Piloto interno correo — externos con aprobación', externos),
      );
    }

    const parametros = {
      proveedor: PILOTO_PROVEEDOR,
      dominiosInternos,
      externosConAprobacion: externos,
      maxCuerpoBytes: dto.maxCuerpoBytes ?? null,
      maxEnviosPorDia: dto.maxEnviosPorDia ?? null,
      ventanaHoraria: dto.ventanaHoraria ?? null,
    };
    await this.audit.append(a.workspaceId, {
      actorType: 'USER',
      actorId: a.userId,
      action: AUDIT_ACTIONS.CANAL_PILOTO_PREPARADO,
      targetType: 'CanalCuenta',
      targetId: cuenta.id,
      resumen: `Piloto interno de correo preparado para la empresa ${dto.empresaId} (simulado, sin activación productiva)`,
      metadata: { empresaId: dto.empresaId, politicas: politicas.map((p) => p.nombre), ...parametros },
    });

    return { cuenta, politicas, parametros, activacionProductiva: false };
  }

  /** Crea una política `EMAIL_SEND` REQUIRE_APPROVAL para la lista de destinatarios si no existe ya (idempotente). */
  private async asegurarPolitica(
    a: AuthContext,
    empresaId: string,
    nombre: string,
    destinatarios: string[],
  ): Promise<{ nombre: string; id: string }> {
    const existente = await this.prisma.politica.findFirst({
      where: { workspaceId: a.workspaceId, empresaId, tipoAccion: 'EMAIL_SEND', nombre, estado: 'ACTIVA' },
    });
    if (existente) return { nombre, id: existente.id };
    const creada = await this.policies.create(
      a.workspaceId,
      { nombre, tipoAccion: 'EMAIL_SEND', empresaId, efecto: 'REQUIRE_APPROVAL', selector: { destinatarios } },
      a,
    );
    return { nombre, id: creada.id };
  }

  /** Normaliza patrones de destinatario (recorta, minúsculas, sin vacíos ni duplicados). */
  private normalizarPatrones(lista: string[]): string[] {
    return [...new Set(lista.map((x) => x.trim().toLowerCase()).filter((x) => x.length > 0))];
  }

  // ---------- Internos ----------
  /** Registra el bloqueo de un envío por guardarraíl (E13) y devuelve el resultado FALLIDO sin salir a la red. */
  private async bloquearPorGuardarrail(
    a: AuthContext,
    cuenta: CanalCuenta,
    destino: string,
    motivo: string,
  ): Promise<{ estado: EstadoMensajeCanal; error: string }> {
    await this.audit.append(a.workspaceId, {
      actorType: a.userId ? 'USER' : 'SYSTEM',
      actorId: a.userId ?? null,
      action: AUDIT_ACTIONS.CANAL_ENVIO_BLOQUEADO,
      targetType: 'CanalCuenta',
      targetId: cuenta.id,
      resumen: `Envío de canal bloqueado por guardarraíl de la cuenta (${motivo})`,
      metadata: { motivo, destino, empresaId: cuenta.empresaId },
    });
    return { estado: 'FALLIDO', error: `Envío bloqueado por guardarraíl de la cuenta: ${motivo}` };
  }

  /** Cuenta los salientes NO fallidos de la cuenta en el día natural actual (para el tope diario del piloto). */
  private contarEnviosHoy(cuentaId: string, workspaceId: string): Promise<number> {
    const inicioDia = new Date();
    inicioDia.setHours(0, 0, 0, 0);
    return this.prisma.mensajeCanal.count({
      where: {
        workspaceId,
        canalCuentaId: cuentaId,
        direccion: 'SALIENTE',
        estado: { not: 'FALLIDO' },
        createdAt: { gte: inicioDia },
      },
    });
  }

  /** Contexto de acción fiel a la cuenta para consultar suspensiones (CONECTOR = cuenta; ORGANIZACION = empresa). */
  private ctxCuenta(cuenta: CanalCuenta, destino: string): ActionContext {
    return {
      workspaceId: cuenta.workspaceId,
      empresaId: cuenta.empresaId,
      tipoAccion: TIPO_ACCION_POR_CANAL[cuenta.tipo] ?? 'CHANNEL_SEND',
      conectorId: cuenta.id,
      recurso: cuenta.id,
      destinatarios: [destino],
    };
  }

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
