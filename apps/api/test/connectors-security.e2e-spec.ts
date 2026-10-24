import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/app';
import { addMember, registerOwner, type Session } from './utils/fixtures';
import { RestMock } from './utils/mock-servers';

/**
 * Auditoría de seguridad: B5 (`POST /connectors/:id/test` exige EDITOR), M4 (valores de `input` codificados en la ruta
 * REST, sin recorrido de rutas) y B6 (`pattern` con riesgo de ReDoS rechazado al guardar la operación).
 */
describe('Conectores: hallazgos de seguridad (e2e)', () => {
  let app: INestApplication;
  let rest: RestMock;
  let owner: Session;
  let editor: Session;
  let viewer: Session;
  let connectorId: string;
  let opId: string;

  beforeAll(async () => {
    rest = await new RestMock().start();
    app = await createTestApp();
    owner = await registerOwner(app, 'conn-sec');
    editor = await addMember(app, owner, { role: 'EDITOR', tag: 'conn-sec-editor' });
    viewer = await addMember(app, owner, { role: 'VIEWER', tag: 'conn-sec-viewer' });
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
});
