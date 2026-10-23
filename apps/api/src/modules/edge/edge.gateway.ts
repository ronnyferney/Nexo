import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { IncomingMessage, Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EdgeBusService } from './edge-bus.service';
import {
  CONTROL_CHANNEL,
  EDGE_CLOSE,
  EDGE_HEARTBEAT_MS,
  EDGE_MAX_PAYLOAD_BYTES,
  EDGE_OFFLINE_AFTER_MS,
  EDGE_WS_PATH,
  reqChannel,
  resChannel,
  type BusRequest,
  type ControlMessage,
  type EdgeReply,
  type WelcomeMessage,
} from './edge.protocol';
import { EdgeService } from './edge.service';

interface EdgeSocket {
  connId: string;
  edgeId: string;
  workspaceId: string;
  ws: WebSocket;
  lastSignal: number;
  lastPersisted: number;
  /** Solicitudes reenviadas a este socket y aún sin respuesta (id → vencimiento). */
  pending: Map<string, number>;
}

const PERSIST_EVERY_MS = 10_000;
const CONNECTION_KEY = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * Gateway WebSocket de Nexo Edge.
 *
 * Decisión: un `WebSocketServer({ noServer: true })` de `ws` enganchado al evento `upgrade` del servidor HTTP de
 * Nest (vía HttpAdapterHost). No requiere cambiar `main.ts` ni el adaptador de WebSockets de la app, autentica el
 * token **antes** de completar el handshake (401 sin abrir el socket) y deja intactos otros `upgrade` del servidor.
 *
 * Cada Edge tiene como máximo una conexión activa en todo el clúster: la nueva reemplaza a la anterior (local o
 * en otra instancia, vía `edge:control`). Las solicitudes llegan por Redis `edge:req:<edgeId>` y las respuestas se
 * publican en `edge:res:<requestId>`.
 */
@Injectable()
export class EdgeGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EdgeGateway.name);
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: EDGE_MAX_PAYLOAD_BYTES });
  private readonly sockets = new Map<string, EdgeSocket>();
  private server?: Server;
  private heartbeat?: NodeJS.Timeout;
  private readonly onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) =>
    void this.handleUpgrade(req, socket, head);

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly edges: EdgeService,
    private readonly bus: EdgeBusService,
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const server = this.adapterHost.httpAdapter?.getHttpServer() as Server | undefined;
    if (!server) return;
    this.server = server;
    server.on('upgrade', this.onUpgrade);
    await this.bus.subscribe(CONTROL_CHANNEL, (raw) => this.onControl(JSON.parse(raw) as ControlMessage));
    this.heartbeat = setInterval(() => this.tick(), EDGE_HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.heartbeat);
    this.server?.off('upgrade', this.onUpgrade);
    for (const s of this.sockets.values()) s.ws.close(EDGE_CLOSE.shutdown, 'Servidor detenido');
    await Promise.all([...this.sockets.keys()].map((id) => this.bus.unsubscribe(reqChannel(id))));
    this.sockets.clear();
    this.wss.close();
  }

  /** Conexiones locales (pruebas y diagnóstico). */
  isConnectedHere(edgeId: string): boolean {
    return this.sockets.has(edgeId);
  }

  // ---------- Handshake ----------
  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const path = (req.url ?? '').split('?')[0];
    if (path !== EDGE_WS_PATH) {
      // Otro consumidor del evento `upgrade` puede atenderlo; si somos el único, rechazar.
      if (this.server && this.server.listenerCount('upgrade') <= 1) reject(socket, 404, 'Not Found');
      return;
    }
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    let edge;
    try {
      edge = await this.edges.authenticate(token);
    } catch (err) {
      this.logger.warn(`Error autenticando un Edge: ${(err as Error).message}`);
      return reject(socket, 500, 'Internal Server Error');
    }
    if (!edge) return reject(socket, 401, 'Unauthorized');
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      void this.register(edge.id, edge.workspaceId, edge.name, ws, req);
    });
  }

  private async register(edgeId: string, workspaceId: string, name: string, ws: WebSocket, req: IncomingMessage) {
    const connId = randomUUID();
    const previous = this.sockets.get(edgeId);
    const entry: EdgeSocket = {
      connId,
      edgeId,
      workspaceId,
      ws,
      lastSignal: Date.now(),
      lastPersisted: 0,
      pending: new Map(),
    };
    this.sockets.set(edgeId, entry);
    if (previous) this.replace(previous, 'Reemplazada por una nueva conexión');

    ws.on('message', (data: RawData, isBinary: boolean) => void this.onMessage(entry, data, isBinary));
    ws.on('pong', () => this.touch(entry));
    ws.on('error', (err) => this.logger.warn(`Socket del Edge ${edgeId}: ${err.message}`));
    ws.on('close', () => void this.onClose(entry));

    try {
      await this.bus.subscribe(reqChannel(edgeId), (raw) => this.forward(edgeId, JSON.parse(raw) as BusRequest));
      // Una sola conexión activa en todo el clúster: las demás instancias cierran la suya.
      const kick: ControlMessage = { type: 'kick', edgeId, keepConnId: connId, reason: 'replaced' };
      await this.bus.publish(CONTROL_CHANNEL, kick);
    } catch (err) {
      this.logger.error(`No se pudo registrar el Edge ${edgeId} en Redis: ${(err as Error).message}`);
      ws.close(1011, 'Error interno');
      return;
    }
    const welcome: WelcomeMessage = { type: 'welcome', edgeId, name };
    ws.send(JSON.stringify(welcome));
    this.logger.log({
      msg: 'edge.connected',
      edgeId,
      workspaceId,
      remote: req.socket.remoteAddress,
    });
  }

  private replace(entry: EdgeSocket, reason: string) {
    this.failPending(entry, 'La conexión del Edge fue reemplazada');
    entry.ws.close(EDGE_CLOSE.replaced, reason);
  }

  private async onClose(entry: EdgeSocket) {
    this.failPending(entry, 'El Edge se desconectó antes de responder');
    if (this.sockets.get(entry.edgeId)?.connId !== entry.connId) return; // ya reemplazada
    this.sockets.delete(entry.edgeId);
    await this.bus.unsubscribe(reqChannel(entry.edgeId));
    this.logger.log({ msg: 'edge.disconnected', edgeId: entry.edgeId, workspaceId: entry.workspaceId });
  }

  private onControl(msg: ControlMessage) {
    if (msg?.type !== 'kick') return;
    const entry = this.sockets.get(msg.edgeId);
    if (!entry || entry.connId === msg.keepConnId) return;
    if (msg.reason === 'revoked') {
      this.failPending(entry, 'El Edge fue revocado');
      entry.ws.close(EDGE_CLOSE.revoked, 'Token revocado o Edge eliminado');
    } else {
      this.replace(entry, 'Reemplazada por una conexión en otra instancia');
    }
  }

  // ---------- Mensajes ----------
  private async onMessage(entry: EdgeSocket, data: RawData, isBinary: boolean) {
    this.touch(entry);
    if (isBinary) return entry.ws.close(EDGE_CLOSE.invalidMessage, 'Solo se admiten mensajes JSON de texto');
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(rawToString(data)) as Record<string, unknown>;
    } catch {
      return entry.ws.close(EDGE_CLOSE.invalidMessage, 'Mensaje JSON inválido');
    }
    switch (msg.type) {
      case 'hello':
        return this.onHello(entry, msg);
      case 'ping':
        entry.ws.send(JSON.stringify({ type: 'pong' }));
        return;
      case 'pong':
        return;
      case 'result':
      case 'error':
      case 'schema_result':
      case 'test_result':
        return this.onReply(entry, msg as unknown as EdgeReply);
      default:
        this.logger.warn(`Edge ${entry.edgeId}: tipo de mensaje desconocido`);
    }
  }

  private async onHello(entry: EdgeSocket, msg: Record<string, unknown>) {
    const version = typeof msg.version === 'string' ? msg.version.slice(0, 50) : null;
    const hostname = typeof msg.hostname === 'string' ? msg.hostname.slice(0, 255) : null;
    const connections = Array.isArray(msg.connections)
      ? [...new Set(msg.connections.filter((c): c is string => typeof c === 'string' && CONNECTION_KEY.test(c)))].slice(
          0,
          100,
        )
      : [];
    entry.lastPersisted = Date.now();
    await this.prisma.edgeAgent
      .update({ where: { id: entry.edgeId }, data: { version, hostname, connections, lastSeenAt: new Date() } })
      .catch((err: Error) => this.logger.warn(`No se pudo actualizar el Edge ${entry.edgeId}: ${err.message}`));
    this.logger.log({ msg: 'edge.hello', edgeId: entry.edgeId, version, connections: connections.length });
  }

  private onReply(entry: EdgeSocket, reply: EdgeReply) {
    const id = typeof reply.id === 'string' ? reply.id : '';
    // Solo se aceptan respuestas a solicitudes enviadas a ESTE socket: un Edge no puede responder por otro.
    if (!entry.pending.delete(id)) return;
    void this.bus.publish(resChannel(id), reply);
  }

  /** Solicitud recibida por Redis para un Edge cuyo socket vive en esta instancia. */
  private forward(edgeId: string, req: BusRequest) {
    const entry = this.sockets.get(edgeId);
    const id = req?.requestId;
    if (typeof id !== 'string' || req.message?.id !== id) return;
    if (!entry || entry.ws.readyState !== WebSocket.OPEN) {
      void this.bus.publish(resChannel(id), {
        type: 'error',
        id,
        code: 'CONNECTION',
        message: 'El Edge no está conectado',
      });
      return;
    }
    entry.pending.set(id, req.deadline);
    entry.ws.send(JSON.stringify(req.message));
  }

  private failPending(entry: EdgeSocket, message: string) {
    for (const id of entry.pending.keys()) {
      void this.bus.publish(resChannel(id), { type: 'error', id, code: 'CONNECTION', message });
    }
    entry.pending.clear();
  }

  // ---------- Heartbeat ----------
  private touch(entry: EdgeSocket) {
    const now = Date.now();
    entry.lastSignal = now;
    if (now - entry.lastPersisted < PERSIST_EVERY_MS) return;
    entry.lastPersisted = now;
    void this.prisma.edgeAgent
      .update({ where: { id: entry.edgeId }, data: { lastSeenAt: new Date(now) } })
      .catch(() => undefined);
  }

  private tick() {
    const now = Date.now();
    for (const entry of this.sockets.values()) {
      for (const [id, deadline] of entry.pending) if (deadline < now) entry.pending.delete(id);
      if (now - entry.lastSignal > EDGE_OFFLINE_AFTER_MS) {
        this.logger.warn({ msg: 'edge.heartbeat_timeout', edgeId: entry.edgeId });
        entry.ws.close(EDGE_CLOSE.heartbeatTimeout, 'Sin heartbeat');
        entry.ws.terminate();
        continue;
      }
      if (entry.ws.readyState === WebSocket.OPEN) entry.ws.ping();
    }
  }
}

function reject(socket: Duplex, status: number, text: string) {
  socket.write(
    `HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

function rawToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}
