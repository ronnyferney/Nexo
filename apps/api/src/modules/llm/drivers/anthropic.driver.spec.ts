import Anthropic from '@anthropic-ai/sdk';
import { AnthropicFoundry } from '@anthropic-ai/foundry-sdk';
import { AnthropicGoogleCloud } from '@anthropic-ai/google-cloud-sdk';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import { parseClaudeOptions } from '../llm-gateway.service';
import type { ConfigService } from '@nestjs/config';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpClientService } from '../../../common/http/http-client.service';
import {
  AnthropicDriver,
  claudeSdkClient,
  isCustomAnthropicEndpoint,
  providerErrorMessage,
  stripHistoricalThinking,
} from './anthropic.driver';

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
    expect(parseClaudeOptions({ channel: 'otro-canal' })).toBeNull();
    expect(parseClaudeOptions('vertex')).toBeNull();
    expect(parseClaudeOptions({ channel: 'foundry', resource: 'x'.repeat(500) })).toEqual({ channel: 'foundry' });
  });
});

describe('Razonamiento preservado: se descarta el de turnos ya cerrados del historial', () => {
  type Block = { type: string; [k: string]: unknown };
  const msg = (role: string, content: Block[]) =>
    ({ role, content }) as unknown as Parameters<typeof stripHistoricalThinking>[0][number];

  // Regresión: al cambiar el system prompt o las herramientas del agente entre turnos, la firma del bloque de
  // razonamiento guardado dejaba de validar y la API respondía «Invalid signature in thinking block».
  it('quita thinking y redacted_thinking de los mensajes del asistente, conservando texto y tool_use', () => {
    const history = [
      msg('user', [{ type: 'text', text: 'hola' }]),
      msg('assistant', [
        { type: 'thinking', thinking: 'razonando…', signature: 'firma-ligada-a-otro-prefijo' },
        { type: 'redacted_thinking', data: 'opaco' },
        { type: 'text', text: 'Hice la tarea.' },
        { type: 'tool_use', id: 'tu_1', name: 'listar', input: {} },
      ]),
      msg('user', [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' }]),
    ];

    const out = stripHistoricalThinking(history) as unknown as { role: string; content: Block[] }[];

    expect(out[1].content.map((b) => b.type)).toEqual(['text', 'tool_use']);
    // El resto del historial no se toca (mismas referencias: sin copias innecesarias).
    expect(out[0]).toBe(history[0]);
    expect(out[2]).toBe(history[2]);
    // No muta el original (la caché de prompts depende de un historial estable).
    expect((history[1] as unknown as { content: Block[] }).content).toHaveLength(4);
  });

  it('deja intactos los mensajes del asistente sin razonamiento y el contenido en texto plano', () => {
    const history = [
      msg('assistant', 'respuesta simple' as unknown as Block[]),
      msg('assistant', [{ type: 'text', text: 'sin thinking' }]),
    ];
    const out = stripHistoricalThinking(history);
    expect(out[0]).toBe(history[0]);
    expect(out[1]).toBe(history[1]);
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

  it('también en Bedrock, Claude Platform on AWS y el canje de Workload Identity Federation', async () => {
    const aws = async () => ({ accessKeyId: 'ASIA', secretAccessKey: 's', sessionToken: 't' });
    await blocked(
      driver.create({
        awsCredentials: aws,
        baseUrl: `http://127.0.0.1:${port}/anthropic`,
        claude: { channel: 'bedrock', region: 'us-east-1' },
      }),
    );
    await blocked(
      driver.create({
        awsCredentials: aws,
        baseUrl: `http://127.0.0.1:${port}`,
        claude: { channel: 'aws', region: 'us-west-2', workspaceId: 'wrkspc_01Ab' },
      }),
    );
    const err = (await driver.create({
      baseUrl: `http://127.0.0.1:${port}`,
      workloadIdentity: {
        federationRuleId: 'fdrl_1',
        organizationId: '00000000-0000-4000-8000-000000000000',
        identityToken: () => 'jwt',
      },
    }).verify!().catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(hits).toBe(0);
  });
});

describe('Conexiones sin claves: Workload Identity Federation y rol de IAM (L2, L3)', () => {
  interface Seen {
    method: string;
    url: string;
    headers: Headers;
    body: string;
  }
  /** `safeFetch` falso: registra cada solicitud y responde según `reply`. */
  function driverWith(reply: (r: Seen) => Response) {
    const seen: Seen[] = [];
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : null;
      const r: Seen = {
        method: init?.method ?? req?.method ?? 'GET',
        url: String(req ? req.url : input),
        headers: new Headers(init?.headers ?? req?.headers),
        body: typeof init?.body === 'string' ? init.body : '',
      };
      seen.push(r);
      return reply(r);
    }) as typeof fetch;
    return { driver: new AnthropicDriver({ safeFetch: () => fetchFn } as unknown as HttpClientService), seen };
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const models = {
    data: [{ type: 'model', id: 'claude-opus-5-5', display_name: 'Opus', created_at: '2026-09-01T00:00:00Z' }],
    has_more: false,
    first_id: 'claude-opus-5-5',
    last_id: 'claude-opus-5-5',
  };
  const wif = (identityToken: () => string) => ({
    federationRuleId: 'fdrl_01Regla',
    organizationId: '00000000-0000-4000-8000-000000000000',
    serviceAccountId: 'svac_01Cuenta',
    workspaceId: 'wrkspc_01Ws',
    identityToken,
  });

  it('WIF: canjea la aserción de Nexo (RFC 7523) y usa el token como Bearer, en caché hasta su expiración', async () => {
    const { driver, seen } = driverWith((r) =>
      r.url.endsWith('/v1/oauth/token')
        ? json({
            access_token: 'sk-ant-oat01-federado',
            token_type: 'Bearer',
            expires_in: 600,
            scope: 'workspace:inference',
          })
        : json(models),
    );
    let minted = 0;
    const client = driver.create({ workloadIdentity: wif(() => `jwt-${++minted}`) });
    await client.verify!();
    await client.verify!();
    const exchanges = seen.filter((r) => r.url.endsWith('/v1/oauth/token'));
    expect(exchanges).toHaveLength(1);
    expect(minted).toBe(1);
    expect(exchanges[0].url).toBe('https://api.anthropic.com/v1/oauth/token');
    expect(JSON.parse(exchanges[0].body)).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: 'jwt-1',
      federation_rule_id: 'fdrl_01Regla',
      organization_id: '00000000-0000-4000-8000-000000000000',
      service_account_id: 'svac_01Cuenta',
      workspace_id: 'wrkspc_01Ws',
    });
    expect(exchanges[0].headers.get('anthropic-beta')).toContain('oidc-federation-2026-04-01');
    const calls = seen.filter((r) => r.url.includes('/v1/models'));
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.headers.get('authorization')).toBe('Bearer sk-ant-oat01-federado');
      expect(c.headers.get('x-api-key')).toBeNull();
      expect(c.headers.get('anthropic-beta')).toContain('oauth-2025-04-20');
    }
  });

  it('WIF: un rechazo del intercambio se explica sin el cuerpo de la respuesta', async () => {
    const { driver } = driverWith(() =>
      json({ type: 'error', error: { type: 'authentication_error', message: 'Authentication failed' } }, 401),
    );
    const err = (await driver.create({ workloadIdentity: wif(() => 'jwt') }).verify!().catch(
      (e: unknown) => e,
    )) as Error;
    expect(err.name).toBe('KeylessAuthError');
    expect(err.message).toMatch(/identidad federada.*HTTP 401/);
  });

  /** Credenciales temporales del rol asumido (las entrega `AwsRoleService`). */
  const role = async () => ({
    accessKeyId: 'ASIAROLE0001',
    secretAccessKey: 'secreto-temporal',
    sessionToken: 'sesion-temporal',
    expiration: new Date(Date.now() + 3600_000),
  });

  it('Bedrock: SigV4 con el servicio bedrock-mantle y el token de sesión, sin tomar un Bearer del entorno', async () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = 'bedrock-api-key-del-entorno';
    try {
      const { driver, seen } = driverWith(() => json({ input_tokens: 3 }));
      await driver.create({
        baseUrl: 'https://bedrock-mantle.us-east-1.api.aws/anthropic',
        awsCredentials: role,
        claude: { channel: 'bedrock', region: 'us-east-1' },
      }).verify!();
      expect(seen).toHaveLength(1);
      expect(seen[0].url).toBe('https://bedrock-mantle.us-east-1.api.aws/anthropic/v1/messages/count_tokens');
      expect((JSON.parse(seen[0].body) as { model: string }).model).toBe('anthropic.claude-haiku-5-5');
      expect(seen[0].headers.get('authorization')).toMatch(
        /^AWS4-HMAC-SHA256 Credential=ASIAROLE0001\/\d{8}\/us-east-1\/bedrock-mantle\/aws4_request/,
      );
      expect(seen[0].headers.get('x-amz-security-token')).toBe('sesion-temporal');
    } finally {
      delete process.env.AWS_BEARER_TOKEN_BEDROCK;
    }
  });

  it('Claude Platform on AWS: SigV4 con aws-external-anthropic, cabecera de workspace y API de modelos', async () => {
    const { driver, seen } = driverWith(() => json(models));
    const ids = await driver.create({
      baseUrl: 'https://aws-external-anthropic.us-west-2.api.aws',
      awsCredentials: role,
      claude: { channel: 'aws', region: 'us-west-2', workspaceId: 'wrkspc_01Aws' },
    }).listModels!();
    expect(ids).toEqual(['claude-opus-5-5']);
    expect(seen[0].url).toMatch(/^https:\/\/aws-external-anthropic\.us-west-2\.api\.aws\/v1\/models/);
    expect(seen[0].headers.get('anthropic-workspace-id')).toBe('wrkspc_01Aws');
    expect(seen[0].headers.get('authorization')).toMatch(/\/us-west-2\/aws-external-anthropic\/aws4_request/);
  });

  it('exige el rol, la región y el workspace en los canales de AWS; los hosts oficiales no son un proxy', () => {
    expect(() => claudeSdkClient({ claude: { channel: 'bedrock', region: 'us-east-1' } })).toThrow(/rol de IAM/);
    expect(() => claudeSdkClient({ awsCredentials: role, claude: { channel: 'bedrock' } })).toThrow(/región/);
    expect(() => claudeSdkClient({ awsCredentials: role, claude: { channel: 'aws', region: 'us-west-2' } })).toThrow(
      /workspace/,
    );
    expect(isCustomAnthropicEndpoint('https://bedrock-mantle.us-east-1.api.aws/anthropic', 'bedrock')).toBe(false);
    expect(isCustomAnthropicEndpoint('https://aws-external-anthropic.us-west-2.api.aws', 'aws')).toBe(false);
    expect(isCustomAnthropicEndpoint('https://bedrock-mantle.evil.example.com/anthropic', 'bedrock')).toBe(true);
  });
});
