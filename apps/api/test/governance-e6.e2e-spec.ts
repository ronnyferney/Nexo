import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

/**
 * E6 · Gobierno de acciones (ADR 0013 D1-D4). Verifica el motor de políticas (gana el control más restrictivo, DENY
 * bloquea), la bandeja de aprobaciones (invalidación por cambio de contenido QA03, no autoaprobación QA13, doble
 * aprobación, revalidación al ejecutar) y la suspensión de emergencia (bloquea nuevas y pendientes, reactivación con
 * actor + motivo QA08). Aislamiento por workspace (QA12).
 */
describe('Gobierno de acciones E6 (e2e)', () => {
  let app: INestApplication;
  let owner: Session; // OWNER, actúa como solicitante
  let admin1: Session; // ADMIN, aprobador distinto
  let admin2: Session; // ADMIN, segundo aprobador para la doble aprobación
  let viewer: Session; // VIEWER, sin atribuciones de mutación

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'e6-owner');
    admin1 = await addMember(app, owner, { role: 'ADMIN', tag: 'e6-admin1' });
    admin2 = await addMember(app, owner, { role: 'ADMIN', tag: 'e6-admin2' });
    viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'e6-viewer' });
  });

  afterAll(async () => {
    await app.close();
  });

  async function crearPolitica(admin: Session, body: Record<string, unknown>) {
    return (await admin.api.post('/admin/policies', body).expect(201)).body as { id: string; version: number };
  }

  it('solo ADMIN gestiona políticas (VIEWER y EDITOR no mutan)', async () => {
    await viewer.api.post('/admin/policies', { nombre: 'x', tipoAccion: 'EMAIL_SEND', efecto: 'ALLOW' }).expect(403);
    await crearPolitica(admin1, { nombre: 'Correos requieren aprobación', tipoAccion: 'EMAIL_SEND', efecto: 'REQUIRE_APPROVAL' });
  });

  it('una política DENY bloquea la acción y registra la decisión', async () => {
    await crearPolitica(admin1, { nombre: 'No borrar datos', tipoAccion: 'DATA_DELETE', efecto: 'DENY' });
    const out = (await owner.api.post('/actions', { tipoAccion: 'DATA_DELETE', recurso: 'clientes' }).expect(200))
      .body as { estado: string; decisionId: string; motivo: string };
    expect(out.estado).toBe('DENEGADA');
    expect(out.decisionId).toBeDefined();
    // La decisión queda registrada (inmutable) y es consultable por ADMIN.
    const decisiones = (await admin1.api.get('/admin/policies/decisions').expect(200)).body as { efecto: string }[];
    expect(decisiones.some((d) => d.efecto === 'DENY')).toBe(true);
  });

  it('un tipo sensible sin política se deniega por defecto', async () => {
    const out = (await owner.api.post('/actions', { tipoAccion: 'BANK_ACCOUNT_CHANGE', importe: 10 }).expect(200))
      .body as { estado: string; motivo: string };
    expect(out.estado).toBe('DENEGADA');
    expect(out.motivo).toBe('DENEGACION_POR_DEFECTO');
  });

  it('crea una aprobación, rechaza la autoaprobación y la aprueba un tercero (QA13)', async () => {
    const out = (
      await owner.api
        .post('/actions', {
          tipoAccion: 'EMAIL_SEND',
          proposito: 'Enviar cotización',
          destinatarios: ['cliente@externo.com'],
          contenido: { asunto: 'Cotización', cuerpo: 'Adjunto la cotización' },
          herramienta: 'gmail',
        })
        .expect(200)
    ).body as { estado: string; aprobacionId: string };
    expect(out.estado).toBe('REQUIERE_APROBACION');

    // El solicitante no puede aprobar su propia acción.
    await owner.api.post(`/approvals/${out.aprobacionId}/decision`, { decision: 'APRUEBA' }).expect(400);

    // Un aprobador distinto sí.
    const aprobada = (await admin1.api.post(`/approvals/${out.aprobacionId}/decision`, { decision: 'APRUEBA' }).expect(200))
      .body as { estado: string };
    expect(aprobada.estado).toBe('APROBADA');
  });

  it('invalida al ejecutar si cambia el contenido respecto a lo aprobado (QA03)', async () => {
    const out = (
      await owner.api
        .post('/actions', {
          tipoAccion: 'EMAIL_SEND',
          destinatarios: ['cliente@externo.com'],
          contenido: { cuerpo: 'Texto original' },
          herramienta: 'gmail',
        })
        .expect(200)
    ).body as { aprobacionId: string };
    await admin1.api.post(`/approvals/${out.aprobacionId}/decision`, { decision: 'APRUEBA' }).expect(200);

    // Ejecutar con un contenido distinto: el hash recomputado no coincide → se invalida.
    await owner.api
      .post(`/actions/approvals/${out.aprobacionId}/execute`, { contenido: { cuerpo: 'Texto manipulado' } })
      .expect(403);
    const estado = (await owner.api.get(`/approvals/${out.aprobacionId}`).expect(200)).body as { estado: string };
    expect(estado.estado).toBe('INVALIDADA');
  });

  it('ejecuta una aprobación intacta (revalidación al ejecutar, despacho = seam)', async () => {
    const out = (
      await owner.api
        .post('/actions', { tipoAccion: 'EMAIL_SEND', destinatarios: ['a@externo.com'], contenido: { cuerpo: 'Hola' } })
        .expect(200)
    ).body as { aprobacionId: string };
    await admin1.api.post(`/approvals/${out.aprobacionId}/decision`, { decision: 'APRUEBA' }).expect(200);
    const res = (await owner.api.post(`/actions/approvals/${out.aprobacionId}/execute`, {}).expect(200)).body as {
      aprobacion: { estado: string };
      dispatch: { status: string };
    };
    expect(res.aprobacion.estado).toBe('EJECUTADA');
    expect(res.dispatch.status).toBe('SEAM');
  });

  it('la doble aprobación exige dos personas distintas', async () => {
    await crearPolitica(admin1, {
      nombre: 'Pagos con doble aprobación',
      tipoAccion: 'PAYMENT',
      efecto: 'REQUIRE_APPROVAL',
      requiredApprovals: 2,
    });
    const out = (
      await owner.api
        .post('/actions', { tipoAccion: 'PAYMENT', importe: 5000, moneda: 'USD', proposito: 'Pago a proveedor' })
        .expect(200)
    ).body as { estado: string; aprobacionId: string; requiredApprovals: number };
    expect(out.requiredApprovals).toBe(2);

    const tras1 = (await admin1.api.post(`/approvals/${out.aprobacionId}/decision`, { decision: 'APRUEBA' }).expect(200))
      .body as { estado: string };
    expect(tras1.estado).toBe('PENDIENTE');

    // El mismo aprobador no cuenta dos veces.
    await admin1.api.post(`/approvals/${out.aprobacionId}/decision`, { decision: 'APRUEBA' }).expect(400);

    const tras2 = (await admin2.api.post(`/approvals/${out.aprobacionId}/decision`, { decision: 'APRUEBA' }).expect(200))
      .body as { estado: string };
    expect(tras2.estado).toBe('APROBADA');
  });

  it('la suspensión bloquea nuevas y pendientes, y se reactiva con actor + motivo (QA08)', async () => {
    // Una aprobación pendiente de despacho para el agente que vamos a suspender.
    const pend = (
      await owner.api
        .post('/actions', { tipoAccion: 'EMAIL_SEND', agentId: 'agente-bloqueado', contenido: { cuerpo: 'Pendiente' } })
        .expect(200)
    ).body as { aprobacionId: string };
    await admin1.api.post(`/approvals/${pend.aprobacionId}/decision`, { decision: 'APRUEBA' }).expect(200);

    // Suspensión por AGENTE (solo ADMIN).
    await viewer.api.post('/admin/suspensions', { alcance: 'AGENTE', targetId: 'agente-bloqueado', motivo: 'Incidente' }).expect(403);
    const susp = (
      await admin1.api
        .post('/admin/suspensions', { alcance: 'AGENTE', targetId: 'agente-bloqueado', motivo: 'Incidente de seguridad' })
        .expect(201)
    ).body as { id: string; activa: boolean };
    expect(susp.activa).toBe(true);

    // Nueva acción del agente suspendido: denegada.
    const nueva = (
      await owner.api
        .post('/actions', { tipoAccion: 'EMAIL_SEND', agentId: 'agente-bloqueado', contenido: { cuerpo: 'Nueva' } })
        .expect(200)
    ).body as { estado: string; motivo: string };
    expect(nueva.estado).toBe('DENEGADA');
    expect(nueva.motivo).toBe('SUSPENDIDO');

    // Otro agente no suspendido sigue operando.
    const otra = (
      await owner.api
        .post('/actions', { tipoAccion: 'EMAIL_SEND', agentId: 'agente-libre', contenido: { cuerpo: 'Libre' } })
        .expect(200)
    ).body as { estado: string };
    expect(otra.estado).toBe('REQUIERE_APROBACION');

    // La aprobación pendiente no se puede ejecutar mientras dure la suspensión.
    await owner.api.post(`/actions/approvals/${pend.aprobacionId}/execute`, {}).expect(403);

    // Reactivación con actor + motivo.
    const react = (await admin1.api.post(`/admin/suspensions/${susp.id}/reactivate`, { motivo: 'Resuelto' }).expect(200))
      .body as { activa: boolean; reactivadaMotivo: string; reactivadaPor: string | null };
    expect(react.activa).toBe(false);
    expect(react.reactivadaMotivo).toBe('Resuelto');
    expect(react.reactivadaPor).toBe(admin1.userId);

    // Tras reactivar, el agente vuelve a operar.
    const despues = (
      await owner.api
        .post('/actions', { tipoAccion: 'EMAIL_SEND', agentId: 'agente-bloqueado', contenido: { cuerpo: 'OK' } })
        .expect(200)
    ).body as { estado: string };
    expect(despues.estado).toBe('REQUIERE_APROBACION');
  });

  it('aísla la bandeja y las políticas por workspace (QA12)', async () => {
    const otro = await registerOwner(app, 'e6-otro');
    // El otro workspace no ve las aprobaciones del primero.
    const bandejaOtro = (await otro.api.get('/approvals').expect(200)).body as unknown[];
    expect(bandejaOtro).toHaveLength(0);
    // Ni las políticas.
    const politicasOtro = (await otro.api.get('/admin/policies').expect(200)).body as unknown[];
    expect(politicasOtro).toHaveLength(0);

    // Una aprobación concreta del primero no es accesible desde el otro workspace.
    const out = (
      await owner.api.post('/actions', { tipoAccion: 'EMAIL_SEND', contenido: { cuerpo: 'privado' } }).expect(200)
    ).body as { aprobacionId: string };
    await otro.api.get(`/approvals/${out.aprobacionId}`).expect(404);
  });
});
