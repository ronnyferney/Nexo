import type { INestApplication } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createTestApp, prismaOf } from './utils/app';
import { addMember, chat, createAgent, registerOwner, type Session } from './utils/fixtures';
import { OpenAiMock, RestMock } from './utils/mock-servers';

interface SkillView {
  id: string;
  name: string;
  slug: string;
  description: string;
  instructions: string;
  operationIds: string[];
  agentCount: number;
  updatedAt: string;
}

interface DocView {
  id: string;
  title: string;
  sourceType: 'TEXT' | 'URL' | 'FILE';
  source: string | null;
  status: 'READY' | 'FAILED';
  error: string | null;
  chunkCount: number;
  charCount: number;
}

interface Hit {
  documentId: string;
  title: string;
  content: string;
  score: number;
}

const HTML_PAGE = `<!doctype html><html><head><title>Manual de reembolsos</title>
<style>.x{color:red}</style><script>window.secreto = "no-indexar";</script></head>
<body><h1>Reembolsos</h1><p>Los reembolsos se procesan en un plazo de diez d&iacute;as h&aacute;biles.</p></body></html>`;

/** Servidor HTML mínimo para la ingesta por URL. */
async function startHtmlServer(): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    if (req.url === '/manual') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(HTML_PAGE);
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('no existe');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

describe('Estudio de agentes · perfil, skills, conocimiento, ejemplos y respaldo de modelos (E2E)', () => {
  let app: INestApplication;
  let rest: RestMock;
  let llm: OpenAiMock;
  let html: { server: Server; origin: string };
  let owner: Session;
  let operationId: string;

  beforeAll(async () => {
    rest = await new RestMock().start();
    llm = await new OpenAiMock().start();
    html = await startHtmlServer();
    app = await createTestApp();
    owner = await registerOwner(app, 'estudio');

    const connector = await owner.api
      .post('/connectors', {
        name: 'Clima',
        type: 'REST',
        config: { baseUrl: rest.origin, openApiUrl: `${rest.origin}/openapi.json` },
      })
      .expect(201);
    const connectorId = (connector.body as { id: string }).id;
    await owner.api.post(`/connectors/${connectorId}/discover`).expect(200);
    const detail = (await owner.api.get(`/connectors/${connectorId}`).expect(200)).body as {
      operations: { id: string }[];
    };
    operationId = detail.operations[0].id;
  });

  afterAll(async () => {
    await app?.close();
    await rest?.stop();
    await llm?.stop();
    if (html) {
      html.server.closeAllConnections();
      await new Promise<void>((resolve) => html.server.close(() => resolve()));
    }
  });

  describe('Perfil y validación', () => {
    it('guarda perfil y cadena de respaldo, y GET /agents/:id incluye los campos nuevos', async () => {
      const res = await owner.api
        .post('/agents', {
          name: 'Agente con perfil',
          provider: 'mock',
          model: 'mock-echo',
          profile: { role: 'Asesor', goals: ['Ayudar'], boundaries: ['Dar consejos legales'] },
          fallbackModels: ['mock:mock-echo'],
        })
        .expect(201);
      const id = (res.body as { id: string }).id;
      const got = (await owner.api.get(`/agents/${id}`).expect(200)).body as Record<string, unknown>;
      expect(got).toMatchObject({
        profile: { role: 'Asesor', goals: ['Ayudar'], boundaries: ['Dar consejos legales'] },
        fallbackModels: ['mock:mock-echo'],
        skills: [],
        knowledgeBases: [],
        knowledge: [],
        examplesCount: 0,
      });
      expect(got).not.toHaveProperty('examples');

      await owner.api.patch(`/agents/${id}`, { profile: { tone: 'Formal' } }).expect(200);
      const patched = (await owner.api.get(`/agents/${id}`).expect(200)).body as { profile: unknown };
      expect(patched.profile).toEqual({ tone: 'Formal' });
    });

    it('rechaza perfiles y respaldos inválidos', async () => {
      const base = { name: 'Inválido', provider: 'mock', model: 'mock-echo' };
      await owner.api.post('/agents', { ...base, profile: { role: 'x'.repeat(1001) } }).expect(400);
      await owner.api.post('/agents', { ...base, profile: { desconocido: 'x' } }).expect(400);
      await owner.api.post('/agents', { ...base, profile: { goals: 'no-es-lista' } }).expect(400);
      await owner.api.post('/agents', { ...base, fallbackModels: ['sin-formato'] }).expect(400);
      await owner.api.post('/agents', { ...base, fallbackModels: ['a:1', 'b:2', 'c:3', 'd:4'] }).expect(400);
    });
  });

  describe('Skills', () => {
    let skill: SkillView;
    let agentId: string;

    it('crea skills con slug derivado del nombre y único por workspace', async () => {
      skill = (
        await owner.api
          .post('/skills', {
            name: 'Facturación Avanzada',
            description: 'Cuando el usuario pregunte por facturas',
            instructions: '1. Pide el número de factura.\n2. Consulta el clima con la herramienta.',
            operationIds: [operationId],
          })
          .expect(201)
      ).body as SkillView;
      expect(skill).toMatchObject({ slug: 'facturacion-avanzada', operationIds: [operationId], agentCount: 0 });

      const dup = (
        await owner.api
          .post('/skills', { name: 'Facturación  avanzada!', description: 'Otra', instructions: 'Otra' })
          .expect(201)
      ).body as SkillView;
      expect(dup.slug).toBe('facturacion-avanzada-2');

      const renamed = (await owner.api.patch(`/skills/${dup.id}`, { name: 'Cobranza' }).expect(200)).body as SkillView;
      expect(renamed.slug).toBe('cobranza');
      await owner.api.delete(`/skills/${dup.id}`).expect(200);
      await owner.api.get(`/skills/${dup.id}`).expect(404);

      const list = (await owner.api.get('/skills').expect(200)).body as SkillView[];
      expect(list.map((s) => s.slug)).toEqual(['facturacion-avanzada']);
      expect(Object.keys(list[0]).sort()).toEqual(
        expect.arrayContaining([
          'id',
          'name',
          'slug',
          'description',
          'instructions',
          'operationIds',
          'agentCount',
          'updatedAt',
        ]),
      );
    });

    it('valida que las operaciones pertenezcan al workspace', async () => {
      const res = await owner.api
        .post('/skills', { name: 'Rota', description: 'x', instructions: 'x', operationIds: ['op-inexistente'] })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('op-inexistente');
    });

    it('un VIEWER puede listar pero no crear skills', async () => {
      const viewer = await addMember(app, owner, { role: 'VIEWER' });
      await viewer.api.get('/skills').expect(200);
      await viewer.api.post('/skills', { name: 'Nope', description: 'x', instructions: 'x' }).expect(403);
    });

    it('asigna skills al agente; load_skill devuelve las instrucciones y las operaciones se suman a las tools', async () => {
      agentId = (await createAgent(owner, { name: 'Agente con skills' })).id;
      const assigned = (await owner.api.put(`/agents/${agentId}/skills`, { skillIds: [skill.id] }).expect(200))
        .body as { skills: { id: string; name: string; slug: string }[] };
      expect(assigned.skills).toEqual([{ id: skill.id, name: skill.name, slug: 'facturacion-avanzada' }]);
      expect(((await owner.api.get(`/skills/${skill.id}`).expect(200)).body as SkillView).agentCount).toBe(1);

      const echo = await chat(owner, agentId, 'hola');
      expect(echo.text).toContain('clima__getweather');
      expect(echo.text).toContain('load_skill');

      const loaded = await chat(owner, agentId, '/tool load_skill {"name":"facturacion-avanzada"}');
      expect(loaded.text).toContain('# Facturación Avanzada');
      expect(loaded.text).toContain('Pide el número de factura');
      expect(loaded.text).toContain('Herramientas de esta habilidad: clima__getweather');

      const missing = await chat(owner, agentId, '/tool load_skill {"name":"no-existe"}');
      expect(missing.text).toContain('Habilidad no encontrada');

      const weather = await chat(owner, agentId, '/tool clima__getweather {"city":"Quito"}');
      expect(weather.text).toContain('"city":"Quito"');
    });

    it('no duplica la operación si también está vinculada directamente al agente', async () => {
      await owner.api.put(`/agents/${agentId}/tools`, { tools: [{ operationId, requiresApproval: true }] }).expect(200);
      const preview = (await owner.api.get(`/agents/${agentId}/prompt-preview`).expect(200)).body as {
        tools: { name: string; description: string }[];
      };
      const weatherTools = preview.tools.filter((t) => t.name === 'clima__getweather');
      expect(weatherTools).toHaveLength(1);
      expect(weatherTools[0].description).toContain('Requiere aprobación');
    });

    it('rechaza asignar skills inexistentes', async () => {
      await owner.api.put(`/agents/${agentId}/skills`, { skillIds: ['nope'] }).expect(400);
    });
  });

  describe('Conocimiento', () => {
    let kbId: string;
    let agentId: string;

    it('crea una base e ingiere texto, URL (HTML) y archivo', async () => {
      kbId = (
        (await owner.api.post('/knowledge-bases', { name: 'Políticas', description: 'Manual interno' }).expect(201))
          .body as { id: string }
      ).id;

      const long = Array.from(
        { length: 40 },
        (_, i) => `Sección ${i}. Las vacaciones anuales son de quince días hábiles para todo el personal.`,
      ).join('\n\n');
      const text = (
        await owner.api.post(`/knowledge-bases/${kbId}/documents`, { title: 'Política de vacaciones', text: long })
      ).body as DocView;
      expect(text).toMatchObject({ status: 'READY', sourceType: 'TEXT', error: null });
      expect(text.chunkCount).toBeGreaterThan(1);
      expect(text.charCount).toBe(long.length);

      const url = (
        await owner.api.post(`/knowledge-bases/${kbId}/documents`, { url: `${html.origin}/manual` }).expect(201)
      ).body as DocView;
      expect(url).toMatchObject({ status: 'READY', sourceType: 'URL', title: 'Manual de reembolsos', chunkCount: 1 });
      const chunk = await prismaOf(app).knowledgeChunk.findFirst({ where: { documentId: url.id } });
      expect(chunk?.content).toContain('diez días hábiles');
      expect(chunk?.content).not.toContain('no-indexar');
      expect(chunk?.content).not.toContain('<');

      const file = (
        await owner.api
          .call('post', `/knowledge-bases/${kbId}/documents/upload`)
          .field('title', 'Horarios')
          .attach('file', Buffer.from('# Horarios\n\nLa oficina abre de 8 a 17 horas.'), 'horarios.md')
          .expect(201)
      ).body as DocView;
      expect(file).toMatchObject({ status: 'READY', sourceType: 'FILE', source: 'horarios.md', title: 'Horarios' });
    });

    it('marca FAILED los documentos cuya ingesta falla y valida archivos', async () => {
      const failed = (
        await owner.api.post(`/knowledge-bases/${kbId}/documents`, { url: `${html.origin}/no-existe` }).expect(201)
      ).body as DocView;
      expect(failed).toMatchObject({ status: 'FAILED', chunkCount: 0 });
      expect(failed.error).toContain('404');

      await owner.api
        .call('post', `/knowledge-bases/${kbId}/documents/upload`)
        .attach('file', Buffer.from('MZ binario'), 'programa.exe')
        .expect(400);
      await owner.api
        .call('post', `/knowledge-bases/${kbId}/documents/upload`)
        .attach('file', Buffer.alloc(5 * 1024 * 1024 + 10, 'a'), 'enorme.txt')
        .expect(413);
      await owner.api.post(`/knowledge-bases/${kbId}/documents`, { text: 'sin título' }).expect(400);
      await owner.api.post(`/knowledge-bases/${kbId}/documents`, { title: 'x' }).expect(400);

      const docs = (await owner.api.get(`/knowledge-bases/${kbId}/documents`).expect(200)).body as DocView[];
      expect(docs).toHaveLength(4);
      await owner.api.delete(`/knowledge-bases/${kbId}/documents/${failed.id}`).expect(200);
      const kb = (await owner.api.get(`/knowledge-bases/${kbId}`).expect(200)).body as {
        documentCount: number;
        chunkCount: number;
        agentCount: number;
      };
      expect(kb.documentCount).toBe(3);
      expect(kb.chunkCount).toBeGreaterThan(3);
    });

    it('busca con full-text en español y con respaldo por coincidencia parcial', async () => {
      const hits = (
        await owner.api.post(`/knowledge-bases/${kbId}/search`, { query: '¿Cuántas vacaciones tengo?' }).expect(200)
      ).body as Hit[];
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.length).toBeLessThanOrEqual(5);
      expect(hits[0]).toMatchObject({ title: 'Política de vacaciones' });
      expect(hits[0].score).toBeGreaterThan(0);

      const refunds = (await owner.api.post(`/knowledge-bases/${kbId}/search`, { query: 'reembolso' }).expect(200))
        .body as Hit[];
      expect(refunds[0].title).toBe('Manual de reembolsos');

      // "horar" no es una palabra completa ni una raíz en español: lo resuelve el respaldo ILIKE.
      const partial = (
        await owner.api.post(`/knowledge-bases/${kbId}/search`, { query: 'horar', limit: 2 }).expect(200)
      ).body as Hit[];
      expect(partial[0].title).toBe('Horarios');

      const none = (await owner.api.post(`/knowledge-bases/${kbId}/search`, { query: 'astronautas' }).expect(200))
        .body as Hit[];
      expect(none).toEqual([]);
    });

    it('el agente usa search_knowledge con las bases asignadas', async () => {
      agentId = (await createAgent(owner, { name: 'Agente con conocimiento' })).id;
      const before = await chat(owner, agentId, 'hola');
      expect(before.text).not.toContain('search_knowledge');

      const assigned = (await owner.api.put(`/agents/${agentId}/knowledge`, { knowledgeBaseIds: [kbId] }).expect(200))
        .body as { knowledgeBases: { id: string; name: string }[] };
      expect(assigned.knowledgeBases).toEqual([{ id: kbId, name: 'Políticas' }]);

      const r = await chat(owner, agentId, '/tool search_knowledge {"query":"plazo de reembolsos"}');
      expect(r.text).toContain('Documento: Manual de reembolsos');
      expect(r.text).toContain('diez días hábiles');

      const nothing = await chat(owner, agentId, '/tool search_knowledge {"query":"astronautas"}');
      expect(nothing.text).toContain('No se encontró información');

      await owner.api.put(`/agents/${agentId}/knowledge`, { knowledgeBaseIds: ['no-existe'] }).expect(400);
    });

    it('el agente aprende con save_knowledge cuando la base es escribible', async () => {
      // writableIds debe ser subconjunto de knowledgeBaseIds.
      await owner.api
        .put(`/agents/${agentId}/knowledge`, { knowledgeBaseIds: [kbId], writableIds: ['otra'] })
        .expect(400);

      const assigned = (
        await owner.api
          .put(`/agents/${agentId}/knowledge`, { knowledgeBaseIds: [kbId], writableIds: [kbId] })
          .expect(200)
      ).body as { knowledge: { knowledgeBaseId: string; canWrite: boolean; knowledgeBase: { description: string } }[] };
      expect(assigned.knowledge).toEqual([
        {
          knowledgeBaseId: kbId,
          canWrite: true,
          knowledgeBase: { id: kbId, name: 'Políticas', description: 'Manual interno' },
        },
      ]);

      const detail = (await owner.api.get(`/agents/${agentId}`).expect(200)).body as {
        knowledge: { knowledgeBaseId: string; canWrite: boolean }[];
      };
      expect(detail.knowledge).toEqual([
        {
          knowledgeBaseId: kbId,
          canWrite: true,
          knowledgeBase: { id: kbId, name: 'Políticas', description: 'Manual interno' },
        },
      ]);

      const saved = await chat(
        owner,
        agentId,
        '/tool save_knowledge {"title":"Perfil de Ana Torres","content":"Ana Torres es gerenta de compras; prefiere correos breves y directos."}',
      );
      expect(saved.text).toContain('Guardado en la base de conocimiento: Perfil de Ana Torres');

      const doc = await prismaOf(app).knowledgeDocument.findFirst({
        where: { knowledgeBaseId: kbId, title: 'Perfil de Ana Torres' },
      });
      expect(doc).toMatchObject({ sourceType: 'TEXT', status: 'READY' });

      const hits = (
        await owner.api.post(`/knowledge-bases/${kbId}/search`, { query: 'gerenta de compras' }).expect(200)
      ).body as Hit[];
      expect(hits[0].title).toBe('Perfil de Ana Torres');
      expect(hits[0].content).toContain('correos breves');
    });

    it('sin base escribible, save_knowledge no se ofrece ni se ejecuta', async () => {
      await owner.api.put(`/agents/${agentId}/knowledge`, { knowledgeBaseIds: [kbId] }).expect(200);
      const preview = (await owner.api.get(`/agents/${agentId}/prompt-preview`).expect(200)).body as {
        tools: { name: string }[];
      };
      expect(preview.tools.map((t) => t.name)).not.toContain('save_knowledge');
      const r = await chat(owner, agentId, '/tool save_knowledge {"title":"x","content":"y"}');
      expect(r.text).toContain('Tool desconocida: save_knowledge');
    });
  });

  describe('Ejemplos y prompt-preview', () => {
    it('gestiona ejemplos (máx. 20) y muestra el prompt compuesto con todas las herramientas', async () => {
      const agentId = (
        await owner.api
          .post('/agents', {
            name: 'Agente completo',
            provider: 'mock',
            model: 'mock-echo',
            systemPrompt: 'Firma como Nexo.',
            profile: { role: 'Asistente de RR. HH.', boundaries: ['Revelar salarios'], language: 'español' },
          })
          .expect(201)
      ).body.id as string;
      const skills = (await owner.api.get('/skills').expect(200)).body as SkillView[];
      const bases = (await owner.api.get('/knowledge-bases').expect(200)).body as { id: string }[];
      await owner.api.put(`/agents/${agentId}/skills`, { skillIds: skills.map((s) => s.id) }).expect(200);
      await owner.api.put(`/agents/${agentId}/knowledge`, { knowledgeBaseIds: bases.map((b) => b.id) }).expect(200);
      await owner.api.put(`/agents/${agentId}/tools`, { tools: [{ operationId }] }).expect(200);

      const ex = (
        await owner.api.post(`/agents/${agentId}/examples`, { input: '¿Días libres?', output: 'Quince.' }).expect(201)
      ).body as { id: string; input: string; output: string; createdAt: string };
      expect(ex).toMatchObject({ input: '¿Días libres?', output: 'Quince.' });
      const list = (await owner.api.get(`/agents/${agentId}/examples`).expect(200)).body as unknown[];
      expect(list).toHaveLength(1);

      const preview = (await owner.api.get(`/agents/${agentId}/prompt-preview`).expect(200)).body as {
        system: string;
        tools: { name: string; description: string }[];
      };
      const titles = [...preview.system.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
      expect(titles).toEqual([
        'Rol',
        'Límites',
        'Idioma',
        'Instrucciones adicionales',
        'Habilidades disponibles',
        'Conocimiento',
        'Ejemplos',
      ]);
      expect(preview.system).toContain('No debes revelar salarios');
      expect(preview.system).toContain('`facturacion-avanzada`');
      expect(preview.system).toContain('¿Días libres?');
      expect(preview.tools.map((t) => t.name)).toEqual(['clima__getweather', 'load_skill', 'search_knowledge']);
      expect(preview.tools.every((t) => t.description.length > 0)).toBe(true);

      const described = (await owner.api.get(`/agents/${agentId}`).expect(200)).body as { examplesCount: number };
      expect(described.examplesCount).toBe(1);

      for (let i = 1; i < 20; i++) {
        await owner.api.post(`/agents/${agentId}/examples`, { input: `e${i}`, output: `s${i}` }).expect(201);
      }
      await owner.api.post(`/agents/${agentId}/examples`, { input: 'sobra', output: 'sobra' }).expect(400);
      await owner.api.delete(`/agents/${agentId}/examples/${ex.id}`).expect(200);
      await owner.api.delete(`/agents/${agentId}/examples/${ex.id}`).expect(404);
      await owner.api.post(`/agents/${agentId}/examples`, { input: 'cabe', output: 'cabe' }).expect(201);
    });

    it('un agente sin perfil ni extras conserva exactamente su systemPrompt', async () => {
      const agentId = (await createAgent(owner, { systemPrompt: 'Solo esto.' })).id;
      const preview = (await owner.api.get(`/agents/${agentId}/prompt-preview`).expect(200)).body as {
        system: string;
        tools: unknown[];
      };
      expect(preview).toEqual({ system: 'Solo esto.', tools: [] });
    });
  });

  describe('Respaldo de modelos (D1)', () => {
    let failingId: string;

    beforeAll(async () => {
      const conn = await owner.api
        .post('/admin/llm/connections', {
          name: 'Caída',
          kind: 'OPENAI_COMPATIBLE',
          baseUrl: llm.baseUrl('caida'),
          apiKey: 'sk-incorrecta',
        })
        .expect(201);
      failingId = (conn.body as { id: string }).id;
      await owner.api
        .post(`/admin/llm/connections/${failingId}/models`, {
          modelId: 'gpt-caido',
          label: 'GPT caído',
          tier: 'STANDARD',
          inputUsdPerMTok: 1,
          outputUsdPerMTok: 2,
        })
        .expect(201);
    });

    it('si el proveedor principal falla, usa el siguiente respaldo y lo avisa', async () => {
      const agentId = (
        await createAgent(owner, {
          name: 'Agente con respaldo',
          provider: failingId,
          model: 'gpt-caido',
        })
      ).id;
      // La API rechaza respaldos inexistentes; uno que quedó inválido después (datos heredados) se omite con aviso.
      await owner.api
        .patch(`/agents/${agentId}`, { fallbackModels: ['inexistente:modelo-x', 'mock:mock-echo'] })
        .expect(400);
      await prismaOf(app).agent.update({
        where: { id: agentId },
        data: { fallbackModels: ['inexistente:modelo-x', 'mock:mock-echo'] },
      });

      const before = llm.chatRequests('caida').length;
      const { status, events } = await owner.api.sse(`/agents/${agentId}/chat`, { message: 'hola', stream: true });
      expect(status).toBe(200);
      expect(llm.chatRequests('caida').length).toBe(before + 1);
      const notices = events.filter((e) => e.event === 'notice').map((e) => (e.data as { message: string }).message);
      expect(notices).toEqual([
        expect.stringContaining('El modelo de respaldo modelo-x no está disponible'),
        'El modelo gpt-caido (Caída) falló; se usa mock-echo (Mock).',
      ]);
      const done = events.find((e) => e.event === 'done')?.data as { providerId: string; model: string; text: string };
      expect(done).toMatchObject({ providerId: 'mock', model: 'mock-echo' });
      expect(done.text).toContain('Eco: hola');
    });

    it('sin respaldos, el error del proveedor se propaga', async () => {
      const agentId = (await createAgent(owner, { name: 'Sin respaldo', provider: failingId, model: 'gpt-caido' })).id;
      const res = await owner.api.post(`/agents/${agentId}/chat`, { message: 'hola' });
      expect(res.status).toBe(500);
    });

    it('los errores de configuración del principal no activan el respaldo', async () => {
      await owner.api
        .post('/agents', { name: 'Mal configurado', provider: 'mock', model: 'modelo-inexistente' })
        .expect(400);
      const agentId = (await createAgent(owner, { name: 'Mal configurado' })).id;
      await prismaOf(app).agent.update({ where: { id: agentId }, data: { model: 'modelo-inexistente' } });
      await owner.api.patch(`/agents/${agentId}`, { fallbackModels: ['mock:mock-echo'] }).expect(200);
      await owner.api.post(`/agents/${agentId}/chat`, { message: 'hola' }).expect(400);
    });
  });

  describe('Aislamiento multi-tenant', () => {
    let other: Session;
    let skillId: string;
    let kbId: string;

    beforeAll(async () => {
      other = await registerOwner(app, 'estudio-b');
      skillId = ((await owner.api.get('/skills').expect(200)).body as SkillView[])[0].id;
      kbId = ((await owner.api.get('/knowledge-bases').expect(200)).body as { id: string }[])[0].id;
    });

    it('B no ve ni modifica las skills de A, ni puede usarlas o usar sus operaciones', async () => {
      expect((await other.api.get('/skills').expect(200)).body).toEqual([]);
      await other.api.get(`/skills/${skillId}`).expect(404);
      await other.api.patch(`/skills/${skillId}`, { name: 'Robada' }).expect(404);
      await other.api.delete(`/skills/${skillId}`).expect(404);
      await other.api
        .post('/skills', { name: 'Con op ajena', description: 'x', instructions: 'x', operationIds: [operationId] })
        .expect(400);
      const bAgent = (await createAgent(other)).id;
      await other.api.put(`/agents/${bAgent}/skills`, { skillIds: [skillId] }).expect(400);
      // El mismo slug puede existir en otro workspace.
      const own = (
        await other.api
          .post('/skills', { name: 'Facturación Avanzada', description: 'x', instructions: 'x' })
          .expect(201)
      ).body as SkillView;
      expect(own.slug).toBe('facturacion-avanzada');
    });

    it('B no ve, consulta ni modifica las bases de conocimiento de A', async () => {
      expect((await other.api.get('/knowledge-bases').expect(200)).body).toEqual([]);
      await other.api.get(`/knowledge-bases/${kbId}`).expect(404);
      await other.api.get(`/knowledge-bases/${kbId}/documents`).expect(404);
      await other.api.post(`/knowledge-bases/${kbId}/search`, { query: 'vacaciones' }).expect(404);
      await other.api.post(`/knowledge-bases/${kbId}/documents`, { title: 'x', text: 'x' }).expect(404);
      await other.api.patch(`/knowledge-bases/${kbId}`, { name: 'Robada' }).expect(404);
      await other.api.delete(`/knowledge-bases/${kbId}`).expect(404);
      const bAgent = (await createAgent(other)).id;
      await other.api.put(`/agents/${bAgent}/knowledge`, { knowledgeBaseIds: [kbId] }).expect(400);
    });

    it('B no puede leer el prompt ni los ejemplos del agente de A', async () => {
      const aAgent = (await createAgent(owner, { name: 'Privado' })).id;
      await other.api.get(`/agents/${aAgent}/prompt-preview`).expect(404);
      await other.api.get(`/agents/${aAgent}/examples`).expect(404);
      await other.api.post(`/agents/${aAgent}/examples`, { input: 'x', output: 'y' }).expect(404);
    });
  });
});
