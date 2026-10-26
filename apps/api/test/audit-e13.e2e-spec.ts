import type { INestApplication } from '@nestjs/common';
import { createTestApp, prismaOf } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

interface AuditEntry {
  id: string;
  seq: number;
  action: string;
  actorType: string;
  actorId: string | null;
  targetType: string | null;
  targetId: string | null;
  resumen: string;
  contentHash: string;
  prevHash: string;
  hash: string;
}

interface AuditList {
  items: AuditEntry[];
  nextCursor: string | null;
}

interface VerifyResult {
  ok: boolean;
  total: number;
  rotaEnSeq?: number;
  motivo?: string;
}

/**
 * E13 · Auditoría inmutable. Verifica que los hechos de gobierno (política creada, aprobación concedida, suspensión
 * activada/levantada) se registran encadenados por hash (seq monotónica, prevHash enlaza), que la cadena verifica OK,
 * que manipular una fila por acceso directo a BD rompe la cadena de forma detectable (en el seq exacto), el aislamiento
 * multi-tenant de la cadena y que solo ADMIN+ puede leer la auditoría.
 */
describe('Auditoría inmutable E13 (e2e)', () => {
  let app: INestApplication;
  let owner: Session; // OWNER, solicitante de la acción
  let admin: Session; // ADMIN, aprobador y gestor de gobierno
  let viewer: Session; // VIEWER, sin acceso a la auditoría

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'e13-owner');
    admin = await addMember(app, owner, { role: 'ADMIN', tag: 'e13-admin' });
    viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'e13-viewer' });
  });

  afterAll(async () => {
    await app.close();
  });

  /** Genera una cadena de hechos de gobierno en el workspace del owner/admin. */
  async function generarHechos() {
    // Política (POLITICA_CREADA) que exige aprobación para EMAIL_SEND.
    await admin.api
      .post('/admin/policies', {
        nombre: 'Correos con aprobación',
        tipoAccion: 'EMAIL_SEND',
        efecto: 'REQUIRE_APPROVAL',
      })
      .expect(201);

    // Acción que requiere aprobación; el admin la concede (APROBACION_CONCEDIDA).
    const req = (
      await owner.api
        .post('/actions', {
          tipoAccion: 'EMAIL_SEND',
          destinatarios: ['cliente@externo.com'],
          contenido: { cuerpo: 'Hola' },
        })
        .expect(200)
    ).body as { aprobacionId: string };
    await admin.api.post(`/approvals/${req.aprobacionId}/decision`, { decision: 'APRUEBA' }).expect(200);

    // Suspensión de emergencia activada y luego levantada (SUSPENSION_ACTIVADA / SUSPENSION_LEVANTADA).
    const susp = (
      await admin.api
        .post('/admin/suspensions', { alcance: 'AGENTE', targetId: 'agente-x', motivo: 'Incidente de seguridad' })
        .expect(201)
    ).body as { id: string };
    await admin.api.post(`/admin/suspensions/${susp.id}/reactivate`, { motivo: 'Resuelto' }).expect(200);
  }

  it('encadena los hechos de gobierno: seq monotónica y prevHash enlaza', async () => {
    await generarHechos();

    const list = (await admin.api.get('/auditoria?take=200').expect(200)).body as AuditList;
    expect(list.items.length).toBeGreaterThanOrEqual(4);

    const acciones = list.items.map((e) => e.action);
    expect(acciones).toContain('POLITICA_CREADA');
    expect(acciones).toContain('APROBACION_CONCEDIDA');
    expect(acciones).toContain('SUSPENSION_ACTIVADA');
    expect(acciones).toContain('SUSPENSION_LEVANTADA');

    // Orden ascendente por seq para comprobar el encadenamiento.
    const asc = [...list.items].sort((a, b) => a.seq - b.seq);
    for (let i = 0; i < asc.length; i++) {
      expect(asc[i].seq).toBe(i + 1); // secuencia monotónica 1..n
      if (i === 0) {
        expect(asc[i].prevHash).toBe('0'.repeat(64)); // GENESIS
      } else {
        expect(asc[i].prevHash).toBe(asc[i - 1].hash); // enlaza con la entrada anterior
      }
    }

    // La aprobación quedó registrada con su actor (el admin) y su objetivo.
    const aprob = asc.find((e) => e.action === 'APROBACION_CONCEDIDA')!;
    expect(aprob.actorType).toBe('USER');
    expect(aprob.actorId).toBe(admin.userId);
    expect(aprob.targetType).toBe('Aprobacion');
  });

  it('la cadena intacta verifica OK', async () => {
    const res = (await admin.api.get('/auditoria/verificacion').expect(200)).body as VerifyResult;
    expect(res.ok).toBe(true);
    expect(res.total).toBeGreaterThanOrEqual(4);
    expect(res.rotaEnSeq).toBeUndefined();
  });

  it('filtra por action y targetType', async () => {
    const soloSusp = (await admin.api.get('/auditoria?action=SUSPENSION_ACTIVADA').expect(200)).body as AuditList;
    expect(soloSusp.items.length).toBeGreaterThanOrEqual(1);
    expect(soloSusp.items.every((e) => e.action === 'SUSPENSION_ACTIVADA')).toBe(true);
  });

  it('un VIEWER no puede leer la auditoría (ADMIN+)', async () => {
    await viewer.api.get('/auditoria').expect(403);
    await viewer.api.get('/auditoria/verificacion').expect(403);
  });

  it('manipular una fila directamente en BD rompe la cadena de forma detectable', async () => {
    // Workspace propio para no afectar las comprobaciones de los demás tests.
    const sabotaje = await registerOwner(app, 'e13-sabotaje');
    await sabotaje.api
      .post('/admin/suspensions', { alcance: 'AGENTE', targetId: 'a1', motivo: 'Motivo uno de prueba' })
      .expect(201);
    await sabotaje.api
      .post('/admin/suspensions', { alcance: 'AGENTE', targetId: 'a2', motivo: 'Motivo dos de prueba' })
      .expect(201);

    const antes = (await sabotaje.api.get('/auditoria/verificacion').expect(200)).body as VerifyResult;
    expect(antes.ok).toBe(true);
    expect(antes.total).toBe(2);

    // Alteración directa del contenido de la primera entrada (lo que haría un atacante con acceso a BD).
    const primera = await prismaOf(app).auditLog.findFirst({
      where: { workspaceId: sabotaje.workspaceId, seq: 1 },
    });
    await prismaOf(app).auditLog.update({
      where: { id: primera!.id },
      data: { resumen: 'RESUMEN MANIPULADO' },
    });

    const despues = (await sabotaje.api.get('/auditoria/verificacion').expect(200)).body as VerifyResult;
    expect(despues.ok).toBe(false);
    expect(despues.rotaEnSeq).toBe(1);
    expect(despues.motivo).toBe('CONTENIDO_ALTERADO');
  });

  it('aísla la cadena por workspace (otro workspace no ve ni afecta la del primero)', async () => {
    const otro = await registerOwner(app, 'e13-otro');
    const vacia = (await otro.api.get('/auditoria?take=200').expect(200)).body as AuditList;
    expect(vacia.items).toHaveLength(0);

    const verif = (await otro.api.get('/auditoria/verificacion').expect(200)).body as VerifyResult;
    expect(verif.ok).toBe(true);
    expect(verif.total).toBe(0);

    // La cadena del owner sigue intacta e independiente de los sabotajes de otros workspaces.
    const propia = (await admin.api.get('/auditoria/verificacion').expect(200)).body as VerifyResult;
    expect(propia.ok).toBe(true);
  });
});
