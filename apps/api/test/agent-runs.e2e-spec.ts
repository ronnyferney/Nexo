import type { INestApplication } from '@nestjs/common';
import { createTestApp, prismaOf, type Api } from './utils/app';
import { addMember, createAgent, publishAgent, registerOwner, shareAgent, type Session } from './utils/fixtures';

const DAY_MS = 24 * 60 * 60 * 1000;

interface RunItem {
  id: string;
  agentId: string;
  agentName: string;
  source: string;
  status: string;
  error: string | null;
  model: string | null;
  providerId: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  ttftMs: number | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  conversationId: string | null;
  executionId: string | null;
}

interface RunsPage {
  items: RunItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Inserta un AgentRun directamente para controlar estado, origen y fecha (no se puede post-fechar vía chat). */
function addRun(
  app: INestApplication,
  s: Session,
  agentId: string,
  opts: {
    status?: string;
    source?: string;
    daysAgo?: number;
    error?: string | null;
    durationMs?: number | null;
    ttftMs?: number | null;
    costUsd?: number | null;
  } = {},
) {
  const startedAt = new Date(Date.now() - (opts.daysAgo ?? 0) * DAY_MS);
  return prismaOf(app).agentRun.create({
    data: {
      workspaceId: s.workspaceId,
      agentId,
      userId: s.userId,
      source: (opts.source ?? 'CHAT') as never,
      status: (opts.status ?? 'SUCCEEDED') as never,
      error: opts.error ?? null,
      model: 'mock-echo',
      providerId: 'mock',
      startedAt,
      finishedAt: opts.status === 'RUNNING' ? null : new Date(startedAt.getTime() + (opts.durationMs ?? 100)),
      durationMs: opts.status === 'RUNNING' ? null : (opts.durationMs ?? 100),
      ttftMs: opts.ttftMs ?? 20,
      costUsd: opts.costUsd ?? 0.01,
      inputTokens: 10,
      outputTokens: 5,
      conversationId: 'conv-1',
      executionId: null,
      createdAt: startedAt,
    },
  });
}

const list = async (api: Api, qs = ''): Promise<RunsPage> =>
  (await api.get(`/agent-runs${qs}`).expect(200)).body as RunsPage;

describe('Historial de ejecuciones de agente (RX-14) (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('Listado, filtros, orden y paginación', () => {
    let owner: Session;
    let agentId: string;
    let otherAgentId: string;

    beforeAll(async () => {
      owner = await registerOwner(app, 'runs-owner');
      agentId = (await createAgent(owner, { name: 'Agente con historial' })).id;
      otherAgentId = (await createAgent(owner, { name: 'Otro agente' })).id;
      // Historial del agente principal: éxito reciente, un fallo hace 2 días, uno en curso, uno vía workflow antiguo.
      await addRun(app, owner, agentId, { status: 'SUCCEEDED', source: 'CHAT', daysAgo: 0 });
      await addRun(app, owner, agentId, { status: 'FAILED', source: 'CHAT', daysAgo: 2, error: 'Boom'.repeat(400) });
      await addRun(app, owner, agentId, { status: 'RUNNING', source: 'CHAT', daysAgo: 1 });
      await addRun(app, owner, agentId, { status: 'SUCCEEDED', source: 'WORKFLOW', daysAgo: 10 });
      // Un run de otro agente para comprobar el filtro agentId.
      await addRun(app, owner, otherAgentId, { status: 'SUCCEEDED', source: 'CHAT', daysAgo: 0 });
    });

    it('lista los runs de todos los agentes visibles con el contrato de campos esperado', async () => {
      const page = await list(owner.api);
      expect(page.items.length).toBe(5);
      expect(page.nextCursor).toBeNull();
      expect(page.hasMore).toBe(false);
      const row = page.items.find((r) => r.status === 'SUCCEEDED' && r.agentId === agentId)!;
      expect(Object.keys(row).sort()).toEqual(
        [
          'agentId',
          'agentName',
          'conversationId',
          'costUsd',
          'durationMs',
          'error',
          'executionId',
          'finishedAt',
          'id',
          'inputTokens',
          'model',
          'outputTokens',
          'providerId',
          'source',
          'startedAt',
          'status',
          'ttftMs',
        ].sort(),
      );
      expect(row.agentName).toBe('Agente con historial');
      expect(row.costUsd).toBeCloseTo(0.01, 6);
      expect(row.finishedAt).not.toBeNull();
    });

    it('ordena por startedAt descendente (más reciente primero)', async () => {
      const page = await list(owner.api);
      const times = page.items.map((r) => new Date(r.startedAt).getTime());
      const sorted = [...times].sort((a, b) => b - a);
      expect(times).toEqual(sorted);
    });

    it('filtra por agentId (solo runs del agente indicado)', async () => {
      const page = await list(owner.api, `?agentId=${agentId}`);
      expect(page.items).toHaveLength(4);
      expect(page.items.every((r) => r.agentId === agentId)).toBe(true);
    });

    it('filtra por status', async () => {
      const page = await list(owner.api, '?status=FAILED');
      expect(page.items).toHaveLength(1);
      expect(page.items[0].status).toBe('FAILED');
      // El error se recorta a 500 caracteres.
      expect(page.items[0].error!.length).toBe(500);
    });

    it('filtra por source', async () => {
      const page = await list(owner.api, '?source=WORKFLOW');
      expect(page.items).toHaveLength(1);
      expect(page.items[0].source).toBe('WORKFLOW');
    });

    it('filtra por rango de fechas sobre startedAt', async () => {
      const from = new Date(Date.now() - 3 * DAY_MS).toISOString();
      const page = await list(owner.api, `?from=${encodeURIComponent(from)}`);
      // Quedan fuera el run de hace 10 días (workflow); entran los 4 de los últimos 3 días.
      expect(page.items.every((r) => new Date(r.startedAt).getTime() >= Date.parse(from))).toBe(true);
      expect(page.items.some((r) => r.source === 'WORKFLOW')).toBe(false);
    });

    it('pagina por cursor sin solapar ni perder filas', async () => {
      const first = await list(owner.api, '?take=2');
      expect(first.items).toHaveLength(2);
      expect(first.hasMore).toBe(true);
      expect(first.nextCursor).not.toBeNull();

      const second = await list(owner.api, `?take=2&cursor=${first.nextCursor}`);
      expect(second.items).toHaveLength(2);
      const third = await list(owner.api, `?take=2&cursor=${second.nextCursor}`);
      expect(third.items).toHaveLength(1);
      expect(third.hasMore).toBe(false);
      expect(third.nextCursor).toBeNull();

      const seen = [...first.items, ...second.items, ...third.items].map((r) => r.id);
      expect(new Set(seen).size).toBe(5);
    });
  });

  describe('Aislamiento entre workspaces', () => {
    it('un workspace no ve runs de otro', async () => {
      const a = await registerOwner(app, 'runs-isoA');
      const b = await registerOwner(app, 'runs-isoB');
      const agentA = (await createAgent(a, { name: 'Solo A' })).id;
      await addRun(app, a, agentA, { status: 'SUCCEEDED' });

      const pageB = await list(b.api);
      expect(pageB.items).toHaveLength(0);
      const pageA = await list(a.api);
      expect(pageA.items.map((r) => r.agentId)).toEqual([agentA]);

      // B tampoco puede atisbar runs de A filtrando por su agentId (página vacía, sin filtrar).
      const probe = await list(b.api, `?agentId=${agentA}`);
      expect(probe.items).toHaveLength(0);
    });
  });

  describe('Alcance por rol (mismo criterio que el tablero/observabilidad)', () => {
    let owner: Session;
    let editorA: Session;
    let viewer: Session;
    let companyId: string;
    let privateId: string;
    let teamId: string;

    beforeAll(async () => {
      owner = await registerOwner(app, 'runs-rol');
      editorA = await addMember(app, owner, { role: 'EDITOR', tag: 'runs-ea' });
      viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'runs-viewer' });

      companyId = (await createAgent(owner, { name: 'Empresa' })).id;
      await publishAgent(owner, companyId);
      privateId = (await createAgent(editorA, { name: 'Privado de A' })).id;
      teamId = (await createAgent(editorA, { name: 'Equipo de A' })).id;
      await shareAgent(editorA, teamId, [{ principalType: 'USER', principalId: viewer.userId, permission: 'USE' }]);

      await addRun(app, owner, companyId, { status: 'SUCCEEDED' });
      await addRun(app, editorA, privateId, { status: 'SUCCEEDED' });
      await addRun(app, editorA, teamId, { status: 'SUCCEEDED' });
    });

    const agentIdsOf = async (s: Session) => [...new Set((await list(s.api)).items.map((r) => r.agentId))].sort();

    it('OWNER/ADMIN ven runs de todos los agentes del workspace (incluido el privado ajeno)', async () => {
      expect(await agentIdsOf(owner)).toEqual([companyId, privateId, teamId].sort());
    });

    it('un VIEWER no ve runs de agentes que no puede usar (ni el privado ajeno)', async () => {
      const ids = await agentIdsOf(viewer);
      expect(ids).toEqual([companyId, teamId].sort());
      expect(ids).not.toContain(privateId);
      // Tampoco colándose por agentId: el privado ajeno no es visible.
      const probe = await list(viewer.api, `?agentId=${privateId}`);
      expect(probe.items).toHaveLength(0);
    });
  });
});
