import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

/**
 * Jerarquía / organigrama de empleados digitales (E3/RF32). Verifica: fijar supervisor válido construye el árbol;
 * rechazo de ciclo (A→B→A); rechazo de nivel incoherente (EMPLEADO supervisa GERENTE); supervisor de otro workspace
 * (404); cadena de mando ascendente; quitar supervisor (null) deja al agente como raíz; un VIEWER lee pero no modifica
 * (403); aislamiento multi-tenant; la jerarquía NO concede acceso a datos (ADR 0007); y que cada cambio deja entrada en
 * la auditoría inmutable (E13).
 */
describe('Jerarquía de empleados digitales (E2E · E3)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function crearCargo(s: Session, nombre: string, nivel: string): Promise<string> {
    const res = await s.api.post('/cargos', { nombre, nivel }).expect(201);
    return (res.body as { id: string }).id;
  }

  async function crearAgente(s: Session, name: string, cargoId?: string): Promise<string> {
    const res = await s.api
      .post('/agents', { name, provider: 'mock', model: 'mock-echo', ...(cargoId ? { cargoId } : {}) })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  interface NodoArbol {
    id: string;
    nombre: string;
    nivel: string;
    reportaAAgentId: string | null;
    subordinados: NodoArbol[];
  }

  function buscar(arbol: NodoArbol[], id: string): NodoArbol | undefined {
    for (const n of arbol) {
      if (n.id === id) return n;
      const hit = buscar(n.subordinados, id);
      if (hit) return hit;
    }
    return undefined;
  }

  it('fija supervisor válido y construye el árbol; audita el cambio (E13)', async () => {
    const owner = await registerOwner(app, 'jer-arbol');
    const gerente = await crearCargo(owner, 'Gerente', 'GERENTE');
    const empleado = await crearCargo(owner, 'Empleado', 'EMPLEADO');
    const jefe = await crearAgente(owner, 'Jefa', gerente);
    const sub = await crearAgente(owner, 'Subordinado', empleado);

    await owner.api.put(`/hierarchy/${sub}/reporta-a`, { reportaAAgentId: jefe }).expect(200);

    const arbol = (await owner.api.get('/hierarchy').expect(200)).body as NodoArbol[];
    const nodoJefe = buscar(arbol, jefe)!;
    expect(nodoJefe.reportaAAgentId).toBeNull();
    expect(nodoJefe.subordinados.map((n) => n.id)).toContain(sub);
    const nodoSub = buscar(arbol, sub)!;
    expect(nodoSub.reportaAAgentId).toBe(jefe);

    // Auditoría: el cambio dejó una entrada JERARQUIA_MODIFICADA sobre el agente subordinado.
    const audit = (
      await owner.api.get(`/auditoria?action=JERARQUIA_MODIFICADA&targetId=${sub}`).expect(200)
    ).body as { items: { action: string; targetId: string; metadata: Record<string, unknown> }[] };
    expect(audit.items.length).toBeGreaterThanOrEqual(1);
    expect(audit.items[0]).toMatchObject({ action: 'JERARQUIA_MODIFICADA', targetId: sub });
    expect(audit.items[0].metadata).toMatchObject({ agentId: sub, supervisorNuevo: jefe });
  });

  it('rechaza un ciclo A→B→A con 400', async () => {
    const owner = await registerOwner(app, 'jer-ciclo');
    const gerente = await crearCargo(owner, 'Gerente', 'GERENTE');
    const a = await crearAgente(owner, 'Agente A', gerente);
    const b = await crearAgente(owner, 'Agente B', gerente);
    // A reporta a B (válido, mismo nivel).
    await owner.api.put(`/hierarchy/${a}/reporta-a`, { reportaAAgentId: b }).expect(200);
    // B reporta a A cerraría el ciclo A→B→A: 400.
    await owner.api.put(`/hierarchy/${b}/reporta-a`, { reportaAAgentId: a }).expect(400);
    // Reportarse a sí mismo: 400.
    await owner.api.put(`/hierarchy/${a}/reporta-a`, { reportaAAgentId: a }).expect(400);
  });

  it('rechaza nivel incoherente (EMPLEADO supervisa GERENTE) con 400', async () => {
    const owner = await registerOwner(app, 'jer-nivel');
    const gerente = await crearCargo(owner, 'Gerente', 'GERENTE');
    const empleado = await crearCargo(owner, 'Empleado', 'EMPLEADO');
    const agGerente = await crearAgente(owner, 'Gerenta', gerente);
    const agEmpleado = await crearAgente(owner, 'Operario', empleado);
    // El gerente no puede reportar a un empleado (supervisor de menor nivel).
    await owner.api.put(`/hierarchy/${agGerente}/reporta-a`, { reportaAAgentId: agEmpleado }).expect(400);
    // Al revés sí se permite (gerente supervisa empleado).
    await owner.api.put(`/hierarchy/${agEmpleado}/reporta-a`, { reportaAAgentId: agGerente }).expect(200);
  });

  it('un agente sin cargo se trata como EMPLEADO (política conservadora): no supervisa a un GERENTE', async () => {
    const owner = await registerOwner(app, 'jer-sincargo');
    const gerente = await crearCargo(owner, 'Gerente', 'GERENTE');
    const agGerente = await crearAgente(owner, 'Dir', gerente);
    const agSinCargo = await crearAgente(owner, 'Sin cargo'); // nivel efectivo EMPLEADO
    await owner.api.put(`/hierarchy/${agGerente}/reporta-a`, { reportaAAgentId: agSinCargo }).expect(400);
  });

  it('rechaza un supervisor de otro workspace (404) y no deja tocar jerarquía ajena', async () => {
    const owner = await registerOwner(app, 'jer-iso-a');
    const otro = await registerOwner(app, 'jer-iso-b');
    const agentePropio = await crearAgente(owner, 'Propio');
    const agenteAjeno = await crearAgente(otro, 'Ajeno');
    // Supervisor que vive en otro workspace: 404.
    await owner.api.put(`/hierarchy/${agentePropio}/reporta-a`, { reportaAAgentId: agenteAjeno }).expect(404);
    // Fijar supervisor sobre un agente de otro workspace: 404 (el agente no existe en este workspace).
    await owner.api.put(`/hierarchy/${agenteAjeno}/reporta-a`, { reportaAAgentId: agentePropio }).expect(404);
    // El organigrama de cada workspace solo contiene sus propios agentes.
    const arbolOtro = (await otro.api.get('/hierarchy').expect(200)).body as NodoArbol[];
    expect(buscar(arbolOtro, agentePropio)).toBeUndefined();
    expect(buscar(arbolOtro, agenteAjeno)).toBeDefined();
  });

  it('devuelve la cadena de mando ascendente y permite quitar el supervisor (null = raíz)', async () => {
    const owner = await registerOwner(app, 'jer-cadena');
    const gerente = await crearCargo(owner, 'Gerente', 'GERENTE');
    const a = await crearAgente(owner, 'Raíz', gerente);
    const b = await crearAgente(owner, 'Medio', gerente);
    const c = await crearAgente(owner, 'Hoja', gerente);
    await owner.api.put(`/hierarchy/${b}/reporta-a`, { reportaAAgentId: a }).expect(200);
    await owner.api.put(`/hierarchy/${c}/reporta-a`, { reportaAAgentId: b }).expect(200);

    const cadena = (await owner.api.get(`/hierarchy/${c}/cadena-mando`).expect(200)).body as {
      agentId: string;
      cadena: { id: string }[];
    };
    expect(cadena.agentId).toBe(c);
    expect(cadena.cadena.map((n) => n.id)).toEqual([b, a]);

    // Quitar el supervisor deja a C como raíz.
    await owner.api.put(`/hierarchy/${c}/reporta-a`, { reportaAAgentId: null }).expect(200);
    const arbol = (await owner.api.get('/hierarchy').expect(200)).body as NodoArbol[];
    expect(arbol.some((n) => n.id === c)).toBe(true);
    const sinSup = (await owner.api.get(`/hierarchy/${c}/cadena-mando`).expect(200)).body as { cadena: unknown[] };
    expect(sinSup.cadena).toHaveLength(0);
  });

  it('un VIEWER lee el organigrama pero no lo modifica (403)', async () => {
    const owner = await registerOwner(app, 'jer-viewer');
    const viewer = await addMember(app, owner, { role: 'VIEWER' });
    const a = await crearAgente(owner, 'Agente A');
    const b = await crearAgente(owner, 'Agente B');
    await viewer.api.get('/hierarchy').expect(200);
    await viewer.api.get(`/hierarchy/${a}/cadena-mando`).expect(200);
    await viewer.api.put(`/hierarchy/${a}/reporta-a`, { reportaAAgentId: b }).expect(403);
  });

  it('un EDITOR tampoco define la estructura (exige ADMIN+)', async () => {
    const owner = await registerOwner(app, 'jer-editor');
    const editor = await addMember(app, owner, { role: 'EDITOR' });
    const a = await crearAgente(owner, 'Agente A');
    const b = await crearAgente(owner, 'Agente B');
    await editor.api.put(`/hierarchy/${a}/reporta-a`, { reportaAAgentId: b }).expect(403);
  });

  it('la jerarquía NO concede acceso a datos (ADR 0007)', async () => {
    const owner = await registerOwner(app, 'jer-acceso');
    const viewer = await addMember(app, owner, { role: 'VIEWER' });
    const gerente = await crearCargo(owner, 'Gerente', 'GERENTE');
    // Agente supervisor PRIVATE del owner; subordinado PRIVATE del viewer.
    const supervisor = await crearAgente(owner, 'Supervisor', gerente);
    const subordinado = await crearAgente(viewer, 'Subordinado');
    // Antes de la jerarquía, el viewer no ve el agente privado del owner.
    await viewer.api.get(`/agents/${supervisor}`).expect(404);
    // El admin fija la línea de mando (el subordinado del viewer reporta al supervisor del owner).
    await owner.api.put(`/hierarchy/${subordinado}/reporta-a`, { reportaAAgentId: supervisor }).expect(200);
    // Reportar a alguien NO da permisos: el viewer sigue sin acceso al agente supervisor.
    await viewer.api.get(`/agents/${supervisor}`).expect(404);
  });
});
