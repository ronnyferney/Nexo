import Anthropic from '@anthropic-ai/sdk';
import { AnthropicFoundry } from '@anthropic-ai/foundry-sdk';
import { AnthropicGoogleCloud } from '@anthropic-ai/google-cloud-sdk';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import { parseClaudeOptions } from '../llm-gateway.service';
import type { ConfigService } from '@nestjs/config';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpClientService } from '../../../common/http/http-client.service';
import { AnthropicDriver, claudeSdkClient, isCustomAnthropicEndpoint, providerErrorMessage } from './anthropic.driver';

describe('Driver de Claude por canal', () => {
  const token = () => Promise.resolve('token-google');

  it('elige el cliente oficial de cada canal', async () => {
    expect(await claudeSdkClient({ apiKey: 'sk-ant-x' })()).toBeInstanceOf(Anthropic);
    expect(
      await claudeSdkClient({
        getAccessToken: token,
        claude: { channel: 'google-cloud', project: 'mi-proyecto-123', workspaceId: 'wrkspc_abc1' },
      })(),
    ).toBeInstanceOf(AnthropicGoogleCloud);
    expect(
      await claudeSdkClient({ getAccessToken: token, claude: { channel: 'vertex', project: 'mi-proyecto-123' } })(),
    ).toBeInstanceOf(AnthropicVertex);
    expect(
      await claudeSdkClient({ apiKey: 'clave', claude: { channel: 'foundry', resource: 'mi-recurso' } })(),
    ).toBeInstanceOf(AnthropicFoundry);
  });

  it('Vertex AI crea un cliente por solicitud con el token vigente', async () => {
    let n = 0;
    const factory = claudeSdkClient({
      getAccessToken: () => Promise.resolve(`token-${++n}`),
      claude: { channel: 'vertex', project: 'mi-proyecto-123', region: 'global' },
    });
    const a = await factory();
    const b = await factory();
    expect(a).not.toBe(b);
    expect(n).toBe(2);
  });

  it('exige los datos de cada canal y nunca acepta Google Cloud o Vertex sin inicio de sesión', () => {
    expect(() => claudeSdkClient({})).toThrow(/API key/);
    expect(() => claudeSdkClient({ claude: { channel: 'google-cloud', project: 'p', workspaceId: 'w' } })).toThrow(
      /iniciar sesión con Google/,
    );
    expect(() => claudeSdkClient({ getAccessToken: token, claude: { channel: 'google-cloud', project: 'p' } })).toThrow(
      /workspace/,
    );
    expect(() => claudeSdkClient({ getAccessToken: token, claude: { channel: 'vertex' } })).toThrow(/proyecto/);
  });

  it('distingue los hosts oficiales de un proxy por canal', () => {
    expect(isCustomAnthropicEndpoint(undefined)).toBe(false);
    expect(isCustomAnthropicEndpoint('https://api.anthropic.com')).toBe(false);
    expect(isCustomAnthropicEndpoint('https://gateway.empresa.com')).toBe(true);
    expect(isCustomAnthropicEndpoint('https://claude.googleapis.com', 'google-cloud')).toBe(false);
    expect(isCustomAnthropicEndpoint('https://us-east5-aiplatform.googleapis.com/v1', 'vertex')).toBe(false);
    expect(isCustomAnthropicEndpoint('https://mi-recurso.services.ai.azure.com/anthropic', 'foundry')).toBe(false);
    expect(isCustomAnthropicEndpoint('https://evil.services.ai.azure.com.example.com', 'foundry')).toBe(true);
  });

  it('solo lee de driverOptions canales conocidos y campos de texto acotados', () => {
    expect(parseClaudeOptions({ channel: 'vertex', project: 'p', region: 'global', extra: 'x' })).toEqual({
      channel: 'vertex',
      project: 'p',
      region: 'global',
    });
    expect(parseClaudeOptions({ channel: 'bedrock' })).toBeNull();
    expect(parseClaudeOptions('vertex')).toBeNull();
    expect(parseClaudeOptions({ channel: 'foundry', resource: 'x'.repeat(500) })).toEqual({ channel: 'foundry' });
  });
});

describe('A1 · errores del proveedor sin el cuerpo crudo', () => {
  it('solo el mensaje con forma de la API de Anthropic; si no, el estado HTTP', () => {
    expect(
      providerErrorMessage({
        status: 401,
        error: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
      }),
    ).toBe('invalid x-api-key');
    // Respuesta de un servicio interno (p. ej. metadatos): nunca se devuelve su contenido.
    expect(providerErrorMessage({ status: 404, error: { secreto_interno: 'datos-de-red-privada' } })).toBe(
      'El proveedor respondió HTTP 404',
    );
    expect(providerErrorMessage({ status: 500, error: '<html>interno</html>' })).toBe(
      'El proveedor respondió HTTP 500',
    );
  });
});

describe('A1 · los SDK de Claude salen por la política de red de Nexo', () => {
  const strict = new HttpClientService({
    get: (k: string) => ({ 'http.timeoutMs': 5000, 'http.allowPrivateNetworks': false })[k],
  } as unknown as ConfigService);
  const driver = new AnthropicDriver(strict);
  // Servicio interno real: si el bloqueo fallara, recibiría la petición y su respuesta volvería al usuario.
  let hits = 0;
  let port = 0;
  const server = createServer((_req, res) => {
    hits++;
    res.end('{"secreto_interno":"datos-de-red-privada"}');
  });
  beforeAll(
    () =>
      new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', () => {
          port = (server.address() as AddressInfo).port;
          resolve();
        }),
      ),
  );
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  /** El error del SDK conserva como causa el bloqueo de la política de red. */
  async function blocked(client: { verify?: () => Promise<void> }) {
    const err = (await client.verify!().catch((e: unknown) => e)) as Error & { cause?: Error };
    expect(err).toBeInstanceOf(Error);
    expect(`${err.message} ${err.cause?.message ?? ''}`).toMatch(/bloquead/i);
  }

  it('loopback, metadatos de la nube e IPv6 mapeada en hexadecimal: bloqueados sin llegar al servicio', async () => {
    await blocked(driver.create({ apiKey: 'sk-ant-x', baseUrl: `http://127.0.0.1:${port}/#` }));
    await blocked(driver.create({ apiKey: 'sk-ant-x', baseUrl: `http://[::ffff:7f00:1]:${port}/` }));
    await blocked(driver.create({ apiKey: 'sk-ant-x', baseUrl: 'http://169.254.169.254/latest/meta-data/#' }));
    expect(hits).toBe(0);
  });

  it('también en los canales de Google y Foundry', async () => {
    await blocked(
      driver.create({
        getAccessToken: () => Promise.resolve('t'),
        baseUrl: `http://127.0.0.1:${port}/v1`,
        claude: { channel: 'vertex', project: 'mi-proyecto-123', region: 'global' },
      }),
    );
    await blocked(
      driver.create({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}/anthropic`, claude: { channel: 'foundry' } }),
    );
    expect(hits).toBe(0);
  });
});
