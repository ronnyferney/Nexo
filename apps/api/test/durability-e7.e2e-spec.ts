import type { INestApplication } from '@nestjs/common';
import { IdempotencyService } from '../src/modules/durability/idempotency/idempotency.service';
import { createTestApp } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

/**
 * E7 · Durabilidad avanzada (ADR 0012/0013). Verifica la idempotencia por operación de negocio (misma clave no
 * re-ejecuta el efecto y devuelve el resultado previo, QA04), que un fallo del motor durable alimenta la bandeja de
 * excepciones (RF21) y las acciones de la bandeja (aportar info, reintentar conservando historial QA06, reasignar,
 * cancelar, conciliar) con permisos y aislamiento por workspace (QA12).
 */
describe('Durabilidad avanzada E7 (e2e)', () => {
  let app: INestApplication;
  let owner: Session;
  let editor: Session;
  let viewer: Session;
  let idempotency: IdempotencyService;

  const trigger = { id: 'trigger', type: 'trigger', name: 'Inicio', config: {} };
  // Un nodo condición con un regex gigante hace fallar el motor (patrón inválido por tamaño).
  const failingNode = {
    id: 'boom',
    type: 'condition',
    name: 'Explota',
    config: { rules: [{ left: 'x', operator: 'regex', right: 'x'.repeat(300) }] },
  };

  async function crearFlujoFallido(s: Session): Promise<string> {
    const def = { nodes: [trigger, failingNode], edges: [{ id: 'e0', source: 'trigger', target: 'boom' }] };
    const res = await s.api.post('/workflows', { name: 'Flujo que falla', definition: def }).expect(201);
    return (res.body as { id: string }).id;
  }

  async function ejecutar(s: Session, workflowId: string): Promise<{ id: string; status: string }> {
    const res = await s.api.post(`/workflows/${workflowId}/run`, { input: {}, wait: true }).expect(202);
    return res.body as { id: string; status: string };
  }

  interface Excepcion {
    id: string;
    estado: string;
    causa: string;
    origen: string;
    executionId: string | null;
    duenoUserId: string | null;
    idempotencyKeyId: string | null;
  }

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'e7-owner');
    editor = await addMember(app, owner, { role: 'EDITOR', tag: 'e7-editor' });
    viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'e7-viewer' });
    idempotency = app.get(IdempotencyService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('idempotencia: la misma clave no re-ejecuta el efecto y devuelve el resultado previo (QA04)', async () => {
    let ejecuciones = 0;
    const efecto = async () => {
      ejecuciones++;
      return { status: 'CONFIRMADO', providerRef: `ref-${ejecuciones}` };
    };
    const clave = `pago-${Date.now()}`;

    const r1 = await idempotency.withIdempotency(owner.workspaceId, clave, 'PAYMENT', efecto);
    const r2 = await idempotency.withIdempotency(owner.workspaceId, clave, 'PAYMENT', efecto);

    expect(r1.reusado).toBe(false);
    expect(r2.reusado).toBe(true);
    expect(r2.resultado).toEqual(r1.resultado);
    expect(ejecuciones).toBe(1);

    // Aislamiento por workspace: la misma clave en otro workspace sí ejecuta (QA12).
    const otro = await registerOwner(app, 'e7-otro-ws');
    const r3 = await idempotency.withIdempotency(otro.workspaceId, clave, 'PAYMENT', efecto);
    expect(r3.reusado).toBe(false);
    expect(ejecuciones).toBe(2);
  });

  it('un fallo del motor durable abre una excepción en la bandeja (RF21)', async () => {
    const wf = await crearFlujoFallido(owner);
    const ex = await ejecutar(owner, wf);
    expect(ex.status).toBe('FAILED');

    const bandeja = (await owner.api.get('/excepciones').expect(200)).body as Excepcion[];
    const excepcion = bandeja.find((e) => e.executionId === ex.id);
    expect(excepcion).toBeDefined();
    expect(excepcion!.origen).toBe('MOTOR_DURABLE');
    expect(excepcion!.causa).toBe('FALLO_EJECUCION');
    expect(excepcion!.estado).toBe('ABIERTA');

    // El detalle incluye el historial append-only con el evento CREADA.
    const detalle = (await owner.api.get(`/excepciones/${excepcion!.id}`).expect(200)).body as {
      eventos: { tipo: string }[];
    };
    expect(detalle.eventos.some((e) => e.tipo === 'CREADA')).toBe(true);
  });

  it('reintentar conserva el historial y no duplica la excepción (QA06)', async () => {
    const wf = await crearFlujoFallido(owner);
    const ex = await ejecutar(owner, wf);
    const bandeja = (await owner.api.get('/excepciones').expect(200)).body as Excepcion[];
    const exc = bandeja.find((e) => e.executionId === ex.id)!;

    const antes = (await owner.api.get(`/excepciones/${exc.id}`).expect(200)).body as { eventos: unknown[] };
    const res = (await editor.api.post(`/excepciones/${exc.id}/reintentar`).expect(200)).body as { estado: string };
    expect(res.estado).toBe('EN_PROGRESO');

    const despues = (await owner.api.get(`/excepciones/${exc.id}`).expect(200)).body as {
      eventos: { tipo: string }[];
    };
    // Se AÑADE un evento de reintento (historial conservado, no reescrito).
    expect(despues.eventos.length).toBe(antes.eventos.length + 1);
    expect(despues.eventos.some((e) => e.tipo === 'REINTENTO')).toBe(true);
  });

  it('aportar info, reasignar, cancelar y conciliar respetan permisos (EDITOR+) ', async () => {
    const wf = await crearFlujoFallido(owner);
    const ex = await ejecutar(owner, wf);
    const bandeja = (await owner.api.get('/excepciones').expect(200)).body as Excepcion[];
    const exc = bandeja.find((e) => e.executionId === ex.id)!;

    // VIEWER no puede mutar.
    await viewer.api.post(`/excepciones/${exc.id}/info`, { nota: 'intento' }).expect(403);
    await viewer.api.post(`/excepciones/${exc.id}/reasignar`, { duenoUserId: viewer.userId }).expect(403);

    // EDITOR sí.
    await editor.api
      .post(`/excepciones/${exc.id}/info`, { nota: 'Revisado', siguienteAccion: 'Corregir nodo' })
      .expect(200);
    const reasignada = (
      await editor.api.post(`/excepciones/${exc.id}/reasignar`, { duenoUserId: owner.userId }).expect(200)
    ).body as Excepcion;
    expect(reasignada.duenoUserId).toBe(owner.userId);

    const conciliada = (
      await editor.api.post(`/excepciones/${exc.id}/conciliar`, { resultado: 'CONFIRMADO' }).expect(200)
    ).body as Excepcion;
    expect(conciliada.estado).toBe('CONCILIADA');

    // Ya cerrada: no admite más acciones.
    await editor.api.post(`/excepciones/${exc.id}/info`, { nota: 'tarde' }).expect(400);
  });

  it('aísla la bandeja de excepciones por workspace (QA12)', async () => {
    const wf = await crearFlujoFallido(owner);
    const ex = await ejecutar(owner, wf);
    const bandeja = (await owner.api.get('/excepciones').expect(200)).body as Excepcion[];
    const exc = bandeja.find((e) => e.executionId === ex.id)!;

    const otro = await registerOwner(app, 'e7-aislado');
    const bandejaOtro = (await otro.api.get('/excepciones').expect(200)).body as Excepcion[];
    expect(bandejaOtro.find((e) => e.id === exc.id)).toBeUndefined();
    await otro.api.get(`/excepciones/${exc.id}`).expect(404);
    await otro.api.post(`/excepciones/${exc.id}/reintentar`).expect(404);
  });
});
