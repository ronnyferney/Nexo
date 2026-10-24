import type { INestApplication } from '@nestjs/common';
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { Api, createTestApp, prismaOf } from './utils/app';
import { invitationToken, login, PASSWORD, registerOwner, uniqueEmail, type Session } from './utils/fixtures';

const ATTACKER_PASSWORD = 'Clave-Del-Atacante-1';
const VICTIM_PASSWORD = 'Clave-De-La-Persona-2';

async function invite(owner: Session, email: string, role = 'ADMIN') {
  const res = await owner.api.post('/admin/org/members', { email, name: 'María Gómez', role }).expect(201);
  const body = res.body as { invitation: { id: string }; acceptUrl: string; emailSent: boolean };
  return { ...body, token: invitationToken(body.acceptUrl) };
}

/** Servidor SMTP mínimo en memoria: guarda cada mensaje recibido (destinatario y cuerpo). */
function fakeSmtp(): Promise<{ server: Server; port: number; messages: { to: string; data: string }[] }> {
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
const decodeQp = (text: string) => text.replace(/=\r?\n/g, '').replace(/=3D/g, '=');

describe('Invitaciones y verificación de correo (C1, E2E)', () => {
  let app: INestApplication;
  let client: Session;

  beforeAll(async () => {
    app = await createTestApp();
    client = await registerOwner(app, 'cliente-sa');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('C1: una cuenta pre-registrada por un atacante no obtiene la membresía; la persona real toma el control', async () => {
    const email = uniqueEmail('maria-gomez');
    // 1. El atacante registra el correo de la víctima con una contraseña que conoce.
    await new Api(app)
      .post('/auth/register', { email, name: 'Atacante', password: ATTACKER_PASSWORD, workspaceName: 'Señuelo' })
      .expect(201);
    const attacker = await login(app, email, ATTACKER_PASSWORD);
    const attackerApi = new Api(app, (attacker.body as { accessToken: string }).accessToken);
    expect((await attackerApi.get('/auth/me').expect(200)).body).toMatchObject({ emailVerifiedAt: null });

    // 2. El ADMIN real de «Cliente S.A.» agrega ese correo: se crea una invitación, no una membresía.
    const inv = await invite(client, email);
    const members = (await client.api.get('/admin/org/members').expect(200)).body as { email: string }[];
    expect(members.map((m) => m.email)).not.toContain(email);

    // 3. El atacante inicia sesión y no puede entrar al workspace del cliente.
    const relogin = await login(app, email, ATTACKER_PASSWORD);
    expect(relogin.status).toBe(200);
    expect(relogin.body).not.toMatchObject({ workspaceId: client.workspaceId });
    await attackerApi.post('/auth/switch-workspace', { workspaceId: client.workspaceId }).expect(403);
    const attackerMe = (await attackerApi.get('/auth/me').expect(200)).body as {
      memberships: { workspace: { id: string } }[];
    };
    expect(attackerMe.memberships.map((m) => m.workspace.id)).not.toContain(client.workspaceId);

    // 4. La persona real abre el enlace que recibió: la cuenta existe pero no está verificada, así que el token
    //    demuestra que controla el correo y elige una contraseña nueva.
    expect((await new Api(app).get(`/auth/invitations/${inv.token}`).expect(200)).body).toMatchObject({
      accountExists: true,
      requiresLogin: false,
      role: 'ADMIN',
    });
    await new Api(app).post(`/auth/invitations/${inv.token}/accept`, {}).expect(400);
    const accepted = await new Api(app)
      .post(`/auth/invitations/${inv.token}/accept`, { name: 'María Gómez', password: VICTIM_PASSWORD })
      .expect(200);
    expect(accepted.body).toMatchObject({ workspaceId: client.workspaceId, role: 'ADMIN', sessionsRevoked: true });

    // 5. Las sesiones y la contraseña del atacante dejan de valer; la persona real entra al workspace del cliente.
    await attackerApi.get('/auth/me').expect(401);
    await new Api(app, (relogin.body as { accessToken: string }).accessToken).get('/auth/me').expect(401);
    expect((await login(app, email, ATTACKER_PASSWORD)).status).toBe(401);
    const victim = await login(app, email, VICTIM_PASSWORD);
    expect(victim.status).toBe(200);
    const victimApi = new Api(app, (victim.body as { accessToken: string }).accessToken);
    const me = (await victimApi.get('/auth/me').expect(200)).body as {
      name: string;
      emailVerifiedAt: string | null;
      memberships: { role: string; workspace: { id: string } }[];
    };
    expect(me.emailVerifiedAt).not.toBeNull();
    expect(me.name).toBe('María Gómez');
    expect(me.memberships).toContainEqual(
      expect.objectContaining({ role: 'ADMIN', workspace: expect.objectContaining({ id: client.workspaceId }) }),
    );
    await victimApi.post('/auth/switch-workspace', { workspaceId: client.workspaceId }).expect(200);
  });

  it('un ADMIN no puede invitar con rol OWNER; un OWNER sí', async () => {
    const ws = await registerOwner(app, 'inv-owner');
    const adminInv = await invite(ws, uniqueEmail('admin-inv'), 'ADMIN');
    const admin = await new Api(app)
      .post(`/auth/invitations/${adminInv.token}/accept`, { name: 'Admin Invitado', password: PASSWORD })
      .expect(200);
    const adminApi = new Api(app, (admin.body as { accessToken: string }).accessToken);
    await adminApi.post('/admin/org/members', { email: uniqueEmail('dueno'), role: 'OWNER' }).expect(403);
    await ws.api.post('/admin/org/members', { email: uniqueEmail('dueno'), role: 'OWNER' }).expect(201);
  });

  it('revocar invalida el enlace; invitar de nuevo al mismo correo revoca el enlace anterior', async () => {
    const email = uniqueEmail('revocada');
    const first = await invite(client, email, 'EDITOR');
    const second = await invite(client, email, 'VIEWER');
    await new Api(app).get(`/auth/invitations/${first.token}`).expect(410);
    await new Api(app).post(`/auth/invitations/${first.token}/accept`, { password: PASSWORD }).expect(410);

    const pending = (await client.api.get('/admin/org/invitations').expect(200)).body as {
      id: string;
      email: string;
    }[];
    expect(pending.filter((i) => i.email === email).map((i) => i.id)).toEqual([second.invitation.id]);

    await client.api.delete(`/admin/org/invitations/${second.invitation.id}`).expect(200);
    await new Api(app).get(`/auth/invitations/${second.token}`).expect(410);
    await new Api(app).post(`/auth/invitations/${second.token}/accept`, { password: PASSWORD }).expect(410);
    const after = (await client.api.get('/admin/org/invitations').expect(200)).body as { email: string }[];
    expect(after.map((i) => i.email)).not.toContain(email);
    expect(await prismaOf(app).user.findUnique({ where: { email } })).toBeNull();

    // Otro workspace no ve ni revoca las invitaciones de este.
    const other = await registerOwner(app, 'inv-ajeno');
    const third = await invite(client, email, 'VIEWER');
    await other.api.delete(`/admin/org/invitations/${third.invitation.id}`).expect(404);
    expect(((await other.api.get('/admin/org/invitations').expect(200)).body as unknown[]).length).toBe(0);
  });

  it('una invitación vencida no se puede usar y figura como EXPIRED', async () => {
    const email = uniqueEmail('vencida');
    const inv = await invite(client, email, 'EDITOR');
    await prismaOf(app).invitation.update({
      where: { id: inv.invitation.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await new Api(app).get(`/auth/invitations/${inv.token}`).expect(410);
    await new Api(app).post(`/auth/invitations/${inv.token}/accept`, { password: PASSWORD }).expect(410);
    const list = (await client.api.get('/admin/org/invitations').expect(200)).body as { id: string; status: string }[];
    expect(list.find((i) => i.id === inv.invitation.id)?.status).toBe('EXPIRED');
    await new Api(app).get('/auth/invitations/inv_no-existe').expect(404);
  });

  it('dos aceptaciones simultáneas del mismo enlace: solo una crea la cuenta', async () => {
    const email = uniqueEmail('carrera');
    const inv = await invite(client, email, 'EDITOR');
    const results = await Promise.all(
      [0, 1].map(() =>
        new Api(app).post(`/auth/invitations/${inv.token}/accept`, { name: 'Carrera', password: PASSWORD }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 410]);
    expect(await prismaOf(app).membership.count({ where: { user: { email }, workspaceId: client.workspaceId } })).toBe(
      1,
    );
  });

  it('cambiar la contraseña invalida las demás sesiones y devuelve un token nuevo (B3)', async () => {
    const s = await registerOwner(app, 'cambio-clave');
    const other = new Api(app, ((await login(app, s.email)).body as { accessToken: string }).accessToken);
    const res = await s.api
      .post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Nueva-Clave-789' })
      .expect(200);
    const fresh = new Api(app, (res.body as { accessToken: string }).accessToken);
    await fresh.get('/auth/me').expect(200);
    await s.api.get('/auth/me').expect(401);
    await other.get('/auth/me').expect(401);
  });

  it('sin SMTP la verificación por correo no está disponible (503) y la consola muestra el enlace', async () => {
    const s = await registerOwner(app, 'sin-smtp');
    expect((await new Api(app).get('/auth/config').expect(200)).body).toEqual({
      registrationMode: 'open',
      mailEnabled: false,
    });
    await s.api.post('/auth/verify-email/request').expect(503);
    expect((await invite(client, uniqueEmail('sin-smtp'))).emailSent).toBe(false);
  });

  describe('con REGISTRATION_MODE=invite_only', () => {
    let closed: INestApplication;

    beforeAll(async () => {
      process.env.REGISTRATION_MODE = 'invite_only';
      closed = await createTestApp();
    });

    afterAll(async () => {
      delete process.env.REGISTRATION_MODE;
      await closed?.close();
    });

    it('el registro público responde 403 y solo se entra por invitación', async () => {
      expect((await new Api(closed).get('/auth/config').expect(200)).body).toMatchObject({
        registrationMode: 'invite_only',
      });
      const email = uniqueEmail('cerrado');
      const res = await new Api(closed)
        .post('/auth/register', { email, name: 'Sin Invitación', password: PASSWORD })
        .expect(403);
      expect((res.body as { message: string }).message).toMatch(/registro público está cerrado/);
      expect(await prismaOf(closed).user.findUnique({ where: { email } })).toBeNull();

      const inv = await invite(client, email, 'VIEWER');
      await new Api(closed)
        .post(`/auth/invitations/${inv.token}/accept`, { name: 'Invitada', password: PASSWORD })
        .expect(200);
      expect((await login(closed, email)).body).toMatchObject({ workspaceId: client.workspaceId, role: 'VIEWER' });
    });
  });

  describe('con SMTP configurado', () => {
    let smtp: Awaited<ReturnType<typeof fakeSmtp>>;
    let mailApp: INestApplication;

    beforeAll(async () => {
      smtp = await fakeSmtp();
      process.env.SMTP_URL = `smtp://127.0.0.1:${smtp.port}`;
      process.env.MAIL_FROM = 'Nexo <no-responder@nexo.test>';
      mailApp = await createTestApp();
    });

    afterAll(async () => {
      delete process.env.SMTP_URL;
      delete process.env.MAIL_FROM;
      await mailApp?.close();
      smtp?.server.close();
    });

    it('la invitación se envía al correo invitado con el enlace de aceptación', async () => {
      const owner = await registerOwner(mailApp, 'smtp-owner');
      const email = uniqueEmail('smtp-invitada');
      const inv = await invite(owner, email, 'EDITOR');
      expect(inv.emailSent).toBe(true);
      const mail = smtp.messages.find((m) => m.to === email);
      expect(mail).toBeDefined();
      expect(decodeQp(mail!.data)).toContain(inv.acceptUrl);
    });

    it('verificar el correo exige el enlace Y la sesión de esa cuenta (el atacante no tiene el enlace; la víctima no tiene la sesión)', async () => {
      const s = await registerOwner(mailApp, 'smtp-verifica');
      await s.api.post('/auth/verify-email/request').expect(200);
      const mail = smtp.messages.find((m) => m.to === s.email);
      expect(mail).toBeDefined();
      const token = /verificar-correo\/([\w.-]+)/.exec(decodeQp(mail!.data))?.[1];
      expect(token).toBeTruthy();

      // Sin sesión, con la de otra cuenta o con un token alterado: no verifica.
      await new Api(mailApp).post(`/auth/verify-email/${token}`).expect(401);
      const other = await registerOwner(mailApp, 'smtp-otro');
      await other.api.post(`/auth/verify-email/${token}`).expect(403);
      await s.api.post(`/auth/verify-email/${token}x`).expect(400);
      // Un token de verificación no sirve como token de sesión.
      await new Api(mailApp, token).get('/auth/me').expect(401);

      await s.api.post(`/auth/verify-email/${token}`).expect(200);
      expect((await s.api.get('/auth/me').expect(200)).body).toMatchObject({ emailVerifiedAt: expect.any(String) });
      expect((await s.api.post('/auth/verify-email/request').expect(200)).body).toEqual({
        sent: false,
        alreadyVerified: true,
      });
    });
  });
});
