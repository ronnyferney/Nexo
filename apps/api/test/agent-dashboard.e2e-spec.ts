import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/app';
import { chat, createAgent, publishAgent, registerOwner, type Session } from './utils/fixtures';

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
      // Datos no instrumentados: se exponen como null, no se inventan.
      expect(d.kpis.testing).toBeNull();
      expect(d.kpis.successRatePct).toBeNull();
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
});
