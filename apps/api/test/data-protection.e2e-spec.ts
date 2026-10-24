import type { INestApplication } from '@nestjs/common';
import { ConversationRetentionService } from '../src/modules/data-protection/conversation-retention.service';
import { PrivacySettingsService } from '../src/modules/data-protection/privacy-settings.service';
import { RetentionService } from '../src/modules/workflows/retention.service';
import { createTestApp, prismaOf } from './utils/app';
import { addMember, chat, createAgent, registerOwner, type Session } from './utils/fixtures';
import { OpenAiMock, RestMock, textReply, toolCallReply } from './utils/mock-servers';

type WireMessage = { role: string; content: string | null; tool_calls?: unknown[] };

const EMAIL = 'ana.perez@cliente-e2e.co';
const PHONE = '3105556677';
const CEDULA = '1020304050';
const MARKER = /\[(CORREO|TELEFONO|DOCUMENTO)_[0-9a-f]{8}\]/g;
const DAY = 24 * 3600 * 1000;

describe('Protección de datos · DataGuard y retención de conversaciones (ADR 0008, E2E)', () => {
  let app: INestApplication;
  let llm: OpenAiMock;
  let rest: RestMock;
  let owner: Session;
  let other: Session;
  let editor: Session;

  const policy = (s: Session) => s.api.get('/admin/data-protection/policy');
  const setPolicy = (s: Session, body: Record<string, unknown>) => s.api.put('/admin/data-protection/policy', body);

  /** Conexión OpenAI-compatible contra el mock, con un modelo, y un agente que la usa. */
  async function llmAgent(s: Session, channel: string, systemPrompt = 'Eres un asistente') {
    const conn = await s.api
      .post('/admin/llm/connections', {
        name: `DataGuard ${channel}`,
        kind: 'OPENAI_COMPATIBLE',
        baseUrl: llm.baseUrl(channel),
        apiKey: llm.apiKey,
      })
      .expect(201);
    const connectionId = (conn.body as { id: string }).id;
    await s.api
      .post(`/admin/llm/connections/${connectionId}/models`, {
        modelId: 'gpt-e2e',
        label: 'GPT E2E',
        tier: 'STANDARD',
        inputUsdPerMTok: 1,
        outputUsdPerMTok: 1,
      })
      .expect(201);
    return (await createAgent(s, { name: `Agente ${channel}`, provider: connectionId, model: 'gpt-e2e', systemPrompt }))
      .id;
  }

  beforeAll(async () => {
    llm = await new OpenAiMock().start();
    rest = await new RestMock().start();
    app = await createTestApp();
    owner = await registerOwner(app, 'datos');
    other = await registerOwner(app, 'datos-otro');
    editor = await addMember(app, owner, { role: 'EDITOR' });
  });

  afterAll(async () => {
    const settings = app?.get(PrivacySettingsService);
    for (const s of [owner, other]) if (s) await settings?.reset(s.workspaceId);
    await app?.close();
    await llm?.stop();
    await rest?.stop();
  });

  describe('Política del workspace', () => {
    it('por defecto enmascara (ADR 0008) y las credenciales se bloquean siempre', async () => {
      const res = await policy(owner).expect(200);
      expect(res.body).toMatchObject({
        dataGuardMode: 'mask',
        conversationRetentionDays: null,
        isDefault: true,
        credentials: 'BLOCK',
      });
    });

    it('solo ADMIN/OWNER: EDITOR recibe 403 al leer, cambiar o probar la política', async () => {
      await policy(editor).expect(403);
      await setPolicy(editor, { dataGuardMode: 'off' }).expect(403);
      await editor.api.post('/admin/data-protection/test', { text: 'x' }).expect(403);
    });

    it('valida modo y días de retención', async () => {
      await setPolicy(owner, { dataGuardMode: 'todo' }).expect(400);
      await setPolicy(owner, { conversationRetentionDays: 0 }).expect(400);
      await setPolicy(owner, { conversationRetentionDays: 4000 }).expect(400);
      await setPolicy(owner, { conversationRetentionDays: 1.5 }).expect(400);
      const ok = await setPolicy(owner, { dataGuardMode: 'mask', conversationRetentionDays: 30 }).expect(200);
      expect(ok.body).toMatchObject({ dataGuardMode: 'mask', conversationRetentionDays: 30, isDefault: false });
      // Cada workspace tiene su propia política.
      expect((await policy(other).expect(200)).body).toMatchObject({ isDefault: true });
    });

    it('POST /test devuelve hallazgos sin valores y la vista enmascarada', async () => {
      const res = await owner.api
        .post('/admin/data-protection/test', { text: `Correo ${EMAIL}, cédula ${CEDULA}` })
        .expect(200);
      const body = res.body as { findings: { category: string }[]; masked: string; mode: string };
      expect(body.mode).toBe('mask');
      expect(body.findings.map((f) => f.category)).toEqual(['EMAIL', 'NATIONAL_ID']);
      expect(JSON.stringify(body.findings)).not.toContain(EMAIL);
      expect(body.masked).toMatch(/^Correo \[CORREO_[0-9a-f]{8}\], cédula \[DOCUMENTO_[0-9a-f]{8}\]$/);
    });
  });

  describe('Modo mask con un proveedor externo (mock OpenAI-compatible)', () => {
    const channel = 'dataguard-mask';
    let agentId: string;

    beforeAll(async () => {
      agentId = await llmAgent(owner, channel);
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
      await owner.api
        .put(`/agents/${agentId}/tools`, { tools: [{ operationId: detail.operations[0].id }] })
        .expect(200);
    });

    it('el proveedor recibe marcadores; la herramienta, la respuesta y lo guardado tienen los valores reales', async () => {
      const before = llm.chatRequests(channel).length;
      const first = await chat(owner, agentId, `Soy Ana, cédula ${CEDULA}, correo ${EMAIL} y celular ${PHONE}`);
      const [req1] = llm.chatRequests(channel).slice(before);
      const sent1 = JSON.stringify(req1.body);
      for (const v of [EMAIL, PHONE, CEDULA]) expect(sent1).not.toContain(v);
      const userMsg = (req1.body.messages as WireMessage[]).at(-1)!.content!;
      const markers = userMsg.match(MARKER)!;
      expect(markers).toHaveLength(3);
      const emailMarker = markers.find((m) => m.startsWith('[CORREO_'))!;

      // Turno 2: el modelo pide la herramienta con el marcador y responde citándolo.
      llm.enqueue(
        channel,
        toolCallReply([{ id: 'call_dp', name: 'clima__getweather', args: { city: emailMarker } }]),
        textReply(`Listo: su correo registrado es ${emailMarker}.`),
      );
      const mark = llm.chatRequests(channel).length;
      const restBefore = rest.requests.length;
      const res = await owner.api
        .post(`/agents/${agentId}/chat`, { message: '¿Cuál es mi correo?', conversationId: first.conversationId })
        .expect(200);

      // La herramienta se ejecutó con el valor real…
      const weather = rest.requests.slice(restBefore).find((r) => r.path === '/weather');
      expect(weather?.query.get('city')).toBe(EMAIL);
      // …el usuario lo ve restituido…
      expect((res.body as { text: string }).text).toBe(`Listo: su correo registrado es ${EMAIL}.`);
      // …y el proveedor nunca lo vio: ni en el historial, ni en el resultado de la herramienta.
      const [req2, req3] = llm.chatRequests(channel).slice(mark);
      for (const r of [req2, req3]) {
        const body = JSON.stringify(r.body);
        for (const v of [EMAIL, PHONE, CEDULA]) expect(body).not.toContain(v);
      }
      // Historial determinista: el turno 1 se reenvía con los mismos marcadores (caché de prompts).
      expect((req2.body.messages as WireMessage[])[1].content).toBe(userMsg);
      const toolMsg = (req3.body.messages as WireMessage[]).find((m) => m.role === 'tool')!;
      expect(toolMsg.content).toContain(emailMarker);

      // Lo guardado (formato nativo, append-only) conserva los valores reales para mostrarlos al usuario.
      const stored = await prismaOf(app).conversation.findUniqueOrThrow({ where: { id: first.conversationId } });
      const json = JSON.stringify(stored.messages);
      expect(json).toContain(EMAIL);
      expect(json).not.toMatch(/\[CORREO_/);
    });

    it('streaming SSE: texto restituido y aviso sin valores', async () => {
      const mockAgent = (await createAgent(owner, { name: 'Eco DataGuard' })).id;
      const { status, events } = await owner.api.sse(`/agents/${mockAgent}/chat`, {
        message: `Mi correo es ${EMAIL}`,
        stream: true,
      });
      expect(status).toBe(200);
      const text = events
        .filter((e) => e.event === 'text')
        .map((e) => (e.data as { text: string }).text)
        .join('');
      expect(text).toContain(`Eco: Mi correo es ${EMAIL}`);
      const notice = events.find((e) => e.event === 'notice');
      expect((notice?.data as { message: string }).message).toMatch(/enmascaró 1 dato personal \(correo electrónico\)/);
      expect(JSON.stringify(notice?.data)).not.toContain(EMAIL);
      expect(events.at(-1)?.event).toBe('done');
    });
  });

  describe('Credenciales de la bóveda', () => {
    it('nunca llegan al proveedor: ni en el system prompt ni en el mensaje del usuario', async () => {
      // Sin palabras como «token» o «clave» delante: solo la bóveda permite reconocerlo.
      const secret = 'Zq7Lm2Xv9Rt4Wp';
      await owner.api.put('/workspace/secrets', { name: 'CRM_TOKEN_E2E', value: secret }).expect(200);
      const channel = 'dataguard-vault';
      const agentId = await llmAgent(owner, channel, `Para el CRM use ${secret} si lo piden`);
      const before = llm.chatRequests(channel).length;
      await chat(owner, agentId, `Me dieron ${secret}, ¿sirve?`);
      const [req] = llm.chatRequests(channel).slice(before);
      const body = JSON.stringify(req.body);
      expect(body).not.toContain(secret);
      expect(body).toContain('[CREDENCIAL_OCULTA]');
    });
  });

  describe('Modo block', () => {
    it('rechaza el mensaje con datos personales sin llamar al proveedor (JSON 422 y evento SSE error)', async () => {
      await setPolicy(other, { dataGuardMode: 'block' }).expect(200);
      const channel = 'dataguard-block';
      const agentId = await llmAgent(other, channel);
      const before = llm.chatRequests(channel).length;

      const res = await other.api.post(`/agents/${agentId}/chat`, { message: `Llámeme al ${PHONE}` }).expect(422);
      expect((res.body as { message: string }).message).toMatch(/datos personales \(teléfono\)/);
      expect(JSON.stringify(res.body)).not.toContain(PHONE);

      const sse = await other.api.sse(`/agents/${agentId}/chat`, { message: `Correo ${EMAIL}`, stream: true });
      expect(sse.events.at(-1)).toMatchObject({ event: 'error' });
      expect(llm.chatRequests(channel).length).toBe(before);

      // Sin datos personales, la conversación sigue normalmente.
      await chat(other, agentId, 'Hola, ¿cómo va todo?');
      expect(llm.chatRequests(channel).length).toBe(before + 1);
    });
  });

  describe('Retención de conversaciones (D7)', () => {
    it('borra lo vencido solo del workspace que lo configuró', async () => {
      const prisma = prismaOf(app);
      const ownerAgent = (await createAgent(owner, { name: 'Retención A' })).id;
      const otherAgent = (await createAgent(other, { name: 'Retención B' })).id;
      const [aOld, aNew, bOld] = [
        await chat(owner, ownerAgent, 'conversación vieja'),
        await chat(owner, ownerAgent, 'conversación reciente'),
        await chat(other, otherAgent, 'conversación vieja de otro workspace'),
      ];
      const old = new Date(Date.now() - 40 * DAY);
      await prisma.$executeRaw`UPDATE "Conversation" SET "updatedAt" = ${old} WHERE id IN (${aOld.conversationId}, ${bOld.conversationId})`;
      const [copilotOld, copilotOther] = await Promise.all([
        prisma.copilotSession.create({
          data: {
            workspaceId: owner.workspaceId,
            userId: owner.userId,
            mode: 'CREATE',
            providerId: 'mock',
            model: 'mock-echo',
          },
        }),
        prisma.copilotSession.create({
          data: {
            workspaceId: other.workspaceId,
            userId: other.userId,
            mode: 'CREATE',
            providerId: 'mock',
            model: 'mock-echo',
          },
        }),
      ]);
      await prisma.copilotMessage.create({ data: { sessionId: copilotOld.id, role: 'user', text: 'contenido' } });
      await prisma.$executeRaw`UPDATE "CopilotSession" SET "updatedAt" = ${old} WHERE id IN (${copilotOld.id}, ${copilotOther.id})`;

      // `owner` fijó 30 días; `other` no tiene retención (sin límite).
      const result = await app.get(RetentionService).purge(new Date(), owner.workspaceId);
      expect(result.conversations).toMatchObject({ conversations: 1, copilotSessions: 1, workspaces: 1 });

      const left = (
        await prisma.conversation.findMany({
          where: { id: { in: [aOld.conversationId, aNew.conversationId, bOld.conversationId] } },
          select: { id: true },
        })
      ).map((c) => c.id);
      expect(left.sort()).toEqual([aNew.conversationId, bOld.conversationId].sort());
      expect(await prisma.copilotSession.findUnique({ where: { id: copilotOld.id } })).toBeNull();
      expect(await prisma.copilotMessage.count({ where: { sessionId: copilotOld.id } })).toBe(0);
      expect(await prisma.copilotSession.findUnique({ where: { id: copilotOther.id } })).not.toBeNull();

      // Con 60 días en el otro workspace, una conversación de 40 días sigue vigente; con 30, se borra.
      const retention = app.get(ConversationRetentionService);
      await setPolicy(other, { conversationRetentionDays: 60 }).expect(200);
      expect(await retention.purge(new Date(), other.workspaceId)).toMatchObject({ conversations: 0 });
      await setPolicy(other, { conversationRetentionDays: 30 }).expect(200);
      expect(await retention.purge(new Date(), other.workspaceId)).toMatchObject({
        conversations: 1,
        copilotSessions: 1,
      });
      expect(await prisma.conversation.findUnique({ where: { id: bOld.conversationId } })).toBeNull();
      // Las conversaciones recientes del primer workspace no se tocaron.
      expect(await prisma.conversation.findUnique({ where: { id: aNew.conversationId } })).not.toBeNull();
    });

    it('volver a "sin límite" deja de purgar', async () => {
      await setPolicy(other, { conversationRetentionDays: null }).expect(200);
      expect((await policy(other).expect(200)).body).toMatchObject({ conversationRetentionDays: null });
      const result = await app.get(ConversationRetentionService).purge(new Date(), other.workspaceId);
      expect(result).toMatchObject({ conversations: 0, workspaces: 0 });
    });
  });
});
