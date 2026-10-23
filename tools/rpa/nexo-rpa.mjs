#!/usr/bin/env node
/**
 * RPA de Nexo: abre Google Chrome (visible) y configura desde cero, solo con la interfaz, como lo haría una persona:
 *   1. Inicia sesión.
 *   2. Crea un conector REST (Open-Meteo, API pública sin claves), su operación «Clima actual» y la prueba.
 *   3. Crea un agente, elige el modelo y le asigna la operación como herramienta.
 *   4. Conversa con el agente (la herramienta hace la llamada real).
 *   5. Arma un flujo en el constructor visual conectando los nodos con el mouse, lo guarda y lo ejecuta.
 *   6. Abre el detalle de la ejecución.
 *
 *   npm run local:rpa                  (con Nexo corriendo: npm run local)
 *
 * Variables opcionales: NEXO_EMAIL / NEXO_PASSWORD (si cambió la contraseña del usuario maestro), NEXO_WEB_URL,
 * NEXO_RPA_SPEED (ms entre acciones, por defecto 250), NEXO_RPA_HEADLESS=1 (sin ventana), NEXO_RPA_BROWSER (ruta de
 * un Chrome/Chromium distinto), NEXO_RPA_VIDEO=<carpeta> (graba video .webm; requiere `npx playwright install ffmpeg`). Para grabar la pantalla en macOS: Cmd+Shift+5 antes de ejecutar.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = process.env.NEXO_WEB_URL ?? 'http://localhost:4200';
const WEATHER_URL = process.env.NEXO_DEMO_WEATHER_URL ?? 'https://api.open-meteo.com/v1';
const SPEED = Number(process.env.NEXO_RPA_SPEED ?? 250);
const HEADLESS = process.env.NEXO_RPA_HEADLESS === '1';
const VIDEO_DIR = process.env.NEXO_RPA_VIDEO;
const stamp = new Date().toTimeString().slice(0, 5).replace(':', '');
const CONNECTOR = `Clima Open-Meteo ${stamp}`;
const AGENT = `Coordinador de despachos ${stamp}`;
const FLOW = `Despacho según clima ${stamp}`;
const CITY = { ciudad: 'Bogotá', latitude: 4.711, longitude: -74.0721 };

const color = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', b: '\x1b[1m', x: '\x1b[0m' };
const results = [];
const check = (name, ok) => {
  results.push({ name, ok });
  console.log(`${ok ? `${color.g}✔` : `${color.r}✖`}${color.x} ${name}`);
};
const fail = (m) => {
  console.error(`${color.r}✖ ${m}${color.x}`);
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
  if (!email || !password) fail('Sin credenciales. Use: NEXO_EMAIL=su@correo NEXO_PASSWORD=su-clave npm run local:rpa');
  return { email, password };
}

const anthropic = (() => {
  const env = path.join(ROOT, 'apps', 'api', '.env');
  return existsSync(env) && /^ANTHROPIC_API_KEY=\S+/m.test(readFileSync(env, 'utf8'));
})();

/** Mismo nombre de tool que expone la API al modelo: <conector>__<operación> (agent-runtime.service.ts). */
function toolName(connectorName, opKey) {
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${slug(connectorName).slice(0, 24)}__${slug(opKey)}`.slice(0, 64);
}

async function launch() {
  const base = { headless: HEADLESS, slowMo: SPEED, args: ['--start-maximized'] };
  if (process.env.NEXO_RPA_BROWSER) return chromium.launch({ ...base, executablePath: process.env.NEXO_RPA_BROWSER });
  try {
    return await chromium.launch({ ...base, channel: 'chrome' });
  } catch {
    fail('No encontré Google Chrome. Instálelo (brew install --cask google-chrome) o indique NEXO_RPA_BROWSER.');
  }
}

async function main() {
  try {
    await fetch(WEB);
  } catch {
    fail(`Nexo no responde en ${WEB}. Ejecute primero: npm run local`);
  }
  const { email, password } = credentials();
  console.log(`${color.b}RPA de Nexo${color.x} · ${WEB} · usuario ${email} · IA: ${anthropic ? 'Claude' : 'simulada'}\n`);

  const browser = await launch();
  const size = { width: 1600, height: 960 };
  const context = await browser.newContext({
    viewport: HEADLESS || VIDEO_DIR ? size : null,
    ...(VIDEO_DIR ? { recordVideo: { dir: VIDEO_DIR, size } } : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const pause = (ms) => page.waitForTimeout(ms);

  async function caption(text, ms = 2200) {
    await page.evaluate((t) => {
      let el = document.getElementById('nx-rpa');
      if (!el) {
        el = document.createElement('div');
        el.id = 'nx-rpa';
        el.style.cssText =
          'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:1100px;z-index:99999;' +
          'background:rgba(17,20,38,.93);color:#fff;padding:12px 20px;border-radius:12px;font:500 18px/1.4 ' +
          'Inter,system-ui,sans-serif;text-align:center;pointer-events:none;box-shadow:0 10px 30px rgba(0,0,0,.3)';
        document.body.appendChild(el);
      }
      el.innerHTML = `<span style="opacity:.6">RPA ·</span> ${t}`;
    }, text);
    await pause(ms);
  }
  async function type(locator, text) {
    await locator.click();
    await locator.fill('');
    await locator.pressSequentially(text, { delay: 30 });
  }
  const node = (name) => page.locator('.node', { hasText: name }).first();
  async function moveNode(name, x, y) {
    const box = await node(name).boundingBox();
    const canvas = await page.locator('.canvas').boundingBox();
    await page.mouse.move(box.x + 30, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvas.x + x, canvas.y + y, { steps: 20 });
    await page.mouse.up();
  }
  async function connect(from, to) {
    const a = await node(from).locator('.port.out').boundingBox();
    const b = await node(to).locator('.port.in').boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
    await page.mouse.up();
  }
  async function nodeId(name) {
    await node(name).click();
    return (await page.locator('.inspector code').first().innerText()).trim();
  }

  // ---------- 1. Inicio de sesión ----------
  await page.goto(`${WEB}/login`);
  await caption('Configuración de Nexo desde cero, solo con la interfaz', 2500);
  await type(page.locator('input[type=email]'), email);
  await type(page.locator('input[type=password]'), password);
  await page.getByRole('button', { name: /Ingresar|Iniciar/ }).click();
  await page.waitForURL(`${WEB}/`).catch(() => fail('No se pudo iniciar sesión (¿cambió la contraseña? use NEXO_PASSWORD)'));
  check('Inicio de sesión', true);

  // ---------- 2. Conector REST ----------
  await caption('1. Crear un conector REST hacia Open-Meteo (API pública de clima, sin claves)');
  await page.getByRole('link', { name: 'Conectores' }).first().click();
  await page.getByRole('button', { name: /Nuevo conector/ }).click();
  await page.locator('button.type', { hasText: 'REST' }).first().click();
  await type(page.getByLabel('Nombre del conector'), CONNECTOR);
  await page.getByRole('button', { name: /^Crear$/ }).click();
  await page.waitForURL(/connectors\/c/);
  await caption('URL base del servicio');
  await type(page.getByPlaceholder('https://api.ejemplo.com/v1'), WEATHER_URL);
  await page.getByRole('button', { name: /Guardar cambios/ }).click();
  await pause(1200);

  await caption('2. Definir la operación «Clima actual»: método, ruta, parámetros y su esquema de entrada');
  await page.getByRole('tab', { name: /Operaciones/ }).click();
  await page.getByRole('button', { name: /Nueva operación/ }).click();
  const opCard = page.locator('.card').filter({ has: page.getByPlaceholder('buscar_cliente') }).first();
  await type(opCard.getByPlaceholder('buscar_cliente'), 'clima_actual');
  await type(opCard.locator('.field', { hasText: /^Nombre/ }).locator('input'), 'Clima actual');
  await type(
    opCard.locator('.field', { hasText: 'Descripción' }).locator('textarea'),
    'Temperatura, lluvia y viento actuales para unas coordenadas. Úsala antes de recomendar un despacho.',
  );
  const editors = opCard.locator('nx-json-editor textarea');
  await editors.nth(0).fill(
    JSON.stringify(
      {
        method: 'GET',
        path: '/forecast',
        query: {
          latitude: '{{ input.latitude }}',
          longitude: '{{ input.longitude }}',
          current: 'temperature_2m,precipitation,wind_speed_10m',
          timezone: 'America/Bogota',
        },
      },
      null,
      2,
    ),
  );
  await editors.nth(1).fill(
    JSON.stringify(
      {
        type: 'object',
        required: ['latitude', 'longitude'],
        properties: { latitude: { type: 'number' }, longitude: { type: 'number' } },
      },
      null,
      2,
    ),
  );
  await pause(800);
  await page.getByRole('button', { name: /Guardar operación/ }).click();
  await page.locator('.op-item', { hasText: 'Clima actual' }).first().waitFor();
  await page.locator('.op-item', { hasText: 'Clima actual' }).first().click();
  await caption('3. Probar la operación con las coordenadas de Bogotá');
  await page.locator('.card', { hasText: 'Probar operación' }).locator('textarea').first()
    .fill(JSON.stringify({ latitude: CITY.latitude, longitude: CITY.longitude }));
  await page.getByRole('button', { name: /^Ejecutar$/ }).click();
  const opOk = await page.locator('text=temperature_2m').first().waitFor({ timeout: 20000 }).then(() => true, () => false);
  check('Conector REST creado y operación probada (respuesta real del servicio)', opOk);
  await caption('Respuesta del servicio: temperatura, lluvia y viento', 2500);

  // ---------- 3. Agente ----------
  await caption('4. Crear el agente y darle la herramienta');
  await page.getByRole('link', { name: 'Agentes' }).first().click();
  await page.getByRole('link', { name: /Crear agente/ }).first().click();
  await page.waitForURL(/agents\/new/);
  const expert = page.getByRole('button', { name: /Prefiero crearlo vacío/ });
  if (await expert.isVisible().catch(() => false)) await expert.click();
  await type(page.locator('#new-name'), AGENT);
  await page.getByRole('button', { name: /^Crear agente/ }).click();
  await page.waitForURL(/agents\/c/);
  await page.locator('#agent-name').waitFor();
  const role = page.getByLabel(/^Rol/).first();
  if (await role.isVisible().catch(() => false)) {
    await type(role, 'Coordinador de despachos de una empresa de transporte de carga en Colombia.');
  }
  await caption(anthropic ? 'Modelo: Claude' : 'Modelo: simulado (sin ANTHROPIC_API_KEY)');
  await page.getByRole('tab', { name: 'Modelo' }).click();
  await page.locator('#agent-provider').selectOption({ value: anthropic ? 'anthropic' : 'mock' });
  await pause(500);
  await page.locator('#agent-model').selectOption({ value: anthropic ? 'claude-opus-5-5' : 'mock-echo' });
  await page.getByRole('tab', { name: /Herramientas/ }).click();
  const group = page.locator('.connector-group', { hasText: CONNECTOR }).first();
  await group.scrollIntoViewIfNeeded();
  await group.locator('.op-row', { hasText: 'Clima actual' }).locator('input[type=checkbox]').first().check();
  await page.getByRole('button', { name: /^Guardar/ }).click();
  await pause(1500);
  check('Agente creado con su herramienta', !(await page.getByRole('button', { name: /^Guardar/ }).isEnabled()));

  // ---------- 4. Conversación ----------
  await caption('5. Conversar con el agente: consulta el clima con su herramienta');
  const question = anthropic
    ? `¿Puedo despachar hoy desde ${CITY.ciudad}? Coordenadas ${CITY.latitude}, ${CITY.longitude}`
    : `/tool ${toolName(CONNECTOR, 'clima_actual')} ${JSON.stringify({ latitude: CITY.latitude, longitude: CITY.longitude })}`;
  await type(page.locator('#chat-input'), question);
  await page.locator('#chat-input').press('Enter');
  const chatOk = await page.locator('text=/clima_actual|Clima actual/').nth(1).waitFor({ timeout: 60000 })
    .then(() => true, () => false);
  await pause(2500);
  check('El agente usó la herramienta en la conversación', chatOk);

  // ---------- 5. Flujo ----------
  await caption('6. Armar el flujo en el constructor visual');
  await page.getByRole('link', { name: 'Flujos' }).first().click();
  await type(page.getByPlaceholder('Nombre del nuevo flujo'), FLOW);
  await page.getByRole('button', { name: /^Crear flujo/ }).click();
  await page.waitForURL(/workflows\/c/);
  await node('Inicio').waitFor();
  await moveNode('Inicio', 60, 140);
  async function add(type_, name, x, y) {
    await page.locator('.palette-item', { hasText: type_ }).first().click();
    await type(page.locator('.inspector .field', { hasText: 'Nombre' }).locator('input').first(), name);
    await moveNode(name, x, y);
  }
  await add('Conector', 'Consultar clima', 450, 140);
  await page.locator('.inspector select').first().selectOption({ label: 'Clima actual' });
  await page.locator('.inspector nx-json-editor textarea').first().fill(
    JSON.stringify({ latitude: '{{ input.latitude }}', longitude: '{{ input.longitude }}' }, null, 2),
  );
  await add('Agente IA', 'Recomendar despacho', 60, 340);
  await page.locator('.inspector select').first().selectOption({ label: AGENT });
  await add('Respuesta', 'Resultado', 450, 340);

  await caption('Conectar los nodos con el mouse: de la salida de uno a la entrada del siguiente');
  await connect('Inicio', 'Consultar clima');
  await connect('Consultar clima', 'Recomendar despacho');
  await connect('Recomendar despacho', 'Resultado');
  const edges = await page.locator('path.edge').count();
  check(`Flujo con ${edges} conexiones hechas con el mouse`, edges >= 3);

  await caption('Mapear datos entre pasos con plantillas {{ … }}');
  const climaId = await nodeId('Consultar clima');
  const agenteId = await nodeId('Recomendar despacho');
  await page.locator('.inspector textarea').first().fill(
    `Clima en {{ input.ciudad }}: {{ nodes.${climaId}.output.data.current | json }}. ` +
      '¿Recomiendas despachar hoy? Responde en 2 líneas.',
  );
  await node('Resultado').click();
  await page.locator('.inspector nx-json-editor textarea').first().fill(
    JSON.stringify(
      {
        ciudad: '{{ input.ciudad }}',
        temperatura_c: `{{ nodes.${climaId}.output.data.current.temperature_2m }}`,
        lluvia_mm: `{{ nodes.${climaId}.output.data.current.precipitation }}`,
        viento_kmh: `{{ nodes.${climaId}.output.data.current.wind_speed_10m }}`,
        recomendacion: `{{ nodes.${agenteId}.output.text }}`,
      },
      null,
      2,
    ),
  );
  await page.getByRole('button', { name: /^Guardar/ }).click();
  await pause(1500);
  check('Flujo guardado', (await page.locator('text=cambios sin guardar').count()) === 0);

  // ---------- 6. Ejecución ----------
  await caption('7. Ejecutar el flujo con Bogotá como entrada');
  await page.getByRole('button', { name: 'Ejecutar' }).first().click();
  await page.locator('.inspector nx-json-editor textarea').first().fill(JSON.stringify(CITY, null, 2));
  await page.getByRole('button', { name: /Ejecutar ahora/ }).click();
  await page.locator('.inspector .step').nth(3).waitFor({ timeout: 60000 }).catch(() => {});
  await pause(2500);
  const steps = await page.locator('.inspector .step').allInnerTexts();
  check(`Ejecución con ${steps.length}/4 pasos`, steps.length === 4 && steps.every((s) => s.startsWith('OK')));
  await caption('8. Detalle de la ejecución: estado, tiempos, entrada y salida de cada paso');
  await page.getByRole('link', { name: 'Ver detalle' }).click();
  await page.waitForURL(/executions\//);
  await pause(4000);

  const failed = results.filter((r) => !r.ok).length;
  await caption(failed ? `Terminó con ${failed} paso(s) a revisar` : 'Configuración completa: conector, agente y flujo', 3000);
  console.log(`\n${failed ? color.y : color.g}${results.length - failed}/${results.length} comprobaciones correctas${color.x}`);
  console.log(`Ejecución: ${page.url()}`);

  if (!HEADLESS && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    await rl.question('\nRevise el navegador. Presione Enter para cerrarlo… ');
    rl.close();
  }
  await context.close();
  await browser.close();
  if (VIDEO_DIR) console.log(`Video guardado en ${VIDEO_DIR}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => fail(e.message));
