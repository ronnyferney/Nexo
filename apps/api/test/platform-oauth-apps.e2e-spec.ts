import type { INestApplication } from '@nestjs/common';
import { Api, createTestApp, prismaOf } from './utils/app';
import { PASSWORD } from './utils/fixtures';

/** La app OAuth de la plataforma se configura una sola vez aquí; luego cualquier workspace conecta con un clic. */
const PLATFORM_ADMIN = 'platform-oauth-admin-e2e@nexo.test';
Object.assign(process.env, { PLATFORM_ADMIN_EMAILS: PLATFORM_ADMIN });

const MS_CLIENT_ID = 'caacab14-22dc-4276-a00d-abf0d650e5a6';
const MS_SECRET = 'abc8Q~valor.del.secreto_de_prueba_123';

describe('Consola de plataforma · apps OAuth de inicio de sesión (E2E)', () => {
  let app: INestApplication;
  let admin: Api;
  let user: Api;

  beforeAll(async () => {
    app = await createTestApp();
    await prismaOf(app).platformOAuthApp.deleteMany({});

    await new Api(app).post('/auth/register', {
      email: PLATFORM_ADMIN,
      name: 'Admin plataforma OAuth',
      password: PASSWORD,
      workspaceName: 'Plataforma OAuth E2E',
    });
    // El administrador de plataforma debe tener el correo verificado (A7).
    await prismaOf(app).user.update({ where: { email: PLATFORM_ADMIN }, data: { emailVerifiedAt: new Date() } });
    const adminLogin = await new Api(app)
      .post('/auth/login', { email: PLATFORM_ADMIN, password: PASSWORD })
      .expect(200);
    admin = new Api(app, (adminLogin.body as { accessToken: string }).accessToken);

    const email = `oauth-user-${Date.now()}@nexo.test`;
    await new Api(app).post('/auth/register', {
      email,
      name: 'Usuario',
      password: PASSWORD,
      workspaceName: 'Cliente OAuth',
    });
    const userLogin = await new Api(app).post('/auth/login', { email, password: PASSWORD }).expect(200);
    user = new Api(app, (userLogin.body as { accessToken: string }).accessToken);
  });

  afterAll(async () => {
    await prismaOf(app).platformOAuthApp.deleteMany({});
    await app?.close();
  });

  it('solo un administrador de plataforma gestiona las apps; un usuario normal recibe 403', async () => {
    await user.get('/platform/oauth-apps').expect(403);
    await user.put('/platform/oauth-apps/microsoft', { clientId: MS_CLIENT_ID, clientSecret: MS_SECRET }).expect(403);
  });

  it('lista los proveedores con sus permisos y la URL de redirección a registrar', async () => {
    const list = (await admin.get('/platform/oauth-apps').expect(200)).body as Array<Record<string, unknown>>;
    const ms = list.find((p) => p.provider === 'microsoft')!;
    expect(ms).toMatchObject({ label: 'Microsoft 365', configured: false, clientIdHint: null });
    expect(ms.redirectUri).toMatch(/\/api\/oauth\/callback$/);
    expect(ms.scopes).toEqual(expect.arrayContaining(['Mail.ReadWrite', 'offline_access', 'User.Read']));
    expect((ms.integrations as string[]).length).toBeGreaterThan(0);
  });

  it('valida el client ID y el secreto de Microsoft, y nunca devuelve el secreto', async () => {
    const notGuid = await admin
      .put('/platform/oauth-apps/microsoft', { clientId: 'no-guid', clientSecret: MS_SECRET })
      .expect(400);
    expect(JSON.stringify(notGuid.body)).toContain('Id. de aplicación (cliente)');
    const secretId = await admin
      .put('/platform/oauth-apps/microsoft', {
        clientId: MS_CLIENT_ID,
        clientSecret: '9f9f9f9f-aaaa-bbbb-cccc-ddddeeeeffff',
      })
      .expect(400);
    expect(JSON.stringify(secretId.body)).toContain('Id. de secreto');

    const ok = await admin
      .put('/platform/oauth-apps/microsoft', { clientId: MS_CLIENT_ID, clientSecret: MS_SECRET })
      .expect(200);
    expect(ok.body).toMatchObject({ provider: 'microsoft', configured: true, source: 'console' });
    expect(JSON.stringify(ok.body)).not.toContain(MS_SECRET);

    // Se guarda cifrado: la fila no contiene el secreto en claro.
    const row = await prismaOf(app).platformOAuthApp.findUnique({ where: { provider: 'microsoft' } });
    expect(row!.clientSecretCipher).not.toContain(MS_SECRET);
    expect(row!.clientSecretCipher.startsWith('v2:')).toBe(true);
  });

  it('una vez configurada, cualquier usuario la usa al instalar sin ver client IDs ni secretos', async () => {
    const catalog = (await user.get('/connector-catalog').expect(200)).body as Array<Record<string, unknown>>;
    const mail = catalog.find((e) => e.id === 'microsoft-mail')!;
    expect(mail.platformApp).toEqual({ available: true, clientIdHint: 'caac…e5a6' });

    // El usuario instala sin credenciales y el inicio de sesión usa el client ID de la plataforma.
    const inst = (
      await user
        .post('/connector-catalog/microsoft-mail/install', { authMethod: 'oauth2_code', credentials: {} })
        .expect(201)
    ).body as {
      id: string;
      authorizeUrl: string;
    };
    expect(new URL(inst.authorizeUrl).searchParams.get('client_id')).toBe(MS_CLIENT_ID);
    expect(JSON.stringify(inst)).not.toContain(MS_SECRET);

    const accounts = (await user.get('/connector-catalog/microsoft-mail/accounts').expect(200)).body as Array<
      Record<string, unknown>
    >;
    expect(accounts[0]).toMatchObject({ connected: false, app: { kind: 'platform', clientIdHint: 'caac…e5a6' } });
  });

  it('eliminar la app deja a las integraciones sin inicio de sesión de plataforma', async () => {
    await admin.delete('/platform/oauth-apps/microsoft').expect(200);
    const catalog = (await user.get('/connector-catalog').expect(200)).body as Array<Record<string, unknown>>;
    const mail = catalog.find((e) => e.id === 'microsoft-mail')!;
    expect(mail.platformApp).toEqual({ available: false, clientIdHint: null });
  });
});
