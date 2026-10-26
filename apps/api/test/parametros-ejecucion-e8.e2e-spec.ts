import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/app';
import { addMember, createAgent, registerOwner, type Session } from './utils/fixtures';

/**
 * Parámetros de ejecución del empleado digital (E8): estación virtual + salida a internet. Verifica: crear estación
 * virtual (ADMIN); asignarla a un agente y fijar `salidaInternet`; la lectura refleja los parámetros; una estación de
 * otro workspace da 404 al asignar; aislamiento multi-tenant; roles (VIEWER no crea estación ni cambia parámetros,
 * EDITOR no crea estación pero sí cambia parámetros); la baja lógica de la estación (RETIRADA) no rompe el agente
 * asignado; y que cada cambio deja entrada en la auditoría inmutable (E13), incluido el cambio sensible de
 * `salidaInternet` (anterior/nuevo).
 */
describe('Parámetros de ejecución del empleado digital (E2E · E8)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  async function crearEstacion(s: Session, nombre: string, proveedor = 'interna'): Promise<string> {
    const res = await s.api.post('/estaciones-virtuales', { nombre, proveedor }).expect(201);
    return (res.body as { id: string }).id;
  }

  interface ParamsView {
    agentId: string;
    estacionVirtualId: string | null;
    salidaInternet: boolean;
    parametrosEjecucion: Record<string, unknown>;
  }

  it('crea estación, la asigna a un agente con salida a internet y la lectura lo refleja; audita (E13)', async () => {
    const owner = await registerOwner(app, 'e8-crud');
    const estacion = await crearEstacion(owner, 'Estación RPA 1');
    const agent = await createAgent(owner);

    const res = (
      await owner.api
        .put(`/execution-params/${agent.id}`, {
          estacionVirtualId: estacion,
          salidaInternet: true,
          parametrosEjecucion: { horarioOperacion: '08:00-18:00', limites: { maxTareasDia: 100 } },
        })
        .expect(200)
    ).body as ParamsView;
    expect(res).toMatchObject({ estacionVirtualId: estacion, salidaInternet: true });
    expect(res.parametrosEjecucion).toMatchObject({ horarioOperacion: '08:00-18:00' });

    const leido = (await owner.api.get(`/execution-params/${agent.id}`).expect(200)).body as ParamsView;
    expect(leido).toMatchObject({ estacionVirtualId: estacion, salidaInternet: true });

    // Auditoría: creación de estación y cambio de parámetros (con salidaInternet anterior/nuevo).
    const estAudit = (
      await owner.api.get(`/auditoria?action=ESTACION_VIRTUAL_CREADA&targetId=${estacion}`).expect(200)
    ).body as { items: unknown[] };
    expect(estAudit.items.length).toBeGreaterThanOrEqual(1);

    const parAudit = (
      await owner.api.get(`/auditoria?action=PARAMETROS_EJECUCION_MODIFICADOS&targetId=${agent.id}`).expect(200)
    ).body as { items: { metadata: Record<string, unknown> }[] };
    expect(parAudit.items.length).toBeGreaterThanOrEqual(1);
    expect(parAudit.items[0].metadata).toMatchObject({
      salidaInternetPrevia: false,
      salidaInternetNueva: true,
      estacionVirtualNueva: estacion,
    });
  });

  it('desasigna la estación con null y conserva salidaInternet por defecto en agentes nuevos', async () => {
    const owner = await registerOwner(app, 'e8-null');
    const estacion = await crearEstacion(owner, 'Estación desasignable');
    const agent = await createAgent(owner);

    // Un agente nuevo nace sin estación, sin salida a internet y con parámetros vacíos.
    const inicial = (await owner.api.get(`/execution-params/${agent.id}`).expect(200)).body as ParamsView;
    expect(inicial).toMatchObject({ estacionVirtualId: null, salidaInternet: false, parametrosEjecucion: {} });

    await owner.api.put(`/execution-params/${agent.id}`, { estacionVirtualId: estacion }).expect(200);
    await owner.api.put(`/execution-params/${agent.id}`, { estacionVirtualId: null }).expect(200);
    const tras = (await owner.api.get(`/execution-params/${agent.id}`).expect(200)).body as ParamsView;
    expect(tras.estacionVirtualId).toBeNull();
  });

  it('rechaza asignar una estación de otro workspace (404) y aísla el listado', async () => {
    const owner = await registerOwner(app, 'e8-iso-a');
    const otro = await registerOwner(app, 'e8-iso-b');
    const estacionAjena = await crearEstacion(otro, 'Estación ajena');
    const agent = await createAgent(owner);

    await owner.api.put(`/execution-params/${agent.id}`, { estacionVirtualId: estacionAjena }).expect(404);

    // El listado de cada workspace solo contiene sus propias estaciones.
    const propias = (await owner.api.get('/estaciones-virtuales').expect(200)).body as { id: string }[];
    expect(propias.some((e) => e.id === estacionAjena)).toBe(false);
    // La estación ajena no es legible desde el otro workspace.
    await owner.api.get(`/estaciones-virtuales/${estacionAjena}`).expect(404);
  });

  it('roles: VIEWER no crea estación ni cambia parámetros; EDITOR no crea estación pero sí cambia parámetros', async () => {
    const owner = await registerOwner(app, 'e8-roles');
    const viewer = await addMember(app, owner, { role: 'VIEWER' });
    const editor = await addMember(app, owner, { role: 'EDITOR' });
    const estacion = await crearEstacion(owner, 'Estación roles');
    const agent = await createAgent(owner);

    // VIEWER lee pero no crea ni modifica.
    await viewer.api.get('/estaciones-virtuales').expect(200);
    await viewer.api.post('/estaciones-virtuales', { nombre: 'No permitida' }).expect(403);
    await viewer.api.put(`/execution-params/${agent.id}`, { salidaInternet: true }).expect(403);

    // EDITOR no crea estaciones (infraestructura = ADMIN) pero sí fija parámetros del expediente.
    await editor.api.post('/estaciones-virtuales', { nombre: 'Editor no crea' }).expect(403);
    await editor.api.put(`/execution-params/${agent.id}`, { estacionVirtualId: estacion, salidaInternet: true }).expect(200);
  });

  it('la baja lógica de la estación (RETIRADA) no rompe el agente asignado', async () => {
    const owner = await registerOwner(app, 'e8-baja');
    const estacion = await crearEstacion(owner, 'Estación a retirar');
    const agent = await createAgent(owner);
    await owner.api.put(`/execution-params/${agent.id}`, { estacionVirtualId: estacion }).expect(200);

    // Baja lógica: la estación pasa a RETIRADA, no se borra.
    const retirada = (await owner.api.delete(`/estaciones-virtuales/${estacion}`).expect(200)).body as {
      estado: string;
    };
    expect(retirada.estado).toBe('RETIRADA');

    // El agente conserva el vínculo histórico: retirar no desasigna ni rompe el agente.
    const params = (await owner.api.get(`/execution-params/${agent.id}`).expect(200)).body as ParamsView;
    expect(params.estacionVirtualId).toBe(estacion);

    // El retiro quedó auditado.
    const audit = (
      await owner.api.get(`/auditoria?action=ESTACION_VIRTUAL_RETIRADA&targetId=${estacion}`).expect(200)
    ).body as { items: { metadata: Record<string, unknown> }[] };
    expect(audit.items.length).toBeGreaterThanOrEqual(1);
    expect(audit.items[0].metadata).toMatchObject({ estadoNuevo: 'RETIRADA' });
  });

  it('rechaza nombres de estación duplicados por workspace (unicidad)', async () => {
    const owner = await registerOwner(app, 'e8-unico');
    await crearEstacion(owner, 'Estación única');
    await owner.api.post('/estaciones-virtuales', { nombre: 'Estación única' }).expect(409);
  });
});
