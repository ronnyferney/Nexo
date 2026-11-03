import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/app';
import {
  addMember,
  chat,
  createAgent,
  createUnit,
  LONG_MESSAGE,
  publishAgent,
  registerOwner,
  rootUnit,
  type Session,
} from './utils/fixtures';

const monthKey = () => new Date().toISOString().slice(0, 7);
const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

interface Alert {
  orgUnitId: string;
  threshold: number;
}
interface AgentBudgetRow {
  agentId: string;
  policy: string;
  pct: number;
  spentUsd: number;
  critico: boolean;
}
interface OverrideRow {
  id: string;
  orgUnitId: string | null;
  agentId: string | null;
  periodKey: string;
  vigente: boolean;
}

async function alertsOf(s: Session, orgUnitId: string): Promise<number[]> {
  const all = (await s.api.get('/admin/alerts').expect(200)).body as Alert[];
  return all
    .filter((a) => a.orgUnitId === orgUnitId)
    .map((a) => a.threshold)
    .sort((a, b) => a - b);
}

async function auditActions(s: Session, action: string): Promise<number> {
  const res = (await s.api.get(`/auditoria?action=${action}`).expect(200)).body as { items: unknown[] };
  return res.items.length;
}

/**
 * P0.1 (presupuestos) + P1.1c (degradación por criticidad). Verifica: alertas 80/90/100 una vez cada una; bloqueo al
 * 100 % salvo override auditado; bolsa por agente y su aislamiento; preset piloto US$ 0 (solo mock); degradación solo en
 * procesos no críticos con validación de impacto, y crítico bloquea; rol ADMIN para las operaciones sensibles.
 */
describe('Presupuestos P0.1/P1.1c (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  describe('Alertas 80/90/100 una sola vez por umbral', () => {
    let owner: Session;
    let editor: Session;
    let unitId: string;
    let agentId: string;

    beforeAll(async () => {
      owner = await registerOwner(app, 'alertas');
      const root = await rootUnit(owner);
      unitId = (await createUnit(owner, 'Alertas', root.id)).id;
      editor = await addMember(app, owner, { role: 'EDITOR', orgUnitId: unitId });
      agentId = (await createAgent(owner)).id;
      await publishAgent(owner, agentId);
      await owner.api
        .put(`/admin/budgets/${unitId}`, { period: 'MONTHLY', limitUsd: 0.0001, policy: 'ALERT_ONLY' })
        .expect(200);
    });

    it('al superar el 100 % emite 80/90/100 una vez cada una (y los umbrales por defecto son 80/90/100)', async () => {
      await chat(editor, agentId, LONG_MESSAGE);
      expect(await alertsOf(owner, unitId)).toEqual([80, 90, 100]);
    });

    it('un consumo adicional no duplica las alertas (idempotente por umbral/periodo)', async () => {
      await chat(editor, agentId, LONG_MESSAGE);
      expect(await alertsOf(owner, unitId)).toEqual([80, 90, 100]);
    });
  });

  describe('Bloqueo al 100 % salvo override gobernado y auditado', () => {
    let owner: Session;
    let editor: Session;
    let unitId: string;
    let agentId: string;

    beforeAll(async () => {
      owner = await registerOwner(app, 'override');
      const root = await rootUnit(owner);
      unitId = (await createUnit(owner, 'Operaciones', root.id)).id;
      editor = await addMember(app, owner, { role: 'EDITOR', orgUnitId: unitId });
      agentId = (await createAgent(owner)).id;
      await publishAgent(owner, agentId);
      await owner.api
        .put(`/admin/budgets/${unitId}`, { period: 'MONTHLY', limitUsd: 0.0001, policy: 'BLOCK' })
        .expect(200);
    });

    it('agotado el tope, bloquea; con autorización expresa deja pasar; revocada, vuelve a bloquear', async () => {
      await chat(editor, agentId, LONG_MESSAGE); // agota
      await editor.api.post(`/agents/${agentId}/chat`, { message: 'hola' }).expect(402);

      const granted = (
        await owner.api
          .post('/admin/budgets/overrides', { orgUnitId: unitId, motivo: 'Cierre de mes autorizado', expiresAt: future() })
          .expect(201)
      ).body as OverrideRow;
      expect(granted).toMatchObject({ orgUnitId: unitId, agentId: null, periodKey: monthKey(), vigente: true });
      expect(await auditActions(owner, 'PRESUPUESTO_OVERRIDE_CONCEDIDO')).toBeGreaterThanOrEqual(1);

      // Con override vigente el consumo pasa pese a estar por encima del tope.
      await chat(editor, agentId, 'con autorización');

      await owner.api.delete(`/admin/budgets/overrides/${granted.id}`).expect(200);
      expect(await auditActions(owner, 'PRESUPUESTO_OVERRIDE_REVOCADO')).toBeGreaterThanOrEqual(1);
      await editor.api.post(`/agents/${agentId}/chat`, { message: 'otra' }).expect(402);
    });

    it('rechaza un override sin alcance único o con vigencia pasada', async () => {
      await owner.api
        .post('/admin/budgets/overrides', { motivo: 'sin alcance', expiresAt: future() })
        .expect(400);
      await owner.api
        .post('/admin/budgets/overrides', {
          orgUnitId: unitId,
          motivo: 'vencido',
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        })
        .expect(400);
    });

    it('un EDITOR no puede conceder autorizaciones (rol ADMIN)', async () => {
      await editor.api
        .post('/admin/budgets/overrides', { orgUnitId: unitId, motivo: 'intento', expiresAt: future() })
        .expect(403);
    });
  });

  describe('Bolsa por AGENTE y su aislamiento', () => {
    let owner: Session;
    let editor: Session;
    let unitId: string;
    let agentConBolsa: string;
    let agentSinBolsa: string;

    beforeAll(async () => {
      owner = await registerOwner(app, 'agente');
      const root = await rootUnit(owner);
      unitId = (await createUnit(owner, 'Área', root.id)).id;
      editor = await addMember(app, owner, { role: 'EDITOR', orgUnitId: unitId });
      agentConBolsa = (await createAgent(owner, { name: 'Con bolsa' })).id;
      agentSinBolsa = (await createAgent(owner, { name: 'Sin bolsa' })).id;
      await publishAgent(owner, agentConBolsa);
      await publishAgent(owner, agentSinBolsa);
      await owner.api
        .put(`/admin/agent-budgets/${agentConBolsa}`, { period: 'MONTHLY', limitUsd: 0.0001, policy: 'BLOCK' })
        .expect(200);
    });

    it('la bolsa del agente bloquea al agotarse sin afectar a otro agente (resolución por agente)', async () => {
      await chat(editor, agentConBolsa, LONG_MESSAGE); // agota su bolsa
      const res = await editor.api.post(`/agents/${agentConBolsa}/chat`, { message: 'hola' }).expect(402);
      expect((res.body as { message: string }).message).toContain('Con bolsa');
      // Otro agente sin bolsa propia sigue operando (aislamiento entre bolsas de agente).
      await chat(editor, agentSinBolsa, 'hola');

      const rows = (await owner.api.get('/admin/agent-budgets').expect(200)).body as AgentBudgetRow[];
      const row = rows.find((r) => r.agentId === agentConBolsa)!;
      expect(row).toMatchObject({ policy: 'BLOCK', critico: true });
      expect(row.pct).toBeGreaterThanOrEqual(100);
      expect(rows.find((r) => r.agentId === agentSinBolsa)).toBeUndefined();
    });

    it('un override por agente deja pasar su bolsa agotada', async () => {
      await owner.api
        .post('/admin/budgets/overrides', { agentId: agentConBolsa, motivo: 'excepción', expiresAt: future() })
        .expect(201);
      await chat(editor, agentConBolsa, 'con override de agente');
    });
  });

  describe('Preset de piloto US$ 0 (solo proveedor mock)', () => {
    let owner: Session;
    let mockAgent: string;
    let realAgent: string;

    beforeAll(async () => {
      owner = await registerOwner(app, 'piloto');
      mockAgent = (await createAgent(owner, { name: 'Piloto mock' })).id;
      realAgent = (await createAgent(owner, { name: 'Piloto real', provider: 'anthropic', model: 'claude-opus-5-5' })).id;
      await publishAgent(owner, mockAgent);
      await publishAgent(owner, realAgent);
    });

    it('con modo piloto activo solo corre el proveedor mock; el proveedor real se bloquea con costo externo 0', async () => {
      await owner.api.put('/admin/budgets/pilot', { modoPiloto: true }).expect(200);
      expect((await owner.api.get('/admin/budgets/pilot').expect(200)).body).toMatchObject({ modoPiloto: true });

      const r = await chat(owner, mockAgent, 'hola');
      expect(r).toMatchObject({ providerId: 'mock', model: 'mock-echo' });

      const res = await owner.api.post(`/agents/${realAgent}/chat`, { message: 'hola' }).expect(402);
      expect((res.body as { message: string }).message).toContain('piloto');
      expect(await auditActions(owner, 'MODO_PILOTO_MODIFICADO')).toBeGreaterThanOrEqual(1);
    });

    it('un EDITOR no puede cambiar el modo piloto (rol ADMIN)', async () => {
      const editor = await addMember(app, owner, { role: 'EDITOR' });
      await editor.api.put('/admin/budgets/pilot', { modoPiloto: false }).expect(403);
    });
  });

  describe('Degradación solo en procesos no críticos con validación de impacto (P1.1c)', () => {
    let owner: Session;
    let editor: Session;
    let unitId: string;
    let agentId: string;

    beforeAll(async () => {
      owner = await registerOwner(app, 'criticidad');
      const root = await rootUnit(owner);
      unitId = (await createUnit(owner, 'Crítico', root.id)).id;
      editor = await addMember(app, owner, { role: 'EDITOR', orgUnitId: unitId });
      agentId = (await createAgent(owner)).id;
      await publishAgent(owner, agentId);
      // DOWNGRADE al mismo modelo mock (único del simulador): el agente es crítico por defecto.
      await owner.api
        .put(`/admin/budgets/${unitId}`, {
          period: 'MONTHLY',
          limitUsd: 0.0001,
          policy: 'DOWNGRADE',
          downgradeProviderId: 'mock',
          downgradeModel: 'mock-echo',
        })
        .expect(200);
    });

    it('un proceso crítico al tope BLOQUEA (no degrada)', async () => {
      await chat(editor, agentId, LONG_MESSAGE); // agota
      await editor.api.post(`/agents/${agentId}/chat`, { message: 'hola' }).expect(402);
    });

    it('marcado como no crítico y con validación de impacto, deja de bloquear (habilita la degradación)', async () => {
      await owner.api
        .put(`/admin/budgets/${unitId}`, {
          period: 'MONTHLY',
          limitUsd: 0.0001,
          policy: 'DOWNGRADE',
          downgradeProviderId: 'mock',
          downgradeModel: 'mock-echo',
          critico: false,
        })
        .expect(200);
      // Sin validación de impacto sigue bloqueando.
      await editor.api.post(`/agents/${agentId}/chat`, { message: 'hola' }).expect(402);
      await owner.api.post(`/admin/budgets/${unitId}/impacto`, { nota: 'Impacto evaluado' }).expect(201);
      expect(await auditActions(owner, 'PRESUPUESTO_IMPACTO_VALIDADO')).toBeGreaterThanOrEqual(1);
      // Con no crítico + impacto validado, la bolsa habilita la degradación y el consumo pasa.
      await chat(editor, agentId, 'hola');
    });
  });

  describe('Aislamiento multi-tenant', () => {
    it('las autorizaciones y bolsas de agente no se ven desde otro workspace', async () => {
      const a = await registerOwner(app, 'iso-a');
      const b = await registerOwner(app, 'iso-b');
      const rootA = await rootUnit(a);
      const unitA = (await createUnit(a, 'Privada', rootA.id)).id;
      await a.api.put(`/admin/budgets/${unitA}`, { period: 'MONTHLY', limitUsd: 1, policy: 'BLOCK' }).expect(200);
      await a.api
        .post('/admin/budgets/overrides', { orgUnitId: unitA, motivo: 'solo A', expiresAt: future() })
        .expect(201);

      expect((await b.api.get('/admin/budgets/overrides').expect(200)).body).toEqual([]);
      expect((await b.api.get('/admin/agent-budgets').expect(200)).body).toEqual([]);
      // B no puede autorizar la unidad de A (no existe en su workspace).
      await b.api
        .post('/admin/budgets/overrides', { orgUnitId: unitA, motivo: 'intruso', expiresAt: future() })
        .expect(404);
    });
  });
});
