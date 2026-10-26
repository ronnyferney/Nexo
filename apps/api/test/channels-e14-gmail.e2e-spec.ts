import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

/**
 * E14 · Canales externos: adaptador de correo Gmail (sandbox, SIN envíos reales). Verifica: creación de cuenta CORREO
 * proveedor `gmail` (y por el alias `google_mail`), envío SIN credenciales → FALLIDO con causa clara sin tocar la red,
 * idempotencia del envío y aislamiento multi-tenant. Los recorridos con red (envío real contra la Gmail API) se cubren
 * con dobles de `HttpClientService` en `channels-adapters.spec.ts`; aquí NUNCA se llama a Google (sin `secretRef`).
 */
describe('Canales externos E14 · Gmail (e2e)', () => {
  let app: INestApplication;
  let owner: Session;
  let editor: Session;
  let otro: Session;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'e14gmail-owner');
    editor = await addMember(app, owner, { role: 'EDITOR', tag: 'e14gmail-editor' });
    otro = await registerOwner(app, 'e14gmail-otro');
  });

  afterAll(async () => {
    await app.close();
  });

  // `empresaId` único por cuenta: el modelo exige unicidad de (workspace, empresa, tipo, proveedor).
  function crearCuenta(s: Session, empresaId: string, body: Record<string, unknown> = {}) {
    return s.api.post('/canales-externos', {
      empresaId,
      tipo: 'CORREO',
      proveedor: 'gmail',
      config: { remitente: 'bot@empresa.test' },
      ...body,
    });
  }

  it('crea una cuenta CORREO proveedor gmail (y acepta el alias google_mail)', async () => {
    const res = await crearCuenta(owner, 'empresa-crea').expect(201);
    expect((res.body as { proveedor: string }).proveedor).toBe('gmail');
    expect((res.body as { secretRef: string | null }).secretRef).toBeNull();
    // El alias selecciona el mismo adaptador: una cuenta `google_mail` CORREO también es válida.
    await crearCuenta(owner, 'empresa-crea', { proveedor: 'google_mail' }).expect(201);
    // Gmail no soporta WHATSAPP.
    await crearCuenta(owner, 'empresa-crea', { proveedor: 'gmail', tipo: 'WHATSAPP' }).then((r) =>
      expect(r.status).toBe(400),
    );
  });

  it('envío SIN credenciales → FALLIDO con causa clara, sin salir a la red ni filtrar el secreto', async () => {
    const cuenta = (await crearCuenta(owner, 'empresa-sincred').expect(201)).body as { id: string };
    const res = (
      await editor.api
        .post(`/canales-externos/${cuenta.id}/enviar`, {
          destino: 'cliente@externo.test',
          asunto: 'Hola',
          cuerpo: 'No debe salir a la red',
          idempotencyKey: 'gmail-sin-cred',
        })
        .expect(200)
    ).body as { estado: string; error: string };
    expect(res.estado).toBe('FALLIDO');
    expect(res.error).toContain('sin credenciales');

    // `test` de credenciales también reporta inactivo (sin red).
    const prueba = (await owner.api.post(`/canales-externos/${cuenta.id}/test`).expect(200)).body as { ok: boolean };
    expect(prueba.ok).toBe(false);
  });

  it('es idempotente: reenviar con la misma clave devuelve el mismo mensaje sin duplicar', async () => {
    const cuenta = (await crearCuenta(owner, 'empresa-idem').expect(201)).body as { id: string };
    const primero = (
      await editor.api
        .post(`/canales-externos/${cuenta.id}/enviar`, {
          destino: 'cliente@externo.test',
          cuerpo: 'Primer intento',
          idempotencyKey: 'gmail-dup',
        })
        .expect(200)
    ).body as { id: string };
    const segundo = (
      await editor.api
        .post(`/canales-externos/${cuenta.id}/enviar`, {
          destino: 'otro@externo.test',
          cuerpo: 'Segundo intento (ignorado)',
          idempotencyKey: 'gmail-dup',
        })
        .expect(200)
    ).body as { id: string; cuerpo: string };
    expect(segundo.id).toBe(primero.id);
    expect(segundo.cuerpo).toBe('Primer intento');
  });

  it('aislamiento multi-tenant: otro workspace no ve ni opera la cuenta gmail', async () => {
    const cuenta = (await crearCuenta(owner, 'empresa-tenant').expect(201)).body as { id: string };
    await otro.api.get(`/canales-externos/${cuenta.id}`).expect(404);
    await otro.api
      .post(`/canales-externos/${cuenta.id}/enviar`, { destino: 'x@test', cuerpo: 'x', idempotencyKey: 'gmail-otro' })
      .expect(404);
  });
});
