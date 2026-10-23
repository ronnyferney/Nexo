import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { WebSocketServer, type WebSocket } from 'ws';
import { EdgeClient, edgeWsUrl } from './client';
import { parseEdgeConfig } from './config';
import type { DbDriver } from './core/drivers';

const TOKEN = 'nexoedge_prueba';
const config = parseEdgeConfig('connections:\n  local:\n    engine: postgres\n    host: h\n    database: d\n    user: u\n', {});
const driver: DbDriver = {
  engine: 'postgres',
  query: async () => ({ rows: [{ n: 1 }], rowCount: 1, truncated: false, fields: [{ name: 'n' }] }),
  listSchema: async () => [],
  ping: async () => ({ version: 'PostgreSQL 16' }),
  close: async () => {},
};

describe('edgeWsUrl', () => {
  it('deriva la URL del WebSocket', () => {
    assert.equal(edgeWsUrl('https://nexo.ejemplo.com').href, 'wss://nexo.ejemplo.com/api/edge/ws');
    assert.equal(edgeWsUrl('https://nexo.ejemplo.com/api/').href, 'wss://nexo.ejemplo.com/api/edge/ws');
    assert.equal(edgeWsUrl('http://localhost:3000').href, 'ws://localhost:3000/api/edge/ws');
    assert.equal(edgeWsUrl('wss://x.com/api/edge/ws').href, 'wss://x.com/api/edge/ws');
  });

  it('exige TLS fuera de localhost', () => {
    assert.throws(() => new EdgeClient({ url: 'http://nexo.ejemplo.com', token: TOKEN, config }), /TLS/);
    assert.throws(() => new EdgeClient({ url: 'https://nexo.ejemplo.com', token: 'otro', config }), /nexoedge_/);
  });
});

describe('EdgeClient contra un servidor simulado', () => {
  const server = createServer();
  const wss = new WebSocketServer({ noServer: true });
  const sockets: WebSocket[] = [];
  const messages: Record<string, unknown>[] = [];
  let url = '';
  let rejectNext = false;

  before(async () => {
    server.on('upgrade', (req: IncomingMessage, socket, head) => {
      if (req.headers.authorization !== `Bearer ${TOKEN}` || rejectNext) {
        rejectNext = false;
        socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        sockets.push(ws);
        ws.on('message', (d) => {
          const msg = JSON.parse(String(d)) as Record<string, unknown>;
          messages.push(msg);
          if (msg.type === 'hello') ws.send(JSON.stringify({ type: 'welcome', edgeId: 'e1', name: 'Prueba' }));
        });
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    wss.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  it('hello, solicitudes, heartbeat y reconexión con backoff', async () => {
    const client = new EdgeClient({
      url,
      token: TOKEN,
      config,
      hostname: 'host-prueba',
      version: '1.2.3',
      heartbeatMs: 50,
      backoff: { initialMs: 20, maxMs: 100 },
      driverFactory: () => driver,
    });
    client.start();
    await client.waitForWelcome(2000);
    assert.deepEqual(messages[0], { type: 'hello', version: '1.2.3', hostname: 'host-prueba', connections: ['local'] });

    // Solicitud de consulta → resultado con el mismo id.
    const reply = new Promise<Record<string, unknown>>((resolve) => {
      sockets[0].on('message', (d) => {
        const m = JSON.parse(String(d)) as Record<string, unknown>;
        if (m.type === 'result') resolve(m);
      });
    });
    sockets[0].send(
      JSON.stringify({ type: 'query', id: 'q1', connectionKey: 'local', sql: 'SELECT 1 AS n', params: {}, mode: 'read' }),
    );
    const result = await reply;
    assert.equal(result.id, 'q1');
    assert.deepEqual((result.data as { rows: unknown[] }).rows, [{ n: 1 }]);

    // Heartbeat de aplicación.
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(messages.some((m) => m.type === 'ping'));

    // El servidor cierra → el cliente reconecta solo (y un 401 intermedio solo retrasa el reintento).
    rejectNext = true;
    const rejected = new Promise<number>((resolve) => client.once('rejected', resolve));
    sockets[0].close(1012, 'reinicio');
    assert.equal(await rejected, 401);
    await client.waitForWelcome(3000);
    assert.equal(sockets.length, 2);
    assert.equal(client.connected, true);
    await client.stop();
    assert.equal(client.connected, false);
  });
});
