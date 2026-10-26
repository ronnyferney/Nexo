import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

/**
 * E14 · Voz (ADR 0015 D2), sandbox SIN gasto y SIN red a proveedores reales. Verifica:
 * - roles: solo ADMIN+ crea cuentas de voz; VIEWER lee;
 * - recorrido simulado COMPLETO: iniciar (SIMULADA) → turno (EN_CURSO) → transferir (TRANSFERIDA) → finalizar
 *   (FINALIZADA), determinista y sin red;
 * - idempotencia: reiniciar con la misma clave devuelve la misma llamada;
 * - capabilities incompatibles bloqueadas EN CONFIGURACIÓN (400), no en tiempo de llamada;
 * - capa (d): una acción sensible en un turno pasa por el ActionGateway (E6) y una política DENY la bloquea;
 * - stub amazon_connect/google_cloud SIN credenciales → llamada FALLIDA, sin tocar la red;
 * - aislamiento multi-tenant.
 *
 * NUNCA se contacta a AWS/GCP: el simulado no sale a la red y los stubs quedan inactivos sin credenciales.
 */
describe('Voz E14 (e2e)', () => {
  let app: INestApplication;
  let owner: Session;
  let editor: Session;
  let viewer: Session;
  let otro: Session;
  let cuentaSim: string;

  const EMPRESA = 'empresa-voz';

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'voz-owner');
    editor = await addMember(app, owner, { role: 'EDITOR', tag: 'voz-editor' });
    viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'voz-viewer' });
    otro = await registerOwner(app, 'voz-otro');
  });

  afterAll(async () => {
    await app.close();
  });

  function crearCuenta(s: Session, body: Record<string, unknown> = {}) {
    return s.api.post('/voz/cuentas', { empresaId: EMPRESA, proveedor: 'simulado', config: {}, ...body });
  }

  it('solo ADMIN+ crea cuentas de voz; VIEWER puede leer', async () => {
    await crearCuenta(viewer).then((r) => expect(r.status).toBe(403));
    await crearCuenta(editor).then((r) => expect(r.status).toBe(403));
    const res = await crearCuenta(owner).expect(201);
    cuentaSim = (res.body as { id: string }).id;
    const lista = (await viewer.api.get('/voz/cuentas').expect(200)).body as { id: string }[];
    expect(lista.some((c) => c.id === cuentaSim)).toBe(true);
  });

  it('recorre una llamada simulada completa (iniciar→turno→transferir→finalizar) sin red', async () => {
    const ini = (
      await editor.api
        .post('/voz/llamadas', { cuentaId: cuentaSim, direccion: 'SALIENTE', numero: '+100', idempotencyKey: 'call-1' })
        .expect(200)
    ).body as { id: string; estado: string; proveedorCallId: string };
    expect(ini.estado).toBe('SIMULADA');
    expect(ini.proveedorCallId).toMatch(/^simcall_/);

    const turno = (
      await editor.api.post(`/voz/llamadas/${ini.id}/turno`, { entrada: 'hola, buenos días' }).expect(200)
    ).body as { estado: string; transcripcion: string; gobierno?: unknown };
    expect(turno.estado).toBe('EN_CURSO');
    expect(turno.transcripcion).toBe('hola, buenos días');
    expect(turno.gobierno).toBeUndefined();

    const transf = (
      await editor.api.post(`/voz/llamadas/${ini.id}/transferir`, { destino: 'cola-soporte' }).expect(200)
    ).body as { estado: string };
    expect(transf.estado).toBe('TRANSFERIDA');

    const fin = (await editor.api.post(`/voz/llamadas/${ini.id}/finalizar`, {}).expect(200)).body as {
      estado: string;
      duracionSeg: number;
    };
    expect(fin.estado).toBe('FINALIZADA');
    expect(fin.duracionSeg).toBeGreaterThan(0);

    // Una llamada finalizada no admite más operaciones.
    await editor.api.post(`/voz/llamadas/${ini.id}/turno`, { entrada: 'x' }).expect(400);
  });

  it('es idempotente: reiniciar con la misma clave devuelve la misma llamada', async () => {
    const a = (
      await editor.api
        .post('/voz/llamadas', { cuentaId: cuentaSim, direccion: 'SALIENTE', numero: '+1', idempotencyKey: 'dup' })
        .expect(200)
    ).body as { id: string };
    const b = (
      await editor.api
        .post('/voz/llamadas', { cuentaId: cuentaSim, direccion: 'SALIENTE', numero: '+2', idempotencyKey: 'dup' })
        .expect(200)
    ).body as { id: string };
    expect(b.id).toBe(a.id);
    const llamadas = (await owner.api.get(`/voz/llamadas?cuentaId=${cuentaSim}`).expect(200)).body as { id: string }[];
    expect(llamadas.filter((l) => l.id === a.id)).toHaveLength(1);
  });

  it('bloquea capabilities incompatibles en configuración (el simulado no ofrece providerDialog)', async () => {
    await editor.api
      .post('/voz/llamadas', {
        cuentaId: cuentaSim,
        direccion: 'SALIENTE',
        numero: '+1',
        idempotencyKey: 'incompat',
        requisitos: { dialogo: 'providerDialog' },
      })
      .expect(400);
  });

  it('capa (d): una acción sensible pasa por E6 (PERMITIDA sin política) y una DENY la bloquea', async () => {
    // Sin política: la acción sensible se gobierna y resulta PERMITIDA.
    const call1 = (
      await editor.api
        .post('/voz/llamadas', { cuentaId: cuentaSim, direccion: 'SALIENTE', numero: '+1', idempotencyKey: 'gob-1' })
        .expect(200)
    ).body as { id: string };
    const t1 = (
      await editor.api.post(`/voz/llamadas/${call1.id}/turno`, { entrada: 'quiero hacer un pago' }).expect(200)
    ).body as { gobierno?: { tipoAccion: string; estado: string } };
    expect(t1.gobierno?.tipoAccion).toBe('VOICE_PAYMENT');
    expect(t1.gobierno?.estado).toBe('PERMITIDA');

    // Política DENY para VOICE_PAYMENT: la misma acción queda denegada por gobierno, sin efecto.
    await owner.api
      .post('/admin/policies', { nombre: 'No pagar por voz', tipoAccion: 'VOICE_PAYMENT', efecto: 'DENY' })
      .expect(201);
    const call2 = (
      await editor.api
        .post('/voz/llamadas', { cuentaId: cuentaSim, direccion: 'SALIENTE', numero: '+1', idempotencyKey: 'gob-2' })
        .expect(200)
    ).body as { id: string };
    const t2 = (
      await editor.api.post(`/voz/llamadas/${call2.id}/turno`, { entrada: 'necesito hacer un pago urgente' }).expect(200)
    ).body as { gobierno?: { estado: string } };
    expect(t2.gobierno?.estado).toBe('DENEGADA');
  });

  it('stub amazon_connect sin credenciales → llamada FALLIDA, sin tocar la red', async () => {
    const cuenta = (await crearCuenta(owner, { proveedor: 'amazon_connect' }).expect(201)).body as {
      id: string;
      secretRef: string | null;
    };
    expect(cuenta.secretRef).toBeNull();
    const ini = (
      await editor.api
        .post('/voz/llamadas', { cuentaId: cuenta.id, direccion: 'SALIENTE', numero: '+1', idempotencyKey: 'aws-1' })
        .expect(200)
    ).body as { estado: string };
    expect(ini.estado).toBe('FALLIDA');
  });

  it('aislamiento multi-tenant: otro workspace no ve ni opera la cuenta', async () => {
    await otro.api.get(`/voz/cuentas/${cuentaSim}`).expect(404);
    await otro.api
      .post('/voz/llamadas', { cuentaId: cuentaSim, direccion: 'SALIENTE', numero: '+1', idempotencyKey: 'x' })
      .expect(404);
    const lista = (await otro.api.get('/voz/cuentas').expect(200)).body as { id: string }[];
    expect(lista.some((c) => c.id === cuentaSim)).toBe(false);
  });
});
