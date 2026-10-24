import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP } from 'node:net';
import { pipeline, Readable, Transform } from 'node:stream';
import * as zlib from 'node:zlib';
import {
  defaultHostResolver,
  isPrivateAddress,
  NetworkPolicyError,
  pinnedLookup,
  resolvePublicAddresses,
  type HostResolver,
  type ResolvedAddress,
} from './network-policy';

export { isPrivateAddress, NetworkPolicyError, pinnedLookup, type HostResolver, type ResolvedAddress };

/** Token opcional para sustituir el resolutor DNS (pruebas de DNS rebinding). */
export const HTTP_HOST_RESOLVER = Symbol('HTTP_HOST_RESOLVER');

export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: unknown;
  rawBody: string;
  durationMs: number;
}

/** Opciones de `safeFetch()`. Todas son opcionales; los valores por defecto son los del cliente de conectores. */
export interface SafeFetchOptions {
  /** Tiempo máximo (ms) hasta recibir las cabeceras de respuesta. Def.: `http.timeoutMs` (30 s). */
  timeoutMs?: number;
  /**
   * Inactividad máxima del socket (ms), también mientras se lee el cuerpo. `0` la desactiva (flujos SSE largos).
   * Def.: igual a `timeoutMs`.
   */
  idleTimeoutMs?: number;
  /** Bytes máximos del cuerpo de respuesta (ya descomprimido). Def.: 5 MB. */
  maxBodyBytes?: number;
  /**
   * Lista blanca opcional de hosts (sin puerto, en minúsculas). Si se indica, cualquier otro host se rechaza antes de
   * resolver DNS. La política de redes privadas se aplica igualmente.
   */
  allowedHosts?: readonly string[];
}

export const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

/** La respuesta superó el límite de tamaño; se aborta sin terminar de leerla. */
export class ResponseTooLargeError extends Error {
  constructor(limit: number) {
    super(`La respuesta excede el tamaño máximo permitido (${formatBytes(limit)})`);
    this.name = 'ResponseTooLargeError';
  }
}

/**
 * Cliente HTTP saliente con protección SSRF, timeout y límite de tamaño. Toda llamada saliente de la API pasa por
 * aquí (`request()` para conectores, `safeFetch()` para SDK de terceros).
 *
 * Garantías (salvo `CONNECTOR_ALLOW_PRIVATE_NETWORKS=true`, que desactiva solo el bloqueo de redes internas):
 * - Solo `http:`/`https:`.
 * - El host se resuelve UNA vez, se validan todas sus IP con `net.BlockList` (`network-policy.ts`) y el socket se abre
 *   contra esas IP (`lookup` fijado). Sin segunda resolución, no hay DNS rebinding. SNI, certificado y `Host` siguen
 *   usando el nombre original.
 * - Nunca sigue redirecciones (`redirect: 'manual'` siempre): el 3xx se devuelve tal cual al llamador.
 * - Timeout hasta cabeceras + inactividad del socket; `AbortSignal` del llamador respetado.
 * - El cuerpo se lee por flujo contando bytes; se rechaza un `content-length` mayor al límite y se aborta la lectura
 *   en cuanto se supera, sin acumular el resto en memoria.
 *
 * ## `safeFetch()` para SDK (driver LLM, MCP, etc.)
 *
 * ```ts
 * const fetch = this.http.safeFetch({ timeoutMs: 60_000, idleTimeoutMs: 120_000, maxBodyBytes: 20 * 1024 * 1024,
 *   allowedHosts: ['api.anthropic.com'] });
 * new Anthropic({ apiKey, baseURL, fetch });
 * ```
 *
 * Devuelve una función con la firma de `fetch` global (WHATWG `Request`/`Response`, cuerpos en streaming, SSE). Los
 * errores de política se lanzan como `NetworkPolicyError` y los de tamaño como `ResponseTooLargeError` (la lectura
 * de `response.body` falla); los SDK los tratan como error de conexión. No devuelva al usuario el cuerpo crudo de
 * una respuesta de error de un host configurable.
 */
@Injectable()
export class HttpClientService implements OnModuleDestroy {
  private readonly timeoutMs: number;
  private readonly allowPrivate: boolean;
  private readonly resolver: HostResolver;
  // Agentes propios: un socket reutilizado siempre fue abierto contra una IP validada por esta misma política.
  private readonly httpAgent = new http.Agent({ keepAlive: true });
  private readonly httpsAgent = new https.Agent({ keepAlive: true });

  constructor(config: ConfigService, @Optional() @Inject(HTTP_HOST_RESOLVER) resolver?: HostResolver) {
    this.timeoutMs = config.get<number>('http.timeoutMs') ?? 30000;
    this.allowPrivate = config.get<boolean>('http.allowPrivateNetworks') ?? false;
    this.resolver = resolver ?? defaultHostResolver;
  }

  onModuleDestroy(): void {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const timeoutMs = req.timeoutMs ?? this.timeoutMs;
    const started = Date.now();
    let rawBody: string;
    let res: Response;
    try {
      res = await this.dispatch(
        req.url,
        {
          method: req.method ?? 'GET',
          headers: req.headers,
          body: req.body,
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        },
        { timeoutMs, idleTimeoutMs: timeoutMs, maxBodyBytes: DEFAULT_MAX_BODY_BYTES },
      );
      rawBody = await res.text();
    } catch (err) {
      throw translateError(err, timeoutMs);
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    let body: unknown = rawBody;
    if ((headers['content-type'] ?? '').includes('json') && rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    }
    return { status: res.status, ok: res.ok, headers, body, rawBody, durationMs: Date.now() - started };
  }

  /**
   * `fetch` compatible con el global que aplica la política de red de este servicio (ver doc. de la clase).
   * Pensado para SDK que aceptan un `fetch` propio (Anthropic, MCP...).
   */
  safeFetch(options: SafeFetchOptions = {}): typeof fetch {
    const opts = {
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      idleTimeoutMs: options.idleTimeoutMs ?? options.timeoutMs ?? this.timeoutMs,
      maxBodyBytes: options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
      allowedHosts: options.allowedHosts?.map((h) => h.toLowerCase()),
    };
    return (input: RequestInfo | URL, init?: RequestInit) => this.dispatch(input, init, opts);
  }

  /**
   * Valida un destino (nombre o IP) y devuelve las IP a las que DEBE conectarse el llamador, o `null` si la política
   * de redes privadas está desactivada. Úsela en clientes que no son HTTP (drivers de base de datos): conecte a la IP
   * devuelta y use el nombre solo para TLS/SNI.
   */
  async resolvePublicHost(hostname: string): Promise<ResolvedAddress[] | null> {
    if (this.allowPrivate) return null;
    return resolvePublicAddresses(hostname, this.resolver);
  }

  /** Lanza `NetworkPolicyError` si el destino es interno. Prefiera `resolvePublicHost()` y conectar a la IP. */
  async assertPublicHost(hostname: string): Promise<void> {
    await this.resolvePublicHost(hostname);
  }

  private async dispatch(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    opts: { timeoutMs: number; idleTimeoutMs: number; maxBodyBytes: number; allowedHosts?: string[] },
  ): Promise<Response> {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Protocolo no permitido: ${url.protocol}`);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (opts.allowedHosts && !opts.allowedHosts.includes(host.toLowerCase()))
      throw new NetworkPolicyError(url.hostname);
    const addresses = await this.resolvePublicHost(host);

    const method = request.method.toUpperCase();
    const body =
      request.body && method !== 'GET' && method !== 'HEAD' ? Buffer.from(await request.arrayBuffer()) : undefined;
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => (headers[k] = v));
    headers['accept'] ??= '*/*';
    headers['user-agent'] ??= 'Nexo/1.0';
    headers['accept-encoding'] ??= 'gzip, deflate, br';
    if (body) headers['content-length'] = String(body.byteLength);
    const signal = request.signal;
    signal.throwIfAborted();

    const isHttps = url.protocol === 'https:';
    const options: https.RequestOptions = {
      protocol: url.protocol,
      hostname: host,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method,
      headers,
      agent: isHttps ? this.httpsAgent : this.httpAgent,
      ...(addresses ? { lookup: pinnedLookup(addresses) } : {}),
      ...(isHttps && !isIP(host) ? { servername: host } : {}),
    };

    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      let incoming: http.IncomingMessage | undefined;
      const req = (isHttps ? https : http).request(options);
      const fail = (err: Error) => {
        clearTimeout(headerTimer);
        if (!settled) {
          settled = true;
          reject(err);
        }
        // Con la respuesta ya entregada, el error llega al lector del cuerpo a través del flujo.
        incoming?.destroy(err);
        req.destroy(err);
      };
      const onAbort = () => {
        const reason: unknown = signal.reason;
        fail(reason instanceof Error ? reason : new DOMException('Operación abortada', 'AbortError'));
      };
      const headerTimer = setTimeout(
        () => fail(new Error(`Tiempo de espera agotado (${opts.timeoutMs} ms) esperando a ${url.host}`)),
        opts.timeoutMs,
      );
      signal.addEventListener('abort', onAbort, { once: true });
      if (opts.idleTimeoutMs > 0) {
        req.setTimeout(opts.idleTimeoutMs, () =>
          req.destroy(new Error(`Conexión inactiva por más de ${opts.idleTimeoutMs} ms con ${url.host}`)),
        );
      }
      req.on('error', fail);
      req.on('close', () => clearTimeout(headerTimer));
      req.on('response', (res) => {
        clearTimeout(headerTimer);
        incoming = res;
        res.on('close', () => signal.removeEventListener('abort', onAbort));
        try {
          const response = this.toResponse(res, request, url, method, opts.maxBodyBytes);
          settled = true;
          resolve(response);
        } catch (err) {
          res.destroy();
          fail(err instanceof Error ? err : new Error(String(err)));
        }
      });
      req.end(body);
    });
  }

  private toResponse(
    res: http.IncomingMessage,
    request: Request,
    url: URL,
    method: string,
    maxBodyBytes: number,
  ): Response {
    const status = res.statusCode ?? 0;
    if (status < 200 || status > 599) throw new Error(`Respuesta HTTP inválida (${status}) de ${url.host}`);
    if (status >= 300 && status < 400 && request.redirect === 'error') {
      throw new TypeError(`Redirección no permitida desde ${url.host}`);
    }
    const declared = Number(res.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBodyBytes) throw new ResponseTooLargeError(maxBodyBytes);

    const headers = new Headers();
    for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) {
      try {
        headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
      } catch {
        // Cabecera inválida según WHATWG: se descarta.
      }
    }

    let body: ReadableStream<Uint8Array> | null = null;
    if (method === 'HEAD' || NULL_BODY_STATUS.has(status)) {
      res.resume();
    } else {
      body = Readable.toWeb(limitBody(res, maxBodyBytes)) as unknown as ReadableStream<Uint8Array>;
    }
    const response = new Response(body, { status, statusText: res.statusMessage ?? '', headers });
    Object.defineProperty(response, 'url', { value: url.toString() });
    return response;
  }
}

/** Descomprime si hace falta y corta el flujo al superar `limit` bytes (descomprimidos). */
function limitBody(res: http.IncomingMessage, limit: number): Readable {
  let total = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > limit) cb(new ResponseTooLargeError(limit));
      else cb(null, chunk);
    },
  });
  const decoder = decoderFor(res.headers['content-encoding']);
  const done = () => undefined; // los errores se propagan al último flujo (y de ahí al ReadableStream)
  return decoder ? pipeline(res, decoder, limiter, done) : pipeline(res, limiter, done);
}

function decoderFor(encoding: string | undefined): Transform | undefined {
  const enc = (encoding ?? '').trim().toLowerCase();
  const flush = { flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH };
  if (enc === 'gzip' || enc === 'x-gzip') return zlib.createGunzip(flush);
  if (enc === 'deflate') return zlib.createInflate(flush);
  if (enc === 'br') return zlib.createBrotliDecompress();
  return undefined;
}

function translateError(err: unknown, timeoutMs: number): unknown {
  if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return new Error(`Tiempo de espera agotado (${timeoutMs} ms)`);
  }
  // `Response.text()` envuelve a veces el error del flujo; se conserva el mensaje original.
  if (err instanceof TypeError && err.cause instanceof Error) return err.cause;
  return err;
}

function formatBytes(n: number): string {
  return n % (1024 * 1024) === 0 ? `${n / (1024 * 1024)} MB` : `${n} bytes`;
}
