#!/usr/bin/env node
/**
 * Demo de agentes y flujos sobre Nexo local (`npm run local` debe estar corriendo).
 *
 *   npm run local:demo
 *
 * Crea (o reutiliza) en el workspace del usuario maestro:
 *   1. Conector REST «Clima (Open-Meteo)», API pública sin claves, con la operación `clima_actual`.
 *   2. Agente «Asistente de despacho (demo)» que usa esa operación como herramienta.
 *   3. Flujo «Demo: clima y recomendación de despacho»: disparador → conector → agente → respuesta.
 * Luego conversa con el agente (la herramienta hace una llamada real) y ejecuta el flujo, y muestra los resultados.
 *
 * Credenciales: las de .dev/credenciales.txt, o NEXO_EMAIL y NEXO_PASSWORD si cambió la contraseña.
 * IA: con ANTHROPIC_API_KEY en apps/api/.env usa Claude; si no, el modelo simulado (que invoca la herramienta con
 * el comando `/tool`, para demostrar el circuito completo sin costo).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.NEXO_API_URL ?? 'http://localhost:3000/api';
const WEB = process.env.NEXO_WEB_URL ?? 'http://localhost:4200';
const CONNECTOR = 'Clima (Open-Meteo)';
const AGENT = 'Asistente de despacho (demo)';
const WORKFLOW = 'Demo: clima y recomendación de despacho';
// Solo para pruebas sin internet: apunta el conector a un servidor que imite a Open-Meteo.
const WEATHER_URL = process.env.NEXO_DEMO_WEATHER_URL ?? 'https://api.open-meteo.com/v1';
const CITY = { ciudad: 'Bogotá', latitude: 4.711, longitude: -74.0721 };

const c = { b: '\x1b[1m', g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', d: '\x1b[2m', x: '\x1b[0m' };
const ok = (m) => console.log(`${c.g}✔${c.x} ${m}`);
const step = (m) => console.log(`\n${c.b}▸ ${m}${c.x}`);
const fail = (m) => {
  console.error(`${c.r}✖ ${m}${c.x}`);
  process.exit(1);
};

function credentials() {
  if (process.env.NEXO_EMAIL && process.env.NEXO_PASSWORD) {
    return { email: process.env.NEXO_EMAIL, password: process.env.NEXO_PASSWORD };
  }
  const file = path.join(ROOT, '.dev', 'credenciales.txt');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const email = /Usuario maestro: (.+)/.exec(text)?.[1]?.trim();
  const password = /Contraseña inicial: (.+)/.exec(text)?.[1]?.trim();
  if (!email || !password) {
    fail('No encontré las credenciales. Ejecute: NEXO_EMAIL=su@correo NEXO_PASSWORD=su-clave npm run local:demo');
  }
  return { email, password };
}

function anthropicConfigured() {
  const env = path.join(ROOT, 'apps', 'api', '.env');
  return existsSync(env) && /^ANTHROPIC_API_KEY=\S+/m.test(readFileSync(env, 'utf8'));
}

let token = '';
async function call(method, route, body) {
  let res;
  try {
    res = await fetch(`${API}${route}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    fail(`La API no responde en ${API}. ¿Está corriendo? Ejecute: npm run local`);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('; ') : (data?.message ?? text);
    throw Object.assign(new Error(`${method} ${route} → ${res.status}: ${msg}`), { status: res.status });
  }
  return data;
}

async function ensureConnector() {
  const existing = (await call('GET', '/connectors')).find((x) => x.name === CONNECTOR);
  if (existing) {
    ok(`Conector existente: ${CONNECTOR}`);
    return call('GET', `/connectors/${existing.id}`);
  }
  const connector = await call('POST', '/connectors', {
    name: CONNECTOR,
    description: 'Clima actual por coordenadas (Open-Meteo, API pública sin claves). Conector REST de demostración.',
    type: 'REST',
    config: { baseUrl: WEATHER_URL, timeoutMs: 15000 },
  });
  await call('POST', `/connectors/${connector.id}/operations`, {
    key: 'clima_actual',
    name: 'Clima actual',
    description:
      'Devuelve temperatura (°C), precipitación (mm), probabilidad de lluvia y viento (km/h) actuales para unas ' +
      'coordenadas. Úsala antes de recomendar un despacho o una ruta.',
    inputSchema: {
      type: 'object',
      required: ['latitude', 'longitude'],
      properties: {
        latitude: { type: 'number', minimum: -90, maximum: 90, description: 'Latitud, p. ej. 4.711 (Bogotá)' },
        longitude: { type: 'number', minimum: -180, maximum: 180, description: 'Longitud, p. ej. -74.0721 (Bogotá)' },
      },
    },
    definition: {
      method: 'GET',
      path: '/forecast',
      query: {
        latitude: '{{ input.latitude }}',
        longitude: '{{ input.longitude }}',
        current: 'temperature_2m,precipitation,wind_speed_10m',
        hourly: 'precipitation_probability',
        forecast_hours: '6',
        timezone: 'America/Bogota',
      },
    },
  });
  ok(`Conector creado: ${CONNECTOR} (operación clima_actual)`);
  return call('GET', `/connectors/${connector.id}`);
}

async function ensureAgent(operationId, provider, model) {
  const mine = await call('GET', '/agents?scope=mine');
  let agent = mine.find((a) => a.name === AGENT);
  if (agent) {
    await call('PATCH', `/agents/${agent.id}`, { provider, model });
    ok(`Agente existente: ${AGENT}`);
  } else {
    agent = await call('POST', '/agents', {
      name: AGENT,
      description: 'Recomienda si despachar vehículos según el clima actual de la ciudad (demo).',
      provider,
      model,
      effort: 'low',
      profile: {
        role: 'Asistente de despacho de una empresa de transporte de carga en Colombia.',
        goals: [
          'Consultar el clima actual de la ciudad antes de recomendar un despacho.',
          'Recomendar DESPACHAR, DESPACHAR CON PRECAUCIÓN o POSPONER con una razón breve.',
        ],
        boundaries: ['No inventar datos del clima: usar siempre la herramienta.', 'Responder en máximo 3 líneas.'],
        tone: 'Directo y operativo',
        language: 'español',
      },
    });
    ok(`Agente creado: ${AGENT}`);
  }
  await call('PUT', `/agents/${agent.id}/tools`, { tools: [{ operationId, requiresApproval: false }] });
  return agent;
}

async function ensureWorkflow(operationId, agentId) {
  const definition = {
    nodes: [
      { id: 'inicio', type: 'trigger', name: 'Inicio manual', position: { x: 40, y: 160 }, config: {} },
      {
        id: 'clima',
        type: 'connector',
        name: 'Consultar clima',
        position: { x: 300, y: 160 },
        config: {
          operationId,
          input: { latitude: '{{ input.latitude }}', longitude: '{{ input.longitude }}' },
          retries: 1,
        },
      },
      {
        id: 'despacho',
        type: 'agent',
        name: 'Recomendar despacho',
        position: { x: 560, y: 160 },
        config: {
          agentId,
          message:
            'Clima actual en {{ input.ciudad }}: {{ nodes.clima.output.data.current | json }}. ' +
            'Probabilidad de lluvia próximas horas: {{ nodes.clima.output.data.hourly.precipitation_probability | json }}. ' +
            '¿Recomiendas despachar hoy? Responde en 2 líneas.',
        },
      },
      {
        id: 'respuesta',
        type: 'output',
        name: 'Respuesta',
        position: { x: 820, y: 160 },
        config: {
          output: {
            ciudad: '{{ input.ciudad }}',
            temperatura_c: '{{ nodes.clima.output.data.current.temperature_2m }}',
            precipitacion_mm: '{{ nodes.clima.output.data.current.precipitation }}',
            viento_kmh: '{{ nodes.clima.output.data.current.wind_speed_10m }}',
            recomendacion: '{{ nodes.despacho.output.text }}',
          },
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'inicio', target: 'clima' },
      { id: 'e2', source: 'clima', target: 'despacho' },
      { id: 'e3', source: 'despacho', target: 'respuesta' },
    ],
  };
  const existing = (await call('GET', '/workflows')).find((w) => w.name === WORKFLOW);
  if (existing) {
    await call('PATCH', `/workflows/${existing.id}`, { definition });
    ok(`Flujo existente actualizado: ${WORKFLOW}`);
    return existing;
  }
  const wf = await call('POST', '/workflows', {
    name: WORKFLOW,
    description: 'Consulta el clima de una ciudad con un conector REST y pide al agente una recomendación de despacho.',
    definition,
  });
  ok(`Flujo creado: ${WORKFLOW}`);
  return wf;
}

async function main() {
  const { email, password } = credentials();
  step(`Iniciando sesión como ${email}`);
  try {
    token = (await call('POST', '/auth/login', { email, password })).accessToken;
  } catch (e) {
    if (e.status === 401) {
      fail('Contraseña incorrecta (¿la cambió en Mi cuenta?). Use: NEXO_EMAIL=… NEXO_PASSWORD=… npm run local:demo');
    }
    throw e;
  }
  ok('Sesión iniciada');

  const claude = anthropicConfigured();
  const provider = claude ? 'anthropic' : 'mock';
  const model = claude ? 'claude-opus-5-5' : 'mock-echo';
  console.log(
    claude
      ? `${c.d}IA: Claude (${model}) con su ANTHROPIC_API_KEY${c.x}`
      : `${c.y}IA: modelo simulado (agregue ANTHROPIC_API_KEY en apps/api/.env para usar Claude)${c.x}`,
  );

  step('1/4 Conector REST');
  const connector = await ensureConnector();
  const op = connector.operations.find((o) => o.key === 'clima_actual');
  const direct = await call('POST', `/connectors/${connector.id}/operations/${op.id}/invoke`, {
    input: { latitude: CITY.latitude, longitude: CITY.longitude },
  });
  if (!direct.ok) fail(`Open-Meteo respondió con error: ${JSON.stringify(direct).slice(0, 300)}`);
  const cur = direct.data.current;
  ok(`Llamada real a Open-Meteo: ${CITY.ciudad} ${cur.temperature_2m} °C, lluvia ${cur.precipitation} mm, viento ${cur.wind_speed_10m} km/h`);

  step('2/4 Agente con herramienta');
  const agent = await ensureAgent(op.id, provider, model);
  const tool = `${CONNECTOR.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24)}__clima_actual`;
  const question = claude
    ? `¿Puedo despachar hoy desde ${CITY.ciudad}? (lat ${CITY.latitude}, lon ${CITY.longitude})`
    : `/tool ${tool} ${JSON.stringify({ latitude: CITY.latitude, longitude: CITY.longitude })}`;
  console.log(`${c.d}Pregunta: ${question}${c.x}`);
  const chat = await call('POST', `/agents/${agent.id}/chat`, { message: question });
  const used = (chat.toolCalls ?? chat.steps ?? []).length;
  ok(`Respuesta del agente${used ? ` (usó ${used} herramienta/s)` : ''}:`);
  console.log(`  ${String(chat.text ?? chat.reply ?? JSON.stringify(chat)).slice(0, 600).replace(/\n/g, '\n  ')}`);

  step('3/4 Flujo');
  const wf = await ensureWorkflow(op.id, agent.id);

  step('4/4 Ejecutando el flujo (espera hasta 60 s)');
  const run = await call('POST', `/workflows/${wf.id}/run`, { input: CITY, wait: true });
  const status = run.status ?? run.execution?.status;
  if (status === 'SUCCEEDED') ok('Ejecución exitosa');
  else console.log(`${c.y}! Estado: ${status ?? 'en cola'}${c.x}`);
  if (run.output) console.log(JSON.stringify(run.output, null, 2).replace(/^/gm, '  '));
  if (run.error) console.log(`${c.r}  Error: ${run.error}${c.x}`);

  console.log(`\n${c.b}Abra en el navegador:${c.x}`);
  console.log(`  Agente (pruebe el chat):  ${WEB}/agents/${agent.id}`);
  console.log(`  Flujo (constructor):      ${WEB}/workflows/${wf.id}`);
  const execId = run.id ?? run.executionId ?? run.execution?.id;
  console.log(`  Ejecución (paso a paso):  ${execId ? `${WEB}/executions/${execId}` : `${WEB}/executions`}`);
  console.log(`  Conector:                 ${WEB}/connectors/${connector.id}`);
}

main().catch((e) => fail(e.message));
