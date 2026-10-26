import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createTestApp } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

/**
 * E11 · Comunidad interna (el "muro" corporativo privado). Verifica: publicar cada tipo; el feed lista con conteos y
 * filtra por tipo/orgUnit/estado; comentar y reaccionar (idempotencia de reacción); marcar un APOYO como RESUELTA
 * (solo autor/ADMIN); un COMPROMISO con tareaId válido y el rechazo de una tarea de otro workspace; aislamiento
 * multi-tenant (otro workspace no ve ni comenta → 404); y la autorización de editar/archivar (autor o ADMIN).
 */
describe('Comunidad interna E11 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: Session;
  let viewer: Session;
  let admin: Session;
  let otro: Session;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    owner = await registerOwner(app, 'e11-owner');
    viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'e11-viewer' });
    admin = await addMember(app, owner, { role: 'ADMIN', tag: 'e11-admin' });
    otro = await registerOwner(app, 'e11-otro');
  });

  afterAll(async () => {
    await app.close();
  });

  async function crearTarea(workspaceId: string, titulo = 'Tarea E11'): Promise<string> {
    const t = await prisma.tarea.create({ data: { workspaceId, titulo } });
    return t.id;
  }

  it('un VIEWER puede publicar cada tipo y el autor es el usuario autenticado', async () => {
    for (const tipo of ['NOVEDAD', 'APOYO', 'APRENDIZAJE', 'COMPROMISO']) {
      const body = { tipo, titulo: `T ${tipo}`, cuerpo: `Cuerpo ${tipo}` };
      const res = await viewer.api.post('/comunidad/publicaciones', body).expect(201);
      expect((res.body as { tipo: string }).tipo).toBe(tipo);
      expect((res.body as { autorUserId: string }).autorUserId).toBe(viewer.userId);
      expect((res.body as { estado: string }).estado).toBe('ACTIVA');
    }
  });

  it('el feed lista con conteos de comentarios/reacciones y filtra por tipo', async () => {
    const pub = (await owner.api.post('/comunidad/publicaciones', { tipo: 'NOVEDAD', cuerpo: 'Feed' }).expect(201))
      .body as { id: string };
    await owner.api.post(`/comunidad/publicaciones/${pub.id}/comentarios`, { cuerpo: 'c1' }).expect(201);
    await owner.api.post(`/comunidad/publicaciones/${pub.id}/reacciones`, { tipo: 'like' }).expect(201);

    const feed = (await owner.api.get('/comunidad/publicaciones?tipo=NOVEDAD').expect(200)).body as {
      items: { id: string; tipo: string; _count: { comentarios: number; reacciones: number } }[];
      total: number;
    };
    expect(feed.items.every((p) => p.tipo === 'NOVEDAD')).toBe(true);
    const encontrada = feed.items.find((p) => p.id === pub.id);
    expect(encontrada?._count.comentarios).toBe(1);
    expect(encontrada?._count.reacciones).toBe(1);
  });

  it('el feed filtra por orgUnit y por estado (y oculta ARCHIVADA por defecto)', async () => {
    const units = (await owner.api.get('/admin/org/units').expect(200)).body as { id: string; isRoot: boolean }[];
    const root = units.find((u) => u.isRoot)!;
    const conUnidad = (
      await owner.api
        .post('/comunidad/publicaciones', { tipo: 'NOVEDAD', cuerpo: 'Con unidad', orgUnitId: root.id })
        .expect(201)
    ).body as { id: string };

    const porUnidad = (await owner.api.get(`/comunidad/publicaciones?orgUnitId=${root.id}`).expect(200)).body as {
      items: { id: string; orgUnitId: string | null }[];
    };
    expect(porUnidad.items.every((p) => p.orgUnitId === root.id)).toBe(true);
    expect(porUnidad.items.some((p) => p.id === conUnidad.id)).toBe(true);

    // Archivar y comprobar que desaparece del muro por defecto pero aparece con filtro estado=ARCHIVADA.
    await owner.api.delete(`/comunidad/publicaciones/${conUnidad.id}`).expect(200);
    const porDefecto = (await owner.api.get(`/comunidad/publicaciones?orgUnitId=${root.id}`).expect(200)).body as {
      items: { id: string }[];
    };
    expect(porDefecto.items.some((p) => p.id === conUnidad.id)).toBe(false);
    const archivadas = (await owner.api.get('/comunidad/publicaciones?estado=ARCHIVADA').expect(200)).body as {
      items: { id: string; estado: string }[];
    };
    expect(archivadas.items.some((p) => p.id === conUnidad.id && p.estado === 'ARCHIVADA')).toBe(true);
  });

  it('comentar y reaccionar; la reacción es idempotente por (publicación, autor, tipo)', async () => {
    const pub = (await viewer.api.post('/comunidad/publicaciones', { tipo: 'APRENDIZAJE', cuerpo: 'React' }).expect(201))
      .body as { id: string };

    await viewer.api.post(`/comunidad/publicaciones/${pub.id}/comentarios`, { cuerpo: 'Gran aporte' }).expect(201);
    const coment = (await owner.api.get(`/comunidad/publicaciones/${pub.id}/comentarios`).expect(200)).body as {
      cuerpo: string;
    }[];
    expect(coment).toHaveLength(1);

    const r1 = (await viewer.api.post(`/comunidad/publicaciones/${pub.id}/reacciones`, { tipo: 'like' }).expect(201))
      .body as { id: string };
    const r2 = (await viewer.api.post(`/comunidad/publicaciones/${pub.id}/reacciones`, { tipo: 'like' }).expect(201))
      .body as { id: string };
    expect(r2.id).toBe(r1.id); // idempotente: no crea otra
    const reacciones = await prisma.reaccion.count({ where: { publicacionId: pub.id } });
    expect(reacciones).toBe(1);

    // Quitar la reacción (idempotente).
    await viewer.api.delete(`/comunidad/publicaciones/${pub.id}/reacciones/like`).expect(200);
    await viewer.api.delete(`/comunidad/publicaciones/${pub.id}/reacciones/like`).expect(200);
    expect(await prisma.reaccion.count({ where: { publicacionId: pub.id } })).toBe(0);
  });

  it('marcar un APOYO como RESUELTA: solo el autor o un ADMIN', async () => {
    const apoyo = (await viewer.api.post('/comunidad/publicaciones', { tipo: 'APOYO', cuerpo: 'Necesito ayuda' }).expect(201))
      .body as { id: string };

    // Otro VIEWER distinto del autor no puede editar (403). Usamos owner como autor-ajeno pero owner es OWNER (admin+),
    // así que probamos con un segundo viewer.
    const viewer2 = await addMember(app, owner, { role: 'VIEWER', tag: 'e11-viewer2' });
    await viewer2.api.patch(`/comunidad/publicaciones/${apoyo.id}`, { estado: 'RESUELTA' }).expect(403);

    // El autor sí.
    const resuelta = (await viewer.api.patch(`/comunidad/publicaciones/${apoyo.id}`, { estado: 'RESUELTA' }).expect(200))
      .body as { estado: string };
    expect(resuelta.estado).toBe('RESUELTA');

    // Un ADMIN puede editar la publicación de otro.
    const r2 = (await admin.api.patch(`/comunidad/publicaciones/${apoyo.id}`, { cuerpo: 'Editado por admin' }).expect(200))
      .body as { cuerpo: string };
    expect(r2.cuerpo).toBe('Editado por admin');
  });

  it('un COMPROMISO admite tareaId del mismo workspace; una tarea de otro workspace se rechaza', async () => {
    const tareaPropia = await crearTarea(owner.workspaceId);
    const ok = (
      await owner.api
        .post('/comunidad/publicaciones', { tipo: 'COMPROMISO', cuerpo: 'Me comprometo', tareaId: tareaPropia })
        .expect(201)
    ).body as { tareaId: string };
    expect(ok.tareaId).toBe(tareaPropia);

    const tareaAjena = await crearTarea(otro.workspaceId);
    await owner.api
      .post('/comunidad/publicaciones', { tipo: 'COMPROMISO', cuerpo: 'Tarea ajena', tareaId: tareaAjena })
      .expect(400);

    // Un tipo que no es COMPROMISO/APOYO no puede ligar tarea.
    await owner.api
      .post('/comunidad/publicaciones', { tipo: 'NOVEDAD', cuerpo: 'No liga', tareaId: tareaPropia })
      .expect(400);
  });

  it('aislamiento multi-tenant: otro workspace no ve ni comenta la publicación (404)', async () => {
    const pub = (await owner.api.post('/comunidad/publicaciones', { tipo: 'NOVEDAD', cuerpo: 'Privada' }).expect(201))
      .body as { id: string };

    await otro.api.get(`/comunidad/publicaciones/${pub.id}`).expect(404);
    await otro.api.post(`/comunidad/publicaciones/${pub.id}/comentarios`, { cuerpo: 'intruso' }).expect(404);
    await otro.api.post(`/comunidad/publicaciones/${pub.id}/reacciones`, { tipo: 'like' }).expect(404);

    const feedOtro = (await otro.api.get('/comunidad/publicaciones').expect(200)).body as { items: { id: string }[] };
    expect(feedOtro.items.some((p) => p.id === pub.id)).toBe(false);
  });

  it('archivar requiere ser autor o ADMIN; el detalle incluye comentarios', async () => {
    const pub = (await admin.api.post('/comunidad/publicaciones', { tipo: 'NOVEDAD', cuerpo: 'De admin' }).expect(201))
      .body as { id: string };
    await admin.api.post(`/comunidad/publicaciones/${pub.id}/comentarios`, { cuerpo: 'nota' }).expect(201);

    const detalle = (await viewer.api.get(`/comunidad/publicaciones/${pub.id}`).expect(200)).body as {
      comentarios: unknown[];
    };
    expect(detalle.comentarios).toHaveLength(1);

    // Un VIEWER que no es autor no puede archivar.
    await viewer.api.delete(`/comunidad/publicaciones/${pub.id}`).expect(403);
    // El autor (admin) sí.
    await admin.api.delete(`/comunidad/publicaciones/${pub.id}`).expect(200);
  });
});
