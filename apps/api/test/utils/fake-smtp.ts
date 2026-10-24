import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

/** Servidor SMTP mínimo en memoria: guarda cada mensaje recibido (destinatario y cuerpo). */
export function fakeSmtp(): Promise<{ server: Server; port: number; messages: { to: string; data: string }[] }> {
  const messages: { to: string; data: string }[] = [];
  const server = createServer((socket: Socket) => {
    let buffer = '';
    let inData = false;
    let to = '';
    let data = '';
    socket.write('220 fake ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            messages.push({ to, data });
            socket.write('250 OK\r\n');
          } else {
            data += `${line.startsWith('..') ? line.slice(1) : line}\n`;
          }
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250 fake\r\n');
        else if (cmd === 'MAIL') socket.write('250 OK\r\n');
        else if (cmd === 'RCPT') {
          to = /<([^>]+)>/.exec(line)?.[1] ?? '';
          socket.write('250 OK\r\n');
        } else if (cmd === 'DATA') {
          inData = true;
          data = '';
          socket.write('354 fin con .\r\n');
        } else if (cmd === 'QUIT') {
          socket.end('221 adiós\r\n');
        } else socket.write('250 OK\r\n');
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port, messages })),
  );
}

/** Quita el «soft line break» de quoted-printable para leer los enlaces del cuerpo. */
export const decodeQp = (text: string) => text.replace(/=\r?\n/g, '').replace(/=3D/g, '=');

export type FakeSmtp = Awaited<ReturnType<typeof fakeSmtp>>;

/** Espera (hasta `timeoutMs`) el primer correo a `to` que cumpla `match`; los envíos en segundo plano tardan un poco. */
export async function waitForMail(
  smtp: FakeSmtp,
  to: string,
  match: (data: string) => boolean = () => true,
  timeoutMs = 5000,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = smtp.messages.find((m) => m.to === to && match(decodeQp(m.data)));
    if (found) return decodeQp(found.data);
    if (Date.now() > deadline) return undefined;
    await new Promise((r) => setTimeout(r, 50));
  }
}
