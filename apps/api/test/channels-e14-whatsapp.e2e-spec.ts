import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Api, createTestApp } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';

/**
 * E14 · Canales externos, incremento 2: WhatsApp (sandbox, SIN envíos reales). Verifica:
 * - cuenta WhatsApp `simulado` → SIMULADO determinista sin red (incluida plantilla válida aceptada de extremo a extremo);
 * - cuentas Meta/Twilio SIN credenciales → FALLIDO con causa, sin tocar la red;
 * - plantilla con parámetros inválida → FALLIDO sin red (Meta, validación previa a la red);
 * - webhooks: verificación de firma (Meta HMAC-SHA256) que ACEPTA la válida y RECHAZA la inválida (Meta y Twilio),
 *   registro idempotente de entrantes y aislamiento por cuenta/proveedor;
 * - aislamiento multi-tenant.
 *
 * NUNCA se llama a Meta/Twilio reales: las cuentas Meta/Twilio o no tienen credenciales (no tocan red) o fallan en la
 * validación de plantilla antes de la red. Los recorridos con red (envío real) se cubren con dobles en los `*.spec.ts`.
 */
describe('Canales externos E14 · WhatsApp (e2e)', () => {
  let app: INestApplication;
  let owner: Session;
  let editor: Session;
  let otro: Session;
  let cuentaSim: string;
  let cuentaMeta: string;
  let cuentaTwilio: string;

  const APP_SECRET = 'webhook-secret-xyz';

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'e14wa-owner');
    editor = await addMember(app, owner, { role: 'EDITOR', tag: 'e14wa-editor' });
    otro = await registerOwner(app, 'e14wa-otro');

    // Secretos en bóveda (ADMIN). El valor JSON aísla token de envío y app secret de firma de webhooks.
    await owner.api
      .put('/workspace/secrets', { name: 'WHATSAPP_META', value: JSON.stringify({ accessToken: 'tok', appSecret: APP_SECRET }) })
      .expect(200);
    await owner.api
      .put('/workspace/secrets', { name: 'WHATSAPP_TWILIO', value: JSON.stringify({ accountSid: 'AC1', authToken: 'authtk' }) })
      .expect(200);

    cuentaSim = (
      await owner.api
        .post('/canales-externos', { empresaId: 'emp', tipo: 'WHATSAPP', proveedor: 'simulado' })
        .expect(201)
    ).body.id;
    cuentaMeta = (
      await owner.api
        .post('/canales-externos', {
          empresaId: 'emp',
          tipo: 'WHATSAPP',
          proveedor: 'whatsapp_meta',
          secretRef: 'WHATSAPP_META',
          config: { phoneNumberId: '123456' },
        })
        .expect(201)
    ).body.id;
    cuentaTwilio = (
      await owner.api
        .post('/canales-externos', {
          empresaId: 'emp',
          tipo: 'WHATSAPP',
          proveedor: 'whatsapp_twilio',
          secretRef: 'WHATSAPP_TWILIO',
          config: { fromNumber: '+14155238886' },
        })
        .expect(201)
    ).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('acepta el alias de proveedor (meta / twilio) al crear cuentas', async () => {
    await owner.api
      .post('/canales-externos', { empresaId: 'emp-alias', tipo: 'WHATSAPP', proveedor: 'meta' })
      .expect(201);
    await owner.api
      .post('/canales-externos', { empresaId: 'emp-alias', tipo: 'WHATSAPP', proveedor: 'twilio' })
      .expect(201);
  });

  it('cuenta simulada WhatsApp → SIMULADO sin red', async () => {
    const res = await editor.api
      .post(`/canales-externos/${cuentaSim}/enviar`, { destino: '+57300', cuerpo: 'Hola', idempotencyKey: 'wa-sim-1' })
      .expect(200);
    expect(res.body.estado).toBe('SIMULADO');
    expect(res.body.proveedorMensajeId).toMatch(/^sim_/);
  });

  it('plantilla con parámetros VÁLIDA se acepta de extremo a extremo (simulado)', async () => {
    const res = await editor.api
      .post(`/canales-externos/${cuentaSim}/enviar`, {
        destino: '+57300',
        cuerpo: 'Confirmación',
        idempotencyKey: 'wa-sim-tpl',
        plantilla: { nombre: 'confirmacion_cita', idioma: 'es', parametros: ['Ana', '10:00'] },
      })
      .expect(200);
    expect(res.body.estado).toBe('SIMULADO');
  });

  it('cuenta Meta SIN credenciales → FALLIDO con causa, sin red', async () => {
    const sinCreds = (
      await owner.api
        .post('/canales-externos', {
          empresaId: 'emp-sincreds',
          tipo: 'WHATSAPP',
          proveedor: 'whatsapp_meta',
          config: { phoneNumberId: '123' },
        })
        .expect(201)
    ).body.id;
    const res = await editor.api
      .post(`/canales-externos/${sinCreds}/enviar`, { destino: '+57300', cuerpo: 'x', idempotencyKey: 'wa-meta-nc' })
      .expect(200);
    expect(res.body.estado).toBe('FALLIDO');
    expect(res.body.error).toContain('sin credenciales');
  });

  it('cuenta Twilio SIN credenciales → FALLIDO con causa, sin red', async () => {
    const sinCreds = (
      await owner.api
        .post('/canales-externos', {
          empresaId: 'emp-sincreds-tw',
          tipo: 'WHATSAPP',
          proveedor: 'whatsapp_twilio',
          config: { fromNumber: '+1' },
        })
        .expect(201)
    ).body.id;
    const res = await editor.api
      .post(`/canales-externos/${sinCreds}/enviar`, { destino: '+57300', cuerpo: 'x', idempotencyKey: 'wa-tw-nc' })
      .expect(200);
    expect(res.body.estado).toBe('FALLIDO');
    expect(res.body.error).toContain('sin credenciales');
  });

  it('plantilla INVÁLIDA (Meta con credenciales) → FALLIDO sin red (validación previa)', async () => {
    const res = await editor.api
      .post(`/canales-externos/${cuentaMeta}/enviar`, {
        destino: '+57300',
        cuerpo: 'x',
        idempotencyKey: 'wa-meta-tpl-bad',
        plantilla: { nombre: 'NO VALE' },
      })
      .expect(200);
    expect(res.body.estado).toBe('FALLIDO');
    expect(res.body.error).toContain('Nombre de plantilla inválido');
  });

  // ---------- Webhooks ----------
  function metaPayload(id: string) {
    return JSON.stringify({
      entry: [
        {
          changes: [
            { value: { messages: [{ id, from: '573001112233', type: 'text', text: { body: 'Hola entrante' } }] } },
          ],
        },
      ],
    });
  }
  function firmaMeta(raw: string) {
    return 'sha256=' + createHmac('sha256', APP_SECRET).update(raw, 'utf8').digest('hex');
  }

  it('webhook Meta con firma VÁLIDA registra un entrante idempotente', async () => {
    const raw = metaPayload('wamid.e2e.1');
    const path = `/canales-externos/webhooks/whatsapp_meta/${cuentaMeta}`;

    const r1 = await new Api(app)
      .call('post', path)
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', firmaMeta(raw))
      .send(raw);
    expect(r1.status).toBe(200);
    expect(r1.body.entrantes).toBe(1);

    // Redelivery idéntica → idempotente (no duplica).
    const r2 = await new Api(app)
      .call('post', path)
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', firmaMeta(raw))
      .send(raw);
    expect(r2.status).toBe(200);
    expect(r2.body.entrantes).toBe(0);

    const mensajes = (await owner.api.get(`/canales-externos/${cuentaMeta}/mensajes`).expect(200)).body as {
      direccion: string;
      cuerpo: string;
      proveedorMensajeId: string;
    }[];
    const entrantes = mensajes.filter((m) => m.direccion === 'ENTRANTE' && m.proveedorMensajeId === 'wamid.e2e.1');
    expect(entrantes).toHaveLength(1);
    expect(entrantes[0].cuerpo).toBe('Hola entrante');
  });

  it('webhook Meta con firma INVÁLIDA → 401 y no registra nada', async () => {
    const raw = metaPayload('wamid.e2e.2');
    const res = await new Api(app)
      .call('post', `/canales-externos/webhooks/whatsapp_meta/${cuentaMeta}`)
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', 'sha256=firmafalsa')
      .send(raw);
    expect(res.status).toBe(401);

    const mensajes = (await owner.api.get(`/canales-externos/${cuentaMeta}/mensajes`).expect(200)).body as {
      proveedorMensajeId: string;
    }[];
    expect(mensajes.some((m) => m.proveedorMensajeId === 'wamid.e2e.2')).toBe(false);
  });

  it('webhook Meta SIN cabecera de firma → 401', async () => {
    const raw = metaPayload('wamid.e2e.3');
    const res = await new Api(app)
      .call('post', `/canales-externos/webhooks/whatsapp_meta/${cuentaMeta}`)
      .set('content-type', 'application/json')
      .send(raw);
    expect(res.status).toBe(401);
  });

  it('webhook Twilio con firma INVÁLIDA → 401', async () => {
    const body = { MessageSid: 'SMe2e', From: 'whatsapp:+57300', Body: 'Hola' };
    const res = await new Api(app)
      .call('post', `/canales-externos/webhooks/whatsapp_twilio/${cuentaTwilio}`)
      .set('x-twilio-signature', 'firma-mala')
      .send(body);
    expect(res.status).toBe(401);
  });

  it('webhook con proveedor de ruta que no corresponde a la cuenta → 404', async () => {
    const raw = metaPayload('wamid.e2e.x');
    const res = await new Api(app)
      .call('post', `/canales-externos/webhooks/whatsapp_twilio/${cuentaMeta}`)
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', firmaMeta(raw))
      .send(raw);
    expect(res.status).toBe(404);
  });

  it('webhook a una cuenta inexistente → 404', async () => {
    const res = await new Api(app)
      .call('post', `/canales-externos/webhooks/whatsapp_meta/cuenta-inexistente`)
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', 'sha256=x')
      .send('{}');
    expect(res.status).toBe(404);
  });

  it('aislamiento multi-tenant: otro workspace no opera la cuenta WhatsApp', async () => {
    await otro.api.get(`/canales-externos/${cuentaMeta}`).expect(404);
    await otro.api
      .post(`/canales-externos/${cuentaMeta}/enviar`, { destino: '+1', cuerpo: 'x', idempotencyKey: 'otro-wa' })
      .expect(404);
  });
});
