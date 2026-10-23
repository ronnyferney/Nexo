import type { INestApplication } from '@nestjs/common';
import { createTestApp, prismaOf } from './utils/app';
import {
  addMember,
  chat,
  createAgent,
  createGroup,
  createUnit,
  registerOwner,
  rootUnit,
  shareAgent,
  type GroupView,
  type Session,
} from './utils/fixtures';

interface AgentView {
  id: string;
  visibility: string;
  myPermission?: string;
  shares?: { principalType: string; principalId: string; principalName: string; permission: string }[];
}

interface GroupSummary {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
}

/**
 * Caso de negocio (ADR 0007 D6): el ADMIN crea el grupo "Gerentes de línea" con personas de varias unidades y publica
 * el agente "Resultados financieros" (TEAM) al grupo con USE; todos sus miembros lo ven y conversan con él.
 */
describe('Grupos de usuarios: publicar agentes a una audiencia (ADR 0007 D6) (E2E)', () => {
  let app: INestApplication;
  let owner: Session;
  let admin: Session;
  let viewerManager: Session; // VIEWER, unidad Finanzas
  let editorManager: Session; // EDITOR, unidad Operaciones
  let outsider: Session; // EDITOR de Finanzas fuera del grupo
  let other: Session; // OWNER de otro workspace
  let group: GroupView;
  let agentId: string;

  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
  const list = async (s: Session, scope?: string) =>
    ids((await s.api.get(`/agents${scope ? `?scope=${scope}` : ''}`).expect(200)).body as AgentView[]);
  const explore = async (s: Session) => ids((await s.api.get('/agents/explore').expect(200)).body as AgentView[]);

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'grupos');
    const root = await rootUnit(owner);
    const finanzas = (await createUnit(owner, 'Finanzas', root.id)).id;
    const operaciones = (await createUnit(owner, 'Operaciones', root.id)).id;
    admin = await addMember(app, owner, { role: 'ADMIN', tag: 'grp-admin' });
    viewerManager = await addMember(app, owner, { role: 'VIEWER', orgUnitId: finanzas, tag: 'grp-viewer' });
    editorManager = await addMember(app, owner, { role: 'EDITOR', orgUnitId: operaciones, tag: 'grp-editor' });
    outsider = await addMember(app, owner, { role: 'EDITOR', orgUnitId: finanzas, tag: 'grp-fuera' });
    other = await registerOwner(app, 'grupos-otro');
  });

  afterAll(async () => {
    await app.close();
  });

  it('el ADMIN crea el grupo con gerentes de unidades distintas', async () => {
    group = await createGroup(admin, {
      name: 'Gerentes de línea',
      description: 'Gerentes de todas las líneas de negocio',
      userIds: [viewerManager.userId, editorManager.userId, viewerManager.userId],
    });
    expect(group).toMatchObject({
      name: 'Gerentes de línea',
      description: 'Gerentes de todas las líneas de negocio',
      memberCount: 2,
    });
    expect(group.members.map((m) => m.userId).sort()).toEqual([viewerManager.userId, editorManager.userId].sort());
    expect(group.members.every((m) => m.email && m.name)).toBe(true);
    expect(typeof group.createdAt).toBe('string');

    const all = (await admin.api.get('/admin/groups').expect(200)).body as GroupView[];
    expect(all.map((g) => g.name)).toEqual(['Gerentes de línea']);
    expect(all[0].members).toHaveLength(2);
  });

  it('valida nombre único (409), longitud (400) y miembros ajenos al workspace (400 indicando cuáles)', async () => {
    const dup = await admin.api.post('/admin/groups', { name: 'gerentes de LÍNEA' }).expect(409);
    expect((dup.body as { message: string }).message).toMatch(/Ya existe un grupo con ese nombre/);
    await admin.api.post('/admin/groups', { name: 'G' }).expect(400);
    await admin.api.post('/admin/groups', { name: 'Largo', description: 'x'.repeat(301) }).expect(400);
    const foreign = await admin.api
      .post('/admin/groups', { name: 'Mixto', userIds: [editorManager.userId, other.userId] })
      .expect(400);
    expect(JSON.stringify(foreign.body)).toContain(other.userId);
    expect(JSON.stringify(foreign.body)).not.toContain(editorManager.userId);
    await admin.api.put(`/admin/groups/${group.id}/members`, { userIds: [other.userId] }).expect(400);
    await admin.api
      .put(`/admin/groups/${group.id}/members`, { userIds: Array.from({ length: 501 }, (_, i) => `u${i}`) })
      .expect(400);
  });

  it('PATCH renombra y cambia la descripción; el nombre sigue siendo único', async () => {
    const tmp = await createGroup(admin, { name: 'Temporal' });
    await admin.api.patch(`/admin/groups/${tmp.id}`, { name: 'Gerentes de línea' }).expect(409);
    const renamed = (await admin.api.patch(`/admin/groups/${tmp.id}`, { name: 'Comité', description: '' }).expect(200))
      .body as GroupView;
    expect(renamed).toMatchObject({ id: tmp.id, name: 'Comité', description: null, memberCount: 0, members: [] });
    await admin.api.delete(`/admin/groups/${tmp.id}`).expect(200);
  });

  it('EDITOR lista /groups pero no administra grupos; VIEWER recibe 403', async () => {
    const summaries = (await editorManager.api.get('/groups').expect(200)).body as GroupSummary[];
    const mine = summaries.find((g) => g.id === group.id);
    expect(mine).toEqual({
      id: group.id,
      name: 'Gerentes de línea',
      description: 'Gerentes de todas las líneas de negocio',
      memberCount: 2,
    });
    expect(mine).not.toHaveProperty('members');
    await editorManager.api.get('/admin/groups').expect(403);
    await editorManager.api.post('/admin/groups', { name: 'Intruso' }).expect(403);
    await editorManager.api.patch(`/admin/groups/${group.id}`, { name: 'X1' }).expect(403);
    await editorManager.api.put(`/admin/groups/${group.id}/members`, { userIds: [] }).expect(403);
    await editorManager.api.delete(`/admin/groups/${group.id}`).expect(403);
    await viewerManager.api.get('/groups').expect(403);
  });

  it('el ADMIN publica "Resultados financieros" (TEAM) al grupo con USE; los miembros lo ven y conversan', async () => {
    agentId = (await createAgent(admin, { name: 'Resultados financieros' })).id;
    await shareAgent(admin, agentId, [{ principalType: 'GROUP', principalId: group.id, permission: 'USE' }]);
    const got = (await admin.api.get(`/agents/${agentId}`).expect(200)).body as AgentView;
    expect(got.visibility).toBe('TEAM');
    expect(got.shares).toEqual([
      expect.objectContaining({
        principalType: 'GROUP',
        principalId: group.id,
        principalName: 'Gerentes de línea',
        permission: 'USE',
      }),
    ]);

    for (const member of [viewerManager, editorManager]) {
      expect(await list(member)).toContain(agentId);
      expect(await list(member, 'shared')).toContain(agentId);
      expect(await list(member, 'workspace')).not.toContain(agentId);
      expect(await explore(member)).toContain(agentId);
      const view = (await member.api.get(`/agents/${agentId}`).expect(200)).body as AgentView;
      expect(view.myPermission).toBe('USE');
      expect(view).not.toHaveProperty('shares');
      const reply = await chat(member, agentId, 'Resultados del trimestre');
      expect(reply.conversationId).toBeTruthy();
      await member.api.patch(`/agents/${agentId}`, { name: 'Cambio' }).expect(403);
    }

    await outsider.api.get(`/agents/${agentId}`).expect(404);
    await outsider.api.post(`/agents/${agentId}/chat`, { message: 'hola' }).expect(404);
    expect(await list(outsider)).not.toContain(agentId);
    expect(await explore(outsider)).not.toContain(agentId);
  });

  it('un share EDIT al grupo da edición al EDITOR; el rol VIEWER es un tope (solo usa)', async () => {
    await admin.api
      .put(`/agents/${agentId}/shares`, {
        shares: [{ principalType: 'GROUP', principalId: group.id, permission: 'EDIT' }],
      })
      .expect(200);
    const asEditor = (await editorManager.api.get(`/agents/${agentId}`).expect(200)).body as AgentView;
    expect(asEditor.myPermission).toBe('EDIT');
    const asViewer = (await viewerManager.api.get(`/agents/${agentId}`).expect(200)).body as AgentView;
    // Igual que con shares USER: el permiso efectivo se informa, pero el rol VIEWER impide escribir.
    expect(asViewer.myPermission).toBe('EDIT');
    await chat(viewerManager, agentId, 'sigo pudiendo conversar');
    await viewerManager.api.patch(`/agents/${agentId}`, { name: 'Cambio' }).expect(403);
    await admin.api
      .put(`/agents/${agentId}/shares`, {
        shares: [{ principalType: 'GROUP', principalId: group.id, permission: 'USE' }],
      })
      .expect(200);
  });

  it('agregar o quitar a alguien del grupo cambia su acceso al instante', async () => {
    let updated = (
      await admin.api
        .put(`/admin/groups/${group.id}/members`, { userIds: [viewerManager.userId, outsider.userId] })
        .expect(200)
    ).body as GroupView;
    expect(updated.memberCount).toBe(2);
    expect(updated.members.map((m) => m.userId).sort()).toEqual([viewerManager.userId, outsider.userId].sort());

    await editorManager.api.get(`/agents/${agentId}`).expect(404);
    await editorManager.api.post(`/agents/${agentId}/chat`, { message: 'hola' }).expect(404);
    expect(await list(editorManager, 'shared')).not.toContain(agentId);
    expect(await explore(editorManager)).not.toContain(agentId);
    await chat(outsider, agentId, 'ahora soy gerente');

    updated = (
      await admin.api
        .put(`/admin/groups/${group.id}/members`, {
          userIds: [viewerManager.userId, editorManager.userId],
        })
        .expect(200)
    ).body as GroupView;
    expect(updated.memberCount).toBe(2);
    await outsider.api.get(`/agents/${agentId}`).expect(404);
    await chat(editorManager, agentId, 'de vuelta');
  });

  it('aislamiento multi-tenant: el grupo no es visible ni utilizable desde otro workspace', async () => {
    await other.api.get('/admin/groups').expect(200).expect([]);
    expect((await other.api.get('/groups').expect(200)).body).toEqual([]);
    await other.api.patch(`/admin/groups/${group.id}`, { name: 'Robado' }).expect(404);
    await other.api.put(`/admin/groups/${group.id}/members`, { userIds: [other.userId] }).expect(404);
    await other.api.delete(`/admin/groups/${group.id}`).expect(404);

    const foreignAgent = (await createAgent(other, { name: 'Agente ajeno' })).id;
    await other.api.patch(`/agents/${foreignAgent}/visibility`, { visibility: 'TEAM' }).expect(200);
    const res = await other.api
      .put(`/agents/${foreignAgent}/shares`, {
        shares: [{ principalType: 'GROUP', principalId: group.id, permission: 'USE' }],
      })
      .expect(400);
    expect((res.body as { message: string }).message).toBe('Algún grupo no existe en el workspace');
    await admin.api
      .put(`/agents/${agentId}/shares`, {
        shares: [{ principalType: 'GROUP', principalId: 'grupo-inexistente', permission: 'USE' }],
      })
      .expect(400);
  });

  it('retirar a un miembro del workspace lo saca de sus grupos', async () => {
    const temp = await addMember(app, owner, { role: 'EDITOR', tag: 'grp-temporal' });
    const g = await createGroup(admin, { name: 'Gerentes temporales', userIds: [temp.userId, editorManager.userId] });
    await admin.api.delete(`/admin/org/members/${temp.membershipId}`).expect(200);
    const after = ((await admin.api.get('/admin/groups').expect(200)).body as GroupView[]).find((x) => x.id === g.id);
    expect(after?.members.map((m) => m.userId)).toEqual([editorManager.userId]);
    const rows = await prismaOf(app).userGroupMember.count({ where: { userId: temp.userId } });
    expect(rows).toBe(0);
    await admin.api.delete(`/admin/groups/${g.id}`).expect(200);
  });

  it('eliminar el grupo elimina su share y los miembros pierden el acceso', async () => {
    const removed = (await admin.api.delete(`/admin/groups/${group.id}`).expect(200)).body as GroupView & {
      removedShares: number;
    };
    expect(removed).toMatchObject({ id: group.id, name: 'Gerentes de línea', removedShares: 1 });
    const shares = await prismaOf(app).agentShare.count({ where: { principalType: 'GROUP', principalId: group.id } });
    expect(shares).toBe(0);
    const got = (await admin.api.get(`/agents/${agentId}`).expect(200)).body as AgentView;
    expect(got.shares).toEqual([]);
    for (const member of [viewerManager, editorManager]) {
      await member.api.get(`/agents/${agentId}`).expect(404);
      expect(await list(member)).not.toContain(agentId);
      expect(await explore(member)).not.toContain(agentId);
    }
    expect(ids((await admin.api.get('/admin/groups').expect(200)).body as GroupView[])).not.toContain(group.id);
    await admin.api.patch(`/admin/groups/${group.id}`, { name: 'Ya no existe' }).expect(404);
  });
});
