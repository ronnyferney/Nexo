import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { CryptoService } from '../src/common/crypto/crypto.service';
import { createPasswordResetToken } from '../src/modules/auth/password-reset-token';
import { Api, createTestApp, prismaOf } from './utils/app';
import { decodeQp, fakeSmtp, waitForMail, type FakeSmtp } from './utils/fake-smtp';
import { addMember, login, PASSWORD, registerOwner, uniqueEmail, type Session } from './utils/fixtures';

const NEW_PASSWORD = 'Clave-Nueva-Restablecida-1';

const resetToken = (mail: string | undefined) => /restablecer\/(pwr_[\w-]+)/.exec(mail ?? '')?.[1];

describe('Recuperación de contraseña por correo (C1, E2E)', () => {
  describe('sin SMTP', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createTestApp();
    });

    afterAll(async () => {
      await app?.close();
    });

    it('responde 503 exista o no la cuenta (coherente con la verificación de correo)', async () => {
      const s = await registerOwner(app, 'pwr-sin-smtp');
      const known = await new Api(app).post('/auth/password/forgot', { email: s.email }).expect(503);
      const unknown = await new Api(app).post('/auth/password/forgot', { email: uniqueEmail('nadie') }).expect(503);
      const { timestamp: _a, ...knownBody } = known.body as Record<string, unknown>;
      const { timestamp: _b, ...unknownBody } = unknown.body as Record<string, unknown>;
      expect(knownBody).toEqual(unknownBody);
      expect(await prismaOf(app).passwordResetToken.count({ where: { userId: s.userId } })).toBe(0);
    });

    it('el enlace que genera el operador (npm run auth:reset-link) restablece la contraseña y cierra las sesiones', async () => {
      const s = await registerOwner(app, 'pwr-operador');
      const { token } = await createPasswordResetToken(prismaOf(app), s.userId);
      const res = await new Api(app).post('/auth/password/reset', { token, password: NEW_PASSWORD }).expect(200);
      expect(res.body).toEqual({ reset: true, sessionsRevoked: true, apiKeysRevoked: 0 });
      await s.api.get('/auth/me').expect(401);
      expect((await login(app, s.email, NEW_PASSWORD)).status).toBe(200);
      await new Api(app).post('/auth/password/reset', { token, password: 'Otra-Clave-Distinta-2' }).expect(400);
    });
  });

  describe('con el limitador real', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createTestApp({ throttle: true });
    });

    afterAll(async () => {
      await app?.close();
    });

    it('limita las solicitudes por IP (5 cada 15 minutos)', async () => {
      const [a, b] = randomBytes(2);
      const ip = `198.51.${a}.${(b % 250) + 1}`;
      const forgotFrom = () =>
        request(app.getHttpServer())
          .post('/api/auth/password/forgot')
          .set('X-Forwarded-For', ip)
          .send({ email: uniqueEmail('pwr-limite-ip') });
      for (let i = 0; i < 5; i++) expect((await forgotFrom()).status).toBe(503);
      expect((await forgotFrom()).status).toBe(429);
    });
  });

  describe('con SMTP', () => {
    let smtp: FakeSmtp;
    let app: INestApplication;

    beforeAll(async () => {
      smtp = await fakeSmtp();
      process.env.SMTP_URL = `smtp://127.0.0.1:${smtp.port}`;
      process.env.MAIL_FROM = 'Nexo <no-responder@nexo.test>';
      app = await createTestApp();
    });

    afterAll(async () => {
      delete process.env.SMTP_URL;
      delete process.env.MAIL_FROM;
      await app?.close();
      smtp?.server.close();
    });

    const forgot = (email: string) => new Api(app).post('/auth/password/forgot', { email }).expect(202);
    const reset = (token: string | undefined, password = NEW_PASSWORD) =>
      new Api(app).post('/auth/password/reset', { token, password });

    /** Pide el enlace y devuelve el token del correo nuevo que llega a `email`. */
    async function requestLink(email: string): Promise<string> {
      const before = smtp.messages.filter((m) => m.to === email).length;
      await forgot(email);
      const deadline = Date.now() + 5000;
      for (;;) {
        const mails = smtp.messages.filter((m) => m.to === email);
        if (mails.length > before) {
          const token = resetToken(decodeQp(mails[mails.length - 1].data));
          if (!token) throw new Error('El correo de recuperación no trae el enlace');
          return token;
        }
        if (Date.now() > deadline) throw new Error(`No llegó el correo de recuperación a ${email}`);
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    it('sin enumeración: misma respuesta exista o no el correo; solo la cuenta real recibe el enlace', async () => {
      const s = await registerOwner(app, 'pwr-enum');
      const nobody = uniqueEmail('pwr-nadie');
      const known = await forgot(s.email);
      const unknown = await forgot(nobody);
      expect(known.body).toEqual(unknown.body);
      expect(known.body).toMatchObject({ accepted: true });
      expect(resetToken(await waitForMail(smtp, s.email))).toMatch(/^pwr_/);
      await new Promise((r) => setTimeout(r, 300));
      expect(smtp.messages.filter((m) => m.to === nobody)).toHaveLength(0);
      // Solo el hash del token queda en la base.
      const rows = await prismaOf(app).passwordResetToken.findMany({ where: { userId: s.userId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).toBe(CryptoService.sha256(resetToken(await waitForMail(smtp, s.email))!));
    });

    it('restablecer cambia la contraseña e invalida todas las sesiones; el enlace no se puede reutilizar', async () => {
      const s = await registerOwner(app, 'pwr-ok');
      const otherSession = new Api(app, ((await login(app, s.email)).body as { accessToken: string }).accessToken);
      const token = await requestLink(s.email);
      // Un enlace de recuperación nunca sirve como token de sesión.
      await new Api(app, token).get('/auth/me').expect(401);

      const res = await reset(token).expect(200);
      expect(res.body).toEqual({ reset: true, sessionsRevoked: true, apiKeysRevoked: 0 });
      await s.api.get('/auth/me').expect(401);
      await otherSession.get('/auth/me').expect(401);
      expect((await login(app, s.email, PASSWORD)).status).toBe(401);
      expect((await login(app, s.email, NEW_PASSWORD)).status).toBe(200);

      const reused = await reset(token, 'Otra-Clave-Distinta-2').expect(400);
      expect((reused.body as { message: string }).message).toMatch(/no es válido, venció o ya se usó/);
      expect((await login(app, s.email, NEW_PASSWORD)).status).toBe(200);
    });

    it('restablecer consume también los demás enlaces vigentes de la cuenta', async () => {
      const s = await registerOwner(app, 'pwr-varios');
      const first = await requestLink(s.email);
      const second = await requestLink(s.email);
      expect(first).not.toBe(second);
      await reset(second).expect(200);
      await reset(first, 'Otra-Clave-Distinta-3').expect(400);
    });

    it('un enlace vencido, alterado o inventado se rechaza', async () => {
      const s = await registerOwner(app, 'pwr-vencido');
      const token = await requestLink(s.email);
      await reset(`${token}x`).expect(400);
      await reset('pwr_inventado-0123456789').expect(400);
      await reset('inv_no-es-de-recuperacion').expect(400);
      await prismaOf(app).passwordResetToken.updateMany({
        where: { userId: s.userId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await reset(token).expect(400);
      expect((await login(app, s.email, PASSWORD)).status).toBe(200);
    });

    it('dos restablecimientos simultáneos con el mismo enlace: solo uno se aplica', async () => {
      const s = await registerOwner(app, 'pwr-carrera');
      const token = await requestLink(s.email);
      const results = await Promise.all([reset(token, 'Carrera-Clave-Uno-1'), reset(token, 'Carrera-Clave-Dos-2')]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    });

    it('como mucho 3 enlaces vigentes por cuenta: más solicitudes no envían correo', async () => {
      const s = await registerOwner(app, 'pwr-limite');
      // Simultáneas a propósito: antes el conteo y la creación no eran atómicos y llegaba un 4.º enlace.
      await Promise.all(Array.from({ length: 5 }, () => forgot(s.email)));
      // El envío es asíncrono: se esperan los 3 correos (hasta 10 s) y luego un margen para un 4.º que no debe llegar.
      const sent = () => smtp.messages.filter((m) => m.to === s.email).length;
      for (const deadline = Date.now() + 10_000; sent() < 3 && Date.now() < deadline;) {
        await new Promise((r) => setTimeout(r, 50));
      }
      await new Promise((r) => setTimeout(r, 800));
      expect(sent()).toBe(3);
      expect(await prismaOf(app).passwordResetToken.count({ where: { userId: s.userId } })).toBe(3);
    });

    it('cuenta sin verificar pre-creada por otra persona: el dueño del correo toma el control y se revocan las API keys del atacante', async () => {
      // El atacante registra el correo ajeno (queda sin verificar) y deja API keys en su workspace.
      const email = uniqueEmail('pwr-victima');
      await new Api(app)
        .post('/auth/register', { email, name: 'Atacante', password: PASSWORD, workspaceName: 'Señuelo' })
        .expect(201);
      const attacker = new Api(app, ((await login(app, email)).body as { accessToken: string }).accessToken);
      const me = (await attacker.get('/auth/me').expect(200)).body as {
        id: string;
        emailVerifiedAt: string | null;
        activeWorkspaceId: string;
      };
      expect(me.emailVerifiedAt).toBeNull();
      const created = (
        (await attacker.post('/workspace/api-keys', { name: 'Puerta trasera', scopes: ['read'] }).expect(201)).body as {
          key: string;
        }
      ).key;
      // Clave sin creador conocido (anterior a B3) en el workspace donde el atacante es el único administrador.
      const legacy = `nexo_${CryptoService.randomToken(32)}`;
      await prismaOf(app).apiKey.create({
        data: {
          workspaceId: me.activeWorkspaceId,
          name: 'Antigua',
          prefix: legacy.slice(0, 12),
          hash: CryptoService.sha256(legacy),
          scopes: ['*'],
        },
      });
      await new Api(app, created).get('/workflows').expect(200);
      await new Api(app, legacy).get('/workflows').expect(200);

      // El dueño real del correo pide el enlace y elige su contraseña.
      const res = await reset(await requestLink(email)).expect(200);
      expect(res.body).toEqual({ reset: true, sessionsRevoked: true, apiKeysRevoked: 2 });
      await attacker.get('/auth/me').expect(401);
      await new Api(app, created).get('/workflows').expect(401);
      await new Api(app, legacy).get('/workflows').expect(401);
      const owner = new Api(app, ((await login(app, email, NEW_PASSWORD)).body as { accessToken: string }).accessToken);
      expect((await owner.get('/auth/me').expect(200)).body).toMatchObject({ emailVerifiedAt: expect.any(String) });
      const keys = (await owner.get('/workspace/api-keys').expect(200)).body as {
        status: string;
        revokedReason: string;
      }[];
      expect(keys.every((k) => k.status === 'REVOKED' && k.revokedReason === 'account_takeover')).toBe(true);
    });

    it('en un workspace con otro administrador solo se revocan las claves que creó la cuenta recuperada', async () => {
      const email = uniqueEmail('pwr-compartido');
      await new Api(app)
        .post('/auth/register', { email, name: 'Atacante', password: PASSWORD, workspaceName: 'Compartido' })
        .expect(201);
      const loginRes = (await login(app, email)).body as { accessToken: string; workspaceId: string };
      const attacker: Session = {
        api: new Api(app, loginRes.accessToken),
        token: loginRes.accessToken,
        workspaceId: loginRes.workspaceId,
        userId: '',
        email,
        role: 'OWNER',
      };
      const coAdmin = await addMember(app, attacker, { role: 'ADMIN', tag: 'pwr-coadmin' });
      const mine = (
        (await attacker.api.post('/workspace/api-keys', { name: 'Del atacante', scopes: ['read'] }).expect(201))
          .body as { key: string }
      ).key;
      const theirs = (
        (await coAdmin.api.post('/workspace/api-keys', { name: 'Del co-admin', scopes: ['read'] }).expect(201))
          .body as { key: string }
      ).key;
      const legacy = `nexo_${CryptoService.randomToken(32)}`;
      await prismaOf(app).apiKey.create({
        data: {
          workspaceId: attacker.workspaceId,
          name: 'Antigua',
          prefix: legacy.slice(0, 12),
          hash: CryptoService.sha256(legacy),
          scopes: ['*'],
        },
      });

      expect((await reset(await requestLink(email)).expect(200)).body).toMatchObject({ apiKeysRevoked: 1 });
      await new Api(app, mine).get('/workflows').expect(401);
      // El otro administrador pudo crear la clave antigua: no se puede atribuir, se conserva.
      await new Api(app, theirs).get('/workflows').expect(200);
      await new Api(app, legacy).get('/workflows').expect(200);
    });

    it('una cuenta ya verificada conserva sus API keys al restablecer la contraseña', async () => {
      const s = await registerOwner(app, 'pwr-verificada');
      await prismaOf(app).user.update({ where: { id: s.userId }, data: { emailVerifiedAt: new Date() } });
      const key = (
        (await s.api.post('/workspace/api-keys', { name: 'Integración', scopes: ['read'] }).expect(201)).body as {
          key: string;
        }
      ).key;
      expect((await reset(await requestLink(s.email)).expect(200)).body).toMatchObject({ apiKeysRevoked: 0 });
      await new Api(app, key).get('/workflows').expect(200);
    });
  });
});
