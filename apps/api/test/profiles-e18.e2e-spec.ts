import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

/**
 * ADR 0018 Inc.1 — perfiles de contacto/organización y memoria operativa.
 * Cubre CRUD, aislamiento multi-tenant, autorización por rol, validación y unicidad por workspace.
 */
describe('Perfiles y memoria operativa (ADR 0018 Inc.1)', () => {
  let app: INestApplication;
  let wsA: Session;
  let editorA: Session;
  let viewerA: Session;
  let wsB: Session;

  beforeAll(async () => {
    app = await createTestApp();
    wsA = await registerOwner(app, 'perfiles-a');
    editorA = await addMember(app, wsA, { role: 'EDITOR', tag: 'perfiles-editor' });
    viewerA = await addMember(app, wsA, { role: 'VIEWER', tag: 'perfiles-viewer' });
    wsB = await registerOwner(app, 'perfiles-b');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Organizaciones', () => {
    it('crea, lee, edita y lista una organización', async () => {
      const created = await editorA.api
        .post('/profiles/organizaciones', { nombre: 'Acme', dominio: 'Acme.com', tipoSector: 'Software' })
        .expect(201);
      const id = (created.body as { id: string }).id;
      expect((created.body as { dominio: string }).dominio).toBe('acme.com');

      await wsA.api.get(`/profiles/organizaciones/${id}`).expect(200);

      const updated = await editorA.api
        .patch(`/profiles/organizaciones/${id}`, { tipoSector: 'Consultoría' })
        .expect(200);
      expect((updated.body as { tipoSector: string }).tipoSector).toBe('Consultoría');

      const list = await wsA.api.get('/profiles/organizaciones').expect(200);
      expect((list.body as { id: string }[]).some((o) => o.id === id)).toBe(true);
    });

    it('rechaza dominio duplicado dentro del mismo workspace (409)', async () => {
      await editorA.api.post('/profiles/organizaciones', { nombre: 'Uno', dominio: 'dup.com' }).expect(201);
      await editorA.api.post('/profiles/organizaciones', { nombre: 'Dos', dominio: 'dup.com' }).expect(409);
    });

    it('permite el mismo dominio en workspaces distintos (único por workspace)', async () => {
      await editorA.api.post('/profiles/organizaciones', { nombre: 'Org A', dominio: 'compartido.com' }).expect(201);
      await wsB.api.post('/profiles/organizaciones', { nombre: 'Org B', dominio: 'compartido.com' }).expect(201);
    });

    it('VIEWER no puede crear (403) y entradas inválidas dan 400', async () => {
      await viewerA.api.post('/profiles/organizaciones', { nombre: 'No' }).expect(403);
      await editorA.api.post('/profiles/organizaciones', { nombre: 'x' }).expect(400);
      await editorA.api.post('/profiles/organizaciones', {}).expect(400);
    });
  });

  describe('Aislamiento multi-tenant', () => {
    it('WS-B no ve ni edita una organización de WS-A', async () => {
      const created = await editorA.api
        .post('/profiles/organizaciones', { nombre: 'SoloA', dominio: 'soloa.com' })
        .expect(201);
      const id = (created.body as { id: string }).id;

      await wsB.api.get(`/profiles/organizaciones/${id}`).expect(404);
      await wsB.api.patch(`/profiles/organizaciones/${id}`, { nombre: 'Intruso' }).expect(404);
      await wsB.api.delete(`/profiles/organizaciones/${id}`).expect(404);

      const listB = await wsB.api.get('/profiles/organizaciones').expect(200);
      expect((listB.body as { id: string }[]).some((o) => o.id === id)).toBe(false);
    });
  });

  describe('Contactos', () => {
    it('crea un contacto vinculado a su organización y normaliza correos', async () => {
      const org = await editorA.api
        .post('/profiles/organizaciones', { nombre: 'OrgContacto', dominio: 'orgcontacto.com' })
        .expect(201);
      const orgId = (org.body as { id: string }).id;

      const created = await editorA.api
        .post('/profiles/contactos', {
          nombre: 'Ana Pérez',
          correoPrincipal: 'Ana@orgcontacto.com',
          telefonos: ['+593 999 999 999'],
          idioma: 'es',
          organizacionId: orgId,
        })
        .expect(201);
      const body = created.body as { id: string; correoPrincipal: string; correos: string[]; organizacionId: string };
      expect(body.correoPrincipal).toBe('ana@orgcontacto.com');
      expect(body.correos).toContain('ana@orgcontacto.com');
      expect(body.organizacionId).toBe(orgId);

      const fetched = await wsA.api.get(`/profiles/contactos/${body.id}`).expect(200);
      expect((fetched.body as { organizacion: { id: string } }).organizacion.id).toBe(orgId);
    });

    it('rechaza correo principal duplicado por workspace (409) y correo inválido (400)', async () => {
      await editorA.api.post('/profiles/contactos', { nombre: 'C1', correoPrincipal: 'rep@x.com' }).expect(201);
      await editorA.api.post('/profiles/contactos', { nombre: 'C2', correoPrincipal: 'rep@x.com' }).expect(409);
      await editorA.api.post('/profiles/contactos', { nombre: 'C3', correoPrincipal: 'no-es-correo' }).expect(400);
    });

    it('no permite vincular una organización de otro workspace (404)', async () => {
      const orgB = await wsB.api
        .post('/profiles/organizaciones', { nombre: 'OrgB', dominio: 'orgb.com' })
        .expect(201);
      await editorA.api
        .post('/profiles/contactos', { nombre: 'Cruzado', organizacionId: (orgB.body as { id: string }).id })
        .expect(404);
    });

    it('VIEWER no puede crear contactos (403)', async () => {
      await viewerA.api.post('/profiles/contactos', { nombre: 'Nope' }).expect(403);
    });
  });

  describe('Memoria operativa', () => {
    it('crea un hecho PROPUESTO por defecto y lo filtra por proceso', async () => {
      const created = await editorA.api
        .post('/profiles/memoria', { procesoClave: 'facturacion', hecho: 'El cliente paga a 30 días' })
        .expect(201);
      const body = created.body as { id: string; estado: string };
      expect(body.estado).toBe('PROPUESTO');

      const confirmed = await editorA.api
        .patch(`/profiles/memoria/${body.id}`, { estado: 'CONFIRMADO' })
        .expect(200);
      expect((confirmed.body as { estado: string }).estado).toBe('CONFIRMADO');

      const list = await wsA.api.get('/profiles/memoria?procesoClave=facturacion').expect(200);
      expect((list.body as { id: string }[]).some((m) => m.id === body.id)).toBe(true);
    });

    it('valida entradas y estado inválido (400), y aísla por workspace', async () => {
      await editorA.api.post('/profiles/memoria', { procesoClave: 'p', hecho: 'h' }).expect(400);
      await editorA.api
        .post('/profiles/memoria', { procesoClave: 'ventas', hecho: 'hecho válido', estado: 'OTRO' })
        .expect(400);

      const created = await editorA.api
        .post('/profiles/memoria', { procesoClave: 'ventas', hecho: 'hecho de A' })
        .expect(201);
      const id = (created.body as { id: string }).id;
      await wsB.api.get(`/profiles/memoria/${id}`).expect(404);
    });

    it('VIEWER no puede escribir memoria (403)', async () => {
      await viewerA.api.post('/profiles/memoria', { procesoClave: 'x', hecho: 'no debería' }).expect(403);
    });
  });
});
