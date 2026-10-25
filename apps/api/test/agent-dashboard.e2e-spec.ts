import type { INestApplication } from '@nestjs/common';
import { createTestApp, prismaOf } from './utils/app';
import { addMember, chat, createAgent, publishAgent, registerOwner, shareAgent, type Session } from './utils/fixtures';

const DAY_MS = 24 * 60 * 60 * 1000;

interface Dashboard {
  window: { from: string; to: string; days: number };
  kpis: {
    totalAgents: number;
    testing: number | null;
    active: number;
    activeDelta: number;
    published: number;
    executions: number;
    executionsDeltaPct: number | null;
    successRatePct: number | null;
    costUsd: number;
    costDeltaPct: number | null;
    alerts: number;
  };
  counts: { all: number; active: number; testing: number | null; draft: number; archived: number | null };
  agents: {
    id: string;
    name: string;
    description: string | null;
    visibility: string;
    status: string;
    health: { score: number; level: string } | null;
    executions: number;
    users: number;
    costUsd: number;
    area: string | null;
  }[];
}

interface Analytics {
  window: { from: string; to: string; days: number };
  usage: {
    calls: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    bySource: { source: string; calls: number; costUsd: number }[];
  };
  routines: {
    total: number;
    byStatus: Record<string, number>;
    successRatePct: number | null;
    failed: number;
    durationMs: { avg: number; p50: number; p95: number } | null;
  };
  chat: {
    total: number;
    successRatePct: number | null;
    failed: number;
    cancelled: number;
    durationMs: { avg: number; p50: number; p95: number } | null;
    ttftMs: { avg: number; p50: number; p95: number } | null;
  };
}

const dashboard = async (s: Session): Promise<Dashboard> =>
  (await s.api.get('/agents/dashboard').expect(200)).body as Dashboard;
const analytics = async (s: Session): Promise<Analytics> =>
  (await s.api.get('/agents/analytics').expect(200)).body as Analytics;

describe('Tablero y observabilidad de agentes (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('RX-11 · tablero', () => {
    let owner: Session;
    let publishedId: string;
    let draftId: string;

    beforeAll(async () => {
      owner = await registerOwner(app, 'tablero');
      // Un agente publicado (LAUNCHED + WORKSPACE) con dos conversaciones, y uno en borrador sin consumo.
      publishedId = (await createAgent(owner, { name: 'Publicado' })).id;
      await publishAgent(owner, publishedId);
      await chat(owner, publishedId, 'Hola');
      await chat(owner, publishedId, 'Otra vez');
      draftId = (await createAgent(owner, { name: 'Borrador' })).id;
    });

    it('los KPIs reflejan totales, estado y consumo de la ventana', async () => {
      const d = await dashboard(owner);
      expect(d.window.days).toBe(30);
      expect(d.kpis.totalAgents).toBe(2);
      expect(d.kpis.active).toBe(1);
      expect(d.kpis.published).toBe(1);
      // Dos llamadas al modelo (una por turno de chat); costo > 0.
      expect(d.kpis.executions).toBe(2);
      expect(d.kpis.costUsd).toBeGreaterThan(0);
      // Sin periodo previo no hay base de comparación.
      expect(d.kpis.executionsDeltaPct).toBeNull();
      expect(d.kpis.costDeltaPct).toBeNull();
      // `testing` sigue sin instrumentarse: viaja como null.
      expect(d.kpis.testing).toBeNull();
      // `successRatePct` es real (RX-14): los dos turnos de chat se registraron como ejecuciones exitosas.
      expect(d.kpis.successRatePct).toBe(100);
      expect(typeof d.kpis.alerts).toBe('number');
    });

    it('los recuentos por pestaña parten el catálogo (testing/archived no existen)', async () => {
      const d = await dashboard(owner);
      expect(d.counts).toEqual({ all: 2, active: 1, testing: null, draft: 1, archived: null });
    });

    it('las métricas por agente son de la ventana y traen salud, usuarios y costo', async () => {
      const d = await dashboard(owner);
      const pub = d.agents.find((a) => a.id === publishedId)!;
      const draft = d.agents.find((a) => a.id === draftId)!;
      expect(pub).toMatchObject({ name: 'Publicado', status: 'LAUNCHED', visibility: 'WORKSPACE', executions: 2 });
      expect(pub.users).toBe(1);
      expect(pub.costUsd).toBeGreaterThan(0);
      expect(pub.health).toMatchObject({ score: expect.any(Number), level: expect.any(String) });
      // El agente sin área tiene area null; el borrador sin consumo queda en cero.
      expect(pub.area).toBeNull();
      expect(draft).toMatchObject({ status: 'DRAFT', executions: 0, users: 0, costUsd: 0 });
    });
  });

  describe('RX-12 · observabilidad', () => {
    it('agrega el consumo por origen y expone rutinas aun sin corridas', async () => {
      const owner = await registerOwner(app, 'observa');
      const agentId = (await createAgent(owner, { name: 'Observado' })).id;
      await publishAgent(owner, agentId);
      await chat(owner, agentId, 'Hola');

      const a = await analytics(owner);
      expect(a.usage.calls).toBe(1);
      expect(a.usage.costUsd).toBeGreaterThan(0);
      expect(a.usage.bySource).toEqual([{ source: 'CHAT', calls: 1, costUsd: expect.any(Number) }]);
      // Sin rutinas ejecutadas: sin corridas terminadas no hay tasa de éxito ni duración.
      expect(a.routines).toMatchObject({ total: 0, successRatePct: null, durationMs: null, failed: 0 });
      // El turno de chat se registró en AgentRun: tasa de éxito, duración y ttft reales (RX-14).
      expect(a.chat.total).toBe(1);
      expect(a.chat.successRatePct).toBe(100);
      expect(a.chat.failed).toBe(0);
      expect(a.chat.cancelled).toBe(0);
      expect(a.chat.durationMs).toMatchObject({
        avg: expect.any(Number),
        p50: expect.any(Number),
        p95: expect.any(Number),
      });
      expect(a.chat.ttftMs).toMatchObject({
        avg: expect.any(Number),
        p50: expect.any(Number),
        p95: expect.any(Number),
      });
    });

    it('cada turno de chat crea un AgentRun con estado y timings (RX-14)', async () => {
      const owner = await registerOwner(app, 'agentrun');
      const agentId = (await createAgent(owner, { name: 'Con registro' })).id;
      await publishAgent(owner, agentId);
      const res = await chat(owner, agentId, 'Hola');

      const runs = await prismaOf(app).agentRun.findMany({ where: { agentId } });
      expect(runs).toHaveLength(1);
      const run = runs[0];
      expect(run).toMatchObject({
        workspaceId: owner.workspaceId,
        agentId,
        userId: owner.userId,
        source: 'CHAT',
        status: 'SUCCEEDED',
        conversationId: res.conversationId,
      });
      expect(run.finishedAt).not.toBeNull();
      expect(run.durationMs).toBeGreaterThanOrEqual(0);
      expect(run.error).toBeNull();
    });
  });

  describe('Aislamiento entre workspaces', () => {
    it('el tablero y la observabilidad solo ven agentes y consumo del propio workspace', async () => {
      const a = await registerOwner(app, 'aisla-a');
      const b = await registerOwner(app, 'aisla-b');
      const agentA = (await createAgent(a, { name: 'Solo A' })).id;
      await publishAgent(a, agentA);
      await chat(a, agentA, 'Hola');

      const dashB = await dashboard(b);
      expect(dashB.kpis.totalAgents).toBe(0);
      expect(dashB.kpis.executions).toBe(0);
      expect(dashB.agents).toEqual([]);

      const anaB = await analytics(b);
      expect(anaB.usage.calls).toBe(0);
      expect(anaB.usage.bySource).toEqual([]);

      // El dueño de A sí ve su propio agente y su consumo.
      const dashA = await dashboard(a);
      expect(dashA.agents.map((x) => x.id)).toEqual([agentA]);
      expect(dashA.kpis.executions).toBe(1);
    });
  });

  describe('Alcance por rol (ADMIN/OWNER gobiernan; EDITOR/VIEWER solo lo usable)', () => {
    let owner: Session;
    let admin: Session;
    let editorA: Session; // dueño del privado y del de equipo
    let editorB: Session; // de otra unidad, sin shares
    let viewer: Session; // con quien se comparte el de equipo
    let companyId: string; // WORKSPACE + LAUNCHED
    let privateId: string; // PRIVATE de editorA
    let teamId: string; // TEAM de editorA, compartido con viewer

    const idsOf = (d: Dashboard) => d.agents.map((a) => a.id).sort();

    beforeAll(async () => {
      owner = await registerOwner(app, 'alcance');
      admin = await addMember(app, owner, { role: 'ADMIN', tag: 'alc-admin' });
      editorA = await addMember(app, owner, { role: 'EDITOR', tag: 'alc-ea' });
      editorB = await addMember(app, owner, { role: 'EDITOR', tag: 'alc-eb' });
      viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'alc-viewer' });

      companyId = (await createAgent(owner, { name: 'Empresa' })).id;
      await publishAgent(owner, companyId);
      // Un agente privado de editorA (nace PRIVATE con dueño editorA).
      privateId = (await createAgent(editorA, { name: 'Privado de A' })).id;
      // Un agente de equipo de editorA, compartido directamente con el VIEWER (USE).
      teamId = (await createAgent(editorA, { name: 'Equipo de A' })).id;
      await shareAgent(editorA, teamId, [{ principalType: 'USER', principalId: viewer.userId, permission: 'USE' }]);
    });

    it('OWNER y ADMIN ven todos los agentes del workspace (gobierno), incluido el privado ajeno', async () => {
      for (const s of [owner, admin]) {
        const d = await dashboard(s);
        expect(idsOf(d)).toEqual([companyId, privateId, teamId].sort());
        expect(d.kpis.totalAgents).toBe(3);
        expect(d.counts.all).toBe(3);
        // Un solo agente lanzado (empresa) y una sola visibilidad WORKSPACE.
        expect(d.kpis.active).toBe(1);
        expect(d.counts.active).toBe(1);
        expect(d.kpis.published).toBe(1);
        expect(d.counts.draft).toBe(2);
      }
    });

    it('EDITOR dueño ve la empresa más SUS agentes (privado y de equipo)', async () => {
      const d = await dashboard(editorA);
      expect(idsOf(d)).toEqual([companyId, privateId, teamId].sort());
      expect(d.kpis.totalAgents).toBe(3);
      expect(d.kpis.published).toBe(1);
    });

    it('EDITOR de otra unidad sin shares solo ve el agente de empresa', async () => {
      const d = await dashboard(editorB);
      expect(idsOf(d)).toEqual([companyId]);
      expect(d.kpis.totalAgents).toBe(1);
      // No ve ni el privado ni el de equipo ajenos.
      expect(idsOf(d)).not.toContain(privateId);
      expect(idsOf(d)).not.toContain(teamId);
    });

    it('VIEWER ve la empresa y el agente de equipo compartido con él, no el privado ajeno', async () => {
      const d = await dashboard(viewer);
      expect(idsOf(d)).toEqual([companyId, teamId].sort());
      expect(d.kpis.totalAgents).toBe(2);
      expect(idsOf(d)).not.toContain(privateId);
    });

    it('la observabilidad respeta el mismo alcance por rol', async () => {
      // ADMIN y EDITOR dueño ven el mismo catálogo; EDITOR ajeno un subconjunto.
      const anaAdmin = await analytics(admin);
      const anaEditorB = await analytics(editorB);
      expect(anaAdmin.window.days).toBe(30);
      // Sin consumo en estos agentes, pero las estructuras existen y son coherentes.
      expect(anaAdmin.routines).toMatchObject({ total: 0, successRatePct: null, failed: 0, durationMs: null });
      expect(anaEditorB.usage.calls).toBe(0);
    });
  });

  describe('Deltas con datos en dos ventanas de 30 días', () => {
    let owner: Session;
    let agentId: string;

    // Inserta consumo directamente para situarlo en una ventana concreta (no hay forma de post-fechar vía chat).
    const addUsage = (s: Session, agent: string, daysAgo: number, cost: number, source = 'CHAT') =>
      prismaOf(app).usageRecord.create({
        data: {
          workspaceId: s.workspaceId,
          agentId: agent,
          userId: s.userId,
          source: source as never,
          providerId: 'mock',
          model: 'mock-echo',
          inputTokens: 10,
          outputTokens: 5,
          costUsd: cost,
          createdAt: new Date(Date.now() - daysAgo * DAY_MS),
        },
      });

    beforeAll(async () => {
      owner = await registerOwner(app, 'deltas');
      agentId = (await createAgent(owner, { name: 'Con historial' })).id;
      await publishAgent(owner, agentId);
      // Ventana anterior (hace ~45 días): 2 llamadas, costo total 0.20.
      await addUsage(owner, agentId, 45, 0.1);
      await addUsage(owner, agentId, 45, 0.1);
      // Ventana actual (hace ~10 días): 3 llamadas, costo total 0.50.
      await addUsage(owner, agentId, 10, 0.1);
      await addUsage(owner, agentId, 10, 0.2);
      await addUsage(owner, agentId, 10, 0.2);
    });

    it('calcula executionsDeltaPct y costDeltaPct contra el periodo anterior', async () => {
      const d = await dashboard(owner);
      // Solo cuenta la ventana actual: 3 llamadas, costo 0.50.
      expect(d.kpis.executions).toBe(3);
      expect(d.kpis.costUsd).toBeCloseTo(0.5, 6);
      // (3-2)/2 = +50 %; (0.50-0.20)/0.20 = +150 %. Deltas independientes para llamadas y costo.
      expect(d.kpis.executionsDeltaPct).toBe(50);
      expect(d.kpis.costDeltaPct).toBe(150);
      // El agente de empresa se lanzó dentro de la ventana actual: +1 activo frente al periodo previo.
      expect(d.kpis.activeDelta).toBe(1);
      // Métricas por agente usan solo la ventana actual.
      const row = d.agents.find((a) => a.id === agentId)!;
      expect(row.executions).toBe(3);
      expect(row.users).toBe(1);
      expect(row.costUsd).toBeCloseTo(0.5, 6);
    });

    it('la observabilidad agrega solo la ventana actual con su desglose por origen', async () => {
      const a = await analytics(owner);
      expect(a.usage.calls).toBe(3);
      expect(a.usage.costUsd).toBeCloseTo(0.5, 6);
      expect(a.usage.bySource).toEqual([{ source: 'CHAT', calls: 3, costUsd: expect.any(Number) }]);
    });
  });

  describe('Contrato: los campos no soportados viajan como null, nunca inventados', () => {
    it('testing/successRatePct/archived son null y no aparecen campos extra', async () => {
      const owner = await registerOwner(app, 'contrato');
      const d = await dashboard(owner);
      expect(d.kpis.testing).toBeNull();
      expect(d.kpis.successRatePct).toBeNull();
      expect(d.counts.testing).toBeNull();
      expect(d.counts.archived).toBeNull();
      // Las claves son exactamente las del contrato de models.ts (sin inventar métricas).
      expect(Object.keys(d.kpis).sort()).toEqual(
        [
          'active',
          'activeDelta',
          'alerts',
          'costDeltaPct',
          'costUsd',
          'executions',
          'executionsDeltaPct',
          'published',
          'successRatePct',
          'testing',
          'totalAgents',
        ].sort(),
      );
      expect(Object.keys(d.counts).sort()).toEqual(['all', 'active', 'archived', 'draft', 'testing'].sort());
      expect(Object.keys(d)).toEqual(['window', 'kpis', 'counts', 'agents']);
    });
  });
});
