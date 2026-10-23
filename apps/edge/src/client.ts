import { EventEmitter } from 'node:events';
import { hostname as osHostname } from 'node:os';
import WebSocket, { type RawData } from 'ws';
import type { EdgeConfig } from './config';
import { RequestHandler, type DriverFactory } from './handler';
import { silentLogger, type Logger } from './logger';
import { EDGE_CLOSE, EDGE_TOKEN_PREFIX, EDGE_WS_PATH, type EdgeRequest, type HelloMessage, type WelcomeMessage } from './protocol';
import { EDGE_VERSION } from './version';

export interface EdgeClientOptions {
  /** URL pública de la API de Nexo (`https://nexo.ejemplo.com`); también acepta la URL `wss://…/api/edge/ws`. */
  url: string;
  token: string;
  config: EdgeConfig;
  logger?: Logger;
  hostname?: string;
  version?: string;
  /** Intervalo del ping de aplicación (def. 15 s). */
  heartbeatMs?: number;
  /** Sin señales del servidor durante este tiempo, se reinicia la conexión (def. 45 s). */
  deadAfterMs?: number;
  /** Backoff exponencial de reconexión (def. 1 s → 60 s, con jitter). */
  backoff?: { initialMs?: number; maxMs?: number };
  /** Permite ws:// (sin TLS) hacia hosts que no sean locales. Solo para entornos de prueba. */
  allowInsecure?: boolean;
  driverFactory?: DriverFactory;
}

/** Convierte la URL de Nexo en la del WebSocket del Edge. */
export function edgeWsUrl(url: string): URL {
  const u = new URL(url);
  if (u.protocol === 'http:') u.protocol = 'ws:';
  else if (u.protocol === 'https:') u.protocol = 'wss:';
  else if (u.protocol !== 'ws:' && u.protocol !== 'wss:') throw new Error(`Protocolo no soportado en NEXO_URL: ${u.protocol}`);
  if (!u.pathname.endsWith('/edge/ws')) {
    const base = u.pathname.replace(/\/+$/, '').replace(/\/api$/, '');
    u.pathname = `${base}${EDGE_WS_PATH}`;
  }
  u.search = '';
  u.hash = '';
  return u;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Cliente del Edge: conexión WebSocket **saliente** con Nexo, `hello`, heartbeat, reconexión con backoff
 * exponencial y ejecución de solicitudes. Eventos: `welcome`, `connected`, `disconnected`, `rejected`.
 */
export class EdgeClient extends EventEmitter {
  private readonly url: URL;
  private readonly logger: Logger;
  private readonly handler: RequestHandler;
  private ws?: WebSocket;
  private stopped = true;
  private attempt = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private lastSignal = 0;
  private forceMaxBackoff = false;
  private welcome?: WelcomeMessage;

  constructor(private readonly opts: EdgeClientOptions) {
    super();
    if (!opts.token?.startsWith(EDGE_TOKEN_PREFIX)) throw new Error(`NEXO_EDGE_TOKEN debe empezar por "${EDGE_TOKEN_PREFIX}"`);
    this.url = edgeWsUrl(opts.url);
    if (this.url.protocol === 'ws:' && !LOOPBACK.has(this.url.hostname) && !opts.allowInsecure) {
      throw new Error('NEXO_URL sin TLS solo se admite hacia localhost (use https:// o EDGE_ALLOW_INSECURE=true)');
    }
    this.logger = opts.logger ?? silentLogger;
    this.handler = new RequestHandler(opts.config, this.logger, opts.driverFactory);
  }

  get connected(): boolean {
    return !!this.welcome && this.ws?.readyState === WebSocket.OPEN;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeatTimer);
    const ws = this.ws;
    this.ws = undefined;
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          ws.terminate();
          resolve();
        }, 2000);
        ws.once('close', () => {
          clearTimeout(t);
          resolve();
        });
        ws.close(1000, 'Edge detenido');
      });
    }
    await this.handler.close();
  }

  /** Espera el `welcome` de Nexo (pruebas y arranque). */
  waitForWelcome(timeoutMs = 10_000): Promise<WelcomeMessage> {
    if (this.connected && this.welcome) return Promise.resolve(this.welcome);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.off('welcome', on);
        reject(new Error('Nexo no confirmó la conexión a tiempo'));
      }, timeoutMs);
      const on = (w: WelcomeMessage) => {
        clearTimeout(t);
        resolve(w);
      };
      this.once('welcome', on);
    });
  }

  private connect() {
    if (this.stopped) return;
    this.welcome = undefined;
    const ws = new WebSocket(this.url, {
      headers: { authorization: `Bearer ${this.opts.token}` },
      handshakeTimeout: 15_000,
      maxPayload: 16 * 1024 * 1024,
    });
    this.ws = ws;

    ws.on('open', () => {
      this.lastSignal = Date.now();
      const hello: HelloMessage = {
        type: 'hello',
        version: this.opts.version ?? EDGE_VERSION,
        hostname: this.opts.hostname ?? osHostname(),
        connections: this.handler.connectionKeys,
      };
      ws.send(JSON.stringify(hello));
      this.startHeartbeat(ws);
      this.emit('connected');
      this.logger.info('conectado a Nexo', { url: this.url.origin });
    });
    ws.on('unexpected-response', (_req, res) => {
      const status = res.statusCode ?? 0;
      if (status === 401 || status === 403) {
        this.forceMaxBackoff = true;
        this.logger.error('Nexo rechazó el token del Edge (inválido, rotado o revocado)', { status });
      } else {
        this.logger.warn('Nexo rechazó la conexión', { status });
      }
      this.emit('rejected', status);
      ws.terminate();
    });
    ws.on('ping', () => (this.lastSignal = Date.now()));
    ws.on('pong', () => (this.lastSignal = Date.now()));
    ws.on('message', (data: RawData, isBinary: boolean) => {
      this.lastSignal = Date.now();
      if (!isBinary) void this.onMessage(ws, rawToString(data));
    });
    ws.on('error', (err: Error) => this.logger.warn('error de conexión', { error: err.message }));
    ws.on('close', (code: number, reason: Buffer) => {
      clearInterval(this.heartbeatTimer);
      if (this.ws === ws) this.ws = undefined;
      const wasWelcomed = !!this.welcome;
      this.welcome = undefined;
      if (code === EDGE_CLOSE.replaced || code === EDGE_CLOSE.revoked) this.forceMaxBackoff = true;
      this.emit('disconnected', code);
      if (this.stopped) return;
      this.logger.warn('desconectado de Nexo', { code, reason: reason.toString() || undefined });
      if (wasWelcomed && !this.forceMaxBackoff) this.attempt = 0;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    const initial = this.opts.backoff?.initialMs ?? 1000;
    const max = this.opts.backoff?.maxMs ?? 60_000;
    const base = this.forceMaxBackoff ? max : Math.min(initial * 2 ** this.attempt, max);
    this.forceMaxBackoff = false;
    this.attempt++;
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    this.logger.info('reconexión programada', { inMs: delay, attempt: this.attempt });
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private startHeartbeat(ws: WebSocket) {
    clearInterval(this.heartbeatTimer);
    const every = this.opts.heartbeatMs ?? 15_000;
    const dead = this.opts.deadAfterMs ?? 45_000;
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastSignal > dead) {
        this.logger.warn('Nexo no responde al heartbeat; reconectando');
        ws.terminate();
        return;
      }
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, every);
  }

  private async onMessage(ws: WebSocket, raw: string) {
    let msg: { type?: string; id?: unknown };
    try {
      msg = JSON.parse(raw) as { type?: string; id?: unknown };
    } catch {
      this.logger.warn('mensaje de Nexo no es JSON');
      return;
    }
    switch (msg.type) {
      case 'welcome':
        this.welcome = msg as WelcomeMessage;
        this.attempt = 0;
        this.logger.info('Nexo confirmó la conexión', { edgeId: this.welcome.edgeId, name: this.welcome.name });
        this.emit('welcome', this.welcome);
        return;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      case 'pong':
        return;
      case 'query':
      case 'schema':
      case 'test': {
        if (typeof msg.id !== 'string') return;
        const reply = await this.handler.handle(msg as EdgeRequest);
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reply));
        return;
      }
      default:
        this.logger.debug('mensaje ignorado', { type: msg.type });
    }
  }
}

function rawToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}
