import type { INestApplication } from '@nestjs/common';
import { Api, createTestApp } from './utils/app';
import { login, uniqueEmail } from './utils/fixtures';

const EMAIL = uniqueEmail('maestro');
const PASSWORD = 'Clave-Maestra-Generada-123';

describe('Usuario maestro del primer arranque y cambio de contraseña (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.BOOTSTRAP_ADMIN_EMAIL = EMAIL.toUpperCase();
    process.env.BOOTSTRAP_ADMIN_PASSWORD = PASSWORD;
    process.env.BOOTSTRAP_WORKSPACE_NAME = 'Nexo E2E';
    app = await createTestApp();
  });

  afterAll(async () => {
    delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    delete process.env.BOOTSTRAP_WORKSPACE_NAME;
    await app.close();
  });

  it('crea el usuario maestro como OWNER del workspace inicial', async () => {
    const res = await login(app, EMAIL, PASSWORD);
    expect(res.status).toBe(200);
    const me = await new Api(app, (res.body as { accessToken: string }).accessToken).get('/auth/me').expect(200);
    expect(me.body).toMatchObject({ email: EMAIL });
    expect((me.body as { memberships: { role: string; workspace: { name: string } }[] }).memberships).toEqual([
      expect.objectContaining({ role: 'OWNER', workspace: expect.objectContaining({ name: 'Nexo E2E' }) }),
    ]);
  });

  it('un segundo arranque no cambia la contraseña ni duplica el workspace', async () => {
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'Otra-Clave-Distinta-456';
    const second = await createTestApp();
    await second.close();
    process.env.BOOTSTRAP_ADMIN_PASSWORD = PASSWORD;
    expect((await login(app, EMAIL, PASSWORD)).status).toBe(200);
    expect((await login(app, EMAIL, 'Otra-Clave-Distinta-456')).status).toBe(401);
  });

  it('cambia la contraseña exigiendo la actual', async () => {
    const token = ((await login(app, EMAIL, PASSWORD)).body as { accessToken: string }).accessToken;
    const api = new Api(app, token);
    await api
      .post('/auth/change-password', { currentPassword: 'incorrecta', newPassword: 'Nueva-Clave-789' })
      .expect(401);
    await api.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: PASSWORD }).expect(400);
    await api.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'corta' }).expect(400);
    await api.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Nueva-Clave-789' }).expect(200);
    expect((await login(app, EMAIL, PASSWORD)).status).toBe(401);
    expect((await login(app, EMAIL, 'Nueva-Clave-789')).status).toBe(200);
    await new Api(app)
      .post('/auth/change-password', { currentPassword: 'x', newPassword: 'Nueva-Clave-000' })
      .expect(401);
  });
});
