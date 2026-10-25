import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, parseSse } from './utils/app';
import { addMember, createAgent, registerOwner, type Session } from './utils/fixtures';

interface CargoView {
  id: string;
  nombre: string;
  proposito: string | null;
  funciones: string[];
  entregables: string[];
  indicadores: string[];
  limites: string[];
  nivel: string;
  activo: boolean;
  agentsCount: number;
}

interface AgentView {
  id: string;
  launchStatus: string;
  visibility: string;
  cargoId: string | null;
  responsableUserId: string | null;
  suplenteUserId: string | null;
}

/** Primer incremento de la Épica E2: catálogo de Cargo, expediente del agente y ciclo de vida completo (RF02-RF06). */
describe('Empleado digital: cargos, expediente y ciclo de vida (E2 · RF02-RF06) (E2E)', () => {
  let app: INestApplication;
  let owner: Session;
  let member: Session;
  let other: Session; // dueño de OTRO workspace (aislamiento)

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'ciclo');
    member = await addMember(app, owner, { role: 'EDITOR', tag: 'titular' });
    other = await registerOwner(app, 'otrows');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Catálogo de Cargo (RF03)', () => {
    let cargoId: string;

    it('el catálogo nace vacío (los perfiles de ejemplo no se siembran)', async () => {
      expect((await owner.api.get('/cargos').expect(200)).body).toEqual([]);
    });

    it('un EDITOR+ crea un cargo con nivel jerárquico y perfil completo', async () => {
      const body = {
        nombre: 'Analista de cobranzas',
        proposito: 'Gestionar la cartera vencida',
        funciones: ['Llamar a clientes', 'Conciliar pagos'],
        entregables: ['Reporte de recaudo'],
        indicadores: ['% de recaudo'],
        limites: ['No condonar deudas'],
        nivel: 'JEFE',
      };
      const res = (await owner.api.post('/cargos', body).expect(201)).body as CargoView;
      cargoId = res.id;
      expect(res).toMatchObject({ nombre: 'Analista de cobranzas', nivel: 'JEFE', activo: true, agentsCount: 0 });
      expect(res.funciones).toEqual(['Llamar a clientes', 'Conciliar pagos']);
      expect(res.limites).toEqual(['No condonar deudas']);
      expect((await owner.api.get('/cargos').expect(200)).body).toHaveLength(1);
    });

    it('rechaza un nivel jerárquico inválido', async () => {
      await owner.api.post('/cargos', { nombre: 'Cargo raro', nivel: 'REY' }).expect(400);
    });

    it('un VIEWER puede listar pero no mutar (@MinRole EDITOR)', async () => {
      const viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'lector' });
      await viewer.api.get('/cargos').expect(200);
      await viewer.api.post('/cargos', { nombre: 'No permitido' }).expect(403);
      await viewer.api.patch(`/cargos/${cargoId}`, { nombre: 'No' }).expect(403);
      await viewer.api.delete(`/cargos/${cargoId}`).expect(403);
    });

    it('edita el cargo (nivel y estado)', async () => {
      const res = (await owner.api.patch(`/cargos/${cargoId}`, { nivel: 'DIRECTOR', activo: false }).expect(200))
        .body as CargoView;
      expect(res).toMatchObject({ nivel: 'DIRECTOR', activo: false });
    });

    it('aislamiento por workspace: otro workspace no lo ve ni lo toca', async () => {
      expect((await other.api.get('/cargos').expect(200)).body).toEqual([]);
      await other.api.get(`/cargos/${cargoId}`).expect(404);
      await other.api.patch(`/cargos/${cargoId}`, { nombre: 'Hack' }).expect(404);
      await other.api.delete(`/cargos/${cargoId}`).expect(404);
    });

    it('borra el cargo', async () => {
      const temp = ((await owner.api.post('/cargos', { nombre: 'Temporal' }).expect(201)).body as CargoView).id;
      await owner.api.delete(`/cargos/${temp}`).expect(204);
      await owner.api.get(`/cargos/${temp}`).expect(404);
    });
  });

  describe('Expediente del agente (RF02/RF04)', () => {
    let cargoId: string;

    beforeAll(async () => {
      cargoId = ((await owner.api.post('/cargos', { nombre: 'Cargo expediente', nivel: 'EMPLEADO' }).expect(201))
        .body as CargoView).id;
    });

    it('acepta, persiste y devuelve cargoId/responsable/suplente', async () => {
      const id = (await createAgent(owner, { name: 'Con expediente' })).id;
      const upd = (
        await owner.api
          .patch(`/agents/${id}`, { cargoId, responsableUserId: owner.userId, suplenteUserId: member.userId })
          .expect(200)
      ).body as AgentView;
      expect(upd).toMatchObject({ cargoId, responsableUserId: owner.userId, suplenteUserId: member.userId });
      const got = (await owner.api.get(`/agents/${id}`).expect(200)).body as AgentView;
      expect(got).toMatchObject({ cargoId, responsableUserId: owner.userId, suplenteUserId: member.userId });
      expect(((await owner.api.get(`/cargos/${cargoId}`).expect(200)).body as CargoView).agentsCount).toBe(1);
    });

    it('acepta cargo y responsable al crear el agente', async () => {
      const res = (
        await owner.api
          .post('/agents', {
            name: 'Nace con cargo',
            provider: 'mock',
            model: 'mock-echo',
            cargoId,
            responsableUserId: owner.userId,
          })
          .expect(201)
      ).body as AgentView;
      expect(res).toMatchObject({ cargoId, responsableUserId: owner.userId });
    });

    it('el titular y el suplente deben ser miembros del workspace', async () => {
      const id = (await createAgent(owner, { name: 'Responsable ajeno' })).id;
      await owner.api.patch(`/agents/${id}`, { responsableUserId: other.userId }).expect(400);
      await owner.api.patch(`/agents/${id}`, { suplenteUserId: other.userId }).expect(400);
    });

    it('el cargo debe pertenecer al workspace', async () => {
      const foreign = ((await other.api.post('/cargos', { nombre: 'Cargo ajeno' }).expect(201)).body as CargoView).id;
      const id = (await createAgent(owner, { name: 'Cargo ajeno' })).id;
      await owner.api.patch(`/agents/${id}`, { cargoId: foreign }).expect(400);
    });
  });

  describe('Ciclo de vida (RF05/RF06)', () => {
    it('no se puede publicar sin responsable (ni siquiera con override)', async () => {
      const id = (await createAgent(owner, { name: 'Sin responsable' })).id;
      const res = await owner.api.post(`/agents/${id}/launch`, { override: true, reason: 'intento' }).expect(409);
      expect((res.body as { message: string }).message).toMatch(/responsable/i);
    });

    it('con responsable válido se lanza (override salta la puerta de calidad)', async () => {
      const id = (await createAgent(owner, { name: 'Con responsable' })).id;
      await owner.api.patch(`/agents/${id}`, { responsableUserId: owner.userId }).expect(200);
      const res = (await owner.api.post(`/agents/${id}/launch`, { override: true, reason: 'piloto' }).expect(200))
        .body as AgentView;
      expect(res.launchStatus).toBe('LAUNCHED');
    });

    it('Borrador→En validación; suspender un borrador es una transición inválida', async () => {
      const id = (await createAgent(owner, { name: 'En validación' })).id;
      const v = (await owner.api.post(`/agents/${id}/submit-validation`).expect(200)).body as AgentView;
      expect(v.launchStatus).toBe('EN_VALIDACION');
      await owner.api.post(`/agents/${id}/suspend`).expect(409);
    });

    it('Publicado→Suspendido→(reactivar)→Publicado→Retirado; RETIRADO es terminal', async () => {
      const id = (await createAgent(owner, { name: 'Ciclo completo' })).id;
      await owner.api.patch(`/agents/${id}`, { responsableUserId: owner.userId }).expect(200);
      await owner.api.post(`/agents/${id}/launch`, { override: true, reason: 'x' }).expect(200);

      expect(((await owner.api.post(`/agents/${id}/suspend`).expect(200)).body as AgentView).launchStatus).toBe(
        'SUSPENDIDO',
      );
      // Estando suspendido no se relanza con /launch: hay que reactivar.
      await owner.api.post(`/agents/${id}/launch`, { override: true, reason: 'x' }).expect(409);
      expect(((await owner.api.post(`/agents/${id}/reactivate`).expect(200)).body as AgentView).launchStatus).toBe(
        'LAUNCHED',
      );
      expect(((await owner.api.post(`/agents/${id}/retire`).expect(200)).body as AgentView).launchStatus).toBe(
        'RETIRADO',
      );
      // Terminal: ninguna transición más.
      await owner.api.post(`/agents/${id}/reactivate`).expect(409);
      await owner.api.post(`/agents/${id}/submit-validation`).expect(409);
      await owner.api.post(`/agents/${id}/launch`, { override: true, reason: 'x' }).expect(409);
    });

    it('un agente suspendido NO se publica por MCP (ADR 0006 intacto)', async () => {
      const id = (await createAgent(owner, { name: 'MCP ciclo de vida' })).id;
      await owner.api.patch(`/agents/${id}`, { responsableUserId: owner.userId }).expect(200);
      await owner.api.post(`/agents/${id}/launch`, { override: true, reason: 'x' }).expect(200);
      await owner.api.patch(`/agents/${id}/visibility`, { visibility: 'WORKSPACE' }).expect(200);
      const key = (
        (await owner.api.post('/workspace/api-keys', { name: 'MCP ciclo', scopes: ['mcp'] }).expect(201)).body as {
          key: string;
        }
      ).key;
      const mcpTitles = async (): Promise<(string | undefined)[]> => {
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
        type Rpc = { result?: { tools: { name: string; title?: string }[] }; error?: { code: number } };
        const candidates: Rpc[] = raw.trim().startsWith('{')
          ? [JSON.parse(raw) as Rpc]
          : parseSse(raw).map((e) => e.data as Rpc);
        const payload = candidates.find((c) => c?.result?.tools || c?.error);
        // Sin agentes/flujos publicados, el servidor MCP no registra `tools/list` y responde -32601: lista vacía.
        if (payload?.error?.code === -32601) return [];
        if (!payload?.result) throw new Error(`Respuesta MCP inesperada: ${raw}`);
        return payload.result.tools.map((t) => t.title);
      };

      expect(await mcpTitles()).toContain('MCP ciclo de vida');
      await owner.api.post(`/agents/${id}/suspend`).expect(200);
      expect(await mcpTitles()).not.toContain('MCP ciclo de vida');
    });
  });
});
