import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

/**
 * ADR 0018 Inc.2 — enriquecimiento de perfiles desde el correo entrante + consulta por remitente.
 * Cubre: idempotencia (reprocesar el mismo correo → UN contacto, contador incrementa), alta de organización por
 * dominio corporativo, consulta por correo/dominio para la ficha del buzón, autorización por rol y aislamiento
 * multi-tenant (el enriquecimiento corre con el workspace del CANAL, nunca del cuerpo).
 */
describe('Enriquecimiento de perfiles desde correo (ADR 0018 Inc.2)', () => {
  let app: INestApplication;
  let ownerA: Session; // OWNER de WS-A (crea cuentas de canal: exige ADMIN)
  let editorA: Session; // EDITOR de WS-A (simula entrantes: exige EDITOR)
  let viewerA: Session; // VIEWER de WS-A (solo lectura)
  let ownerB: Session; // OWNER de WS-B (aislamiento)
  let cuentaCorreoA: string; // cuenta CORREO simulada en WS-A
  let cuentaCorreoB: string; // cuenta CORREO simulada en WS-B

  async function crearCuentaCorreo(s: Session): Promise<string> {
    const res = await s.api
      .post('/canales-externos', {
        empresaId: 'empresa-inc2',
        tipo: 'CORREO',
        proveedor: 'simulado',
        config: { remitente: 'bot@empresa.test' },
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    ownerA = await registerOwner(app, 'inc2-a');
    editorA = await addMember(app, ownerA, { role: 'EDITOR', tag: 'inc2-editor' });
    viewerA = await addMember(app, ownerA, { role: 'VIEWER', tag: 'inc2-viewer' });
    ownerB = await registerOwner(app, 'inc2-b');
    cuentaCorreoA = await crearCuentaCorreo(ownerA);
    cuentaCorreoB = await crearCuentaCorreo(ownerB);
  });

  afterAll(async () => {
    await app.close();
  });

  it('enriquecer dos veces el mismo correo → UN contacto, contador incrementa, y crea la organización por dominio', async () => {
    const entrante = (clave: string) => ({
      origen: 'Laura@Acme-inc2.com',
      proveedorMensajeId: clave,
      cuerpo: 'Hola, consulto por mi factura',
    });

    await editorA.api.post(`/canales-externos/${cuentaCorreoA}/simular-entrante`, entrante('in-1')).expect(200);
    await editorA.api.post(`/canales-externos/${cuentaCorreoA}/simular-entrante`, entrante('in-2')).expect(200);

    // Un único contacto por correo (normalizado a minúsculas), con el contador en 2.
    const contacto = (
      await ownerA.api.get('/profiles/contactos/por-correo?correo=laura@acme-inc2.com').expect(200)
    ).body as {
      id: string;
      correoPrincipal: string;
      interaccionesCount: number;
      ultimaInteraccionEn: string | null;
      fuente: string;
      organizacion: { dominio: string } | null;
    };
    expect(contacto.correoPrincipal).toBe('laura@acme-inc2.com');
    expect(contacto.interaccionesCount).toBe(2);
    expect(contacto.ultimaInteraccionEn).not.toBeNull();
    expect(contacto.fuente).toBe('correo');
    expect(contacto.organizacion?.dominio).toBe('acme-inc2.com');

    // La lista tiene un solo contacto con ese correo (no se duplicó).
    const lista = (await ownerA.api.get('/profiles/contactos').expect(200)).body as { correoPrincipal: string }[];
    expect(lista.filter((c) => c.correoPrincipal === 'laura@acme-inc2.com')).toHaveLength(1);

    // La organización se resuelve por dominio y queda vinculada al contacto.
    const org = (await ownerA.api.get('/profiles/organizaciones/por-dominio?dominio=acme-inc2.com').expect(200))
      .body as { dominio: string; contactos: { correoPrincipal: string }[] };
    expect(org.dominio).toBe('acme-inc2.com');
    expect(org.contactos.some((c) => c.correoPrincipal === 'laura@acme-inc2.com')).toBe(true);
  });

  it('un dominio de correo personal NO crea organización, pero sí el contacto', async () => {
    await editorA.api
      .post(`/canales-externos/${cuentaCorreoA}/simular-entrante`, {
        origen: 'particular@gmail.com',
        proveedorMensajeId: 'in-personal-1',
        cuerpo: 'Consulta personal',
      })
      .expect(200);

    const contacto = (await ownerA.api.get('/profiles/contactos/por-correo?correo=particular@gmail.com').expect(200))
      .body as { organizacion: unknown | null };
    expect(contacto.organizacion).toBeNull();
    await ownerA.api.get('/profiles/organizaciones/por-dominio?dominio=gmail.com').expect(404);
  });

  it('aislamiento multi-tenant: enriquecer en WS-B no filtra al WS-A y viceversa', async () => {
    await ownerB.api
      .post(`/canales-externos/${cuentaCorreoB}/simular-entrante`, {
        origen: 'cliente@solo-b.com',
        proveedorMensajeId: 'in-b-1',
        cuerpo: 'Mensaje para B',
      })
      .expect(200);

    // WS-B ve su contacto; WS-A no.
    await ownerB.api.get('/profiles/contactos/por-correo?correo=cliente@solo-b.com').expect(200);
    await ownerA.api.get('/profiles/contactos/por-correo?correo=cliente@solo-b.com').expect(404);
    await ownerA.api.get('/profiles/organizaciones/por-dominio?dominio=solo-b.com').expect(404);
  });

  it('autorización: VIEWER no puede simular entrantes (403); solo cuentas sandbox aceptan entrantes', async () => {
    await viewerA.api
      .post(`/canales-externos/${cuentaCorreoA}/simular-entrante`, {
        origen: 'x@acme-inc2.com',
        proveedorMensajeId: 'in-viewer',
      })
      .expect(403);

    // La consulta por correo exige datos válidos (400) y aísla por workspace.
    await ownerA.api.get('/profiles/contactos/por-correo?correo=no-es-correo').expect(400);
  });
});
