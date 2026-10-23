import {
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { EdgeAgent } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EdgeBusService } from './edge-bus.service';
import {
  CONTROL_CHANNEL,
  EDGE_OFFLINE_AFTER_MS,
  EDGE_TOKEN_PREFIX,
  reqChannel,
  resChannel,
  type BusRequest,
  type ControlMessage,
  type EdgeReply,
  type EdgeRequest,
  type EdgeRequestPayload,
} from './edge.protocol';

export type EdgeStatus = 'ONLINE' | 'OFFLINE';

/** Margen sobre el timeout de la consulta para el viaje de ida y vuelta API ↔ Edge. */
const ROUND_TRIP_MARGIN_MS = 5_000;

export function edgeStatus(lastSeenAt: Date | null, now = Date.now()): EdgeStatus {
  return lastSeenAt && now - lastSeenAt.getTime() <= EDGE_OFFLINE_AFTER_MS ? 'ONLINE' : 'OFFLINE';
}

/** Error que el Edge devolvió (`type: 'error'`): las violaciones de política se tratan como solicitud inválida. */
export class EdgeReplyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

@Injectable()
export class EdgeService {
  private readonly logger = new Logger('EdgeAudit');

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EdgeBusService,
  ) {}

  // ---------- Administración ----------
  async list(workspaceId: string) {
    const rows = await this.prisma.edgeAgent.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
    return rows.map((e) => ({
      id: e.id,
      name: e.name,
      status: edgeStatus(e.lastSeenAt),
      lastSeenAt: e.lastSeenAt,
      version: e.version,
      hostname: e.hostname,
      connections: e.connections,
      tokenPrefix: e.tokenPrefix,
      createdAt: e.createdAt,
    }));
  }

  /** Para selectores (cualquier rol): sin datos del host ni del token. */
  async options(workspaceId: string) {
    const rows = await this.prisma.edgeAgent.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } });
    return rows.map((e) => ({ id: e.id, name: e.name, status: edgeStatus(e.lastSeenAt), connections: e.connections }));
  }

  /** El token completo solo se devuelve aquí y en la rotación; en BD queda su SHA-256. */
  async create(workspaceId: string, name: string) {
    const token = newToken();
    const edge = await this.prisma.edgeAgent.create({
      data: { workspaceId, name, tokenHash: CryptoService.sha256(token), tokenPrefix: token.slice(0, 13) },
    });
    return { id: edge.id, name: edge.name, token };
  }

  async remove(workspaceId: string, id: string) {
    await this.get(workspaceId, id);
    await this.prisma.edgeAgent.delete({ where: { id } });
    await this.kick(id);
  }

  async rotateToken(workspaceId: string, id: string) {
    await this.get(workspaceId, id);
    const token = newToken();
    await this.prisma.edgeAgent.update({
      where: { id },
      data: { tokenHash: CryptoService.sha256(token), tokenPrefix: token.slice(0, 13) },
    });
    // La conexión abierta con el token anterior se cierra: deberá reconectar con el nuevo.
    await this.kick(id);
    return { token };
  }

  async get(workspaceId: string, id: string): Promise<EdgeAgent> {
    const edge = await this.prisma.edgeAgent.findFirst({ where: { id, workspaceId } });
    if (!edge) throw new NotFoundException('Edge no encontrado');
    return edge;
  }

  /** Autenticación del upgrade WebSocket: `nexoedge_...` → EdgeAgent. */
  async authenticate(token: string | undefined): Promise<EdgeAgent | null> {
    if (!token || !token.startsWith(EDGE_TOKEN_PREFIX) || token.length > 200) return null;
    return this.prisma.edgeAgent.findUnique({ where: { tokenHash: CryptoService.sha256(token) } });
  }

  private kick(edgeId: string) {
    const msg: ControlMessage = { type: 'kick', edgeId, reason: 'revoked' };
    return this.bus.publish(CONTROL_CHANNEL, msg);
  }

  // ---------- Solicitudes ----------
  /**
   * Envía una solicitud al Edge (esté su socket en esta instancia o en otra) y espera la respuesta.
   * Verifica que el Edge pertenezca al workspace: un workspace nunca puede usar el Edge de otro.
   */
  async request<T extends EdgeReply = EdgeReply>(
    workspaceId: string,
    edgeId: string,
    payload: EdgeRequestPayload,
    timeoutMs: number,
  ): Promise<T> {
    const edge = await this.prisma.edgeAgent.findFirst({
      where: { id: edgeId, workspaceId },
      select: { id: true, name: true, connections: true },
    });
    if (!edge) throw new NotFoundException('Edge no encontrado en este workspace');
    if (edge.connections.length && !edge.connections.includes(payload.connectionKey)) {
      throw new BadRequestException(
        `El Edge "${edge.name}" no declara la conexión "${payload.connectionKey}" (disponibles: ${edge.connections.join(', ')})`,
      );
    }

    const requestId = randomUUID();
    const wait = timeoutMs + ROUND_TRIP_MARGIN_MS;
    const message = { ...payload, id: requestId } as EdgeRequest;
    const started = Date.now();
    let timer: NodeJS.Timeout | undefined;
    let settle!: (reply: EdgeReply) => void;
    const replied = new Promise<EdgeReply>((resolve) => (settle = resolve));
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new GatewayTimeoutException(`El Edge "${edge.name}" no respondió en ${wait} ms`)),
        wait,
      );
    });

    const channel = resChannel(requestId);
    await this.bus.subscribe(channel, (raw) => settle(JSON.parse(raw) as EdgeReply));
    try {
      const envelope: BusRequest = { requestId, edgeId, message, deadline: started + wait };
      const receivers = await this.bus.publish(reqChannel(edgeId), envelope);
      if (receivers === 0) {
        throw new ServiceUnavailableException(`El Edge "${edge.name}" no está conectado`);
      }
      const reply = await Promise.race([replied, timedOut]);
      this.audit(workspaceId, edgeId, payload, reply, Date.now() - started);
      if (reply.type === 'error') throw new EdgeReplyError(reply.code, reply.message);
      return reply as T;
    } catch (err) {
      if (!(err instanceof EdgeReplyError)) {
        this.audit(workspaceId, edgeId, payload, undefined, Date.now() - started, (err as Error).message);
      }
      throw err;
    } finally {
      clearTimeout(timer);
      await this.bus.unsubscribe(channel);
    }
  }

  /** Auditoría mínima: Edge, operación, filas, duración y estado. Nunca SQL, parámetros ni datos. */
  private audit(
    workspaceId: string,
    edgeId: string,
    payload: EdgeRequestPayload,
    reply: EdgeReply | undefined,
    durationMs: number,
    failure?: string,
  ) {
    const status = failure ? 'failed' : reply?.type === 'error' ? `error:${reply.code}` : 'ok';
    this.logger.log({
      msg: 'edge.request',
      workspaceId,
      edgeId,
      type: payload.type,
      connectionKey: payload.connectionKey,
      operation: payload.type === 'query' ? payload.operation : undefined,
      mode: payload.type === 'query' ? payload.mode : undefined,
      rows: reply?.type === 'result' ? reply.data.rowCount : reply?.type === 'schema_result' ? reply.tables.length : 0,
      durationMs,
      status,
      ...(failure ? { error: failure } : {}),
    });
  }
}

function newToken(): string {
  return `${EDGE_TOKEN_PREFIX}${CryptoService.randomToken(32)}`;
}
