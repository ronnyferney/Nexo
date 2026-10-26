import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

/**
 * E14 · GrabacionConfig (ADR 0015 D3/D4 · decisión Jurídica D7): controles configurables de grabación/retención por
 * empresa con DATOS SINTÉTICOS. Verifica:
 * - OFF/null por defecto: una empresa sin configuración ve todo desactivado y nada se graba/retiene;
 * - activar banderas cambia lo que se permite guardar; `retencionDias` null = pendiente de política (no inventa plazo);
 * - roles: VIEWER lee pero NO modifica; ADMIN+ modifica;
 * - aislamiento multi-tenant;
 * - cambiar la configuración queda auditado (E13) con banderas anterior/nuevo;
 * - integración con voz: una llamada con grabación OFF no persiste la transcripción (`transcripcionRef` null).
 *
 * Sin red a proveedores reales: la llamada usa el adaptador `simulado`.
 */
describe('GrabacionConfig E14 (e2e)', () => {
  let app: INestApplication;
  let owner: Session;
  let admin: Session;
  let viewer: Session;
  let otro: Session;

  const EMPRESA = 'empresa-grabacion';

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'grab-owner');
    admin = await addMember(app, owner, { role: 'ADMIN', tag: 'grab-admin' });
    viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'grab-viewer' });
    otro = await registerOwner(app, 'grab-otro');
  });

  afterAll(async () => {
    await app.close();
  });

  it('OFF por defecto: empresa sin configuración ve todo desactivado y null', async () => {
    const cfg = (await viewer.api.get(`/grabacion-config?empresaId=${EMPRESA}`).expect(200)).body as {
      id: string | null;
      configurado?: boolean;
      grabarAudio: boolean;
      guardarTranscripcion: boolean;
      guardarResumen: boolean;
      guardarEvidencia: boolean;
      requiereAutorizacion: boolean;
      retencionDias: number | null;
      accesoRoles: string[];
      eliminacionAutomatica: boolean;
    };
    expect(cfg.id).toBeNull();
    expect(cfg.configurado).toBe(false);
    expect(cfg.grabarAudio).toBe(false);
    expect(cfg.guardarTranscripcion).toBe(false);
    expect(cfg.guardarResumen).toBe(false);
    expect(cfg.guardarEvidencia).toBe(false);
    expect(cfg.requiereAutorizacion).toBe(true); // postura conservadora por defecto
    expect(cfg.retencionDias).toBeNull();
    expect(cfg.accesoRoles).toEqual([]);
    expect(cfg.eliminacionAutomatica).toBe(false);
  });

  it('VIEWER no puede modificar; ADMIN sí', async () => {
    await viewer.api.put(`/grabacion-config/${EMPRESA}`, { grabarAudio: true }).then((r) => expect(r.status).toBe(403));

    const guardada = (
      await admin.api
        .put(`/grabacion-config/${EMPRESA}`, { grabarAudio: true, guardarTranscripcion: true, accesoRoles: ['ADMIN'] })
        .expect(200)
    ).body as { id: string; grabarAudio: boolean; guardarTranscripcion: boolean; retencionDias: number | null };
    expect(guardada.id).toBeTruthy();
    expect(guardada.grabarAudio).toBe(true);
    expect(guardada.guardarTranscripcion).toBe(true);
    // retencionDias sigue null: pendiente de política, no un plazo por defecto.
    expect(guardada.retencionDias).toBeNull();
  });

  it('upsert conserva banderas previas y define retención explícita', async () => {
    const r = (
      await admin.api.put(`/grabacion-config/${EMPRESA}`, { retencionDias: 30, eliminacionAutomatica: true }).expect(200)
    ).body as { grabarAudio: boolean; guardarTranscripcion: boolean; retencionDias: number | null; accesoRoles: string[] };
    // No se tocaron las banderas de grabación: el upsert conserva lo previo.
    expect(r.grabarAudio).toBe(true);
    expect(r.guardarTranscripcion).toBe(true);
    expect(r.retencionDias).toBe(30);
    expect(r.accesoRoles).toEqual(['ADMIN']);
  });

  it('rechaza retencionDias inválido y roles desconocidos (class-validator)', async () => {
    await admin.api.put(`/grabacion-config/${EMPRESA}`, { retencionDias: 0 }).then((r) => expect(r.status).toBe(400));
    await admin.api
      .put(`/grabacion-config/${EMPRESA}`, { accesoRoles: ['SUPERADMIN'] })
      .then((r) => expect(r.status).toBe(400));
  });

  it('aislamiento multi-tenant: otro workspace no ve la configuración de esta empresa', async () => {
    const cfg = (await otro.api.get(`/grabacion-config?empresaId=${EMPRESA}`).expect(200)).body as {
      id: string | null;
      configurado?: boolean;
      grabarAudio: boolean;
    };
    // El otro workspace ve la vista OFF por defecto, nunca la fila ajena.
    expect(cfg.id).toBeNull();
    expect(cfg.configurado).toBe(false);
    expect(cfg.grabarAudio).toBe(false);
  });

  it('cambiar la configuración queda auditado con banderas anterior/nuevo (E13)', async () => {
    const audit = (
      await owner.api.get('/auditoria?action=GRABACION_CONFIG_MODIFICADA&targetType=GrabacionConfig&take=50').expect(200)
    ).body as {
      items: { action: string; targetType: string; metadata: { empresaId: string; anterior: unknown; nuevo: { grabarAudio: boolean } } }[];
    };
    const deEmpresa = audit.items.filter((e) => e.metadata?.empresaId === EMPRESA);
    expect(deEmpresa.length).toBeGreaterThanOrEqual(2);
    // El primer cambio (orden desc ⇒ último del array) no tenía estado previo.
    const primero = deEmpresa[deEmpresa.length - 1];
    expect(primero.metadata.anterior).toBeNull();
    expect(primero.metadata.nuevo.grabarAudio).toBe(true);
  });

  it('integración con voz: con grabación OFF, una llamada no persiste la transcripción', async () => {
    const EMPRESA_OFF = 'empresa-voz-off';
    const cuenta = (
      await owner.api.post('/voz/cuentas', { empresaId: EMPRESA_OFF, proveedor: 'simulado', config: {} }).expect(201)
    ).body as { id: string };

    const ini = (
      await admin.api
        .post('/voz/llamadas', { cuentaId: cuenta.id, direccion: 'SALIENTE', numero: '+100', idempotencyKey: 'grab-off-1' })
        .expect(200)
    ).body as { id: string };

    await admin.api.post(`/voz/llamadas/${ini.id}/turno`, { entrada: 'dato sintético de prueba' }).expect(200);

    const llamada = (await admin.api.get(`/voz/llamadas/${ini.id}`).expect(200)).body as {
      transcripcionRef: string | null;
    };
    // Invariante: grabación OFF por defecto ⇒ nunca se persiste contenido/referencia de transcripción.
    expect(llamada.transcripcionRef).toBeNull();
  });
});
