import * as http from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { gzipSync } from 'node:zlib';
import {
  HttpClientService,
  NetworkPolicyError,
  ResponseTooLargeError,
  type HostResolver,
  type ResolvedAddress,
} from './http-client.service';

const config = (allowPrivateNetworks: boolean) =>
  ({ get: (k: string) => (k === 'http.allowPrivateNetworks' ? allowPrivateNetworks : undefined) }) as never;

interface TestServer {
  port: number;
  origin: string;
  /** Bytes del cuerpo que el servidor llegó a escribir en la ruta /enorme. */
  bigBytesWritten: () => number;
  close: () => Promise<void>;
}

const BIG_TOTAL = 64 * 1024 * 1024;

async function startServer(): Promise<TestServer> {
  let written = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/eco') {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ method: req.method, host: req.headers.host, body, path: req.url }));
      });
      return;
    }
    if (url.pathname === '/enorme') {
      // Flujo de 64 MB sin content-length, escrito respetando la contrapresión del cliente.
      res.writeHead(200, { 'content-type': 'text/plain' });
      const chunk = Buffer.alloc(64 * 1024, 97);
      const pump = () => {
        while (written < BIG_TOTAL) {
          written += chunk.length;
          if (!res.write(chunk)) return void res.once('drain', pump);
        }
        res.end();
      };
      res.on('close', () => (written = Math.min(written, BIG_TOTAL)));
      pump();
      return;
    }
    if (url.pathname === '/declara-grande') {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': String(6 * 1024 * 1024) });
      res.write('a'); // nunca completa el cuerpo: el cliente debe rechazar por la cabecera
      return;
    }
    if (url.pathname === '/redirige') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      return void res.end();
    }
    if (url.pathname === '/gzip') {
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      return void res.end(gzipSync(JSON.stringify({ comprimido: true })));
    }
    if (url.pathname === '/lento') return; // nunca responde
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    bigBytesWritten: () => written,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

describe('HttpClientService', () => {
  let srv: TestServer;
  const clients: HttpClientService[] = [];
  const client = (allowPrivate: boolean, resolver?: HostResolver) => {
    const c = new HttpClientService(config(allowPrivate), resolver);
    clients.push(c);
    return c;
  };

  beforeAll(async () => (srv = await startServer()));
  afterAll(async () => {
    clients.forEach((c) => c.onModuleDestroy());
    await srv.close();
  });

  describe('política SSRF (A3)', () => {
    it.each([
      'http://[::ffff:7f00:1]/',
      'http://[::ffff:a9fe:a9fe]/latest/meta-data/',
      'http://[0:0:0:0:0:ffff:7f00:1]/',
      'http://[64:ff9b::7f00:1]/',
      'http://[2002:7f00:1::]/',
      'http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/',
      'http://[fec0::1]/',
      'http://[fd00:ec2::254]/',
      'http://0.0.0.0/',
      'http://0x7f.1/',
      'http://2130706433/',
      'http://169.254.169.254/latest/meta-data/',
    ])('bloquea %s antes de conectar', async (url) => {
      await expect(client(false).request({ url })).rejects.toBeInstanceOf(NetworkPolicyError);
    });

    it('bloquea un nombre que resuelve a una IP interna', async () => {
      const resolver = jest.fn(async () => [{ address: '::ffff:7f00:1', family: 6 as const }]);
      await expect(client(false, resolver).request({ url: 'http://interno.example/' })).rejects.toThrow(
        'Destino bloqueado por política de red: interno.example',
      );
    });

    it('rechaza protocolos distintos de http(s)', async () => {
      await expect(client(true).request({ url: 'file:///etc/passwd' })).rejects.toThrow(/Protocolo no permitido/);
    });

    it('DNS rebinding: resuelve una vez y conecta a la IP validada aunque el DNS cambie de respuesta', async () => {
      // 1.ª respuesta pública, 2.ª respuesta loopback (el ataque clásico de rebinding).
      const answers: ResolvedAddress[][] = [
        [{ address: '93.184.215.14', family: 4 }],
        [{ address: '127.0.0.1', family: 4 }],
      ];
      const resolver = jest.fn(async () => answers.shift() ?? [{ address: '127.0.0.1', family: 4 as const }]);
      const svc = client(false, resolver);

      // Agente que registra a qué IP habría conectado el socket (vía el `lookup` fijado) y lo desvía al servidor local.
      const connectedTo: unknown[] = [];
      class RecordingAgent extends http.Agent {
        createConnection(options: http.ClientRequestArgs): Socket {
          const lookup = options.lookup as unknown as (
            h: string,
            o: object,
            cb: (e: unknown, a: unknown) => void,
          ) => void;
          lookup(String(options.host), {}, (_e, address) => connectedTo.push(address));
          return connect(srv.port, '127.0.0.1');
        }
      }
      (svc as unknown as { httpAgent: http.Agent }).httpAgent = new RecordingAgent();

      const res = await svc.request({ url: 'http://rebind.example/eco' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ host: 'rebind.example' }); // Host conserva el nombre original
      expect(connectedTo).toEqual(['93.184.215.14']);
      expect(resolver).toHaveBeenCalledTimes(1);

      // La siguiente petición vuelve a validar su propia resolución: ahora apunta a loopback y se bloquea.
      await expect(svc.request({ url: 'http://rebind.example/eco' })).rejects.toBeInstanceOf(NetworkPolicyError);
      expect(connectedTo).toHaveLength(1);
    });
  });

  describe('límite de tamaño por flujo (M5)', () => {
    it('aborta al superar el límite sin leer el cuerpo completo', async () => {
      await expect(client(true).request({ url: `${srv.origin}/enorme` })).rejects.toThrow(
        'La respuesta excede el tamaño máximo permitido (5 MB)',
      );
      // El servidor escribía 64 MB; la lectura se cortó cerca de los 5 MB (más los búferes del socket).
      await new Promise((r) => setTimeout(r, 50));
      expect(srv.bigBytesWritten()).toBeLessThan(16 * 1024 * 1024);
    });

    it('rechaza de inmediato un content-length mayor al límite', async () => {
      const started = Date.now();
      await expect(client(true).request({ url: `${srv.origin}/declara-grande` })).rejects.toBeInstanceOf(
        ResponseTooLargeError,
      );
      expect(Date.now() - started).toBeLessThan(2000);
    });

    it('safeFetch aplica su propio límite al leer response.body', async () => {
      const fetch = client(true).safeFetch({ maxBodyBytes: 1024 });
      const res = await fetch(`${srv.origin}/enorme`);
      expect(res.status).toBe(200);
      await expect(res.text()).rejects.toBeInstanceOf(ResponseTooLargeError);
    });
  });

  describe('comportamiento HTTP', () => {
    it('envía método, cuerpo y Host; interpreta JSON', async () => {
      const res = await client(true).request({ url: `${srv.origin}/eco?a=1`, method: 'POST', body: 'hola' });
      expect(res.body).toMatchObject({ method: 'POST', body: 'hola', host: `127.0.0.1:${srv.port}`, path: '/eco?a=1' });
    });

    it('no sigue redirecciones (el 3xx llega al llamador)', async () => {
      const res = await client(true).request({ url: `${srv.origin}/redirige` });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('http://169.254.169.254/latest/meta-data/');
      const viaFetch = await client(true).safeFetch()(`${srv.origin}/redirige`, { redirect: 'follow' });
      expect(viaFetch.status).toBe(302);
    });

    it('descomprime gzip', async () => {
      expect((await client(true).request({ url: `${srv.origin}/gzip` })).body).toEqual({ comprimido: true });
    });

    it('corta por timeout', async () => {
      await expect(client(true).request({ url: `${srv.origin}/lento`, timeoutMs: 150 })).rejects.toThrow(
        /Tiempo de espera agotado/,
      );
    });

    it('safeFetch respeta el AbortSignal del llamador', async () => {
      const ctrl = new AbortController();
      const pending = client(true).safeFetch()(`${srv.origin}/lento`, { signal: ctrl.signal });
      ctrl.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('safeFetch con allowedHosts rechaza cualquier otro host', async () => {
      const fetch = client(true).safeFetch({ allowedHosts: ['api.anthropic.com'] });
      await expect(fetch(`${srv.origin}/eco`)).rejects.toBeInstanceOf(NetworkPolicyError);
    });

    it('safeFetch devuelve un Response estándar (json, headers, url)', async () => {
      const res = await client(true).safeFetch()(new Request(`${srv.origin}/eco`, { method: 'PUT', body: 'x' }));
      expect(res.ok).toBe(true);
      expect(res.headers.get('content-type')).toBe('application/json');
      expect(res.url).toBe(`${srv.origin}/eco`);
      expect(await res.json()).toMatchObject({ method: 'PUT', body: 'x' });
    });
  });
});
