import type { INestApplication } from '@nestjs/common';
import { createTestApp, prismaOf } from './utils/app';
import { addMember, createAgent, registerOwner, type Session } from './utils/fixtures';

interface TemplateVersion {
  id: string;
  version: number;
  payload: {
    cargo: { cargoId: string | null; nivel: string | null };
    perfil: { systemPrompt: string; model: string };
    skills: { slug: string; name: string }[];
    operaciones: unknown[];
  };
  notas: string | null;
}

interface Template {
  id: string;
  nombre: string;
  descripcion: string | null;
  area: string | null;
  sourceAgentId: string | null;
  versionesCount?: number;
  versiones?: TemplateVersion[];
}

interface InstallResult {
  agentId: string;
  templateId: string;
  version: number;
  skillsVinculadas: number;
  operacionesVinculadas: number;
  aviso: string;
}

/**
 * ADR 0019 · Inc.1 · Agent Hub (plantillas de empleado digital). Verifica: publicar desde un agente crea plantilla +
 * versión v1 y volver a publicar crea v2; instalar crea un agente BORRADOR SIN responsable que NO se puede lanzar;
 * ningún secreto ni responsable viaja en la plantilla ni al instalar; aislamiento WS-A vs WS-B; VIEWER no puede
 * publicar/instalar (403); y cada operación deja su entrada en el AuditLog.
 */
describe('Agent Hub · plantillas de agente (ADR 0019 Inc.1) (e2e)', () => {
  let app: INestApplication;
  let owner: Session;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'e19-owner');
  });

  afterAll(async () => {
    await app.close();
  });

  async function publish(s: Session, agentId: string, body: Record<string, unknown> = {}): Promise<Template> {
    return (await s.api.post('/agent-templates/publish', { agentId, ...body }).expect(201)).body as Template;
  }

  it('publicar desde un agente crea plantilla + versión v1; volver a publicar crea v2', async () => {
    const agent = await createAgent(owner, { name: 'Analista de cartera', systemPrompt: 'Eres un analista.' });

    const t1 = await publish(owner, agent.id, { nombre: 'Analista', area: 'Finanzas', notas: 'Primera versión' });
    expect(t1.sourceAgentId).toBe(agent.id);
    expect(t1.area).toBe('Finanzas');
    expect(t1.versiones).toHaveLength(1);
    expect(t1.versiones![0].version).toBe(1);
    expect(t1.versiones![0].payload.perfil.systemPrompt).toBe('Eres un analista.');

    // Volver a publicar desde el MISMO agente: no crea otra plantilla, agrega la versión 2 (append-only).
    const t2 = await publish(owner, agent.id, { notas: 'Segunda versión' });
    expect(t2.id).toBe(t1.id);
    expect(t2.versiones).toHaveLength(2);
    expect(t2.versiones!.map((v) => v.version)).toEqual([1, 2]);

    // El catálogo del workspace lista la plantilla con el recuento de versiones.
    const catalogo = (await owner.api.get('/agent-templates').expect(200)).body as Template[];
    const encontrada = catalogo.find((c) => c.id === t1.id);
    expect(encontrada?.versionesCount).toBe(2);
  });

  it('instalar crea un agente BORRADOR sin responsable que NO se puede lanzar', async () => {
    const agent = await createAgent(owner, { name: 'Plantilla lanzable' });
    const t = await publish(owner, agent.id);

    const res = (await owner.api.post(`/agent-templates/${t.id}/install`, {}).expect(201)).body as InstallResult;
    expect(res.agentId).toBeDefined();
    expect(res.aviso).toContain('SIN responsable');

    const creado = await prismaOf(app).agent.findFirst({ where: { id: res.agentId, workspaceId: owner.workspaceId } });
    expect(creado).not.toBeNull();
    expect(creado!.launchStatus).toBe('DRAFT');
    expect(creado!.responsableUserId).toBeNull();
    expect(creado!.suplenteUserId).toBeNull();
    // Es el instalador quien queda como dueño; el agente no hereda responsable de la plantilla.
    expect(creado!.ownerId).toBe(owner.userId);

    // Sin responsable, lanzar devuelve 409 (invariante RF02/RF06 reutilizado).
    await owner.api.post(`/agents/${res.agentId}/launch`).expect(409);
  });

  it('instalar una versión concreta y la última por defecto', async () => {
    const agent = await createAgent(owner, { name: 'Versionado', systemPrompt: 'v1' });
    const t = await publish(owner, agent.id);
    await owner.api.patch(`/agents/${agent.id}`, { systemPrompt: 'v2' }).expect(200);
    await publish(owner, agent.id);

    // Instalar la v1 explícitamente usa el prompt de esa versión.
    const r1 = (await owner.api.post(`/agent-templates/${t.id}/install`, { version: 1 }).expect(201))
      .body as InstallResult;
    const a1 = await prismaOf(app).agent.findFirst({ where: { id: r1.agentId } });
    expect(a1!.systemPrompt).toBe('v1');

    // Sin version => última (v2).
    const r2 = (await owner.api.post(`/agent-templates/${t.id}/install`, {}).expect(201)).body as InstallResult;
    const a2 = await prismaOf(app).agent.findFirst({ where: { id: r2.agentId } });
    expect(a2!.systemPrompt).toBe('v2');

    // Una versión inexistente => 404.
    await owner.api.post(`/agent-templates/${t.id}/install`, { version: 99 }).expect(404);
  });

  it('ningún secreto ni responsable viaja en la plantilla ni al instalar', async () => {
    const otroMiembro = await addMember(app, owner, { role: 'EDITOR', tag: 'e19-resp' });
    const agent = await createAgent(owner, { name: 'Con responsable', systemPrompt: 'Usa {{ secrets.API_KEY }}' });
    // El agente de origen SÍ tiene responsable; la plantilla NUNCA debe llevarlo.
    await owner.api.patch(`/agents/${agent.id}`, { responsableUserId: otroMiembro.userId }).expect(200);

    const t = await publish(owner, agent.id);
    const payloadStr = JSON.stringify(t.versiones![0].payload);
    expect(payloadStr).not.toContain(otroMiembro.userId);
    expect(payloadStr).not.toContain('responsableUserId');
    expect(payloadStr).not.toContain('suplenteUserId');
    expect(payloadStr).not.toContain('ownerId');
    // La referencia `{{ secrets.API_KEY }}` del prompt es un marcador, no un secreto: se conserva tal cual.
    expect(t.versiones![0].payload.perfil.systemPrompt).toContain('{{ secrets.API_KEY }}');

    // El agente instalado tampoco adopta el responsable.
    const res = (await owner.api.post(`/agent-templates/${t.id}/install`, {}).expect(201)).body as InstallResult;
    const creado = await prismaOf(app).agent.findFirst({ where: { id: res.agentId } });
    expect(creado!.responsableUserId).toBeNull();
  });

  it('aísla por workspace: otro workspace no ve, no detalla ni instala la plantilla (404)', async () => {
    const agent = await createAgent(owner, { name: 'Privada' });
    const t = await publish(owner, agent.id);

    const otro = await registerOwner(app, 'e19-otro');
    await otro.api.get(`/agent-templates/${t.id}`).expect(404);
    await otro.api.post(`/agent-templates/${t.id}/install`, {}).expect(404);
    // Publicar en el otro workspace citando un agentId ajeno tampoco cruza el límite (404 del agente).
    await otro.api.post('/agent-templates/publish', { agentId: agent.id }).expect(404);

    const catalogo = (await otro.api.get('/agent-templates').expect(200)).body as Template[];
    expect(catalogo.some((c) => c.id === t.id)).toBe(false);
  });

  it('roles: VIEWER no publica ni instala (403); EDITOR sí; VIEWER lee el catálogo', async () => {
    const editor = await addMember(app, owner, { role: 'EDITOR', tag: 'e19-editor' });
    const viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'e19-viewer' });

    const agent = await createAgent(editor, { name: 'Por EDITOR' });
    const t = await publish(editor, agent.id);

    await viewer.api.post('/agent-templates/publish', { agentId: agent.id }).expect(403);
    await viewer.api.post(`/agent-templates/${t.id}/install`, {}).expect(403);
    // VIEWER sí puede descubrir (lectura del catálogo del workspace).
    await viewer.api.get('/agent-templates').expect(200);
    await viewer.api.get(`/agent-templates/${t.id}`).expect(200);

    // EDITOR instala sin problema.
    await editor.api.post(`/agent-templates/${t.id}/install`, {}).expect(201);
  });

  it('skills portables: la plantilla referencia skills por slug y el instalado las adopta', async () => {
    const skill = (
      await owner.api
        .post('/skills', { name: 'Negociación E19', description: 'Cuándo negociar', instructions: 'Pasos...' })
        .expect(201)
    ).body as { id: string; slug: string };
    const agent = await createAgent(owner, { name: 'Con skill' });
    await owner.api.put(`/agents/${agent.id}/skills`, { skillIds: [skill.id] }).expect(200);

    const t = await publish(owner, agent.id);
    expect(t.versiones![0].payload.skills.map((s) => s.slug)).toContain(skill.slug);

    const res = (await owner.api.post(`/agent-templates/${t.id}/install`, {}).expect(201)).body as InstallResult;
    expect(res.skillsVinculadas).toBe(1);
    const creado = await prismaOf(app).agent.findFirst({
      where: { id: res.agentId },
      include: { skills: true },
    });
    expect(creado!.skills.map((s) => s.skillId)).toContain(skill.id);
  });

  it('publicar e instalar dejan su entrada en el AuditLog (actor humano, plantilla/agente)', async () => {
    const agent = await createAgent(owner, { name: 'Auditada' });
    const t = await publish(owner, agent.id);
    const res = (await owner.api.post(`/agent-templates/${t.id}/install`, {}).expect(201)).body as InstallResult;

    const publicada = (
      await owner.api.get(`/auditoria?action=AGENTE_PLANTILLA_PUBLICADA&targetId=${t.id}`).expect(200)
    ).body as { items: { actorType: string; actorId: string; metadata: { version: number } }[] };
    expect(publicada.items.length).toBeGreaterThanOrEqual(1);
    expect(publicada.items[0].actorType).toBe('USER');
    expect(publicada.items[0].actorId).toBe(owner.userId);

    const instalada = (
      await owner.api.get(`/auditoria?action=AGENTE_PLANTILLA_INSTALADA&targetId=${res.agentId}`).expect(200)
    ).body as { items: { metadata: { templateId: string } }[] };
    expect(instalada.items).toHaveLength(1);
    expect(instalada.items[0].metadata.templateId).toBe(t.id);
  });
});
