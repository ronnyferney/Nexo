import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { LOGIN_ACCOUNT_LIMIT } from '../src/common/guards/login-throttler.guard';
import { createTestApp } from './utils/app';
import { addMember, registerOwner, uniqueEmail, type Session } from './utils/fixtures';

/** IP de documentación (RFC 5737) distinta en cada ejecución: los contadores viven en Redis entre ejecuciones. */
function clientIp(): string {
  const [a, b] = randomBytes(2);
  return `198.51.${a}.${(b % 250) + 1}`;
}

const loginFrom = (app: INestApplication, ip: string, email: string) =>
  request(app.getHttpServer())
    .post('/api/auth/login')
    .set('X-Forwarded-For', ip)
    .send({ email, password: 'Clave-Incorrecta-1' });

const mcpList = (app: INestApplication, token: string) =>
  request(app.getHttpServer())
    .post('/api/mcp')
    .set('Authorization', `Bearer ${token}`)
    .set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

describe('Seguridad de la plataforma (E2E)', () => {
  describe('Limitador de peticiones con IP real y Redis (A5)', () => {
    let app: INestApplication;
    let replica: INestApplication;

    beforeAll(async () => {
      app = await createTestApp({ throttle: true });
      replica = await createTestApp({ throttle: true });
    });

    afterAll(async () => {
      await app?.close();
      await replica?.close();
    });

    it('el límite de login es por IP del cliente (X-Forwarded-For), no global para todos los que pasan por el proxy', async () => {
      const attacker = clientIp();
      for (let i = 0; i < 10; i++) await loginFrom(app, attacker, uniqueEmail('ip')).expect(401);
      const blocked = await loginFrom(app, attacker, uniqueEmail('ip'));
      expect(blocked.status).toBe(429);
      expect(blocked.body.message).toMatch(/Demasiadas solicitudes/);

      // Otro cliente detrás del mismo nginx sigue pudiendo iniciar sesión.
      await loginFrom(app, clientIp(), uniqueEmail('ip')).expect(401);
    });

    it('una IP inventada en X-Forwarded-For no evita el límite: cuenta la IP que agregó el proxy de confianza', async () => {
      const attacker = clientIp();
      for (let i = 0; i < 10; i++) await loginFrom(app, `${clientIp()}, ${attacker}`, uniqueEmail('spoof')).expect(401);
      await loginFrom(app, `${clientIp()}, ${attacker}`, uniqueEmail('spoof')).expect(429);
    });

    it('limita los intentos por cuenta aunque lleguen desde IP distintas (fuerza bruta distribuida)', async () => {
      const victim = uniqueEmail('cuenta');
      for (let i = 0; i < LOGIN_ACCOUNT_LIMIT; i++) {
        await loginFrom(app, clientIp(), i % 2 ? victim.toUpperCase() : victim).expect(401);
      }
      const blocked = await loginFrom(app, clientIp(), victim);
      expect(blocked.status).toBe(429);
      expect(blocked.body.message).toMatch(/para esta cuenta/);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

      await loginFrom(app, clientIp(), uniqueEmail('cuenta')).expect(401);
    });

    it('los contadores se comparten entre réplicas de la API (Redis, no memoria)', async () => {
      const ip = clientIp();
      for (let i = 0; i < 5; i++) await loginFrom(app, ip, uniqueEmail('replica')).expect(401);
      for (let i = 0; i < 5; i++) await loginFrom(replica, ip, uniqueEmail('replica')).expect(401);
      await loginFrom(replica, ip, uniqueEmail('replica')).expect(429);
      await loginFrom(app, ip, uniqueEmail('replica')).expect(429);
    });
  });

  describe('Autorización', () => {
    let app: INestApplication;
    let owner: Session;

    beforeAll(async () => {
      app = await createTestApp();
      owner = await registerOwner(app, 'seguridad');
    });

    afterAll(async () => {
      await app?.close();
    });

    it('/api/mcp exige EDITOR: un VIEWER recibe 403 y un EDITOR o una API key listan las tools (M2)', async () => {
      const viewer = await addMember(app, owner, { role: 'VIEWER' });
      const editor = await addMember(app, owner, { role: 'EDITOR' });
      const key = ((await owner.api.post('/workspace/api-keys', { name: 'MCP' }).expect(201)).body as { key: string })
        .key;

      const denied = await mcpList(app, viewer.token);
      expect(denied.status).toBe(403);
      expect((await mcpList(app, editor.token)).status).toBe(200);
      expect((await mcpList(app, key)).status).toBe(200);
    });

    it('/auth/me y /auth/switch-workspace con API key responden 403, no 500 (I3)', async () => {
      const key = (
        (await owner.api.post('/workspace/api-keys', { name: 'Cuenta' }).expect(201)).body as { key: string }
      ).key;
      const me = await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${key}`);
      expect(me.status).toBe(403);
      expect(me.body.message).toMatch(/sesión de usuario/);
      const sw = await request(app.getHttpServer())
        .post('/api/auth/switch-workspace')
        .set('Authorization', `Bearer ${key}`)
        .send({ workspaceId: owner.workspaceId });
      expect(sw.status).toBe(403);
    });

    describe('Rol OWNER (M3)', () => {
      type Member = { membershipId: string; userId: string; role: string };
      const ownerMembership = async (s: Session) =>
        ((await s.api.get('/admin/org/members').expect(200)).body as Member[]).find((m) => m.userId === s.userId)!;

      it('un ADMIN no puede ascenderse ni ascender a nadie a OWNER, ni crear miembros OWNER', async () => {
        const ws = await registerOwner(app, 'm3-ascenso');
        const admin = await addMember(app, ws, { role: 'ADMIN' });
        const editor = await addMember(app, ws, { role: 'EDITOR' });

        const self = await admin.api.patch(`/admin/org/members/${admin.membershipId}`, { role: 'OWNER' });
        expect(self.status).toBe(403);
        expect(self.body.message).toMatch(/Solo un OWNER/);
        await admin.api.patch(`/admin/org/members/${editor.membershipId}`, { role: 'OWNER' }).expect(403);
        await admin.api
          .post('/admin/org/members', {
            email: uniqueEmail('m3'),
            name: 'Nuevo dueño',
            role: 'OWNER',
            password: 'Clave-Segura-123',
          })
          .expect(403);

        // Sí gestiona el resto de roles.
        await admin.api.patch(`/admin/org/members/${editor.membershipId}`, { role: 'VIEWER' }).expect(200);
        const roles = ((await ws.api.get('/admin/org/members').expect(200)).body as Member[]).map((m) => m.role);
        expect(roles.filter((r) => r === 'OWNER')).toHaveLength(1);
      });

      it('un ADMIN no puede degradar ni retirar al OWNER fundador; cambiar su unidad sí', async () => {
        const ws = await registerOwner(app, 'm3-fundador');
        const admin = await addMember(app, ws, { role: 'ADMIN' });
        const founder = await ownerMembership(ws);

        await admin.api.patch(`/admin/org/members/${founder.membershipId}`, { role: 'ADMIN' }).expect(403);
        await admin.api.delete(`/admin/org/members/${founder.membershipId}`).expect(403);
        await admin.api.patch(`/admin/org/members/${founder.membershipId}`, { role: 'OWNER' }).expect(200);
        expect((await ownerMembership(ws)).role).toBe('OWNER');
      });

      it('un OWNER otorga y retira el rol OWNER, pero el workspace nunca queda sin OWNER', async () => {
        const ws = await registerOwner(app, 'm3-dueno');
        const founder = await ownerMembership(ws);
        const second = await addMember(app, ws, { role: 'ADMIN' });
        await ws.api.patch(`/admin/org/members/${second.membershipId}`, { role: 'OWNER' }).expect(200);

        // Dos OWNER que se degradan a la vez: solo uno puede quedar degradado.
        const results = await Promise.all([
          ws.api.patch(`/admin/org/members/${founder.membershipId}`, { role: 'ADMIN' }),
          second.api.patch(`/admin/org/members/${second.membershipId}`, { role: 'ADMIN' }),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
        const members = (await second.api.get('/admin/org/members').expect(200)).body as Member[];
        expect(members.filter((m) => m.role === 'OWNER')).toHaveLength(1);
      });
    });
  });
});
