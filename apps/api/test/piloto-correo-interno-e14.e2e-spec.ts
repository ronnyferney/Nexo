import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

/**
 * E14 · PILOTO INTERNO CONTROLADO del correo corporativo (ADR 0015 · `docs/activacion-correo-controles.md`), ejercido
 * EXTREMO A EXTREMO en AMBIENTE CONTROLADO. Autorización del patrocinador (2026-11-03): preparar un piloto interno con
 * lista blanca, límites de envío, trazabilidad y aprobación humana. NO activa envíos reales ni usa credenciales
 * productivas; el proveedor es SIMULADO (sin salida de red). El canal permanece SIN activación productiva.
 *
 * Recorrido: preparar piloto → envío a interno (queda en aprobación) → aprobación humana → despacho SIMULADO (sin red)
 * → envío a externo bloqueado → kill-switch corta todo → trazas en auditoría. Incluye la PRUEBA NEGATIVA: con el
 * piloto preparado NINGÚN envío real es posible (proveedor simulado, sin credenciales).
 */
interface MensajeCanal {
  id: string;
  direccion: 'SALIENTE' | 'ENTRANTE';
  estado: string;
  error?: string | null;
  aprobacionId?: string | null;
  proveedorMensajeId?: string | null;
  idempotencyKey: string;
  destino: string;
}

interface PrepararResp {
  cuenta: { id: string; proveedor: string; secretRef: string | null; config: Record<string, unknown> };
  politicas: { nombre: string; id: string }[];
  parametros: Record<string, unknown>;
  activacionProductiva: boolean;
}

describe('Piloto interno de correo E14 (e2e)', () => {
  let app: INestApplication;
  let owner: Session; // OWNER/ADMIN: prepara el piloto, aprueba y suspende
  let editor: Session; // EDITOR: envía (solicitante, nunca autoaprueba) y despacha tras aprobación

  const EMPRESA = 'empresa-piloto-interno';
  const INTERNO = 'persona@empresa.test';
  const INTERNO2 = 'otra@empresa.test';
  const EXTERNO = 'contacto@externo.test';

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'piloto-owner');
    editor = await addMember(app, owner, { role: 'EDITOR', tag: 'piloto-editor' });
  });

  afterAll(async () => {
    await app.close();
  });

  function prepararPiloto(body: Record<string, unknown> = {}) {
    return owner.api.post('/canales-externos/piloto/preparar', {
      empresaId: EMPRESA,
      dominiosInternos: ['*@empresa.test'],
      remitente: 'piloto@empresa.test',
      maxCuerpoBytes: 2048,
      maxEnviosPorDia: 3,
      ...body,
    });
  }

  function enviar(cuentaId: string, body: Record<string, unknown>) {
    return editor.api.post(`/canales-externos/${cuentaId}/enviar`, body);
  }

  async function mensajes(cuentaId: string): Promise<MensajeCanal[]> {
    return (await owner.api.get(`/canales-externos/${cuentaId}/mensajes`).expect(200)).body as MensajeCanal[];
  }

  let cuentaId: string;

  // -------------------------------------------------------------------------------------------------------------
  // 1. Preparar el piloto: idempotente, proveedor simulado, sin credenciales, con política de aprobación de internos.
  // -------------------------------------------------------------------------------------------------------------
  it('prepara el piloto (ADMIN): proveedor simulado, SIN secretRef, lista blanca y política de aprobación', async () => {
    const res = (await prepararPiloto().expect(200)).body as PrepararResp;
    cuentaId = res.cuenta.id;
    expect(res.cuenta.proveedor).toBe('simulado_piloto');
    expect(res.cuenta.secretRef).toBeNull();
    expect(res.activacionProductiva).toBe(false);
    expect(res.cuenta.config).toMatchObject({ piloto: true, destinatariosPermitidos: ['*@empresa.test'] });
    expect(res.politicas.length).toBeGreaterThanOrEqual(1);
  });

  it('es idempotente: re-preparar no duplica la cuenta ni las políticas', async () => {
    const res = (await prepararPiloto().expect(200)).body as PrepararResp;
    expect(res.cuenta.id).toBe(cuentaId);
    const cuentas = (await owner.api.get('/canales-externos').expect(200)).body as { id: string; proveedor: string }[];
    expect(cuentas.filter((c) => c.proveedor === 'simulado_piloto' && c.id === cuentaId)).toHaveLength(1);
    const politicas = (await owner.api.get('/admin/policies?tipoAccion=EMAIL_SEND&estado=ACTIVA').expect(200))
      .body as { nombre: string; empresaId: string | null }[];
    const internos = politicas.filter(
      (p) => p.empresaId === EMPRESA && p.nombre === 'Piloto interno correo — aprobación de internos',
    );
    expect(internos).toHaveLength(1);
  });

  it('solo ADMIN prepara el piloto (un EDITOR no puede)', async () => {
    await editor.api
      .post('/canales-externos/piloto/preparar', { empresaId: EMPRESA, dominiosInternos: ['*@empresa.test'] })
      .expect(403);
  });

  // -------------------------------------------------------------------------------------------------------------
  // 2. Envío a interno: queda en APROBACIÓN (no se despacha) → aprobación humana → despacho SIMULADO (sin red).
  // -------------------------------------------------------------------------------------------------------------
  it('un envío a interno queda PENDIENTE de aprobación, sin despachar', async () => {
    const res = (await enviar(cuentaId, { destino: INTERNO, cuerpo: 'Hola interno', idempotencyKey: 'pil-1' }).expect(
      200,
    )).body as MensajeCanal;
    expect(res.estado).toBe('PENDIENTE');
    expect(res.aprobacionId).toBeTruthy();
    expect(res.proveedorMensajeId).toBeFalsy();
  });

  it('tras la aprobación humana, el despacho SIMULADO deja el mensaje en SIMULADO (sin red)', async () => {
    const msg = (await mensajes(cuentaId)).find((m) => m.idempotencyKey === 'pil-1')!;
    // El aprobador (owner) no es el solicitante (editor): no hay autoaprobación.
    await owner.api.post(`/approvals/${msg.aprobacionId}/decision`, { decision: 'APRUEBA' }).expect(200);
    // Antes de despachar sigue PENDIENTE (la aprobación por sí sola no despacha).
    expect((await mensajes(cuentaId)).find((m) => m.idempotencyKey === 'pil-1')!.estado).toBe('PENDIENTE');

    const despachado = (await editor.api
      .post(`/canales-externos/${cuentaId}/mensajes/${msg.id}/despachar`)
      .expect(200)).body as MensajeCanal;
    expect(despachado.estado).toBe('SIMULADO');
    expect(despachado.proveedorMensajeId).toMatch(/^pil_/);
  });

  it('el despacho es idempotente: repetirlo no cambia el mensaje ya SIMULADO', async () => {
    const msg = (await mensajes(cuentaId)).find((m) => m.idempotencyKey === 'pil-1')!;
    const otra = (await editor.api
      .post(`/canales-externos/${cuentaId}/mensajes/${msg.id}/despachar`)
      .expect(200)).body as MensajeCanal;
    expect(otra.estado).toBe('SIMULADO');
    expect(otra.proveedorMensajeId).toBe(msg.proveedorMensajeId);
  });

  // -------------------------------------------------------------------------------------------------------------
  // 3. Envío a externo: bloqueado por la lista blanca (denegación por defecto), sin salir a la red ni pedir aprobación.
  // -------------------------------------------------------------------------------------------------------------
  it('un envío a externo (fuera de la lista blanca) se bloquea sin red ni aprobación', async () => {
    const res = (await enviar(cuentaId, { destino: EXTERNO, cuerpo: 'Hola externo', idempotencyKey: 'pil-ext' }).expect(
      200,
    )).body as MensajeCanal;
    expect(res.estado).toBe('FALLIDO');
    expect(res.error).toContain('DESTINATARIO_FUERA_DE_LISTA_BLANCA');
    expect(res.aprobacionId).toBeFalsy();
  });

  // -------------------------------------------------------------------------------------------------------------
  // 4. Límites del piloto: tamaño del cuerpo y tope de volumen por día.
  // -------------------------------------------------------------------------------------------------------------
  it('un cuerpo mayor al tope del piloto se bloquea (límite de tamaño)', async () => {
    const res = (await enviar(cuentaId, {
      destino: INTERNO,
      cuerpo: 'x'.repeat(5000),
      idempotencyKey: 'pil-grande',
    }).expect(200)).body as MensajeCanal;
    expect(res.estado).toBe('FALLIDO');
    expect(res.error).toContain('CUERPO_EXCEDE_TAMANO_MAXIMO');
  });

  it('el tope de volumen por día bloquea el excedente de salientes del piloto', async () => {
    // Piloto aislado con tope diario = 2 para ejercer el límite de volumen de forma determinista.
    const empresaTope = 'empresa-piloto-tope';
    const cuenta = (
      (await prepararPiloto({ empresaId: empresaTope, maxEnviosPorDia: 2 }).expect(200)).body as PrepararResp
    ).cuenta.id;
    const mandar = (k: string) =>
      editor.api.post(`/canales-externos/${cuenta}/enviar`, { destino: INTERNO, cuerpo: 'hola', idempotencyKey: k });
    // Los dos primeros entran (quedan PENDIENTE de aprobación: cuentan para el tope); el tercero supera el tope.
    expect(((await mandar('tope-1').expect(200)).body as MensajeCanal).estado).toBe('PENDIENTE');
    expect(((await mandar('tope-2').expect(200)).body as MensajeCanal).estado).toBe('PENDIENTE');
    const tercero = (await mandar('tope-3').expect(200)).body as MensajeCanal;
    expect(tercero.estado).toBe('FALLIDO');
    expect(tercero.error).toContain('TOPE_DIARIO_SUPERADO');
  });

  // -------------------------------------------------------------------------------------------------------------
  // 5. Kill-switch (Suspension E6): corta el envío nuevo y el despacho de una saliente ya aprobada.
  // -------------------------------------------------------------------------------------------------------------
  it('el kill-switch corta TODO: envío nuevo y despacho de una aprobada pendiente', async () => {
    // Deja una saliente aprobada pero sin despachar.
    const pend = (await enviar(cuentaId, { destino: INTERNO2, cuerpo: 'Para aprobar', idempotencyKey: 'pil-kill' }).expect(
      200,
    )).body as MensajeCanal;
    expect(pend.estado).toBe('PENDIENTE');
    await owner.api.post(`/approvals/${pend.aprobacionId}/decision`, { decision: 'APRUEBA' }).expect(200);

    // Suspensión por CONECTOR (la cuenta): corte inmediato.
    const susp = (
      await owner.api
        .post('/admin/suspensions', { alcance: 'CONECTOR', targetId: cuentaId, motivo: 'Corte del piloto' })
        .expect(201)
    ).body as { id: string };

    // 5a. Un envío NUEVO queda FALLIDO por la pasarela (denegado por suspensión).
    const nuevo = (await enviar(cuentaId, { destino: INTERNO, cuerpo: 'Durante corte', idempotencyKey: 'pil-kill-2' }).expect(
      200,
    )).body as MensajeCanal;
    expect(nuevo.estado).toBe('FALLIDO');
    expect(nuevo.error).toContain('denegado por política');

    // 5b. El despacho de la aprobada pendiente se rechaza (403) y el mensaje NO se despacha.
    const msg = (await mensajes(cuentaId)).find((m) => m.idempotencyKey === 'pil-kill')!;
    await editor.api.post(`/canales-externos/${cuentaId}/mensajes/${msg.id}/despachar`).expect(403);
    expect((await mensajes(cuentaId)).find((m) => m.idempotencyKey === 'pil-kill')!.estado).toBe('PENDIENTE');

    // Reactivar (ADMIN + motivo) permite de nuevo el despacho SIMULADO.
    await owner.api.post(`/admin/suspensions/${susp.id}/reactivate`, { motivo: 'Incidente resuelto' }).expect(200);
    const despachado = (await editor.api
      .post(`/canales-externos/${cuentaId}/mensajes/${msg.id}/despachar`)
      .expect(200)).body as MensajeCanal;
    expect(despachado.estado).toBe('SIMULADO');
  });

  // -------------------------------------------------------------------------------------------------------------
  // 6. Trazabilidad: auditoría inmutable registra la preparación y las aprobaciones; la cadena sigue intacta.
  // -------------------------------------------------------------------------------------------------------------
  it('la auditoría inmutable registra la preparación del piloto y las aprobaciones; la cadena está intacta', async () => {
    const verif = (await owner.api.get('/auditoria/verificacion').expect(200)).body as { ok: boolean };
    expect(verif.ok).toBe(true);
    const list = (await owner.api.get('/auditoria?take=200').expect(200)).body as {
      items: { action: string; targetId: string; metadata?: Record<string, unknown> }[];
    };
    const acciones = list.items.map((e) => e.action);
    expect(acciones).toContain('CANAL_PILOTO_PREPARADO');
    expect(acciones).toContain('POLITICA_CREADA');
    expect(acciones).toContain('APROBACION_CONCEDIDA');
    expect(acciones).toContain('SUSPENSION_ACTIVADA');
    expect(acciones).toContain('CANAL_ENVIO_BLOQUEADO');
    // La preparación del piloto no expone secretos ni contenido.
    const prep = list.items.find((e) => e.action === 'CANAL_PILOTO_PREPARADO' && e.targetId === cuentaId);
    expect(prep?.metadata).toMatchObject({ empresaId: EMPRESA });
    expect(JSON.stringify(prep?.metadata)).not.toContain('secret');
  });

  // -------------------------------------------------------------------------------------------------------------
  // 7. PRUEBA NEGATIVA: con el piloto preparado, NINGÚN envío real es posible.
  // -------------------------------------------------------------------------------------------------------------
  it('prueba negativa: proveedor simulado, sin credenciales, y ningún mensaje ENVIADO/ENTREGADO/LEIDO', async () => {
    const cuentas = (await owner.api.get('/canales-externos').expect(200)).body as {
      id: string;
      proveedor: string;
      secretRef: string | null;
    }[];
    const piloto = cuentas.find((c) => c.id === cuentaId)!;
    expect(piloto.proveedor).toBe('simulado_piloto');
    expect(piloto.secretRef).toBeNull();
    for (const m of await mensajes(cuentaId)) {
      expect(['ENVIADO', 'ENTREGADO', 'LEIDO']).not.toContain(m.estado);
    }
  });

  it('prueba negativa: aunque se fuerce un secretRef con credencial en bóveda, el adaptador NO despacha (no sale a la red)', async () => {
    // Escenario que el preset NUNCA genera: un ADMIN carga una credencial en la bóveda y la referencia en la cuenta del
    // piloto. El adaptador del piloto la rechaza POR CONSTRUCCIÓN (no sale a la red), así ni siquiera una credencial real
    // habilita un envío productivo mientras el piloto esté en modo controlado.
    await owner.api.put('/workspace/secrets', { name: 'PILOTO_SECRETO_FALSO', value: 'valor-no-usado' }).expect(200);
    await owner.api.patch(`/canales-externos/${cuentaId}`, { secretRef: 'PILOTO_SECRETO_FALSO' }).expect(200);
    const res = (await enviar(cuentaId, { destino: INTERNO, cuerpo: 'Con secreto', idempotencyKey: 'pil-neg' }).expect(
      200,
    )).body as MensajeCanal;
    // Pasa guardarraíl y pasarela (REQUIRE_APPROVAL) → PENDIENTE; al despachar, el adaptador rechaza credenciales.
    expect(res.estado).toBe('PENDIENTE');
    const msg = (await mensajes(cuentaId)).find((m) => m.idempotencyKey === 'pil-neg')!;
    await owner.api.post(`/approvals/${msg.aprobacionId}/decision`, { decision: 'APRUEBA' }).expect(200);
    const despachado = (await editor.api
      .post(`/canales-externos/${cuentaId}/mensajes/${msg.id}/despachar`)
      .expect(200)).body as MensajeCanal;
    expect(despachado.estado).toBe('FALLIDO');
    expect(despachado.error).toContain('no admite credenciales');
    // Restablece el piloto a su estado sin credenciales (idempotente).
    await prepararPiloto().expect(200);
  });
});
