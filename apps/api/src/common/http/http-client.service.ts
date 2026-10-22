import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

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

const MAX_BODY_BYTES = 5 * 1024 * 1024;

/**
 * Cliente HTTP saliente para conectores con timeout, límite de tamaño y protección SSRF
 * (bloquea redes privadas / metadata cloud salvo CONNECTOR_ALLOW_PRIVATE_NETWORKS=true).
 */
@Injectable()
export class HttpClientService {
  private readonly timeoutMs: number;
  private readonly allowPrivate: boolean;

  constructor(config: ConfigService) {
    this.timeoutMs = config.get<number>('http.timeoutMs') ?? 30000;
    this.allowPrivate = config.get<boolean>('http.allowPrivateNetworks') ?? false;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const url = new URL(req.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Protocolo no permitido: ${url.protocol}`);
    await this.assertPublicHost(url.hostname);

    const started = Date.now();
    const res = await fetch(url, {
      method: req.method ?? 'GET',
      headers: req.headers,
      body: req.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(req.timeoutMs ?? this.timeoutMs),
    });

    const rawBody = await this.readLimited(res);
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

  private async readLimited(res: Response): Promise<string> {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BODY_BYTES) throw new Error('La respuesta excede el tamaño máximo permitido (5 MB)');
    return buf.toString('utf8');
  }

  async assertPublicHost(hostname: string): Promise<void> {
    if (this.allowPrivate) return;
    const host = hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
    for (const addr of addresses) {
      if (isPrivateAddress(addr)) throw new Error(`Destino bloqueado por política de red: ${hostname}`);
    }
  }
}

export function isPrivateAddress(ip: string): boolean {
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')
    );
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
