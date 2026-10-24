import type { INestApplication } from '@nestjs/common';
import { Api, createTestApp, prismaOf } from './utils/app';
import {
  addMember,
  adminUnits,
  createAgent,
  publishAgent,
  createUnit,
  invitationToken,
  login,
  PASSWORD,
  registerOwner,
  rootUnit,
  uniqueEmail,
  type Session,
} from './utils/fixtures';

describe('Gobierno de IA · organización, miembros y roles (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('Unidad raíz', () => {
    it('el registro crea una unidad raíz y /admin/org/units la marca isRoot', async () => {
      const owner = await registerOwner(app, 'raiz');
      const units = await adminUnits(owner);
      expect(units).toHaveLength(1);
      expect(units[0]).toMatchObject({ parentId: null, isRoot: true, memberCount: 1, allowedModels: [] });

      const simple = (await owner.api.get('/org/units').expect(200)).body as unknown[];
      expect(simple).toEqual([{ id: units[0].id, name: units[0].name, parentId: null }]);

      const members = (await owner.api.get('/admin/org/members').expect(200)).body as {
        orgUnitId: string;
        role: string;
      }[];
      expect(members).toEqual([expect.objectContaining({ role: 'OWNER', orgUnitId: units[0].id })]);
    });
  });

  describe('Árbol de unidades', () => {
    let owner: Session;
    let rootId: string;

    beforeAll(async () => {
      owner = await registerOwner(app, 'arbol');
      rootId = (await rootUnit(owner)).id;
    });

    it('crea subunidades anidadas y valida el padre', async () => {
      const a = await createUnit(owner, 'Comercial', rootId);
      const b = await createUnit(owner, 'Ventas', a.id);
      const units = await adminUnits(owner);
      expect(units.find((u) => u.id === b.id)).toMatchObject({ parentId: a.id, isRoot: false });

      await owner.api.post('/admin/org/units', { name: 'Huérfana', parentId: 'no-existe' }).expect(404);
      await owner.api.post('/admin/org/units', { name: 'Sin padre' }).expect(400);
      await owner.api.post('/admin/org/units', { name: 'X', parentId: rootId }).expect(400); // nombre muy corto
    });

    it('impide ciclos: mover un padre dentro de su hijo (o de sí mismo) responde 400', async () => {
      const a = await createUnit(owner, 'Operaciones', rootId);
      const b = await createUnit(owner, 'Logística', a.id);
      const c = await createUnit(owner, 'Bodega', b.id);

      await owner.api.patch(`/admin/org/units/${a.id}`, { parentId: c.id }).expect(400);
      await owner.api.patch(`/admin/org/units/${a.id}`, { parentId: b.id }).expect(400);
      await owner.api.patch(`/admin/org/units/${a.id}`, { parentId: a.id }).expect(400);
      await owner.api.patch(`/admin/org/units/${rootId}`, { parentId: a.id }).expect(400);

      // Un movimiento válido sí se permite.
      const moved = await owner.api.patch(`/admin/org/units/${c.id}`, { parentId: a.id }).expect(200);
      expect(moved.body).toMatchObject({ id: c.id, parentId: a.id });
      const units = await adminUnits(owner);
      expect(units.find((u) => u.id === a.id)?.parentId).toBe(rootId);
    });

    it('eliminar una unidad mueve hijos, miembros y agentes al padre; la raíz no se elimina', async () => {
      const a = await createUnit(owner, 'Finanzas', rootId);
      const b = await createUnit(owner, 'Contabilidad', a.id);
      const c = await createUnit(owner, 'Impuestos', b.id);
      const member = await addMember(app, owner, { role: 'EDITOR', orgUnitId: b.id });
      const agent = await createAgent(owner, { costCenterId: b.id });

      await owner.api.delete(`/admin/org/units/${b.id}`).expect(200);

      const units = await adminUnits(owner);
      expect(units.find((u) => u.id === b.id)).toBeUndefined();
      expect(units.find((u) => u.id === c.id)?.parentId).toBe(a.id);
      expect(units.find((u) => u.id === a.id)?.memberCount).toBe(1);

      const members = (await owner.api.get('/admin/org/members').expect(200)).body as {
        userId: string;
        orgUnitId: string;
      }[];
      expect(members.find((m) => m.userId === member.userId)?.orgUnitId).toBe(a.id);

      const agentRow = (await owner.api.get(`/agents/${agent.id}`).expect(200)).body as { costCenterId: string };
      expect(agentRow.costCenterId).toBe(a.id);

      await owner.api.delete(`/admin/org/units/${rootId}`).expect(400);
      await owner.api.delete('/admin/org/units/no-existe').expect(404);
      expect((await adminUnits(owner)).some((u) => u.id === rootId && u.isRoot)).toBe(true);
    });

    it('allowedModels se guarda y se puede vaciar', async () => {
      const unit = await createUnit(owner, 'Restringida', rootId);
      await owner.api.patch(`/admin/org/units/${unit.id}`, { allowedModels: ['mock:mock-echo'] }).expect(200);
      expect((await adminUnits(owner)).find((u) => u.id === unit.id)?.allowedModels).toEqual(['mock:mock-echo']);
      await owner.api.patch(`/admin/org/units/${unit.id}`, { allowedModels: [] }).expect(200);
      expect((await adminUnits(owner)).find((u) => u.id === unit.id)?.allowedModels).toEqual([]);
    });
  });

  describe('Miembros', () => {
    let owner: Session;
    let rootId: string;

    beforeAll(async () => {
      owner = await registerOwner(app, 'miembros');
      rootId = (await rootUnit(owner)).id;
    });

    it('el alta crea una invitación (no una cuenta); al aceptarla con contraseña la persona puede iniciar sesión', async () => {
      const email = uniqueEmail('nuevo');
      const unit = await createUnit(owner, 'Soporte', rootId);
      const created = await owner.api
        .post('/admin/org/members', {
          email: email.toUpperCase(),
          name: 'Ana Nueva',
          role: 'EDITOR',
          orgUnitId: unit.id,
        })
        .expect(201);
      expect(created.body).toMatchObject({
        invitation: { email, name: 'Ana Nueva', role: 'EDITOR', orgUnitId: unit.id, status: 'PENDING' },
        acceptUrl: expect.stringMatching(/\/invitacion\/inv_[\w-]{43}$/),
        emailSent: false,
      });
      // Todavía no hay cuenta ni membresía.
      expect(await prismaOf(app).user.findUnique({ where: { email } })).toBeNull();
      await login(app, email).then((r) => expect(r.status).toBe(401));

      const token = invitationToken((created.body as { acceptUrl: string }).acceptUrl);
      const preview = (await new Api(app).get(`/auth/invitations/${token}`).expect(200)).body;
      expect(preview).toMatchObject({
        email: 'e***@nexo.test',
        role: 'EDITOR',
        accountExists: false,
        requiresLogin: false,
      });
      await new Api(app).post(`/auth/invitations/${token}/accept`, {}).expect(400);
      const accepted = await new Api(app).post(`/auth/invitations/${token}/accept`, { password: PASSWORD }).expect(200);
      expect(accepted.body).toMatchObject({ workspaceId: owner.workspaceId, role: 'EDITOR' });
      const user = await prismaOf(app).user.findUniqueOrThrow({ where: { email } });
      expect(user).toMatchObject({ name: 'Ana Nueva', emailVerifiedAt: expect.any(Date) });

      const res = await login(app, email);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ workspaceId: owner.workspaceId, role: 'EDITOR' });
      // Un solo uso, y un miembro no se vuelve a invitar.
      await new Api(app).post(`/auth/invitations/${token}/accept`, { password: PASSWORD }).expect(410);
      await owner.api.post('/admin/org/members', { email, name: 'Ana Nueva', role: 'EDITOR' }).expect(409);
      // El alta ya no acepta contraseña (la elige la persona).
      await owner.api
        .post('/admin/org/members', { email: uniqueEmail('x'), name: 'Con Clave', role: 'EDITOR', password: PASSWORD })
        .expect(400);
    });

    it('una cuenta existente y verificada acepta solo con su propia sesión; sin orgUnitId queda en la raíz', async () => {
      const other = await registerOwner(app, 'existente');
      await prismaOf(app).user.update({ where: { id: other.userId }, data: { emailVerifiedAt: new Date() } });
      const invited = await owner.api
        .post('/admin/org/members', { email: other.email.toUpperCase(), role: 'VIEWER' })
        .expect(201);
      const token = invitationToken((invited.body as { acceptUrl: string }).acceptUrl);
      expect((await new Api(app).get(`/auth/invitations/${token}`).expect(200)).body).toMatchObject({
        accountExists: true,
        requiresLogin: true,
      });
      // Sin sesión (aunque se envíe una contraseña) o con la sesión de otra persona: 403.
      await new Api(app).post(`/auth/invitations/${token}/accept`, { password: 'Otra-Clave-999' }).expect(403);
      const stranger = await registerOwner(app, 'ajeno');
      await stranger.api.post(`/auth/invitations/${token}/accept`, {}).expect(403);
      // Con su sesión, sí; la contraseña no cambia.
      const accepted = await other.api.post(`/auth/invitations/${token}/accept`, {}).expect(200);
      expect(accepted.body).toMatchObject({ workspaceId: owner.workspaceId, role: 'VIEWER', sessionsRevoked: false });
      const members = (await owner.api.get('/admin/org/members').expect(200)).body as { userId: string }[];
      expect(members.find((m) => m.userId === other.userId)).toMatchObject({ role: 'VIEWER', orgUnitId: rootId });
      expect((await login(app, other.email)).status).toBe(200);
    });

    it('cambia rol y unidad de un miembro', async () => {
      const m = await addMember(app, owner, { role: 'VIEWER' });
      const unit = await createUnit(owner, 'Marketing', rootId);
      const res = await owner.api
        .patch(`/admin/org/members/${m.membershipId}`, { role: 'ADMIN', orgUnitId: unit.id })
        .expect(200);
      expect(res.body).toMatchObject({ membershipId: m.membershipId, role: 'ADMIN', orgUnitId: unit.id });
      await owner.api.patch(`/admin/org/members/${m.membershipId}`, { orgUnitId: 'no-existe' }).expect(404);
      await owner.api.patch(`/admin/org/members/${m.membershipId}`, { role: 'SUPERUSER' }).expect(400);

      // Con un token nuevo el rol cambiado se aplica.
      const relogin = await login(app, m.email);
      expect(relogin.body).toMatchObject({ role: 'ADMIN' });
    });

    it('no se puede dejar el workspace sin OWNER', async () => {
      const solo = await registerOwner(app, 'unico-owner');
      const [ownerMember] = (await solo.api.get('/admin/org/members').expect(200)).body as { membershipId: string }[];
      await solo.api.patch(`/admin/org/members/${ownerMember.membershipId}`, { role: 'ADMIN' }).expect(400);
      await solo.api.delete(`/admin/org/members/${ownerMember.membershipId}`).expect(400);

      // Con un segundo OWNER sí se puede degradar al primero.
      await addMember(app, solo, { role: 'OWNER' });
      const res = await solo.api.patch(`/admin/org/members/${ownerMember.membershipId}`, { role: 'ADMIN' }).expect(200);
      expect(res.body).toMatchObject({ role: 'ADMIN' });
    });

    it('elimina un miembro que no es el último OWNER', async () => {
      const m = await addMember(app, owner, { role: 'EDITOR' });
      await owner.api.delete(`/admin/org/members/${m.membershipId}`).expect(200);
      const members = (await owner.api.get('/admin/org/members').expect(200)).body as { userId: string }[];
      expect(members.some((x) => x.userId === m.userId)).toBe(false);
      await owner.api.delete(`/admin/org/members/${m.membershipId}`).expect(404);
    });

    it('un ADMIN degradado a EDITOR pierde el acceso a /admin con su token vigente', async () => {
      const m = await addMember(app, owner, { role: 'ADMIN' });
      await m.api.get('/admin/org/units').expect(200);
      await owner.api.patch(`/admin/org/members/${m.membershipId}`, { role: 'EDITOR' }).expect(200);
      await m.api.get('/admin/org/units').expect(403);
    });

    it('un miembro eliminado del workspace pierde el acceso con su token vigente', async () => {
      const m = await addMember(app, owner, { role: 'ADMIN' });
      await owner.api.delete(`/admin/org/members/${m.membershipId}`).expect(200);
      const res = await m.api.get('/admin/org/members');
      expect([401, 403]).toContain(res.status);
    });
  });

  describe('Roles', () => {
    let owner: Session;
    let editor: Session;
    let viewer: Session;

    beforeAll(async () => {
      owner = await registerOwner(app, 'roles');
      editor = await addMember(app, owner, { role: 'EDITOR' });
      viewer = await addMember(app, owner, { role: 'VIEWER' });
    });

    const adminRoutes: [string, string][] = [
      ['get', '/admin/org/units'],
      ['post', '/admin/org/units'],
      ['patch', '/admin/org/units/x'],
      ['delete', '/admin/org/units/x'],
      ['get', '/admin/org/members'],
      ['post', '/admin/org/members'],
      ['patch', '/admin/org/members/x'],
      ['delete', '/admin/org/members/x'],
      ['get', '/admin/budgets'],
      ['put', '/admin/budgets/x'],
      ['delete', '/admin/budgets/x'],
      ['get', '/admin/alerts'],
      ['get', '/admin/usage/summary'],
      ['get', '/admin/usage/records'],
      ['get', '/admin/llm/connections'],
      ['post', '/admin/llm/connections'],
      ['patch', '/admin/llm/connections/x'],
      ['delete', '/admin/llm/connections/x'],
      ['post', '/admin/llm/connections/x/test'],
      ['post', '/admin/llm/connections/x/models'],
      ['patch', '/admin/llm/models/x'],
      ['delete', '/admin/llm/models/x'],
    ];

    it('un EDITOR y un VIEWER reciben 403 en todo /admin/*', async () => {
      for (const s of [editor, viewer]) {
        for (const [method, path] of adminRoutes) {
          const res = await s.api.call(method as 'get', path).send({});
          expect({ role: s.role, method, path, status: res.status }).toEqual({
            role: s.role,
            method,
            path,
            status: 403,
          });
        }
      }
    });

    it('un OWNER accede a /admin/* (control positivo)', async () => {
      for (const path of ['/admin/org/units', '/admin/org/members', '/admin/budgets', '/admin/alerts']) {
        await owner.api.get(path).expect(200);
      }
      await owner.api.get('/admin/usage/summary').expect(200);
      await owner.api.get('/admin/llm/connections').expect(200);
    });

    it('un EDITOR accede a /org/units, /llm/catalog, /agents/providers y /me/usage', async () => {
      const units = (await editor.api.get('/org/units').expect(200)).body as { id: string; parentId: null }[];
      expect(units).toHaveLength(1);
      expect(Object.keys(units[0]).sort()).toEqual(['id', 'name', 'parentId']);

      const catalog = (await editor.api.get('/llm/catalog').expect(200)).body as {
        id: string;
        models: Record<string, unknown>[];
      }[];
      const mock = catalog.find((c) => c.id === 'mock');
      expect(mock?.models.map((m) => m.id)).toContain('mock-echo');
      expect(mock?.models[0]).not.toHaveProperty('cacheReadUsdPerMTok');
      expect((await editor.api.get('/agents/providers').expect(200)).body).toEqual(catalog);

      const usage = (await editor.api.get('/me/usage').expect(200)).body as { orgUnit: { id: string } };
      expect(usage.orgUnit.id).toBe(units[0].id);
    });

    // ADR 0007: chatear requiere USE sobre el agente (no un rol): un VIEWER no ve agentes privados ajenos (404) y
    // conversa con los de la empresa, pero no los edita (403).
    it('un VIEWER puede leer el catálogo y su consumo, y solo chatea con agentes que puede usar', async () => {
      await viewer.api.get('/llm/catalog').expect(200);
      await viewer.api.get('/me/usage').expect(200);
      const agent = await createAgent(owner);
      await viewer.api.post(`/agents/${agent.id}/chat`, { message: 'hola' }).expect(404);
      await publishAgent(owner, agent.id);
      await viewer.api.post(`/agents/${agent.id}/chat`, { message: 'hola' }).expect(200);
      await viewer.api.patch(`/agents/${agent.id}`, { name: 'Renombrado' }).expect(403);
    });

    it('sin token o con token alterado responde 401', async () => {
      await owner.api.call('get', '/org/units').set('Authorization', '').expect(401);
      await owner.api.call('get', '/me/usage').set('Authorization', `Bearer ${owner.token}x`).expect(401);
    });
  });
});
