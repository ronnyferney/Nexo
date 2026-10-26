import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

/**
 * E14 · Canales externos (incremento 1, ADR 0015 D1/D4/D5), en modo sandbox. Verifica: CRUD de cuentas de canal
 * (roles ADMIN/VIEWER), envío por el adaptador simulado (estado SIMULADO con id determinista, sin salida de red),
 * idempotencia del envío (reintento con la misma clave no duplica), vínculo a tarea del workspace, cuenta M365 sin
 * credenciales → envío FALLIDO con causa clara (sin intentar red), y aislamiento multi-tenant.
 */
describe('Canales externos E14 (e2e)', () => {
  let app: INestApplication;
  let owner: Session; // OWNER del workspace A
  let editor: Session; // EDITOR del workspace A (envía)
  let viewer: Session; // VIEWER del workspace A (solo lee)
  let otro: Session; // OWNER de un workspace B distinto (aislamiento)
  let cuentaSimulada: string;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'e14-owner');
    editor = await addMember(app, owner, { role: 'EDITOR', tag: 'e14-editor' });
    viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'e14-viewer' });
    otro = await registerOwner(app, 'e14-otro');
  });

  afterAll(async () => {
    await app.close();
  });

  function crearCuenta(s: Session, body: Record<string, unknown>) {
    return s.api.post('/canales-externos', {
      empresaId: 'empresa-e14',
      tipo: 'CORREO',
      proveedor: 'simulado',
      config: { remitente: 'bot@empresa.test' },
      ...body,
    });
  }

  it('solo ADMIN+ crea cuentas de canal (VIEWER y EDITOR no)', async () => {
    await crearCuenta(viewer, {}).then((r) => expect(r.status).toBe(403));
    await crearCuenta(editor, {}).then((r) => expect(r.status).toBe(403));
    const res = await crearCuenta(owner, {}).expect(201);
    cuentaSimulada = (res.body as { id: string }).id;
    expect((res.body as { estado: string }).estado).toBe('ACTIVA');
    // Un VIEWER sí puede listar/leer.
    const lista = (await viewer.api.get('/canales-externos').expect(200)).body as { id: string }[];
    expect(lista.some((c) => c.id === cuentaSimulada)).toBe(true);
  });

  it('rechaza un proveedor que no soporta el tipo de canal', async () => {
    // m365 no soporta WHATSAPP.
    await crearCuenta(owner, { proveedor: 'm365', tipo: 'WHATSAPP' }).then((r) => expect(r.status).toBe(400));
    // proveedor inexistente.
    await crearCuenta(owner, { proveedor: 'inexistente' }).then((r) => expect(r.status).toBe(400));
  });

  it('envía por el adaptador simulado: estado SIMULADO con id determinista, sin red', async () => {
    const res = (
      await editor.api
        .post(`/canales-externos/${cuentaSimulada}/enviar`, {
          destino: 'cliente@externo.test',
          asunto: 'Hola',
          cuerpo: 'Mensaje de prueba',
          idempotencyKey: 'env-1',
        })
        .expect(200)
    ).body as { id: string; estado: string; proveedorMensajeId: string };
    expect(res.estado).toBe('SIMULADO');
    expect(res.proveedorMensajeId).toMatch(/^sim_/);
  });

  it('es idempotente: reenviar con la misma clave devuelve el mismo mensaje sin duplicar', async () => {
    const primero = (
      await editor.api
        .post(`/canales-externos/${cuentaSimulada}/enviar`, {
          destino: 'cliente@externo.test',
          cuerpo: 'Primer intento',
          idempotencyKey: 'env-dup',
        })
        .expect(200)
    ).body as { id: string };
    const segundo = (
      await editor.api
        .post(`/canales-externos/${cuentaSimulada}/enviar`, {
          destino: 'otro@externo.test',
          cuerpo: 'Segundo intento (ignorado)',
          idempotencyKey: 'env-dup',
        })
        .expect(200)
    ).body as { id: string; cuerpo: string };
    expect(segundo.id).toBe(primero.id);
    // No duplicó: el cuerpo es el del primer envío.
    expect(segundo.cuerpo).toBe('Primer intento');
    const mensajes = (await owner.api.get(`/canales-externos/${cuentaSimulada}/mensajes`).expect(200)).body as {
      idempotencyKey: string;
    }[];
    expect(mensajes.filter((m) => m.idempotencyKey === 'env-dup')).toHaveLength(1);
  });

  it('vincula el mensaje a una tarea del workspace y rechaza tareas ajenas', async () => {
    const tarea = (await editor.api.post('/tareas', { titulo: 'Tarea canal E14' }).expect(201)).body as { id: string };
    const res = (
      await editor.api
        .post(`/canales-externos/${cuentaSimulada}/enviar`, {
          destino: 'cliente@externo.test',
          cuerpo: 'Vinculado a tarea',
          idempotencyKey: 'env-tarea',
          tareaId: tarea.id,
        })
        .expect(200)
    ).body as { tareaId: string; estado: string };
    expect(res.tareaId).toBe(tarea.id);
    expect(res.estado).toBe('SIMULADO');

    // Una tarea de otro workspace no se acepta.
    const ajena = (await otro.api.post('/tareas', { titulo: 'Tarea ajena' }).expect(201)).body as { id: string };
    await editor.api
      .post(`/canales-externos/${cuentaSimulada}/enviar`, {
        destino: 'x@externo.test',
        cuerpo: 'Con tarea ajena',
        idempotencyKey: 'env-ajena',
        tareaId: ajena.id,
      })
      .expect(400);
  });

  it('cuenta M365 sin credenciales → envío FALLIDO con causa, sin intentar red', async () => {
    const cuentaM365 = (
      await crearCuenta(owner, { proveedor: 'm365', tipo: 'CORREO', config: { remitente: 'buzon@empresa.test' } }).expect(
        201,
      )
    ).body as { id: string; secretRef: string | null };
    expect(cuentaM365.secretRef).toBeNull();
    const res = (
      await editor.api
        .post(`/canales-externos/${cuentaM365.id}/enviar`, {
          destino: 'cliente@externo.test',
          cuerpo: 'No debe salir a la red',
          idempotencyKey: 'env-m365',
        })
        .expect(200)
    ).body as { estado: string; error: string };
    expect(res.estado).toBe('FALLIDO');
    expect(res.error).toContain('sin credenciales');
    // `test` de credenciales también reporta inactivo (sin red).
    const prueba = (await owner.api.post(`/canales-externos/${cuentaM365.id}/test`).expect(200)).body as { ok: boolean };
    expect(prueba.ok).toBe(false);
  });

  it('gobierno E6: una política DENY bloquea el envío productivo sin salir a la red', async () => {
    // Política DENY para EMAIL_SEND en el workspace A (solo ADMIN+).
    await owner.api
      .post('/admin/policies', { nombre: 'No enviar correo', tipoAccion: 'EMAIL_SEND', efecto: 'DENY' })
      .expect(201);
    // Cuenta productiva (m365); el envío pasa por la pasarela ANTES de tocar credenciales/red.
    const cuenta = (
      await crearCuenta(owner, {
        proveedor: 'm365',
        tipo: 'CORREO',
        empresaId: 'empresa-gob',
        config: { remitente: 'buzon@empresa.test' },
      }).expect(201)
    ).body as { id: string };
    const res = (
      await editor.api
        .post(`/canales-externos/${cuenta.id}/enviar`, {
          destino: 'cliente@externo.test',
          cuerpo: 'Debe quedar denegado',
          idempotencyKey: 'env-deny',
        })
        .expect(200)
    ).body as { estado: string; error: string };
    expect(res.estado).toBe('FALLIDO');
    expect(res.error).toContain('denegado por política');
  });

  it('aislamiento multi-tenant: otro workspace no ve ni opera la cuenta', async () => {
    await otro.api.get(`/canales-externos/${cuentaSimulada}`).expect(404);
    await otro.api
      .post(`/canales-externos/${cuentaSimulada}/enviar`, { destino: 'x@test', cuerpo: 'x', idempotencyKey: 'otro-1' })
      .expect(404);
    const lista = (await otro.api.get('/canales-externos').expect(200)).body as { id: string }[];
    expect(lista.some((c) => c.id === cuentaSimulada)).toBe(false);
  });
});
