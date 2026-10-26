import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

/**
 * E6+ · Catálogo configurable de acciones sensibles + niveles de riesgo (puntos 7 y 8 del patrocinador). Verifica:
 * la semilla base idempotente por workspace; que configurar un tipo (doble aprobación) hace que el `ActionGateway`
 * exija doble aprobación para esa acción (integración ADITIVA con PolicyEngine); la clasificación DESCONOCIDO →
 * detener/escalar; el aislamiento multi-tenant; y los roles (VIEWER lee/clasifica pero NO configura; ADMIN configura).
 */
interface TipoAccion {
  id: string;
  codigo: string;
  nombre: string;
  requiereAprobacion: boolean;
  requiereDobleAprobacion: boolean;
  nivelRiesgoPorDefecto: string;
  umbralMonto: string | null;
  moneda: string | null;
  esSistema: boolean;
  activo: boolean;
}

describe('Acciones sensibles + riesgo E6+ (e2e)', () => {
  let app: INestApplication;
  let owner: Session; // OWNER (solicita acciones y administra)
  let admin: Session; // ADMIN (aprobador distinto)
  let admin2: Session; // ADMIN (segundo aprobador para la doble aprobación)
  let viewer: Session; // VIEWER (lee/clasifica, no configura)

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'e6s-owner');
    admin = await addMember(app, owner, { role: 'ADMIN', tag: 'e6s-admin' });
    admin2 = await addMember(app, owner, { role: 'ADMIN', tag: 'e6s-admin2' });
    viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'e6s-viewer' });
  });

  afterAll(async () => {
    await app.close();
  });

  async function catalogo(s: Session): Promise<TipoAccion[]> {
    return (await s.api.get('/gobierno/acciones-sensibles').expect(200)).body as TipoAccion[];
  }

  it('siembra el catálogo base de sistema de forma idempotente (sin umbrales monetarios)', async () => {
    const primera = await catalogo(viewer);
    const codigos = primera.map((t) => t.codigo);
    expect(codigos).toEqual(expect.arrayContaining(['PAGO', 'CAMBIO_CUENTA_BANCARIA', 'EMAIL_SEND', 'VOICE_CALL']));

    const pago = primera.find((t) => t.codigo === 'PAGO')!;
    expect(pago.esSistema).toBe(true);
    expect(pago.requiereDobleAprobacion).toBe(true);
    expect(pago.nivelRiesgoPorDefecto).toBe('ALTO');
    // Los umbrales monetarios los fija Finanzas: nacen nulos.
    expect(pago.umbralMonto).toBeNull();
    expect(pago.moneda).toBeNull();

    const email = primera.find((t) => t.codigo === 'EMAIL_SEND')!;
    expect(email.requiereAprobacion).toBe(false);
    expect(email.nivelRiesgoPorDefecto).toBe('BAJO');

    // Idempotente: un segundo acceso no duplica ni crea nuevas entradas de sistema.
    const segunda = await catalogo(owner);
    const sistemaPrimera = primera.filter((t) => t.esSistema).length;
    const sistemaSegunda = segunda.filter((t) => t.esSistema).length;
    expect(sistemaSegunda).toBe(sistemaPrimera);
  });

  it('un tipo con doble aprobación (semilla PAGO) hace que el gateway exija doble aprobación', async () => {
    const out = (
      await owner.api
        .post('/actions', { tipoAccion: 'PAGO', importe: 5000, moneda: 'USD', proposito: 'Pago a proveedor' })
        .expect(200)
    ).body as { estado: string; aprobacionId: string; requiredApprovals: number; motivo: string };
    expect(out.estado).toBe('REQUIERE_APROBACION');
    expect(out.requiredApprovals).toBe(2);
    expect(out.motivo).toBe('CATALOGO_DOBLE_APROBACION');

    // Dos aprobadores distintos cierran la aprobación (reutiliza la bandeja de E6).
    const tras1 = (await admin.api.post(`/approvals/${out.aprobacionId}/decision`, { decision: 'APRUEBA' }).expect(200))
      .body as { estado: string };
    expect(tras1.estado).toBe('PENDIENTE');
    const tras2 = (
      await admin2.api.post(`/approvals/${out.aprobacionId}/decision`, { decision: 'APRUEBA' }).expect(200)
    ).body as { estado: string };
    expect(tras2.estado).toBe('APROBADA');
  });

  it('configurar un tipo rutinario a doble aprobación (ADMIN) lo refleja el gateway; VIEWER no configura', async () => {
    const voice = (await catalogo(admin)).find((t) => t.codigo === 'VOICE_CALL')!;

    // VIEWER no puede configurar.
    await viewer.api.patch(`/gobierno/acciones-sensibles/${voice.id}`, { requiereDobleAprobacion: true }).expect(403);

    // Antes de configurar: sin aprobación (comunicación rutinaria) → permitida.
    const antes = (await owner.api.post('/actions', { tipoAccion: 'VOICE_CALL', destinatarios: ['+100'] }).expect(200))
      .body as { estado: string };
    expect(antes.estado).toBe('PERMITIDA');

    // ADMIN configura doble aprobación.
    const actualizado = (
      await admin.api
        .patch(`/gobierno/acciones-sensibles/${voice.id}`, {
          requiereDobleAprobacion: true,
          nivelRiesgoPorDefecto: 'ALTO',
        })
        .expect(200)
    ).body as TipoAccion;
    expect(actualizado.requiereDobleAprobacion).toBe(true);

    // Ahora el gateway exige doble aprobación para VOICE_CALL.
    const despues = (
      await owner.api.post('/actions', { tipoAccion: 'VOICE_CALL', destinatarios: ['+100'] }).expect(200)
    ).body as { estado: string; requiredApprovals: number };
    expect(despues.estado).toBe('REQUIERE_APROBACION');
    expect(despues.requiredApprovals).toBe(2);
  });

  it('clasifica el riesgo: DESCONOCIDO/sin evidencia → detener y escalar (VIEWER puede)', async () => {
    const desconocido = (await viewer.api.post('/gobierno/riesgo/clasificar', { impactoPotencial: 'BAJO' }).expect(200))
      .body as { nivel: string; control: string; detener: boolean; escalar: boolean; scoreCalibrado: boolean };
    expect(desconocido.nivel).toBe('DESCONOCIDO');
    expect(desconocido.control).toBe('DETENER_Y_ESCALAR');
    expect(desconocido.detener).toBe(true);
    expect(desconocido.escalar).toBe(true);
    expect(desconocido.scoreCalibrado).toBe(false);

    // Con evidencia y reglas cumplidas, un impacto bajo es automatizable.
    const bajo = (
      await viewer.api
        .post('/gobierno/riesgo/clasificar', {
          evidenciaSuficiente: true,
          impactoPotencial: 'BAJO',
          cumpleReglas: true,
        })
        .expect(200)
    ).body as { nivel: string; automatizable: boolean };
    expect(bajo.nivel).toBe('BAJO');
    expect(bajo.automatizable).toBe(true);

    // El nivel por defecto del catálogo (PAGO = ALTO) actúa como piso aun con impacto bajo.
    const conCatalogo = (
      await viewer.api
        .post('/gobierno/riesgo/clasificar', {
          tipoAccion: 'PAGO',
          evidenciaSuficiente: true,
          impactoPotencial: 'BAJO',
          cumpleReglas: true,
        })
        .expect(200)
    ).body as { nivel: string; control: string };
    expect(conCatalogo.nivel).toBe('ALTO');
    expect(conCatalogo.control).toBe('REVISION_HUMANA_OBLIGATORIA');
  });

  it('aísla el catálogo configurado por workspace (QA12)', async () => {
    const otro = await registerOwner(app, 'e6s-otro');

    // Una entrada propia de un código nuevo en el workspace del owner.
    await owner.api
      .post('/gobierno/acciones-sensibles', {
        codigo: 'RPA_DESKTOP',
        nombre: 'RPA escritorio',
        requiereAprobacion: true,
        nivelRiesgoPorDefecto: 'MEDIO',
      })
      .expect(201);

    const delOwner = (await catalogo(owner)).map((t) => t.codigo);
    expect(delOwner).toContain('RPA_DESKTOP');

    // El otro workspace tiene su propia semilla base pero NO la entrada personalizada del primero.
    const delOtro = (await catalogo(otro)).map((t) => t.codigo);
    expect(delOtro).toContain('PAGO');
    expect(delOtro).not.toContain('RPA_DESKTOP');
  });

  it('no permite duplicar el código base de sistema del workspace vía alta', async () => {
    await owner.api.post('/gobierno/acciones-sensibles', { codigo: 'PAGO', nombre: 'Pago duplicado' }).expect(400);
  });
});
