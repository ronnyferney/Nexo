import type { INestApplication } from '@nestjs/common';
import { createTestApp, prismaOf } from './utils/app';
import { chat, createAgent, registerOwner, type Session } from './utils/fixtures';

/**
 * Memoria del agente (`save_knowledge`): casos de borde complementarios a `agent-studio.e2e-spec.ts`.
 * Valida la disponibilidad de la herramienta según haya base escribible, la validación de entrada, que escribe en
 * la base escribible (no en una de solo lectura) y el aislamiento entre workspaces del documento guardado.
 */
describe('Memoria del agente · save_knowledge (E2E)', () => {
  let app: INestApplication;

  interface KB {
    id: string;
  }
  interface Hit {
    documentId: string;
    title: string;
    content: string;
    score: number;
  }

  const createKb = async (s: Session, name: string): Promise<string> =>
    ((await s.api.post('/knowledge-bases', { name, description: name }).expect(201)).body as KB).id;

  const search = async (s: Session, kbId: string, query: string): Promise<Hit[]> =>
    (await s.api.post(`/knowledge-bases/${kbId}/search`, { query }).expect(200)).body as Hit[];

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('Disponibilidad y validación de entrada', () => {
    let owner: Session;
    let kbId: string;
    let agentId: string;

    beforeAll(async () => {
      owner = await registerOwner(app, 'memoria');
      kbId = await createKb(owner, 'Memoria del asistente');
      agentId = (await createAgent(owner, { name: 'Asistente con memoria' })).id;
      await owner.api
        .put(`/agents/${agentId}/knowledge`, { knowledgeBaseIds: [kbId], writableIds: [kbId] })
        .expect(200);
    });

    it('con base escribible, save_knowledge aparece en el prompt-preview', async () => {
      const preview = (await owner.api.get(`/agents/${agentId}/prompt-preview`).expect(200)).body as {
        tools: { name: string }[];
      };
      expect(preview.tools.map((t) => t.name)).toContain('save_knowledge');
    });

    it('rechaza guardar sin título o sin contenido, sin crear documentos', async () => {
      const before = await prismaOf(app).knowledgeDocument.count({ where: { knowledgeBaseId: kbId } });

      const sinContenido = await chat(owner, agentId, '/tool save_knowledge {"title":"Solo el título"}');
      expect(sinContenido.text).toContain('indique "content"');

      const sinTitulo = await chat(owner, agentId, '/tool save_knowledge {"content":"Contenido sin título"}');
      expect(sinTitulo.text).toContain('indique "title"');

      const vacios = await chat(owner, agentId, '/tool save_knowledge {"title":"   ","content":"   "}');
      expect(vacios.text).toContain('indique "title"');

      const after = await prismaOf(app).knowledgeDocument.count({ where: { knowledgeBaseId: kbId } });
      expect(after).toBe(before);
    });

    it('guarda y el contenido queda recuperable por búsqueda', async () => {
      const saved = await chat(
        owner,
        agentId,
        '/tool save_knowledge {"title":"Preferencia de Marta","content":"Marta Ríos prefiere reuniones por la mañana y respuestas con viñetas."}',
      );
      expect(saved.text).toContain('Guardado en la base de conocimiento: Preferencia de Marta');

      const hits = await search(owner, kbId, 'reuniones por la mañana');
      expect(hits[0].title).toBe('Preferencia de Marta');
      expect(hits[0].content).toContain('viñetas');
    });
  });

  describe('Escribe en la base escribible, no en las de solo lectura', () => {
    let owner: Session;
    let readId: string;
    let writeId: string;
    let agentId: string;

    beforeAll(async () => {
      owner = await registerOwner(app, 'memoria-rw');
      readId = await createKb(owner, 'Solo lectura');
      writeId = await createKb(owner, 'Escribible');
      agentId = (await createAgent(owner, { name: 'Asistente con dos bases' })).id;
      // Ambas asignadas, pero solo una escribible (writableIds ⊆ knowledgeBaseIds).
      await owner.api
        .put(`/agents/${agentId}/knowledge`, { knowledgeBaseIds: [readId, writeId], writableIds: [writeId] })
        .expect(200);
    });

    it('el documento guardado cae en la base escribible y no en la de solo lectura', async () => {
      const saved = await chat(
        owner,
        agentId,
        '/tool save_knowledge {"title":"Dato aprendido","content":"El cliente Zeta firma contratos solo los viernes."}',
      );
      expect(saved.text).toContain('Guardado en la base de conocimiento: Dato aprendido');

      const inWrite = await prismaOf(app).knowledgeDocument.count({
        where: { knowledgeBaseId: writeId, title: 'Dato aprendido' },
      });
      const inRead = await prismaOf(app).knowledgeDocument.count({
        where: { knowledgeBaseId: readId, title: 'Dato aprendido' },
      });
      expect(inWrite).toBe(1);
      expect(inRead).toBe(0);

      // Recuperable en la escribible; ausente en la de solo lectura.
      expect((await search(owner, writeId, 'contratos los viernes'))[0]?.title).toBe('Dato aprendido');
      expect(await search(owner, readId, 'contratos los viernes')).toEqual([]);
    });
  });

  describe('Aislamiento entre workspaces', () => {
    it('lo que un agente de B guarda no es visible ni recuperable desde A', async () => {
      const a = await registerOwner(app, 'memoria-a');
      const b = await registerOwner(app, 'memoria-b');
      // Ambos workspaces tienen una base con el mismo nombre; son recursos distintos.
      const kbA = await createKb(a, 'Clientes');
      const kbB = await createKb(b, 'Clientes');
      const agentB = (await createAgent(b, { name: 'Agente de B' })).id;
      await b.api.put(`/agents/${agentB}/knowledge`, { knowledgeBaseIds: [kbB], writableIds: [kbB] }).expect(200);

      const saved = await chat(
        b,
        agentB,
        '/tool save_knowledge {"title":"Secreto de B","content":"El margen del cliente Omega es del cuarenta por ciento."}',
      );
      expect(saved.text).toContain('Guardado en la base de conocimiento: Secreto de B');

      // En B existe y se recupera; A no puede verlo en su propia base homónima.
      expect((await search(b, kbB, 'margen del cliente Omega'))[0].title).toBe('Secreto de B');
      expect(await search(a, kbA, 'margen del cliente Omega')).toEqual([]);
      // A tampoco puede buscar en la base de B (404, pertenece a otro workspace).
      await a.api.post(`/knowledge-bases/${kbB}/search`, { query: 'Omega' }).expect(404);
      // Un agente de A no puede marcar la base de B como propia.
      const agentA = (await createAgent(a, { name: 'Agente de A' })).id;
      await a.api.put(`/agents/${agentA}/knowledge`, { knowledgeBaseIds: [kbB] }).expect(400);
    });
  });
});
