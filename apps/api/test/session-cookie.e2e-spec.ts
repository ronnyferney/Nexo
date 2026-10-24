import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Api, createTestApp, prismaOf } from './utils/app';
import { invitationToken, login, PASSWORD, registerOwner, uniqueEmail, type Session } from './utils/fixtures';

/** Cookies `nombre=valor` de la respuesta, con sus atributos sin procesar. */
function setCookies(res: request.Response): Record<string, string> {
  const raw = ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []);
  return Object.fromEntries(raw.map((c) => [c.slice(0, c.indexOf('=')), c]));
}

function cookieValue(setCookie: string): string {
  return setCookie.split(';')[0].slice(setCookie.indexOf('=') + 1);
}

interface Browser {
  session: string;
  csrf: string;
}

/** «Navegador» de la prueba: cookies recibidas en el inicio de sesión. */
function browserFrom(res: request.Response): Browser {
  const c = setCookies(res);
  return { session: cookieValue(c.nexo_session), csrf: cookieValue(c.nexo_csrf) };
}

describe('Sesión de la web en cookie HttpOnly y CSRF (M6)', () => {
  let app: INestApplication;
  let owner: Session;
  const http = () => request(app.getHttpServer());
  const withCookie = (t: request.Test, b: Browser) => t.set('Cookie', `nexo_session=${b.session}; nexo_csrf=${b.csrf}`);

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'cookie');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('el login emite la cookie de sesión HttpOnly (Strict, /api) y la cookie CSRF legible (/)', async () => {
    const res = await http().post('/api/auth/login').send({ email: owner.email, password: PASSWORD }).expect(200);
    const c = setCookies(res);
    expect(c.nexo_session).toMatch(/HttpOnly/);
    expect(c.nexo_session).toMatch(/SameSite=Strict/);
    expect(c.nexo_session).toMatch(/Path=\/api(;|$)/);
    expect(c.nexo_session).toMatch(/Max-Age=(3[5-9]\d\d|3600)/); // JWT_EXPIRES_IN=1h en la suite
    expect(c.nexo_session).not.toMatch(/Secure/); // fuera de producción, sin SESSION_COOKIE_SECURE
    expect(cookieValue(c.nexo_session)).toBe((res.body as { accessToken: string }).accessToken);
    expect(c.nexo_csrf).not.toMatch(/HttpOnly/);
    expect(c.nexo_csrf).toMatch(/SameSite=Strict/);
    expect(c.nexo_csrf).toMatch(/Path=\/(;|$)/);
    expect(cookieValue(c.nexo_csrf)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('con la cookie se lee sin CSRF; escribir exige X-CSRF-Token de esa sesión (403 sin él)', async () => {
    const b = browserFrom(await login(app, owner.email));
    expect((await withCookie(http().get('/api/auth/me'), b).expect(200)).body).toMatchObject({ email: owner.email });

    const body = { name: 'Agente por cookie', systemPrompt: 'Responde breve.' };
    const noCsrf = await withCookie(http().post('/api/agents'), b).send(body).expect(403);
    expect((noCsrf.body as { message: string }).message).toMatch(/CSRF/);
    await withCookie(http().post('/api/agents'), b).set('X-CSRF-Token', 'x'.repeat(43)).send(body).expect(403);
    // Un token CSRF de otra sesión (otro inicio de sesión) tampoco vale.
    const other = browserFrom(await login(app, owner.email));
    await withCookie(http().post('/api/agents'), b).set('X-CSRF-Token', other.csrf).send(body).expect(403);
    await withCookie(http().delete('/api/agents/no-existe'), b).expect(403);

    await withCookie(http().post('/api/agents'), b).set('X-CSRF-Token', b.csrf).send(body).expect(201);
  });

  it('el Bearer sigue funcionando sin CSRF (clientes de API y MCP)', async () => {
    await owner.api.post('/agents', { name: 'Agente por Bearer', systemPrompt: 'Hola.' }).expect(201);
  });

  it('una API key no se acepta como cookie de sesión', async () => {
    const key = (await owner.api.post('/workspace/api-keys', { name: 'cookie' }).expect(201)).body as { key: string };
    const res = await http().get('/api/auth/me').set('Cookie', `nexo_session=${key.key}`).expect(401);
    expect(setCookies(res).nexo_session).toMatch(/nexo_session=;/);
    // Por cabecera sigue valiendo.
    await http().get('/api/agents').set('Authorization', `Bearer ${key.key}`).expect(200);
  });

  it('logout revoca esa sesión (cookie y Bearer del mismo token) y borra las cookies; las demás siguen', async () => {
    const res = await login(app, owner.email);
    const b = browserFrom(res);
    const token = (res.body as { accessToken: string }).accessToken;
    const otherSession = new Api(app, ((await login(app, owner.email)).body as { accessToken: string }).accessToken);

    await withCookie(http().post('/api/auth/logout'), b).expect(403); // con cookie, exige CSRF
    const out = await withCookie(http().post('/api/auth/logout'), b).set('X-CSRF-Token', b.csrf).expect(200);
    expect(out.body).toEqual({ loggedOut: true });
    const cleared = setCookies(out);
    expect(cleared.nexo_session).toMatch(/nexo_session=;.*Path=\/api/);
    expect(cleared.nexo_session).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(cleared.nexo_csrf).toMatch(/nexo_csrf=;.*Path=\//);

    const after = await withCookie(http().get('/api/auth/me'), b).expect(401);
    expect(setCookies(after).nexo_session).toMatch(/nexo_session=;/); // la cookie inválida se borra
    await new Api(app, token).get('/auth/me').expect(401);
    await otherSession.get('/auth/me').expect(200);
  });

  it('logout sin sesión (o con la cookie ya inválida) responde 200 y borra las cookies', async () => {
    const res = await http().post('/api/auth/logout').expect(200);
    expect(setCookies(res).nexo_session).toMatch(/nexo_session=;/);
    await http().post('/api/auth/logout').set('Cookie', 'nexo_session=basura').expect(200);
  });

  it('el Bearer también cierra su sesión con logout', async () => {
    const token = ((await login(app, owner.email)).body as { accessToken: string }).accessToken;
    await new Api(app, token).post('/auth/logout').expect(200);
    await new Api(app, token).get('/auth/me').expect(401);
  });

  it('switch-workspace renueva la cookie y cierra la sesión anterior del navegador', async () => {
    const b = browserFrom(await login(app, owner.email));
    const res = await withCookie(http().post('/api/auth/switch-workspace'), b)
      .set('X-CSRF-Token', b.csrf)
      .send({ workspaceId: owner.workspaceId })
      .expect(200);
    const renewed = browserFrom(res);
    expect(renewed.session).not.toBe(b.session);
    expect(renewed.csrf).not.toBe(b.csrf);
    await withCookie(http().get('/api/auth/me'), renewed).expect(200);
    await withCookie(http().get('/api/auth/me'), b).expect(401);
  });

  it('cambiar la contraseña renueva la cookie e invalida las demás sesiones (tokenVersion)', async () => {
    const s = await registerOwner(app, 'cookie-pass');
    const b = browserFrom(await login(app, s.email));
    const res = await withCookie(http().post('/api/auth/change-password'), b)
      .set('X-CSRF-Token', b.csrf)
      .send({ currentPassword: PASSWORD, newPassword: 'Otra-Clave-Segura-456' })
      .expect(200);
    const renewed = browserFrom(res);
    await withCookie(http().get('/api/auth/me'), renewed).expect(200);
    await withCookie(http().get('/api/auth/me'), b).expect(401);
    await s.api.get('/auth/me').expect(401);
  });

  it('si el navegador perdió la cookie CSRF, GET /auth/me la vuelve a emitir', async () => {
    const b = browserFrom(await login(app, owner.email));
    const res = await http().get('/api/auth/me').set('Cookie', `nexo_session=${b.session}`).expect(200);
    expect(cookieValue(setCookies(res).nexo_csrf)).toBe(b.csrf);
  });

  it('aceptar una invitación deja iniciada la sesión en cookie; una cookie vencida no bloquea la aceptación', async () => {
    const email = uniqueEmail('cookie-inv');
    const inv = (await owner.api.post('/admin/org/members', { email, name: 'Invitada', role: 'VIEWER' }).expect(201))
      .body as { acceptUrl: string };
    const res = await http()
      .post(`/api/auth/invitations/${invitationToken(inv.acceptUrl)}/accept`)
      .set('Cookie', 'nexo_session=token-viejo-invalido')
      .send({ name: 'Invitada', password: PASSWORD })
      .expect(200);
    const b = browserFrom(res);
    expect((await withCookie(http().get('/api/auth/me'), b).expect(200)).body).toMatchObject({
      email,
      activeWorkspaceId: owner.workspaceId,
    });
  });
});

describe('Enumeración de correos (B4)', () => {
  let app: INestApplication;
  let owner: Session;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'b4');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('el registro responde lo mismo exista o no el correo, sin sesión, y no toca la cuenta existente', async () => {
    const fresh = uniqueEmail('b4-nuevo');
    const a = await new Api(app).post('/auth/register', { email: fresh, name: 'Nueva', password: PASSWORD });
    const b = await new Api(app).post('/auth/register', {
      email: owner.email.toUpperCase(),
      name: 'Intruso',
      password: 'Clave-Del-Intruso-9',
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(a.status);
    expect(b.body).toEqual(a.body);
    expect(a.body).not.toHaveProperty('accessToken');
    expect(a.headers['set-cookie']).toBeUndefined();
    expect(b.headers['set-cookie']).toBeUndefined();
    // La cuenta nueva existe y entra con su contraseña; la existente conserva la suya.
    expect((await login(app, fresh)).status).toBe(200);
    expect((await login(app, owner.email)).status).toBe(200);
    expect((await login(app, owner.email, 'Clave-Del-Intruso-9')).status).toBe(401);
    expect(await prismaOf(app).user.count({ where: { email: owner.email } })).toBe(1);
  });

  it('el login tarda lo mismo con un correo inexistente que con una contraseña incorrecta', async () => {
    const time = async (email: string) => {
      const start = process.hrtime.bigint();
      const res = await login(app, email, 'Contrasena-Incorrecta-1');
      expect(res.status).toBe(401);
      expect((res.body as { message: string }).message).toBe('Credenciales inválidas');
      return Number(process.hrtime.bigint() - start) / 1e6;
    };
    await time(uniqueEmail('calentamiento'));
    const existing: number[] = [];
    const missing: number[] = [];
    for (let i = 0; i < 5; i++) {
      existing.push(await time(owner.email));
      missing.push(await time(uniqueEmail('b4-no-existe')));
    }
    const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
    const ratio = median(missing) / median(existing);
    // Sin el hash ficticio, el correo inexistente respondía en ~1 ms frente a ~200 ms de bcrypt (ratio ≈ 0,01).
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  }, 60_000);
});
