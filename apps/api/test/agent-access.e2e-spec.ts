import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, parseSse, prismaOf } from './utils/app';
import {
  addMember,
  chat,
  createAgent,
  createUnit,
  publishAgent,
  registerOwner,
  rootUnit,
  shareAgent,
  type Session,
} from './utils/fixtures';

interface AgentView {
  id: string;
  name: string;
  visibility: 'PRIVATE' | 'TEAM' | 'WORKSPACE';
  launchStatus: 'DRAFT' | 'LAUNCHED';
  launchOverrideReason: string | null;
  ownerId: string | null;
  owner: { id: string; name: string } | null;
  myPermission?: 'OWNER' | 'EDIT' | 'USE' | 'ADMIN_VIEW';
  shares?: { principalType: string; principalId: string; principalName: string; permission: string }[];
  examplesCount?: number;
  tools?: { operationId: string; requiresApproval: boolean }[];
  skills?: { id: string }[];
}

interface Health {
  agentId: string;
  score: number;
  level: string;
  checks: { id: string; passed: boolean; category: string; severity: string; recommendation: string }[];
}

const PROFILE = {
  role: 'Asistente de soporte de primer nivel',
  goals: ['Resolver dudas frecuentes', 'Escalar los casos complejos'],
  boundaries: ['No prometer reembolsos'],
  tone: 'Cercano',
};

async function waitRun(s: Session, runId: string): Promise<{ status: string; score: number | null }> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const run = (await s.api.get(`/eval-runs/${runId}`).expect(200)).body as { status: string; score: number | null };
    if (run.status === 'SUCCEEDED' || run.status === 'FAILED') return run;
    if (Date.now() > deadline) throw new Error(`La corrida ${runId} no terminó`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('Visibilidad y permisos de agentes · salud y lanzamiento (ADR 0006 D3/D4, ADR 0007) (E2E)', () => {
  let app: INestApplication;
  let owner: Session;
  let admin: Session;
  let editorA: Session; // Ventas Norte (subunidad de Ventas)
  let seller: Session; // Ventas Norte
  let editorB: Session; // Soporte
  let viewer: Session; // raíz
  let ventasId: string;
  let ventasNorteId: string;

  const get = (s: Session, id: string) => s.api.get(`/agents/${id}`);
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
  const list = async (s: Session, scope?: string) =>
    ids((await s.api.get(`/agents${scope ? `?scope=${scope}` : ''}`).expect(200)).body as AgentView[]);

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'acceso');
    const root = await rootUnit(owner);
    ventasId = (await createUnit(owner, 'Ventas', root.id)).id;
    ventasNorteId = (await createUnit(owner, 'Ventas Norte', ventasId)).id;
    const soporteId = (await createUnit(owner, 'Soporte', root.id)).id;
    admin = await addMember(app, owner, { role: 'ADMIN', tag: 'admin' });
    editorA = await addMember(app, owner, { role: 'EDITOR', orgUnitId: ventasNorteId, tag: 'editora' });
    seller = await addMember(app, owner, { role: 'EDITOR', orgUnitId: ventasNorteId, tag: 'vendedor' });
    editorB = await addMember(app, owner, { role: 'EDITOR', orgUnitId: soporteId, tag: 'editorb' });
    viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'lector' });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Agentes privados (D1/D2)', () => {
    let privateId: string;

    it('un agente nuevo nace PRIVATE y DRAFT, con el creador como dueño', async () => {
      const created = (
        await editorA.api.post('/agents', { name: 'Privado de A', provider: 'mock', model: 'mock-echo' }).expect(201)
      ).body as AgentView;
      privateId = created.id;
      expect(created).toMatchObject({ visibility: 'PRIVATE', launchStatus: 'DRAFT', ownerId: editorA.userId });
      const got = (await get(editorA, privateId).expect(200)).body as AgentView;
      expect(got).toMatchObject({ myPermission: 'OWNER', owner: { id: editorA.userId, name: 'Miembro EDITOR' } });
      expect(got.shares).toEqual([]);
      expect(await list(editorA)).toContain(privateId);
      expect(await list(editorA, 'mine')).toContain(privateId);
    });

    it('es invisible para otros miembros (404 en lectura, chat, edición y entrenamiento)', async () => {
      for (const s of [editorB, seller, viewer]) {
        await get(s, privateId).expect(404);
        await s.api.post(`/agents/${privateId}/chat`, { message: 'hola' }).expect(404);
        await s.api.patch(`/agents/${privateId}`, { name: 'Intruso' }).expect(404);
        await s.api.get(`/agents/${privateId}/eval-cases`).expect(404);
        await s.api.get(`/agents/${privateId}/health`).expect(404);
        expect(await list(s)).not.toContain(privateId);
      }
      await editorB.api.get('/agents?scope=all').expect(403);
      await editorB.api.get('/agents?scope=otro').expect(400);
    });

    it('ADMIN/OWNER ven la configuración y la salud como ADMIN_VIEW, y lo listan solo con scope=all', async () => {
      const got = (await get(admin, privateId).expect(200)).body as AgentView;
      expect(got.myPermission).toBe('ADMIN_VIEW');
      expect(got.shares).toEqual([]);
      await admin.api.get(`/agents/${privateId}/health`).expect(200);
      await admin.api.get(`/agents/${privateId}/prompt-preview`).expect(200);
      expect(await list(admin)).not.toContain(privateId);
      const all = (await admin.api.get('/agents?scope=all').expect(200)).body as AgentView[];
      expect(all.find((a) => a.id === privateId)).toMatchObject({
        myPermission: 'ADMIN_VIEW',
        owner: { id: editorA.userId },
        visibility: 'PRIVATE',
        launchStatus: 'DRAFT',
      });
    });
  });

  describe('Equipo y shares (D2)', () => {
    let teamId: string;

    beforeAll(async () => {
      teamId = (await createAgent(editorA, { name: 'Agente de Ventas' })).id;
      await shareAgent(editorA, teamId, [{ principalType: 'UNIT', principalId: ventasId, permission: 'USE' }]);
    });

    it('TEAM compartido con una unidad alcanza a sus subunidades (USE), no a otras unidades', async () => {
      const got = (await get(seller, teamId).expect(200)).body as AgentView;
      expect(got.myPermission).toBe('USE');
      expect(got).not.toHaveProperty('shares');
      await chat(seller, teamId, 'hola equipo');
      await seller.api.patch(`/agents/${teamId}`, { name: 'Cambio' }).expect(403);
      expect(await list(seller, 'shared')).toContain(teamId);
      expect(await list(seller, 'mine')).not.toContain(teamId);
      expect(await list(seller, 'workspace')).not.toContain(teamId);
      await get(editorB, teamId).expect(404);
      await get(viewer, teamId).expect(404);
    });

    it('share USE vs EDIT a personas; el rol VIEWER es un tope aunque tenga EDIT', async () => {
      await editorA.api
        .put(`/agents/${teamId}/shares`, {
          shares: [
            { principalType: 'UNIT', principalId: ventasId, permission: 'USE' },
            { principalType: 'USER', principalId: editorB.userId, permission: 'EDIT' },
            { principalType: 'USER', principalId: viewer.userId, permission: 'EDIT' },
          ],
        })
        .expect(200);
      const asB = (await get(editorB, teamId).expect(200)).body as AgentView;
      expect(asB.myPermission).toBe('EDIT');
      expect(asB.shares?.map((s) => s.principalName).sort()).toEqual(['Miembro EDITOR', 'Miembro VIEWER', 'Ventas']);
      await editorB.api.patch(`/agents/${teamId}`, { description: 'Editado por B' }).expect(200);
      // EDIT no permite eliminar ni transferir: eso queda para el dueño o la administración.
      await editorB.api.delete(`/agents/${teamId}`).expect(403);
      await editorB.api.post(`/agents/${teamId}/transfer`, { userId: editorB.userId }).expect(403);

      expect(((await get(viewer, teamId).expect(200)).body as AgentView).myPermission).toBe('EDIT');
      await viewer.api.patch(`/agents/${teamId}`, { description: 'VIEWER' }).expect(403);
      await viewer.api.post(`/agents/${teamId}/chat`, { message: 'hola' }).expect(200);
    });

    it('los shares validan principales del workspace y requieren EDITOR+', async () => {
      const other = await registerOwner(app, 'acceso-b');
      await editorA.api
        .put(`/agents/${teamId}/shares`, {
          shares: [{ principalType: 'USER', principalId: other.userId, permission: 'USE' }],
        })
        .expect(400);
      await editorA.api
        .put(`/agents/${teamId}/shares`, {
          shares: [{ principalType: 'UNIT', principalId: (await rootUnit(other)).id, permission: 'USE' }],
        })
        .expect(400);
      await editorA.api
        .put(`/agents/${teamId}/shares`, { shares: [{ principalType: 'GROUP', principalId: 'x', permission: 'USE' }] })
        .expect(400);
      // El otro workspace no ve el agente.
      await get(other, teamId).expect(404);
    });

    it('los shares de un agente PRIVATE quedan inactivos', async () => {
      const id = (await createAgent(editorA, { name: 'Vuelve a privado' })).id;
      await shareAgent(editorA, id, [{ principalType: 'USER', principalId: seller.userId, permission: 'USE' }]);
      await get(seller, id).expect(200);
      await editorA.api.patch(`/agents/${id}/visibility`, { visibility: 'PRIVATE' }).expect(200);
      await get(seller, id).expect(404);
    });
  });

  describe('Conversaciones privadas (D4)', () => {
    let agentId: string;
    let sellerConversation: string;

    beforeAll(async () => {
      agentId = (await createAgent(owner, { name: 'Agente compartido' })).id;
      await publishAgent(owner, agentId);
    });

    it('cada usuario lista y lee solo sus conversaciones; ADMIN no ve las ajenas', async () => {
      sellerConversation = (await chat(seller, agentId, 'mi consulta privada')).conversationId;
      const mine = (await chat(editorB, agentId, 'consulta de B')).conversationId;
      const sellerList = (await seller.api.get(`/agents/${agentId}/conversations`).expect(200)).body as {
        id: string;
        userId: string;
      }[];
      expect(sellerList.map((c) => c.id)).toEqual([sellerConversation]);
      expect(sellerList[0].userId).toBe(seller.userId);
      await seller.api.get(`/agents/${agentId}/conversations/${sellerConversation}`).expect(200);

      for (const s of [editorB, admin, owner]) {
        const rows = (await s.api.get(`/agents/${agentId}/conversations`).expect(200)).body as { id: string }[];
        expect(rows.map((c) => c.id)).not.toContain(sellerConversation);
        await s.api.get(`/agents/${agentId}/conversations/${sellerConversation}`).expect(404);
      }
      // Tampoco se puede continuar ni calificar una conversación ajena.
      await editorB.api
        .post(`/agents/${agentId}/chat`, { message: 'continuar', conversationId: sellerConversation })
        .expect(404);
      await editorB.api
        .post(`/agents/${agentId}/feedback`, {
          conversationId: sellerConversation,
          userMessage: 'x',
          agentResponse: 'y',
          rating: 'DOWN',
        })
        .expect(404);
      await seller.api
        .post(`/agents/${agentId}/chat`, { message: 'sigo yo', conversationId: sellerConversation })
        .expect(200);
      expect(((await editorB.api.get(`/agents/${agentId}/conversations`).expect(200)).body as unknown[]).length).toBe(
        1,
      );
      void mine;
    });

    it('las conversaciones heredadas (sin usuario) solo las ven ADMIN/OWNER', async () => {
      const legacy = await prismaOf(app).conversation.create({
        data: { agentId, title: 'Heredada', provider: 'mock' },
      });
      for (const s of [admin, owner]) {
        const rows = (await s.api.get(`/agents/${agentId}/conversations`).expect(200)).body as { id: string }[];
        expect(rows.map((c) => c.id)).toContain(legacy.id);
        await s.api.get(`/agents/${agentId}/conversations/${legacy.id}`).expect(200);
      }
      await seller.api.get(`/agents/${agentId}/conversations/${legacy.id}`).expect(404);
    });

    it('la bandeja de supervisión muestra el feedback a quien puede editar; con USE solo el propio', async () => {
      const fb = (
        await seller.api
          .post(`/agents/${agentId}/feedback`, { userMessage: 'q', agentResponse: 'a', rating: 'DOWN' })
          .expect(201)
      ).body as { id: string };
      expect(
        ((await editorB.api.get(`/agents/${agentId}/feedback`).expect(200)).body as { id: string }[]).map((f) => f.id),
      ).not.toContain(fb.id);
      expect(
        ((await seller.api.get(`/agents/${agentId}/feedback`).expect(200)).body as { id: string }[]).map((f) => f.id),
      ).toEqual([fb.id]);
      expect(((await seller.api.get('/feedback').expect(200)).body as { id: string }[]).map((f) => f.id)).not.toContain(
        fb.id,
      );
      await seller.api.post(`/feedback/${fb.id}/review`, { action: 'DISCARD' }).expect(403);
      expect(((await owner.api.get('/feedback').expect(200)).body as { id: string }[]).map((f) => f.id)).toContain(
        fb.id,
      );
      await owner.api.post(`/feedback/${fb.id}/review`, { action: 'DISCARD' }).expect(200);
    });
  });

  describe('Creación por rol y ajustes del workspace (D3)', () => {
    it('un VIEWER crea y edita SUS agentes privados, pero no puede compartirlos', async () => {
      const mine = (
        await viewer.api
          .post('/agents', { name: 'Personal del lector', provider: 'mock', model: 'mock-echo' })
          .expect(201)
      ).body as AgentView;
      expect(mine).toMatchObject({ visibility: 'PRIVATE', ownerId: viewer.userId });
      await viewer.api.patch(`/agents/${mine.id}`, { profile: { role: 'Mi asistente' } }).expect(200);
      await viewer.api.post(`/agents/${mine.id}/examples`, { input: 'a', output: 'b' }).expect(201);
      await chat(viewer, mine.id);
      await viewer.api.patch(`/agents/${mine.id}/visibility`, { visibility: 'TEAM' }).expect(403);
      await viewer.api.patch(`/agents/${mine.id}/visibility`, { visibility: 'WORKSPACE' }).expect(403);
      await viewer.api.put(`/agents/${mine.id}/shares`, { shares: [] }).expect(403);
      await viewer.api
        .post('/agents', { name: 'Equipo', provider: 'mock', model: 'mock-echo', visibility: 'TEAM' })
        .expect(403);
      await viewer.api.post('/agents', { name: 'Empresa', visibility: 'WORKSPACE' }).expect(400);
      await viewer.api.patch(`/agents/${mine.id}`, { visibility: 'WORKSPACE' }).expect(400);
    });

    it('allowPersonalAgents: lo cambia solo ADMIN; desactivado impide agentes personales', async () => {
      expect((await viewer.api.get('/workspace/settings').expect(200)).body).toEqual({ allowPersonalAgents: true });
      await editorA.api.patch('/workspace/settings', { allowPersonalAgents: false }).expect(403);
      await admin.api.patch('/workspace/settings', { allowPersonalAgents: false }).expect(200);
      try {
        await viewer.api.post('/agents', { name: 'Ya no', provider: 'mock', model: 'mock-echo' }).expect(403);
        await editorA.api
          .post('/agents', { name: 'Personal', provider: 'mock', model: 'mock-echo', visibility: 'PRIVATE' })
          .expect(403);
        // Sin visibilidad explícita, un EDITOR+ crea el agente como TEAM.
        const team = (
          await editorA.api.post('/agents', { name: 'Equipo', provider: 'mock', model: 'mock-echo' }).expect(201)
        ).body as AgentView;
        expect(team.visibility).toBe('TEAM');
        await editorA.api.patch(`/agents/${team.id}/visibility`, { visibility: 'PRIVATE' }).expect(403);
      } finally {
        await admin.api.patch('/workspace/settings', { allowPersonalAgents: true }).expect(200);
      }
    });

    it('las API keys usan agentes de la empresa, pero no crean agentes ni ven privados', async () => {
      const key = (
        (await owner.api.post('/workspace/api-keys', { name: 'Integración' }).expect(201)).body as {
          key: string;
        }
      ).key;
      const published = (await createAgent(owner, { name: 'Público para API' })).id;
      await publishAgent(owner, published);
      const privateOne = (await createAgent(owner, { name: 'Privado para API' })).id;
      const api = (method: 'get' | 'post', path: string) =>
        request(app.getHttpServer())[method](`/api${path}`).set('Authorization', `Bearer ${key}`);
      await api('post', `/agents/${published}/chat`).send({ message: 'hola' }).expect(200);
      await api('post', `/agents/${privateOne}/chat`).send({ message: 'hola' }).expect(404);
      await api('post', '/agents').send({ name: 'Desde API', provider: 'mock', model: 'mock-echo' }).expect(403);
      expect(((await api('get', `/agents/${published}/conversations`).expect(200)).body as unknown[]).length).toBe(0);
    });
  });

  describe('Salud y lanzamiento (ADR 0006 D3/D4)', () => {
    let agentId: string;

    it('salud determinista: agente vacío 40, con perfil 73, con casos 83 y con evaluación 95', async () => {
      agentId = (await createAgent(editorA, { name: 'Agente a lanzar' })).id;
      const empty = (await editorA.api.get(`/agents/${agentId}/health`).expect(200)).body as Health;
      expect(empty).toMatchObject({ agentId, score: 40, level: 'NEEDS_WORK' });
      expect(empty.checks.find((c) => c.id === 'profile.role')).toMatchObject({ passed: false, severity: 'CRITICAL' });
      expect(empty.checks.every((c) => c.recommendation)).toBe(true);

      await editorA.api.patch(`/agents/${agentId}`, { profile: PROFILE }).expect(200);
      expect(((await editorA.api.get(`/agents/${agentId}/health`).expect(200)).body as Health).score).toBe(73);

      for (let i = 1; i <= 5; i++) {
        await editorA.api
          .post(`/agents/${agentId}/eval-cases`, {
            input: `Pregunta ${i} sobre envíos`,
            expected: `pregunta ${i} sobre envíos`,
          })
          .expect(201);
      }
      expect(((await editorA.api.get(`/agents/${agentId}/health`).expect(200)).body as Health).score).toBe(83);
    });

    it('sin evaluación no se puede lanzar ni publicar en la empresa', async () => {
      await editorA.api.patch(`/agents/${agentId}/visibility`, { visibility: 'WORKSPACE' }).expect(409);
      const res = await editorA.api.post(`/agents/${agentId}/launch`, {}).expect(409);
      expect((res.body as { message: string }).message).toMatch(/evaluaciones/);
    });

    it('con salud ≥ 70 y evaluación ≥ meta se lanza sin override', async () => {
      const queued = (
        await editorA.api
          .post(`/agents/${agentId}/eval-runs`, { judgeProviderId: 'mock', judgeModel: 'mock-echo' })
          .expect(201)
      ).body as { id: string };
      const run = await waitRun(editorA, queued.id);
      expect(run).toMatchObject({ status: 'SUCCEEDED', score: 1 });
      const health = (await editorA.api.get(`/agents/${agentId}/health`).expect(200)).body as Health;
      expect(health).toMatchObject({ score: 95, level: 'EXCELLENT' });
      expect(health.checks.filter((c) => !c.passed).map((c) => c.id)).toEqual(['operations.fallback']);

      // Un usuario con USE no puede lanzar.
      await shareAgent(editorA, agentId, [{ principalType: 'USER', principalId: seller.userId, permission: 'USE' }]);
      await seller.api.post(`/agents/${agentId}/launch`, {}).expect(403);

      const launched = (await editorA.api.post(`/agents/${agentId}/launch`, {}).expect(200)).body as AgentView;
      expect(launched).toMatchObject({ launchStatus: 'LAUNCHED', launchOverrideReason: null });
      await editorA.api.post(`/agents/${agentId}/launch`, {}).expect(200); // idempotente
      const ws = (await editorA.api.patch(`/agents/${agentId}/visibility`, { visibility: 'WORKSPACE' }).expect(200))
        .body as AgentView;
      expect(ws.visibility).toBe('WORKSPACE');
      expect(((await get(viewer, agentId).expect(200)).body as AgentView).myPermission).toBe('USE');
      expect(await list(viewer, 'workspace')).toContain(agentId);
    });

    it('deslanzar un agente de empresa lo pasa a TEAM (conserva sus shares)', async () => {
      const res = (await editorA.api.post(`/agents/${agentId}/unlaunch`).expect(200)).body as AgentView;
      expect(res).toMatchObject({ launchStatus: 'DRAFT', visibility: 'TEAM' });
      await get(viewer, agentId).expect(404);
      await get(seller, agentId).expect(200);
    });

    it('override: solo ADMIN/OWNER y con razón obligatoria (queda registrada)', async () => {
      const id = (await createAgent(editorA, { name: 'Lanzamiento forzado' })).id;
      await editorA.api.post(`/agents/${id}/launch`, { override: true, reason: 'Urgente' }).expect(403);
      await admin.api.post(`/agents/${id}/launch`, { override: true }).expect(400);
      await admin.api.post(`/agents/${id}/launch`, { override: true, reason: '   ' }).expect(400);
      const res = (
        await admin.api.post(`/agents/${id}/launch`, { override: true, reason: 'Piloto con gerencia' }).expect(200)
      ).body as AgentView;
      expect(res).toMatchObject({ launchStatus: 'LAUNCHED', launchOverrideReason: 'Piloto con gerencia' });
      expect(res.myPermission).toBe('ADMIN_VIEW');
    });

    it('detecta herramientas con efecto sin aprobación humana', async () => {
      const connector = (
        await editorA.api
          .post('/connectors', { name: 'CRM interno', type: 'REST', config: { baseUrl: 'http://127.0.0.1:9' } })
          .expect(201)
      ).body as { id: string };
      const op = (
        await editorA.api
          .post(`/connectors/${connector.id}/operations`, {
            key: 'crear_trato',
            name: 'Crear trato',
            description: 'Crea un trato nuevo en el CRM con el monto indicado',
            definition: { method: 'POST', path: '/deals' },
          })
          .expect(201)
      ).body as { id: string };
      await editorA.api.put(`/agents/${agentId}/tools`, { tools: [{ operationId: op.id }] }).expect(200);
      const h = (await editorA.api.get(`/agents/${agentId}/health`).expect(200)).body as Health;
      expect(h.score).toBe(83);
      expect(h.checks.find((c) => c.id === 'tools.write-approval')).toMatchObject({
        passed: false,
        severity: 'CRITICAL',
      });
      await editorA.api
        .put(`/agents/${agentId}/tools`, { tools: [{ operationId: op.id, requiresApproval: true }] })
        .expect(200);
      expect(((await editorA.api.get(`/agents/${agentId}/health`).expect(200)).body as Health).score).toBe(95);
    });

    it('GET /agents/health resume los agentes visibles (ADMIN: todos)', async () => {
      const mine = (await editorA.api.get('/agents/health').expect(200)).body as {
        total: number;
        byLevel: Record<string, number>;
        agents: { agentId: string; score: number; level: string }[];
      };
      expect(mine.agents.find((a) => a.agentId === agentId)).toMatchObject({ score: 95, level: 'EXCELLENT' });
      expect(Object.values(mine.byLevel).reduce((a, b) => a + b, 0)).toBe(mine.total);
      const sellerView = (await seller.api.get('/agents/health').expect(200)).body as { agents: { agentId: string }[] };
      expect(sellerView.agents.map((a) => a.agentId)).toContain(agentId);
      const bView = (await editorB.api.get('/agents/health').expect(200)).body as { agents: { agentId: string }[] };
      expect(bView.agents.map((a) => a.agentId)).not.toContain(agentId);
      const adminView = (await admin.api.get('/agents/health').expect(200)).body as { agents: { agentId: string }[] };
      expect(adminView.agents.map((a) => a.agentId)).toContain(agentId);
    });
  });

  describe('Transferir, duplicar, explorar y retirar miembros (D3)', () => {
    it('transferir: dueño o ADMIN; el nuevo dueño debe ser miembro', async () => {
      const id = (await createAgent(editorA, { name: 'Para transferir' })).id;
      await editorA.api.post(`/agents/${id}/transfer`, { userId: 'no-es-miembro' }).expect(400);
      const res = (await editorA.api.post(`/agents/${id}/transfer`, { userId: seller.userId }).expect(200))
        .body as AgentView;
      expect(res.ownerId).toBe(seller.userId);
      await get(editorA, id).expect(404); // era PRIVATE: el antiguo dueño pierde el acceso
      expect(((await get(seller, id).expect(200)).body as AgentView).myPermission).toBe('OWNER');
      await admin.api.post(`/agents/${id}/transfer`, { userId: editorA.userId }).expect(200);
      expect(((await get(editorA, id).expect(200)).body as AgentView).myPermission).toBe('OWNER');
    });

    it('duplicar (USE) crea una copia PRIVATE del usuario con perfil, herramientas, skills y ejemplos', async () => {
      const source = (await createAgent(editorA, { name: 'Original', systemPrompt: 'Instrucciones' })).id;
      await editorA.api
        .patch(`/agents/${source}`, { profile: PROFILE, fallbackModels: ['mock:mock-echo'] })
        .expect(200);
      const skill = (
        await owner.api
          .post('/skills', { name: 'Tono comercial', description: 'Cuándo vender', instructions: 'Sea breve.' })
          .expect(201)
      ).body as { id: string };
      await editorA.api.put(`/agents/${source}/skills`, { skillIds: [skill.id] }).expect(200);
      await editorA.api.post(`/agents/${source}/examples`, { input: 'uno', output: '1' }).expect(201);
      await editorA.api.post(`/agents/${source}/examples`, { input: 'dos', output: '2' }).expect(201);
      await editorA.api.post(`/agents/${source}/eval-cases`, { input: 'caso' }).expect(201);
      await chat(editorA, source);

      await seller.api.post(`/agents/${source}/duplicate`, {}).expect(404);
      await shareAgent(editorA, source, [{ principalType: 'USER', principalId: seller.userId, permission: 'USE' }]);
      const copy = (await seller.api.post(`/agents/${source}/duplicate`, {}).expect(201)).body as AgentView & {
        profile: Record<string, unknown>;
        fallbackModels: string[];
        systemPrompt: string;
      };
      expect(copy).toMatchObject({
        name: 'Original (copia)',
        visibility: 'PRIVATE',
        launchStatus: 'DRAFT',
        ownerId: seller.userId,
        myPermission: 'OWNER',
        systemPrompt: 'Instrucciones',
        fallbackModels: ['mock:mock-echo'],
        examplesCount: 2,
      });
      expect(copy.profile).toMatchObject({ role: PROFILE.role });
      expect(copy.skills?.map((s) => s.id)).toEqual([skill.id]);
      const examples = (await seller.api.get(`/agents/${copy.id}/examples`).expect(200)).body as { input: string }[];
      expect(examples.map((e) => e.input)).toEqual(['uno', 'dos']);
      expect(((await seller.api.get(`/agents/${copy.id}/eval-cases`).expect(200)).body as unknown[]).length).toBe(0);
      expect(((await seller.api.get(`/agents/${copy.id}/conversations`).expect(200)).body as unknown[]).length).toBe(0);
      const named = (await seller.api.post(`/agents/${source}/duplicate`, { name: 'Mi versión' }).expect(201))
        .body as AgentView;
      expect(named.name).toBe('Mi versión');
    });

    it('explorar lista agentes de equipo/empresa que puedo usar y que no son míos', async () => {
      const explore = (await seller.api.get('/agents/explore').expect(200)).body as {
        id: string;
        owner: { id: string };
        myPermission: string;
        healthScore: number | null;
        launchStatus: string;
      }[];
      expect(explore.length).toBeGreaterThan(0);
      expect(explore.every((a) => a.owner.id !== seller.userId)).toBe(true);
      expect(explore.every((a) => typeof a.healthScore === 'number')).toBe(true);
      const mine = await list(seller, 'mine');
      expect(explore.some((a) => mine.includes(a.id))).toBe(false);
    });

    it('retirar a un miembro transfiere sus agentes al administrador que lo retira', async () => {
      const leaving = await addMember(app, owner, { role: 'EDITOR', tag: 'saliente' });
      const a1 = (await createAgent(leaving, { name: 'Saliente uno' })).id;
      const a2 = (await createAgent(leaving, { name: 'Saliente dos' })).id;
      await shareAgent(leaving, a2, [{ principalType: 'USER', principalId: seller.userId, permission: 'USE' }]);
      const res = (await admin.api.delete(`/admin/org/members/${leaving.membershipId}`).expect(200)).body as {
        transferredTo: string;
        transferredAgents: { id: string; name: string; visibility: string }[];
      };
      expect(res.transferredTo).toBe(admin.userId);
      expect(res.transferredAgents).toEqual([
        { id: a2, name: 'Saliente dos', visibility: 'TEAM' },
        { id: a1, name: 'Saliente uno', visibility: 'PRIVATE' },
      ]);
      expect(((await get(admin, a1).expect(200)).body as AgentView).myPermission).toBe('OWNER');
      expect(((await get(admin, a2).expect(200)).body as AgentView).visibility).toBe('TEAM');
      await get(seller, a2).expect(200);
    });
  });

  describe('Efectos en MCP, flujos y rutinas (D5)', () => {
    it('el servidor MCP publica solo agentes WORKSPACE + LAUNCHED', async () => {
      const key = ((await owner.api.post('/workspace/api-keys', { name: 'MCP' }).expect(201)).body as { key: string })
        .key;
      const published = (await createAgent(owner, { name: 'MCP publicado' })).id;
      await publishAgent(owner, published);
      const launchedTeam = (await createAgent(owner, { name: 'MCP equipo lanzado' })).id;
      await owner.api.post(`/agents/${launchedTeam}/launch`, { override: true, reason: 'E2E' }).expect(200);
      await owner.api.patch(`/agents/${launchedTeam}/visibility`, { visibility: 'TEAM' }).expect(200);
      await createAgent(owner, { name: 'MCP borrador' });

      const res = await request(app.getHttpServer())
        .post('/api/mcp')
        .set('Authorization', `Bearer ${key}`)
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
        .buffer(true)
        .parse((r, cb) => {
          let data = '';
          r.setEncoding('utf8');
          r.on('data', (chunk: string) => (data += chunk));
          r.on('end', () => cb(null, data));
        });
      expect(res.status).toBe(200);
      const raw = res.body as string;
      const payload = (raw.trim().startsWith('{') ? JSON.parse(raw) : parseSse(raw)[0].data) as {
        result: { tools: { name: string; title?: string }[] };
      };
      const titles = payload.result.tools.map((t) => t.title);
      expect(titles).toContain('MCP publicado');
      expect(titles).not.toContain('MCP equipo lanzado');
      expect(titles).not.toContain('MCP borrador');
    });

    it('un flujo solo puede referenciar agentes que el editor puede USAR (validado al guardar)', async () => {
      const def = (agentId: string, name = 'IA') => ({
        nodes: [
          { id: 'trigger', type: 'trigger', name: 'Inicio', config: {} },
          { id: 'ia', type: 'agent', name, config: { agentId, prompt: 'Hola' } },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'ia' }],
      });
      const privateOfA = (await createAgent(editorA, { name: 'Privado para flujos' })).id;
      const res = await editorB.api.post('/workflows', { name: 'Intento', definition: def(privateOfA) }).expect(400);
      expect(JSON.stringify(res.body)).toContain('no puede usar');
      await editorB.api.post('/workflows', { name: 'Inexistente', definition: def('no-existe') }).expect(400);

      const company = (await createAgent(owner, { name: 'Agente para flujos' })).id;
      await publishAgent(owner, company);
      await editorB.api.post('/workflows', { name: 'Permitido', definition: def(company) }).expect(201);

      // Un flujo existente no se rompe si lo edita alguien sin acceso a un agente ya referenciado…
      const wf = (await editorA.api.post('/workflows', { name: 'De A', definition: def(privateOfA) }).expect(201))
        .body as { id: string };
      await editorB.api.patch(`/workflows/${wf.id}`, { definition: def(privateOfA, 'IA renombrada') }).expect(200);
      // …pero no puede introducir referencias nuevas.
      const otherPrivate = (await createAgent(editorA, { name: 'Otro privado' })).id;
      await editorB.api.patch(`/workflows/${wf.id}`, { definition: def(otherPrivate) }).expect(400);
    });

    it('rutinas: un agente PRIVATE corre a nombre del dueño (su unidad); TEAM en borrador no se ejecuta', async () => {
      const personal = (await createAgent(seller, { name: 'Rutina personal' })).id;
      const routine = (
        await seller.api
          .post(`/agents/${personal}/routines`, {
            name: 'Resumen',
            prompt: 'Resume',
            schedule: '0 8 * * *',
            enabled: false,
          })
          .expect(201)
      ).body as { id: string };
      const run = (await seller.api.post(`/routines/${routine.id}/run`).expect(200)).body as { status: string };
      expect(run.status).toBe('SUCCEEDED');
      const usage = await prismaOf(app).usageRecord.findMany({ where: { agentId: personal, source: 'ROUTINE' } });
      expect(usage).toHaveLength(1);
      expect(usage[0]).toMatchObject({ userId: seller.userId, orgUnitId: ventasNorteId });

      // Otros miembros no ven ni gestionan rutinas de un agente privado ajeno.
      await editorB.api.get(`/routines/${routine.id}`).expect(404);
      await editorB.api.post(`/routines/${routine.id}/run`).expect(404);
      expect(
        ((await editorB.api.get('/routines').expect(200)).body as { id: string }[]).map((r) => r.id),
      ).not.toContain(routine.id);
      expect(((await admin.api.get('/routines').expect(200)).body as { id: string }[]).map((r) => r.id)).toContain(
        routine.id,
      );

      await seller.api.patch(`/agents/${personal}/visibility`, { visibility: 'TEAM' }).expect(200);
      const blocked = await seller.api.post(`/routines/${routine.id}/run`).expect(409);
      expect((blocked.body as { message: string }).message).toMatch(/no está lanzado/);
    });
  });
});
