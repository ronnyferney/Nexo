import type { INestApplication } from '@nestjs/common';
import { Api, createTestApp } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';
import { RestMock } from './utils/mock-servers';

/**
 * Auditoría de seguridad: B5 (`POST /connectors/:id/test` exige EDITOR), M4 (valores de `input` codificados en la ruta
 * REST, sin recorrido de rutas), B6 (`pattern` con riesgo de ReDoS rechazado al guardar la operación) y A4 (un EDITOR o
 * una API key no pueden leer secretos de la bóveda que un ADMIN no permitió al conector).
 */
describe('Conectores: hallazgos de seguridad (e2e)', () => {
  let app: INestApplication;
  let rest: RestMock;
  let owner: Session;
  let editor: Session;
  let viewer: Session;
  let admin: Session;
  let connectorId: string;
  let opId: string;

  beforeAll(async () => {
    rest = await new RestMock().start();
    app = await createTestApp();
    owner = await registerOwner(app, 'conn-sec');
    editor = await addMember(app, owner, { role: 'EDITOR', tag: 'conn-sec-editor' });
    viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'conn-sec-viewer' });
    admin = await addMember(app, owner, { role: 'ADMIN', tag: 'conn-sec-admin' });
    const connector = await owner.api
      .post('/connectors', { name: 'API interna', type: 'REST', config: { baseUrl: `${rest.origin}/v1` } })
      .expect(201);
    connectorId = (connector.body as { id: string }).id;
    const op = await owner.api
      .post(`/connectors/${connectorId}/operations`, {
        key: 'get_item',
        name: 'Obtener ítem',
        definition: { method: 'GET', path: '/items/{{ input.id }}' },
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      })
      .expect(201);
    opId = (op.body as { id: string }).id;
  });

  afterAll(async () => {
    await app?.close();
    await rest?.stop();
  });

  describe('B5: probar un conector', () => {
    it('un VIEWER recibe 403 y no provoca ninguna llamada saliente', async () => {
      const before = rest.requests.length;
      await viewer.api.post(`/connectors/${connectorId}/test`).expect(403);
      expect(rest.requests.length).toBe(before);
    });

    it('un EDITOR sí puede probarlo', async () => {
      const res = await editor.api.post(`/connectors/${connectorId}/test`).expect(200);
      expect(res.body).toMatchObject({ ok: true });
    });
  });

  describe('M4: valores de input en la ruta REST', () => {
    it('"../" y "?" del input viajan codificados dentro del segmento', async () => {
      const before = rest.requests.length;
      await owner.api
        .post(`/connectors/${connectorId}/operations/${opId}/invoke`, { input: { id: '../../admin?x=1#f' } })
        .expect(200);
      const seen = rest.requests.slice(before);
      expect(seen).toHaveLength(1);
      expect(seen[0].path).toBe('/v1/items/..%2F..%2Fadmin%3Fx=1%23f');
      expect([...seen[0].query.keys()]).toEqual([]);
    });

    it('un input ".." se rechaza con 400 sin llamar al servidor', async () => {
      const before = rest.requests.length;
      const res = await owner.api
        .post(`/connectors/${connectorId}/operations/${opId}/invoke`, { input: { id: '..' } })
        .expect(400);
      expect((res.body as { message: string }).message).toMatch(/Ruta de operación inválida/);
      expect(rest.requests.length).toBe(before);
    });
  });

  describe('B6: pattern con riesgo de ReDoS', () => {
    it('crear una operación con (a+)+$ responde 400', async () => {
      const res = await owner.api
        .post(`/connectors/${connectorId}/operations`, {
          key: 'redos',
          name: 'ReDoS',
          definition: { method: 'GET', path: '/items' },
          inputSchema: { type: 'object', properties: { q: { type: 'string', pattern: '^(a+)+$' } } },
        })
        .expect(400);
      expect((res.body as { message: string }).message).toMatch(/riesgo de ReDoS/);
    });
  });

  describe('A4: secretos permitidos por conector', () => {
    const SECRET_VALUE = 'valor-super-secreto-del-admin';
    type Detail = { id: string; allowedSecrets: string[]; blockedSecrets: string[]; secretReferences: string[] };
    const leakedTo = (from: number) =>
      rest.requests.slice(from).filter((r) => JSON.stringify(r).includes(SECRET_VALUE));

    /** Conector + operación del atacante que envía el secreto ajeno a su propio servidor. */
    const exfiltrator = async (api: Api, header = '{{ secrets.ADMIN_DB_PASSWORD }}') => {
      const c = (
        await api
          .post('/connectors', {
            name: 'Exfiltrar',
            type: 'REST',
            config: { baseUrl: rest.origin, headers: { 'x-leak': header } },
          })
          .expect(201)
      ).body as Detail;
      const op = (
        await api
          .post(`/connectors/${c.id}/operations`, {
            key: 'ping',
            name: 'Ping',
            definition: { method: 'GET', path: '/' },
          })
          .expect(201)
      ).body as { id: string };
      return { connector: c, opId: op.id };
    };

    beforeAll(async () => {
      await owner.api.put('/workspace/secrets', { name: 'ADMIN_DB_PASSWORD', value: SECRET_VALUE }).expect(200);
    });

    it('un EDITOR crea un conector que referencia un secreto ajeno → bloqueado, sin enviar nada', async () => {
      const { connector, opId: ping } = await exfiltrator(editor.api);
      expect(connector).toMatchObject({ allowedSecrets: [], blockedSecrets: ['ADMIN_DB_PASSWORD'] });
      const before = rest.requests.length;
      const res = await editor.api.post(`/connectors/${connector.id}/operations/${ping}/invoke`, {}).expect(403);
      expect((res.body as { message: string }).message).toMatch(
        /secretos no permitidos: ADMIN_DB_PASSWORD.*«Secretos permitidos»/,
      );
      const test = await editor.api.post(`/connectors/${connector.id}/test`).expect(200);
      expect(test.body).toMatchObject({ ok: false, message: expect.stringMatching(/no permitidos/) });
      expect(rest.requests.length).toBe(before);
      expect(JSON.stringify([res.body, test.body])).not.toContain(SECRET_VALUE);
    });

    it('el error es el mismo si el secreto no existe (no revela su existencia)', async () => {
      const { connector, opId: ping } = await exfiltrator(editor.api, '{{ secrets.NO_EXISTE_EN_BOVEDA }}');
      const res = await editor.api.post(`/connectors/${connector.id}/operations/${ping}/invoke`, {}).expect(403);
      expect((res.body as { message: string }).message.replace('NO_EXISTE_EN_BOVEDA', 'X')).toBe(
        'El conector referencia secretos no permitidos: X. Un administrador debe autorizarlos en «Secretos permitidos» del conector',
      );
    });

    it('una API key tampoco puede leer el secreto', async () => {
      const key = (
        (
          await owner.api
            .post('/workspace/api-keys', { name: 'A4', scopes: ['read', 'write', 'connectors:invoke'] })
            .expect(201)
        ).body as { key: string }
      ).key;
      const api = new Api(app, key);
      const { connector, opId: ping } = await exfiltrator(api);
      const before = rest.requests.length;
      await api.post(`/connectors/${connector.id}/operations/${ping}/invoke`, {}).expect(403);
      await api.put(`/connectors/${connector.id}/allowed-secrets`, { names: ['ADMIN_DB_PASSWORD'] }).expect(403);
      expect(leakedTo(before)).toHaveLength(0);
    });

    it('{{ secrets | json }} (la bóveda completa) se rechaza incluso para un ADMIN', async () => {
      const { connector, opId: ping } = await exfiltrator(admin.api, '{{ secrets | json }}');
      expect(connector.blockedSecrets).toEqual(['secrets']);
      const before = rest.requests.length;
      const res = await admin.api.post(`/connectors/${connector.id}/operations/${ping}/invoke`, {}).expect(403);
      expect((res.body as { message: string }).message).toMatch(/bóveda completa/);
      expect(rest.requests.length).toBe(before);
    });

    it('un EDITOR no amplía la lista: ni con PUT, ni colándola en PATCH, ni editando la configuración', async () => {
      const { connector, opId: ping } = await exfiltrator(editor.api);
      await editor.api.put(`/connectors/${connector.id}/allowed-secrets`, { names: ['ADMIN_DB_PASSWORD'] }).expect(403);
      await editor.api.patch(`/connectors/${connector.id}`, { allowedSecrets: ['ADMIN_DB_PASSWORD'] }).expect(400);
      const patched = (
        await editor.api
          .patch(`/connectors/${connector.id}`, {
            config: { baseUrl: rest.origin, headers: { 'x-leak': '{{ secrets.ADMIN_DB_PASSWORD }}', otro: 'x' } },
          })
          .expect(200)
      ).body as Detail;
      expect(patched).toMatchObject({ allowedSecrets: [], blockedSecrets: ['ADMIN_DB_PASSWORD'] });
      // Un ADMIN que solo renombra el conector no aprueba la referencia que dejó el EDITOR.
      const renamed = (await admin.api.patch(`/connectors/${connector.id}`, { name: 'Renombrado' }).expect(200))
        .body as Detail;
      expect(renamed.allowedSecrets).toEqual([]);
      await editor.api.post(`/connectors/${connector.id}/operations/${ping}/invoke`, {}).expect(403);
    });

    it('un EDITOR que añade una referencia a un conector ya autorizado queda bloqueado en esa operación', async () => {
      await owner.api.put('/workspace/secrets', { name: 'CRM_TOKEN', value: 'crm-token-permitido' }).expect(200);
      const crm = (
        await admin.api
          .post('/connectors', {
            name: 'CRM',
            type: 'REST',
            config: { baseUrl: rest.origin },
            auth: { type: 'bearer', token: '{{ secrets.CRM_TOKEN }}' },
          })
          .expect(201)
      ).body as Detail;
      expect(crm).toMatchObject({ allowedSecrets: ['CRM_TOKEN'], blockedSecrets: [] });
      const ok = (
        await editor.api
          .post(`/connectors/${crm.id}/operations`, { key: 'ok', name: 'Ok', definition: { method: 'GET', path: '/' } })
          .expect(201)
      ).body as { id: string };
      const leak = (
        await editor.api
          .post(`/connectors/${crm.id}/operations`, {
            key: 'leak',
            name: 'Leak',
            definition: { method: 'GET', path: '/', headers: { 'x-leak': '{{ secrets.ADMIN_DB_PASSWORD }}' } },
          })
          .expect(201)
      ).body as { id: string };
      const before = rest.requests.length;
      await editor.api.post(`/connectors/${crm.id}/operations/${ok.id}/invoke`, {}).expect(200);
      expect(rest.requests.at(-1)!.headers.authorization).toBe('Bearer crm-token-permitido');
      await editor.api.post(`/connectors/${crm.id}/operations/${leak.id}/invoke`, {}).expect(403);
      expect(leakedTo(before)).toHaveLength(0);
      const detail = (await editor.api.get(`/connectors/${crm.id}`).expect(200)).body as Detail;
      expect(detail.blockedSecrets).toEqual(['ADMIN_DB_PASSWORD']);

      // Tampoco puede reenviar el secreto permitido a su servidor cambiando el destino del conector.
      const redirect = await editor.api
        .patch(`/connectors/${crm.id}`, { config: { baseUrl: 'http://127.0.0.1:9/atacante' } })
        .expect(403);
      expect((redirect.body as { message: string }).message).toMatch(/Solo un administrador puede cambiar el destino/);
      await editor.api
        .patch(`/connectors/${crm.id}`, { name: 'CRM (renombrado)', config: { baseUrl: rest.origin } })
        .expect(200);
    });

    it('GraphQL y MCP usan la misma resolución: bloqueados antes de conectar', async () => {
      const before = rest.requests.length;
      const gql = (
        await editor.api
          .post('/connectors', {
            name: 'GQL',
            type: 'GRAPHQL',
            config: { endpoint: `${rest.origin}/graphql`, headers: { 'x-leak': '{{ secrets.ADMIN_DB_PASSWORD }}' } },
          })
          .expect(201)
      ).body as Detail;
      const q = (
        await editor.api
          .post(`/connectors/${gql.id}/operations`, { key: 'q', name: 'Q', definition: { query: '{ a }' } })
          .expect(201)
      ).body as { id: string };
      await editor.api.post(`/connectors/${gql.id}/operations/${q.id}/invoke`, {}).expect(403);
      const mcp = (
        await editor.api
          .post('/connectors', {
            name: 'MCP',
            type: 'MCP',
            config: {
              transport: 'streamable-http',
              url: `${rest.origin}/mcp`,
              headers: { authorization: 'Bearer {{ secrets.ADMIN_DB_PASSWORD }}' },
            },
          })
          .expect(201)
      ).body as Detail;
      await editor.api.post(`/connectors/${mcp.id}/discover`, {}).expect(403);
      expect(rest.requests.length).toBe(before);
    });

    it('cuando un ADMIN permite el secreto, el conector lo usa', async () => {
      const { connector, opId: ping } = await exfiltrator(editor.api);
      await viewer.api.put(`/connectors/${connector.id}/allowed-secrets`, { names: ['ADMIN_DB_PASSWORD'] }).expect(403);
      await admin.api.put(`/connectors/${connector.id}/allowed-secrets`, { names: ['minusculas'] }).expect(400);
      const allowed = (
        await admin.api.put(`/connectors/${connector.id}/allowed-secrets`, { names: ['ADMIN_DB_PASSWORD'] }).expect(200)
      ).body as Detail;
      expect(allowed).toMatchObject({ allowedSecrets: ['ADMIN_DB_PASSWORD'], blockedSecrets: [] });
      const before = rest.requests.length;
      await editor.api.post(`/connectors/${connector.id}/operations/${ping}/invoke`, {}).expect(200);
      expect(rest.requests.at(-1)!.headers['x-leak']).toBe(SECRET_VALUE);
      expect(rest.requests.length).toBe(before + 1);
    });
  });
});
