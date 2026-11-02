import type { INestApplication } from '@nestjs/common';
import { createTestApp, prismaOf } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

interface CrewTemplateVersion {
  id: string;
  version: number;
  payload: {
    proposito: string | null;
    procesoObjetivo: string | null;
    definicion: Record<string, unknown>;
    miembros: {
      rol: string;
      cargoId: string | null;
      nivelEsperado: string | null;
      skills: string[];
      conectoresSugeridos: unknown;
      politicaSugerida: unknown;
      criteriosResultado: unknown;
      delegaA: string[];
    }[];
  };
  notas: string | null;
}

interface CrewTemplate {
  id: string;
  nombre: string;
  descripcion: string | null;
  sourceCuadrillaId: string | null;
  versionesCount?: number;
  versiones?: CrewTemplateVersion[];
}

interface InstallResult {
  cuadrillaId: string;
  templateId: string;
  version: number;
  miembrosInstalados: number;
  aviso: string;
}

/** Miembros declarativos de ejemplo para una cuadrilla de origen. */
function miembrosValidos() {
  return [
    {
      rol: 'Líder de cobranza',
      nivelEsperado: 'LIDER',
      skills: ['skill-negociacion'],
      conectoresSugeridos: [{ connectorId: 'conn-crm', operationId: 'op-listar', modo: 'USE' }],
      politicaSugerida: { limiteDiario: 50, requiereAprobacion: true },
      criteriosResultado: {
        reglaValidacion: { rules: [{ left: '{{ cobro.ok }}', operator: 'eq', right: true }] },
        evidenciaExigida: ['recibo'],
      },
      delegaA: ['Auxiliar de cobranza'],
    },
    { rol: 'Auxiliar de cobranza', nivelEsperado: 'EMPLEADO', skills: ['skill-registro'] },
  ];
}

/**
 * ADR 0019 · Inc.3 · Agent Hub (plantillas de CUADRILLA). Verifica: publicar desde una cuadrilla crea plantilla + v1 y
 * republicar crea v2; instalar crea una cuadrilla BORRADOR con composición válida y sin responsables; una composición
 * inválida (hooks/código) se rechaza (400); ningún secreto/responsable viaja en la plantilla; aislamiento WS-A vs WS-B;
 * VIEWER no publica/instala (403); y cada operación deja su entrada en el AuditLog.
 */
describe('Agent Hub · plantillas de cuadrilla (ADR 0019 Inc.3) (e2e)', () => {
  let app: INestApplication;
  let owner: Session;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'e19c-owner');
  });

  afterAll(async () => {
    await app.close();
  });

  /** Crea una cuadrilla de origen (BORRADOR) con una versión de miembros. Publicar NO exige que esté PUBLICADA. */
  async function crearCuadrilla(s: Session, nombre = 'Cuadrilla de cobranza', miembros = miembrosValidos()) {
    const p = (
      await s.api.post('/crews', { nombre, proposito: 'Recuperar cartera', procesoObjetivo: 'Cobranza' }).expect(201)
    ).body as { id: string };
    await s.api.post(`/crews/${p.id}/versions`, { definicion: { notas: 'v' }, miembros }).expect(201);
    return p;
  }

  async function publish(s: Session, cuadrillaId: string, body: Record<string, unknown> = {}): Promise<CrewTemplate> {
    return (await s.api.post('/crew-templates/publish', { cuadrillaId, ...body }).expect(201)).body as CrewTemplate;
  }

  it('publicar desde una cuadrilla crea plantilla + v1; republicar crea v2', async () => {
    const c = await crearCuadrilla(owner);

    const t1 = await publish(owner, c.id, { nombre: 'Cobranza estándar', notas: 'Primera versión' });
    expect(t1.sourceCuadrillaId).toBe(c.id);
    expect(t1.nombre).toBe('Cobranza estándar');
    expect(t1.versiones).toHaveLength(1);
    expect(t1.versiones![0].version).toBe(1);
    expect(t1.versiones![0].payload.miembros).toHaveLength(2);
    expect(t1.versiones![0].payload.miembros[0].rol).toBe('Líder de cobranza');
    expect(t1.versiones![0].payload.procesoObjetivo).toBe('Cobranza');

    // Republicar desde la MISMA cuadrilla: no crea otra plantilla, agrega la versión 2 (append-only).
    const t2 = await publish(owner, c.id, { notas: 'Segunda versión' });
    expect(t2.id).toBe(t1.id);
    expect(t2.versiones).toHaveLength(2);
    expect(t2.versiones!.map((v) => v.version)).toEqual([1, 2]);

    const catalogo = (await owner.api.get('/crew-templates').expect(200)).body as CrewTemplate[];
    expect(catalogo.find((x) => x.id === t1.id)?.versionesCount).toBe(2);
  });

  it('instalar crea una cuadrilla BORRADOR con composición válida y sin responsables', async () => {
    const c = await crearCuadrilla(owner, 'Instalable');
    const t = await publish(owner, c.id);

    const res = (await owner.api.post(`/crew-templates/${t.id}/install`, {}).expect(201)).body as InstallResult;
    expect(res.cuadrillaId).toBeDefined();
    expect(res.miembrosInstalados).toBe(2);
    expect(res.aviso).toContain('BORRADOR');

    // La cuadrilla instalada existe en BORRADOR con su versión y miembros; ningún agente ni responsable aún.
    const plantilla = await prismaOf(app).cuadrillaPlantilla.findFirst({
      where: { id: res.cuadrillaId, workspaceId: owner.workspaceId },
      include: { versiones: { include: { miembros: true } }, instancias: true },
    });
    expect(plantilla).not.toBeNull();
    expect(plantilla!.estado).toBe('BORRADOR');
    expect(plantilla!.versiones).toHaveLength(1);
    expect(plantilla!.versiones[0].miembros).toHaveLength(2);
    expect(plantilla!.instancias).toHaveLength(0);
    // La cuadrilla instalada es independiente de la de origen (nuevo id).
    expect(plantilla!.id).not.toBe(c.id);

    // Instalar una versión inexistente => 404.
    await owner.api.post(`/crew-templates/${t.id}/install`, { version: 99 }).expect(404);
  });

  it('una composición inválida (hooks/código) se rechaza al instalar (400)', async () => {
    const c = await crearCuadrilla(owner, 'Para contaminar');
    const t = await publish(owner, c.id);

    // Se contamina directamente el payload persistido (saltándose el publish) para probar la validación de install.
    const version = await prismaOf(app).crewTemplateVersion.findFirst({ where: { templateId: t.id } });
    await prismaOf(app).crewTemplateVersion.update({
      where: { id: version!.id },
      data: {
        payload: {
          proposito: 'x',
          procesoObjetivo: 'y',
          definicion: {},
          miembros: [{ rol: 'malicioso', politicaSugerida: { hooks: { onInstall: 'rm -rf /' } } }],
        },
      },
    });

    await owner.api.post(`/crew-templates/${t.id}/install`, {}).expect(400);
    // Install valida ANTES de crear: no quedó ninguna cuadrilla huérfana (solo persiste la de origen con ese nombre).
    const cuadrillas = (await owner.api.get('/crews').expect(200)).body as { id: string; nombre: string }[];
    expect(cuadrillas.filter((x) => x.nombre === t.nombre).map((x) => x.id)).toEqual([c.id]);
  });

  it('ningún secreto ni responsable viaja en la plantilla de cuadrilla', async () => {
    const otro = await addMember(app, owner, { role: 'EDITOR', tag: 'e19c-resp' });
    const c = await crearCuadrilla(owner, 'Con responsable potencial');
    // Instanciar la cuadrilla de origen con un responsable NO debe contaminar la plantilla (la plantilla sale de la
    // composición, no de las instancias). Publicamos y revisamos que el userId no aparezca.
    const t = await publish(owner, c.id);
    const payloadStr = JSON.stringify(t.versiones![0].payload);
    expect(payloadStr).not.toContain(otro.userId);
    expect(payloadStr).not.toContain('responsableUserId');
    expect(payloadStr).not.toContain('secret');
  });

  it('aísla por workspace: otro workspace no ve, no detalla ni instala la plantilla (404)', async () => {
    const c = await crearCuadrilla(owner, 'Privada');
    const t = await publish(owner, c.id);

    const otro = await registerOwner(app, 'e19c-otro');
    await otro.api.get(`/crew-templates/${t.id}`).expect(404);
    await otro.api.post(`/crew-templates/${t.id}/install`, {}).expect(404);
    // Publicar en el otro workspace citando una cuadrilla ajena no cruza el límite (404 de la cuadrilla).
    await otro.api.post('/crew-templates/publish', { cuadrillaId: c.id }).expect(404);

    const catalogo = (await otro.api.get('/crew-templates').expect(200)).body as CrewTemplate[];
    expect(catalogo.some((x) => x.id === t.id)).toBe(false);
  });

  it('roles: VIEWER no publica ni instala (403); EDITOR sí; VIEWER lee el catálogo', async () => {
    const editor = await addMember(app, owner, { role: 'EDITOR', tag: 'e19c-editor' });
    const viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'e19c-viewer' });

    // La cuadrilla de origen la crea un ADMIN/OWNER (crews exige ADMIN para crear/versionar).
    const c = await crearCuadrilla(owner, 'Gobernada por rol');
    const t = await publish(owner, c.id);

    await viewer.api.post('/crew-templates/publish', { cuadrillaId: c.id }).expect(403);
    await viewer.api.post(`/crew-templates/${t.id}/install`, {}).expect(403);
    await viewer.api.get('/crew-templates').expect(200);
    await viewer.api.get(`/crew-templates/${t.id}`).expect(200);

    // EDITOR instala sin problema (crea una cuadrilla BORRADOR; crews.create admite EDITOR+ desde el servicio).
    await editor.api.post(`/crew-templates/${t.id}/install`, {}).expect(201);
  });

  it('publicar e instalar dejan su entrada en el AuditLog (actor humano, plantilla/cuadrilla)', async () => {
    const c = await crearCuadrilla(owner, 'Auditada');
    const t = await publish(owner, c.id);
    const res = (await owner.api.post(`/crew-templates/${t.id}/install`, {}).expect(201)).body as InstallResult;

    const publicada = (
      await owner.api.get(`/auditoria?action=CUADRILLA_PLANTILLA_PUBLICADA&targetId=${t.id}`).expect(200)
    ).body as { items: { actorType: string; actorId: string; metadata: { version: number } }[] };
    expect(publicada.items.length).toBeGreaterThanOrEqual(1);
    expect(publicada.items[0].actorType).toBe('USER');
    expect(publicada.items[0].actorId).toBe(owner.userId);

    const instalada = (
      await owner.api.get(`/auditoria?action=CUADRILLA_PLANTILLA_INSTALADA&targetId=${res.cuadrillaId}`).expect(200)
    ).body as { items: { metadata: { templateId: string } }[] };
    expect(instalada.items).toHaveLength(1);
    expect(instalada.items[0].metadata.templateId).toBe(t.id);
  });
});
