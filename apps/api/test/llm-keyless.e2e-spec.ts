import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createPublicKey, randomBytes, verify as cryptoVerify, type JsonWebKey } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { Api, createTestApp, llmOAuthCookie, prismaOf } from './utils/app';
import { addMember, chat, createAgent, registerOwner, type Session } from './utils/fixtures';
import { ClaudeMessagesMock, StsMock, type RecordedRequest } from './utils/mock-servers';

const ISSUER = 'https://nexo-e2e.example.com/api/oidc';
const PRINCIPAL = 'arn:aws:iam::999999999999:role/nexo-platform';
const ROLE_ARN = 'arn:aws:iam::123456789012:role/nexo-claude';
const WIF_FIELDS = {
  federationRuleId: 'fdrl_01ReglaE2E',
  serviceAccountId: 'svac_01CuentaE2E',
  organizationId: '00000000-0000-4000-8000-0000000000e2',
  anthropicWorkspaceId: 'wrkspc_01WsE2E',
};

type Jwks = { keys: (JsonWebKey & { kid: string; alg: string })[] };

/**
 * Lado de Anthropic del intercambio (platform.claude.com/docs/en/manage-claude/wif-reference): verifica la aserción con
 * el JWKS publicado por Nexo (por `kid`), `iss` exacto, audiencia y sujeto de la regla, vida ≤ 1 hora, `jti` de un solo
 * uso, y los ids de la regla; responde como RFC 6749 §5.1 o con el 401 opaco.
 */
class AnthropicWifVerifier {
  jwks: Jwks = { keys: [] };
  subject = '';
  readonly jtis = new Set<string>();
  readonly assertions: Record<string, unknown>[] = [];
  issued = 0;

  exchange = (body: Record<string, unknown> | undefined, headers: Record<string, unknown>) => {
    const denied = {
      status: 401,
      body: { type: 'error', error: { type: 'authentication_error', message: 'Authentication failed' } },
    };
    if (!String(headers['anthropic-beta'] ?? '').includes('oidc-federation-2026-04-01')) return denied;
    if (body?.grant_type !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') return denied;
    if (body.federation_rule_id !== WIF_FIELDS.federationRuleId) return denied;
    if (body.service_account_id !== WIF_FIELDS.serviceAccountId) return denied;
    if (body.organization_id !== WIF_FIELDS.organizationId || body.workspace_id !== WIF_FIELDS.anthropicWorkspaceId)
      return denied;
    const [h, p, s] = String(body.assertion ?? '').split('.');
    if (!h || !p || !s) return denied;
    const header = JSON.parse(Buffer.from(h, 'base64url').toString()) as { alg: string; kid?: string };
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown>;
    const jwk = this.jwks.keys.find((k) => k.kid === header.kid);
    if (!jwk || !/^(RS|ES)\d{3}$/.test(header.alg)) return denied;
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    const ok = cryptoVerify(
      `sha${header.alg.slice(2)}`,
      Buffer.from(`${h}.${p}`),
      header.alg.startsWith('ES') ? { key, dsaEncoding: 'ieee-p1363' } : key,
      Buffer.from(s, 'base64url'),
    );
    const now = Math.floor(Date.now() / 1000);
    const iat = Number(claims.iat);
    const exp = Number(claims.exp);
    if (!ok || claims.iss !== ISSUER || claims.aud !== 'https://api.anthropic.com' || claims.sub !== this.subject)
      return denied;
    if (!(iat <= now + 30) || !(exp > now - 30) || exp - iat > 3600) return denied;
    const jti = String(claims.jti ?? '');
    if (!jti || this.jtis.has(jti)) return denied;
    this.jtis.add(jti);
    this.assertions.push(claims);
    this.issued++;
    return {
      status: 200,
      body: {
        access_token: `sk-ant-oat01-e2e-${this.issued}`,
        token_type: 'Bearer',
        expires_in: 600,
        scope: 'workspace:inference',
      },
    };
  };
}

/** OpenRouter mínimo para el uso único del `state` entre réplicas: canje PKCE y verificación de la clave. */
class OpenRouterExchangeMock {
  private server?: Server;
  port = 0;
  readonly codes = new Map<string, string>();
  readonly keys = new Set<string>();
  exchanges = 0;

  get origin() {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        const path = new URL(req.url ?? '/', this.origin).pathname;
        const send = (status: number, payload: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(payload));
        };
        if (path === '/api/v1/auth/keys') {
          this.exchanges++;
          const body = raw ? (JSON.parse(raw) as Record<string, string>) : {};
          const challenge = this.codes.get(body.code ?? '');
          this.codes.delete(body.code ?? '');
          const computed = createHash('sha256')
            .update(body.code_verifier ?? '')
            .digest('base64url');
          if (!challenge || computed !== challenge) return send(400, { error: { message: 'Invalid code' } });
          const key = `sk-or-v1-e2e-${randomBytes(6).toString('hex')}`;
          this.keys.add(key);
          return send(200, { key });
        }
        const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
        if (path === '/api/v1/key') return this.keys.has(bearer) ? send(200, { data: {} }) : send(401, {});
        if (path === '/api/v1/models') return send(200, { data: [{ id: 'openai/gpt-x' }] });
        return send(404, {});
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  async stop() {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  /** Consentimiento simulado: devuelve el `code` y el `state` que llegarían al callback. */
  authorize(authorizeUrl: string): { code: string; state: string } {
    const url = new URL(authorizeUrl);
    const callback = new URL(url.searchParams.get('callback_url')!);
    const code = `code-${randomBytes(6).toString('hex')}`;
    this.codes.set(code, url.searchParams.get('code_challenge')!);
    return { code, state: callback.searchParams.get('state')! };
  }
}

const header = (r: RecordedRequest, name: string) => r.headers[name] as string | undefined;

describe('Conexiones Claude sin claves: Workload Identity Federation y rol de IAM (E2E, L2/L3)', () => {
  let app: INestApplication;
  let claude: ClaudeMessagesMock;
  let sts: StsMock;
  let owner: Session;
  let editor: Session;
  let other: Session;
  const wif = new AnthropicWifVerifier();
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    // Credenciales de AWS de la plataforma (cadena estándar del SDK): aquí, variables de entorno ficticias.
    process.env.AWS_ACCESS_KEY_ID = 'AKIAPLATAFORMAE2E';
    process.env.AWS_SECRET_ACCESS_KEY = 'secreto-de-la-plataforma-e2e';
    delete process.env.AWS_PROFILE;
    delete process.env.AWS_SESSION_TOKEN;

    claude = await new ClaudeMessagesMock().start();
    claude.oauthToken = wif.exchange;
    sts = await new StsMock().start();
    app = await createTestApp();
    const config = app.get(ConfigService);
    config.set('llm.wif.issuer', ISSUER);
    config.set('llm.aws.principalArn', PRINCIPAL);
    config.set('llm.aws.stsEndpoint', sts.origin);
    config.set('llm.providerUrlOverrides', {
      anthropic: claude.origin,
      'claude-bedrock': `${claude.origin}/anthropic`,
      'claude-aws': claude.origin,
    });
    owner = await registerOwner(app, 'sin-claves');
    editor = await addMember(app, owner, { role: 'EDITOR' });
    other = await registerOwner(app, 'sin-claves-otro');
    wif.subject = `nexo:workspace:${owner.workspaceId}`;
  });

  afterAll(async () => {
    process.env = savedEnv;
    await app?.close();
    await claude?.stop();
    await sts?.stop();
  });

  describe('Emisor OIDC de Nexo (público)', () => {
    it('publica el descubrimiento y el JWKS sin autenticación, con caché y sin material privado', async () => {
      const disc = await request(app.getHttpServer()).get('/api/oidc/.well-known/openid-configuration').expect(200);
      expect(disc.body).toMatchObject({ issuer: ISSUER, jwks_uri: `${ISSUER}/jwks` });
      expect(disc.headers['cache-control']).toContain('max-age');
      const jwks = await request(app.getHttpServer()).get('/api/oidc/jwks').expect(200);
      const body = jwks.body as Jwks;
      expect(body.keys.length).toBeGreaterThan(0);
      for (const k of body.keys) {
        expect(k.kid).toBeTruthy();
        expect(k).not.toHaveProperty('d');
      }
      // Anthropic lee las claves del JWKS publicado (modo `discovery`).
      wif.jwks = body;
    });
  });

  describe('L2 · Workload Identity Federation con la API de Anthropic', () => {
    it('prepara el registro del emisor: URL, audiencia y sujeto del workspace (solo ADMIN+)', async () => {
      await editor.api
        .post('/admin/llm/providers/anthropic/keyless/prepare', { mechanism: 'WORKLOAD_IDENTITY' })
        .expect(403);
      const res = await owner.api
        .post('/admin/llm/providers/anthropic/keyless/prepare', { mechanism: 'WORKLOAD_IDENTITY' })
        .expect(200);
      expect(res.body).toMatchObject({
        mechanism: 'WORKLOAD_IDENTITY',
        issuerUrl: ISSUER,
        discoveryUrl: `${ISSUER}/.well-known/openid-configuration`,
        jwksUrl: `${ISSUER}/jwks`,
        audience: 'https://api.anthropic.com',
        subject: `nexo:workspace:${owner.workspaceId}`,
        suggestedScope: 'workspace:inference',
      });
      expect((res.body as { steps: string[] }).steps.length).toBeGreaterThan(2);
      const list = (await owner.api.get('/admin/llm/providers').expect(200)).body as {
        providers: { id: string; mechanisms: { type: string; available: boolean }[] }[];
      };
      const anthropic = list.providers.find((p) => p.id === 'anthropic')!;
      expect(anthropic.mechanisms.find((m) => m.type === 'WORKLOAD_IDENTITY')).toMatchObject({ available: true });
    });

    it('una regla que no coincide no crea la conexión y explica el motivo', async () => {
      const res = await owner.api
        .post('/admin/llm/providers/anthropic/connect', {
          mechanism: 'WORKLOAD_IDENTITY',
          fields: { ...WIF_FIELDS, federationRuleId: 'fdrl_01OtraRegla' },
        })
        .expect(400);
      expect((res.body as { message: string }).message).toMatch(/identidad federada/);
      expect(await prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
    });

    it('otro workspace no puede usar la regla de este (el sujeto lo ata al workspace de Nexo)', async () => {
      await other.api
        .post('/admin/llm/providers/anthropic/connect', { mechanism: 'WORKLOAD_IDENTITY', fields: WIF_FIELDS })
        .expect(400);
      expect(await prismaOf(app).llmConnection.count({ where: { workspaceId: other.workspaceId } })).toBe(0);
    });

    it('conecta sin clave, el agente conversa con el token federado y el token se reutiliza hasta su expiración', async () => {
      const before = wif.issued;
      const res = await owner.api
        .post('/admin/llm/providers/anthropic/connect', {
          mechanism: 'WORKLOAD_IDENTITY',
          fields: WIF_FIELDS,
          models: ['claude-opus-5-5'],
        })
        .expect(201);
      const { connection } = res.body as { connection: { id: string; hasApiKey: boolean; keyless: { type: string } } };
      expect(connection).toMatchObject({ hasApiKey: false, keyless: { type: 'WORKLOAD_IDENTITY' } });
      const row = await prismaOf(app).llmConnection.findUniqueOrThrow({ where: { id: connection.id } });
      expect(row.apiKeyCipher).toBeNull();
      expect(row.driverOptions).toMatchObject({
        keyless: {
          type: 'WORKLOAD_IDENTITY',
          federationRuleId: WIF_FIELDS.federationRuleId,
          serviceAccountId: WIF_FIELDS.serviceAccountId,
          organizationId: WIF_FIELDS.organizationId,
          workspaceId: WIF_FIELDS.anthropicWorkspaceId,
        },
      });
      expect(JSON.stringify(row)).not.toContain('sk-ant-oat01');

      const agent = await createAgent(owner, { provider: connection.id, model: 'claude-opus-5-5' });
      expect((await chat(owner, agent.id, 'Hola federado')).text).toBe('Hola desde Claude simulado');
      expect((await chat(owner, agent.id, 'Otra vez')).text).toBe('Hola desde Claude simulado');
      // Un canje para la prueba de conexión y otro para el cliente del agente, que lo reutiliza en ambas conversaciones.
      expect(wif.issued - before).toBe(2);
      const sent = claude.messageRequests().slice(-2);
      expect(sent.map((r) => header(r, 'authorization'))).toEqual([
        `Bearer sk-ant-oat01-e2e-${wif.issued}`,
        `Bearer sk-ant-oat01-e2e-${wif.issued}`,
      ]);
      expect(header(sent[0], 'x-api-key')).toBeUndefined();
      // Cada aserción es nueva (jti único) y de vida corta.
      const last = wif.assertions.slice(-2);
      expect(new Set(last.map((a) => a.jti)).size).toBe(2);
      for (const a of last) expect(Number(a.exp) - Number(a.iat)).toBeLessThanOrEqual(600);
    });

    it('sin un emisor público https (p. ej. localhost) el mecanismo no está disponible', async () => {
      const config = app.get(ConfigService);
      config.set('llm.wif.issuer', 'http://localhost:3000/api/oidc');
      try {
        const res = await owner.api
          .post('/admin/llm/providers/anthropic/keyless/prepare', { mechanism: 'WORKLOAD_IDENTITY' })
          .expect(400);
        expect((res.body as { message: string }).message).toMatch(/443/);
        await owner.api
          .post('/admin/llm/providers/anthropic/connect', { mechanism: 'WORKLOAD_IDENTITY', fields: WIF_FIELDS })
          .expect(400);
      } finally {
        config.set('llm.wif.issuer', ISSUER);
      }
    });
  });

  describe('L3 · Claude en AWS con rol de IAM + ExternalId', () => {
    const prepare = async (provider: string, s: Session = owner) =>
      (await s.api.post(`/admin/llm/providers/${provider}/keyless/prepare`, { mechanism: 'AWS_ROLE' }).expect(200))
        .body as {
        externalId: string;
        setupToken: string;
        principalArn: string;
        trustPolicy: { Statement: { Principal: { AWS: string }; Condition: Record<string, Record<string, string>> }[] };
        permissionsPolicy: unknown;
      };

    it('genera un ExternalId único por conexión con la política de confianza para el cliente', async () => {
      const a = await prepare('claude-bedrock');
      const b = await prepare('claude-bedrock');
      expect(a.externalId).toMatch(/^nexo-[A-Za-z0-9_-]{32}$/);
      expect(a.externalId).not.toBe(b.externalId);
      expect(a.principalArn).toBe(PRINCIPAL);
      expect(a.trustPolicy.Statement[0].Principal.AWS).toBe(PRINCIPAL);
      expect(a.trustPolicy.Statement[0].Condition.StringEquals['sts:ExternalId']).toBe(a.externalId);
      expect(JSON.stringify(a.permissionsPolicy)).toContain('bedrock-mantle:CreateInference');
    });

    it('Bedrock: asume el rol con STS, firma con SigV4 y cachea las credenciales temporales', async () => {
      const setup = await prepare('claude-bedrock');
      sts.roles.set(ROLE_ARN, setup.externalId);
      const stsBefore = sts.assumeRoleRequests().length;
      // Un rol SigV4 válido para el simulador de Claude: credenciales temporales emitidas por STS.
      claude.authorize = (h) =>
        /^AWS4-HMAC-SHA256 Credential=ASIAE2E\d+\/\d{8}\/us-east-1\/bedrock-mantle\/aws4_request/.test(
          String(h.authorization ?? ''),
        ) && /^sesion-temporal-\d+$/.test(String(h['x-amz-security-token'] ?? ''));
      const res = await owner.api
        .post('/admin/llm/providers/claude-bedrock/connect', {
          mechanism: 'AWS_ROLE',
          setupToken: setup.setupToken,
          fields: { region: 'us-east-1', roleArn: ROLE_ARN },
          models: ['anthropic.claude-opus-5-5'],
        })
        .expect(201);
      const { connection } = res.body as { connection: { id: string; keyless: Record<string, string> } };
      expect(connection.keyless).toEqual({ type: 'AWS_ROLE', externalId: setup.externalId, roleArn: ROLE_ARN });
      const row = await prismaOf(app).llmConnection.findUniqueOrThrow({ where: { id: connection.id } });
      expect(row).toMatchObject({
        apiKeyCipher: null,
        driverOptions: {
          keyless: { type: 'AWS_ROLE', roleArn: ROLE_ARN, externalId: setup.externalId, region: 'us-east-1' },
          claude: { channel: 'bedrock', region: 'us-east-1' },
        },
      });

      const assume = sts.assumeRoleRequests().at(-1)!;
      expect(assume.params.get('ExternalId')).toBe(setup.externalId);
      expect(assume.params.get('RoleSessionName')).toBe(`nexo-${owner.workspaceId}`.slice(0, 64));
      expect(String(assume.headers.authorization)).toMatch(/Credential=AKIAPLATAFORMAE2E\//);

      const agent = await createAgent(owner, { provider: connection.id, model: 'anthropic.claude-opus-5-5' });
      expect((await chat(owner, agent.id, 'Hola Bedrock')).text).toBe('Hola desde Claude simulado');
      const sent = claude.messageRequests().at(-1)!;
      expect(sent.path).toBe('/anthropic/v1/messages');
      expect((sent.body as { model: string }).model).toBe('anthropic.claude-opus-5-5');
      expect(sent.body).not.toHaveProperty('fallbacks');
      // Una sola AssumeRole: la prueba de conexión y el agente comparten las credenciales hasta su expiración.
      expect(sts.assumeRoleRequests().length - stsBefore).toBe(1);

      // El ExternalId es de un solo uso: el mismo comprobante no crea otra conexión.
      const reuse = await owner.api
        .post('/admin/llm/providers/claude-bedrock/connect', {
          mechanism: 'AWS_ROLE',
          setupToken: setup.setupToken,
          fields: { region: 'us-east-1', roleArn: ROLE_ARN },
        })
        .expect(400);
      expect((reuse.body as { message: string }).message).toMatch(/ExternalId/);
    });

    it('rechaza el ExternalId de otro workspace, uno alterado o una política de confianza que no coincide', async () => {
      const foreign = await prepare('claude-bedrock', other);
      await owner.api
        .post('/admin/llm/providers/claude-bedrock/connect', {
          mechanism: 'AWS_ROLE',
          setupToken: foreign.setupToken,
          fields: { region: 'us-east-1', roleArn: ROLE_ARN },
        })
        .expect(400);
      await owner.api
        .post('/admin/llm/providers/claude-bedrock/connect', {
          mechanism: 'AWS_ROLE',
          setupToken: `${foreign.setupToken}x`,
          fields: { region: 'us-east-1', roleArn: ROLE_ARN },
        })
        .expect(400);
      // El rol del cliente confía en otro ExternalId: STS niega AssumeRole y no se guarda nada.
      const setup = await prepare('claude-bedrock');
      const count = await prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } });
      const denied = await owner.api
        .post('/admin/llm/providers/claude-bedrock/connect', {
          mechanism: 'AWS_ROLE',
          setupToken: setup.setupToken,
          fields: { region: 'us-east-1', roleArn: 'arn:aws:iam::123456789012:role/otro-rol' },
        })
        .expect(400);
      expect((denied.body as { message: string }).message).toMatch(/política de confianza/);
      expect(JSON.stringify(denied.body)).not.toContain('not authorized');
      expect(await prismaOf(app).llmConnection.count({ where: { workspaceId: owner.workspaceId } })).toBe(count);
    });

    it('Claude Platform on AWS: SigV4 con aws-external-anthropic y la cabecera del workspace', async () => {
      const setup = await prepare('claude-aws');
      const role = 'arn:aws:iam::123456789012:role/nexo-claude-platform';
      sts.roles.set(role, setup.externalId);
      claude.authorize = (h) =>
        /\/us-west-2\/aws-external-anthropic\/aws4_request/.test(String(h.authorization ?? '')) &&
        h['anthropic-workspace-id'] === 'wrkspc_01PlataformaAws';
      const res = await owner.api
        .post('/admin/llm/providers/claude-aws/connect', {
          mechanism: 'AWS_ROLE',
          setupToken: setup.setupToken,
          fields: { region: 'us-west-2', workspaceId: 'wrkspc_01PlataformaAws', roleArn: role },
        })
        .expect(201);
      const body = res.body as {
        connection: { id: string };
        models: { modelId: string }[];
        discoveredModels: string[];
      };
      expect(body.discoveredModels).toEqual(['claude-opus-5-5']);
      expect(body.models.map((m) => m.modelId)).toEqual(['claude-opus-5-5']);
      const agent = await createAgent(owner, { provider: body.connection.id, model: 'claude-opus-5-5' });
      expect((await chat(owner, agent.id, 'Hola AWS')).text).toBe('Hola desde Claude simulado');
    });

    it('sin LLM_AWS_PRINCIPAL_ARN el mecanismo no está disponible', async () => {
      const config = app.get(ConfigService);
      config.set('llm.aws.principalArn', null);
      try {
        const res = await owner.api
          .post('/admin/llm/providers/claude-bedrock/keyless/prepare', { mechanism: 'AWS_ROLE' })
          .expect(400);
        expect((res.body as { message: string }).message).toMatch(/LLM_AWS_PRINCIPAL_ARN/);
      } finally {
        config.set('llm.aws.principalArn', PRINCIPAL);
      }
    });
  });
});

describe('B2 · uso único del state OAuth de proveedores IA entre réplicas (E2E, Redis)', () => {
  let a: INestApplication;
  let b: INestApplication;
  let openrouter: OpenRouterExchangeMock;
  let owner: Session;

  const configure = (app: INestApplication) => {
    const config = app.get(ConfigService);
    config.set('llm.providerUrlOverrides', { openrouter: `${openrouter.origin}/api/v1` });
    config.set('llm.openrouterAuthUrl', `${openrouter.origin}/auth`);
  };
  const callback = (app: INestApplication, query: Record<string, string>) =>
    new Api(app)
      .get(`/llm/oauth/openrouter/callback?${new URLSearchParams(query).toString()}`)
      .set('Cookie', llmOAuthCookie())
      .redirects(0);
  const reason = (location: string) => new URL(location).searchParams.get('reason');

  beforeAll(async () => {
    openrouter = await new OpenRouterExchangeMock().start();
    // Dos instancias de la API con la misma base de datos y el mismo Redis, como dos réplicas detrás del balanceador.
    a = await createTestApp();
    b = await createTestApp();
    configure(a);
    configure(b);
    owner = await registerOwner(a, 'replicas');
  });

  afterAll(async () => {
    await a?.close();
    await b?.close();
    await openrouter?.stop();
  });

  it('el state consumido en una réplica se rechaza en la otra (sin volver a canjear el código)', async () => {
    const start = await owner.api.post('/admin/llm/providers/openrouter/oauth/start', {}).expect(200);
    const { code, state } = openrouter.authorize((start.body as { authorizeUrl: string }).authorizeUrl);

    const first = await callback(a, { code, state }).expect(302);
    expect(new URL(first.headers.location).searchParams.get('llm')).toBe('connected');
    const replay = await callback(b, { code, state }).expect(302);
    expect(reason(replay.headers.location)).toBe('invalid_state');
    expect(openrouter.exchanges).toBe(1);
  });

  it('dos callbacks simultáneos con el mismo state en réplicas distintas: solo uno conecta', async () => {
    const start = await owner.api.post('/admin/llm/providers/openrouter/oauth/start', {}).expect(200);
    const { code, state } = openrouter.authorize((start.body as { authorizeUrl: string }).authorizeUrl);
    const before = openrouter.exchanges;
    const results = await Promise.all([callback(a, { code, state }), callback(b, { code, state })]);
    const outcomes = results.map((r) => new URL(r.headers.location as string).searchParams.get('llm')).sort();
    expect(outcomes).toEqual(['connected', 'error']);
    expect(results.map((r) => reason(r.headers.location as string))).toContain('invalid_state');
    expect(openrouter.exchanges - before).toBe(1);
  });
});
