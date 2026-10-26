import { defineConfig, devices } from '@playwright/test';

/**
 * Configuración Playwright de la suite e2e de Nexo (RX-13).
 *
 * Requisitos de entorno (ver README.md):
 *  - API en http://localhost:3000/api con `CONNECTOR_ALLOW_PRIVATE_NETWORKS=true` y el proveedor LLM `mock`.
 *  - Web en http://localhost:4200 (proxy /api -> :3000).
 *  - Postgres (5432) y Redis (6379) levantados.
 *  - Chromium preinstalado: `PLAYWRIGHT_BROWSERS_PATH` o `CHROME_BIN` apuntando al binario del contenedor.
 *
 * Cada prueba crea su propio usuario/workspace (correo único) para ser independiente.
 */
const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://localhost:4200';
const chromeBin = process.env['CHROME_BIN'];

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  // Amplio para absorber la espera del limitador de alta de usuarios (10/min por IP): una prueba puede tener que
  // aguardar a que se libere la ventana antes de registrar su usuario. El trabajo efectivo de cada prueba es rápido.
  timeout: 150_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // Limitamos la concurrencia: con demasiados workers, el registro + alta de agente + streaming del LLM mock en
  // paralelo saturan la API de pruebas y producen timeouts intermitentes. Dos workers dan una suite estable.
  workers: process.env['PW_WORKERS'] ? Number(process.env['PW_WORKERS']) : 2,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // El vídeo requiere el binario ffmpeg (no siempre presente en el contenedor). Opt-in por entorno.
    video: process.env['E2E_VIDEO'] === 'true' ? 'retain-on-failure' : 'off',
    // En el contenedor no existe un display; Chromium corre sin sandbox como root.
    launchOptions: {
      ...(chromeBin ? { executablePath: chromeBin } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
  projects: [
    {
      name: 'escritorio',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'movil',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
  ],
});
