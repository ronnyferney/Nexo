import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, parseSse, prismaOf } from './utils/app';
import { registerOwner, type Session } from './utils/fixtures';

interface RunResponse {
  id: string;
  status: string;
  output: unknown;
  error: string | null;
  inputWarnings: string[];
}

type Node = { id: string; type: string; name: string; config: Record<string, unknown> };

/** Flujo del caso reportado: la plantilla usa `{{ input.latitude }}` y `{{ input.longitude }}`. */
const weather = (triggerConfig: Record<string, unknown> = {}) => {
  const nodes: Node[] = [
    { id: 'trigger', type: 'trigger', name: 'Inicio', config: triggerConfig },
    {
      id: 'clima_actual',
      type: 'output',
      name: 'Clima actual',
      config: {
        output: { lat: '{{ input.latitude }}', lon: '{{ input.longitude }}', u: "{{ input.u | default:'C' }}" },
      },
    },
  ];
  return { nodes, edges: [{ id: 'e1', source: 'trigger', target: 'clima_actual' }] };
};

const REQUIRED = {
  inputFields: [
    { name: 'latitude', type: 'number', required: true, description: 'Latitud en grados' },
    { name: 'longitude', type: 'number', required: true },
    { name: 'ciudad', type: 'string' },
  ],
};

describe('Entrada de los flujos: aviso antes de ejecutar (P2, E2E)', () => {
  let app: INestApplication;
  let owner: Session;

  const create = async (name: string, definition: object) =>
    ((await owner.api.post('/workflows', { name, definition }).expect(201)).body as { id: string }).id;
  const executions = (workflowId: string) => prismaOf(app).execution.count({ where: { workflowId } });

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'wf-input');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rechaza guardar un esquema de entrada mal formado', async () => {
    const bad = await owner.api
      .post('/workflows', {
        name: 'Esquema malo',
        definition: weather({ inputFields: [{ name: 'a b', type: 'fecha' }] }),
      })
      .expect(400);
    expect(JSON.stringify(bad.body.message)).toContain('nombre inválido');
    expect(JSON.stringify(bad.body.message)).toContain('tipo desconocido');
  });

  it('POST /run responde 400 con los campos requeridos que faltan y no crea la ejecución', async () => {
    const id = await create('Clima con esquema', weather(REQUIRED));
    const res = await owner.api.post(`/workflows/${id}/run`, { input: { latitude: 4.6 }, wait: true }).expect(400);
    expect(res.body.message).toBe('Faltan datos de entrada requeridos: longitude.');

    const both = await owner.api.post(`/workflows/${id}/run`, { input: {} }).expect(400);
    expect(both.body.message).toBe('Faltan datos de entrada requeridos: latitude, longitude.');

    const wrongType = await owner.api
      .post(`/workflows/${id}/run`, { input: { latitude: '4.6', longitude: -74 } })
      .expect(400);
    expect(wrongType.body.message).toBe('El dato de entrada "latitude" debe ser número.');
    expect(await executions(id)).toBe(0);

    const ok = await owner.api
      .post(`/workflows/${id}/run`, { input: { latitude: 4.6, longitude: -74.08 }, wait: true })
      .expect(202);
    const ex = ok.body as RunResponse;
    expect(ex.status).toBe('SUCCEEDED');
    expect(ex.output).toEqual({ lat: 4.6, lon: -74.08, u: 'C' });
    expect(ex.inputWarnings).toEqual([]);
  });

  it('un flujo antiguo sin esquema sigue ejecutando y devuelve advertencias con los campos de las plantillas', async () => {
    const id = await create('Clima antiguo', weather());
    const res = await owner.api.post(`/workflows/${id}/run`, { input: { latitude: 4.6 }, wait: true }).expect(202);
    const ex = res.body as RunResponse;
    expect(ex.status).toBe('SUCCEEDED');
    expect(ex.output).toEqual({ lat: 4.6, u: 'C' });
    expect(ex.inputWarnings).toHaveLength(1);
    expect(ex.inputWarnings[0]).toContain('longitude');
    expect(ex.inputWarnings[0]).not.toContain('latitude');
  });

  it('el webhook también responde 400 con los campos faltantes', async () => {
    const id = await create('Clima por webhook', weather(REQUIRED));
    await owner.api.post(`/workflows/${id}/active`, { active: true }).expect(200);
    const token = ((await owner.api.get(`/workflows/${id}`).expect(200)).body as { webhookToken: string }).webhookToken;
    const hook = () => request(app.getHttpServer()).post(`/api/hooks/${token}?wait=true`);

    const missing = await hook().send({ ciudad: 'Bogotá' }).expect(400);
    expect(missing.body.message).toBe('Faltan datos de entrada requeridos: latitude, longitude.');

    const ok = await hook().send({ latitude: 1, longitude: 2 }).expect(202);
    expect(ok.body).toMatchObject({ status: 'SUCCEEDED', output: { lat: 1, lon: 2 }, inputWarnings: [] });
  });

  it('un sub-flujo con esquema falla con el mensaje claro si el padre no le pasa los requeridos', async () => {
    const child = await create('Hijo con esquema', weather(REQUIRED));
    const parent = await create('Padre sin datos', {
      nodes: [
        { id: 'trigger', type: 'trigger', name: 'Inicio', config: {} },
        { id: 'sub', type: 'subworkflow', name: 'Llamar hijo', config: { workflowId: child, input: { latitude: 1 } } },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'sub' }],
    });
    const ex = (await owner.api.post(`/workflows/${parent}/run`, { input: {}, wait: true }).expect(202))
      .body as RunResponse;
    expect(ex.status).toBe('FAILED');
    expect(ex.error).toContain('Faltan datos de entrada requeridos: longitude');
  });

  it('MCP: la tool del flujo describe los campos y devuelve isError con los faltantes', async () => {
    await create('Clima MCP', weather(REQUIRED)).then((id) =>
      owner.api.post(`/workflows/${id}/active`, { active: true }).expect(200),
    );
    const key = (
      (await owner.api.post('/workspace/api-keys', { name: 'MCP', scopes: ['mcp'] }).expect(201)).body as {
        key: string;
      }
    ).key;
    const rpc = async (method: string, params: object) => {
      const res = await request(app.getHttpServer())
        .post('/api/mcp')
        .set('Authorization', `Bearer ${key}`)
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: 1, method, params })
        .buffer(true)
        .parse((r, cb) => {
          let data = '';
          r.setEncoding('utf8');
          r.on('data', (chunk: string) => (data += chunk));
          r.on('end', () => cb(null, data));
        });
      expect(res.status).toBe(200);
      const raw = res.body as string;
      return (raw.trim().startsWith('{') ? JSON.parse(raw) : parseSse(raw)[0].data) as { result: Record<string, any> };
    };

    const tools = (await rpc('tools/list', {})).result.tools as { name: string; title: string; inputSchema: any }[];
    const tool = tools.find((t) => t.title === 'Clima MCP')!;
    expect(tool.inputSchema.properties.input.description).toContain('latitude (number, requerido): Latitud en grados');

    const call = (await rpc('tools/call', { name: tool.name, arguments: { input: { latitude: 1 } } })).result;
    expect(call.isError).toBe(true);
    expect(call.content[0].text).toBe('Faltan datos de entrada requeridos: longitude.');
  });
});
