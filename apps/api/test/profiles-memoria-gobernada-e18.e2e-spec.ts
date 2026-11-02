import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

/**
 * ADR 0018 Inc.3 — memoria operativa gobernada: confirmación, vigencia y caducidad.
 * Cubre la transición PROPUESTO → CONFIRMADO con auditoría, el corte de hechos vigentes (excluye PROPUESTO y
 * caducados), la purga de caducados con auditoría, el aislamiento multi-tenant y la autorización por rol.
 */
describe('Memoria operativa gobernada (ADR 0018 Inc.3)', () => {
  let app: INestApplication;
  let wsA: Session;
  let editorA: Session;
  let viewerA: Session;
  let wsB: Session;

  beforeAll(async () => {
    app = await createTestApp();
    wsA = await registerOwner(app, 'memoria-a');
    editorA = await addMember(app, wsA, { role: 'EDITOR', tag: 'memoria-editor' });
    viewerA = await addMember(app, wsA, { role: 'VIEWER', tag: 'memoria-viewer' });
    wsB = await registerOwner(app, 'memoria-b');
  });

  afterAll(async () => {
    await app.close();
  });

  /** Busca en la auditoría del workspace una entrada con la acción y el target indicados. */
  async function hayAuditoria(s: Session, action: string, targetId: string): Promise<boolean> {
    const res = await s.api.get(`/auditoria?action=${action}&targetId=${targetId}`).expect(200);
    return (res.body as { items: { id: string }[] }).items.length > 0;
  }

  describe('Confirmación gobernada', () => {
    it('pasa un hecho de PROPUESTO a CONFIRMADO y lo audita', async () => {
      const created = await editorA.api
        .post('/profiles/memoria', { procesoClave: 'cobranza', hecho: 'El cliente responde mejor por la mañana' })
        .expect(201);
      const id = (created.body as { id: string; estado: string }).id;
      expect((created.body as { estado: string }).estado).toBe('PROPUESTO');

      const confirmed = await editorA.api.post(`/profiles/memoria/${id}/confirmar`).expect(201);
      expect((confirmed.body as { estado: string }).estado).toBe('CONFIRMADO');

      expect(await hayAuditoria(wsA, 'MEMORIA_CONFIRMADA', id)).toBe(true);
    });

    it('rechaza confirmar dos veces el mismo hecho (409)', async () => {
      const created = await editorA.api
        .post('/profiles/memoria', { procesoClave: 'cobranza', hecho: 'No llamar en fin de semana' })
        .expect(201);
      const id = (created.body as { id: string }).id;
      await editorA.api.post(`/profiles/memoria/${id}/confirmar`).expect(201);
      await editorA.api.post(`/profiles/memoria/${id}/confirmar`).expect(409);
    });

    it('VIEWER no puede confirmar (403)', async () => {
      const created = await editorA.api
        .post('/profiles/memoria', { procesoClave: 'cobranza', hecho: 'Hecho a confirmar por viewer' })
        .expect(201);
      const id = (created.body as { id: string }).id;
      await viewerA.api.post(`/profiles/memoria/${id}/confirmar`).expect(403);
    });
  });

  describe('Hechos vigentes', () => {
    it('solo devuelve CONFIRMADO y no caducados; excluye PROPUESTO y caducados', async () => {
      const proceso = 'vigencia-test';
      const futuro = new Date(Date.now() + 86_400_000).toISOString();
      const pasado = new Date(Date.now() - 86_400_000).toISOString();

      // PROPUESTO (no vigente).
      await editorA.api.post('/profiles/memoria', { procesoClave: proceso, hecho: 'propuesto' }).expect(201);
      // CONFIRMADO sin caducidad (vigente).
      const sinCad = await editorA.api
        .post('/profiles/memoria', { procesoClave: proceso, hecho: 'confirmado sin caducidad' })
        .expect(201);
      const idSinCad = (sinCad.body as { id: string }).id;
      await editorA.api.post(`/profiles/memoria/${idSinCad}/confirmar`).expect(201);
      // CONFIRMADO con caducidad futura (vigente).
      const futuroCad = await editorA.api
        .post('/profiles/memoria', { procesoClave: proceso, hecho: 'confirmado futuro', caducaEn: futuro })
        .expect(201);
      const idFuturo = (futuroCad.body as { id: string }).id;
      await editorA.api.post(`/profiles/memoria/${idFuturo}/confirmar`).expect(201);
      // CONFIRMADO ya caducado (no vigente).
      const caducado = await editorA.api
        .post('/profiles/memoria', { procesoClave: proceso, hecho: 'confirmado caducado', caducaEn: pasado })
        .expect(201);
      const idCaducado = (caducado.body as { id: string }).id;
      await editorA.api.post(`/profiles/memoria/${idCaducado}/confirmar`).expect(201);

      const vigentes = await wsA.api.get(`/profiles/memoria/vigentes?procesoClave=${proceso}`).expect(200);
      const hechos = (vigentes.body as { id: string; estado: string }[]).map((m) => m.id);
      expect(hechos).toContain(idSinCad);
      expect(hechos).toContain(idFuturo);
      expect(hechos).not.toContain(idCaducado);
      expect((vigentes.body as { estado: string }[]).every((m) => m.estado === 'CONFIRMADO')).toBe(true);

      // La lista general sí muestra todos (incluido el PROPUESTO).
      const todos = await wsA.api.get(`/profiles/memoria?procesoClave=${proceso}`).expect(200);
      expect((todos.body as { id: string }[]).length).toBe(4);
    });
  });

  describe('Purga de caducados', () => {
    it('elimina los caducados, los audita y respeta los vigentes', async () => {
      const proceso = 'purga-test';
      const pasado = new Date(Date.now() - 86_400_000).toISOString();
      const futuro = new Date(Date.now() + 86_400_000).toISOString();

      const caducado = await editorA.api
        .post('/profiles/memoria', { procesoClave: proceso, hecho: 'a purgar', caducaEn: pasado })
        .expect(201);
      const idCaducado = (caducado.body as { id: string }).id;
      const vigente = await editorA.api
        .post('/profiles/memoria', { procesoClave: proceso, hecho: 'se queda', caducaEn: futuro })
        .expect(201);
      const idVigente = (vigente.body as { id: string }).id;

      const res = await editorA.api.post('/profiles/memoria/purgar-caducados').expect(201);
      expect((res.body as { purgados: number }).purgados).toBeGreaterThanOrEqual(1);

      await wsA.api.get(`/profiles/memoria/${idCaducado}`).expect(404);
      await wsA.api.get(`/profiles/memoria/${idVigente}`).expect(200);
      expect(await hayAuditoria(wsA, 'MEMORIA_CADUCADA', idCaducado)).toBe(true);
    });

    it('VIEWER no puede purgar (403)', async () => {
      await viewerA.api.post('/profiles/memoria/purgar-caducados').expect(403);
    });
  });

  describe('Descarte y aislamiento', () => {
    it('descartar (DELETE) audita MEMORIA_DESCARTADA', async () => {
      const created = await editorA.api
        .post('/profiles/memoria', { procesoClave: 'descarte', hecho: 'hecho a descartar' })
        .expect(201);
      const id = (created.body as { id: string }).id;
      await editorA.api.delete(`/profiles/memoria/${id}`).expect(204);
      expect(await hayAuditoria(wsA, 'MEMORIA_DESCARTADA', id)).toBe(true);
    });

    it('WS-B no confirma ni purga hechos de WS-A (aislamiento)', async () => {
      const created = await editorA.api
        .post('/profiles/memoria', { procesoClave: 'aislamiento', hecho: 'solo de A' })
        .expect(201);
      const id = (created.body as { id: string }).id;
      await wsB.api.post(`/profiles/memoria/${id}/confirmar`).expect(404);

      // La purga de WS-B no toca ni audita el hecho caducado de WS-A.
      const pasado = new Date(Date.now() - 86_400_000).toISOString();
      const cadA = await editorA.api
        .post('/profiles/memoria', { procesoClave: 'aislamiento', hecho: 'caducado de A', caducaEn: pasado })
        .expect(201);
      const idCadA = (cadA.body as { id: string }).id;
      await wsB.api.post('/profiles/memoria/purgar-caducados').expect(201);
      await wsA.api.get(`/profiles/memoria/${idCadA}`).expect(200);
    });
  });
});
