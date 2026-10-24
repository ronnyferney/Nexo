import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LlmConnection } from '@prisma/client';
import { CryptoService } from '../../common/crypto/crypto.service';
import type { HttpClientService, HttpRequest, HttpResponse } from '../../common/http/http-client.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { parseOAuthEndpointOverrides } from '../../config/configuration';
import { llmOAuthEnvName, mechanismViews, resolveLlmOAuthApp } from './llm-oauth-apps';
import { ConnectionUnavailableException } from './llm-errors';
import { LlmTokenService, tokensFrom } from './llm-token.service';
import { findMechanism, findProvider } from './providers';

const KEY = '0f1e2d3c4b5a69788796a5b4c3d2e1f000112233445566778899aabbccddeeff';
const config = (values: Record<string, unknown> = {}) => new ConfigService({ encryptionKey: KEY, ...values });
const vertex = () => findProvider('vertex')!;
const azure = () => findProvider('azure-openai')!;
const hf = () => findProvider('huggingface')!;

class FakeHttp {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly replies: { status: number; body: unknown; delayMs?: number }[]) {}
  async request(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    const r = this.replies.shift() ?? { status: 200, body: {} };
    if (r.delayMs) await new Promise((resolve) => setTimeout(resolve, r.delayMs));
    return {
      status: r.status,
      ok: r.status < 400,
      headers: { 'content-type': 'application/json' },
      body: r.body,
      rawBody: JSON.stringify(r.body),
      durationMs: 1,
    };
  }
}

/** Prisma en memoria con lo que usa LlmTokenService. */
function fakePrisma(row: Partial<LlmConnection>) {
  const state = { row: { ...row } as LlmConnection, updates: 0 };
  const prisma = {
    llmConnection: {
      findUnique: () => Promise.resolve({ ...state.row }),
      update: ({ data }: { data: Partial<LlmConnection> }) => {
        state.updates++;
        state.row = { ...state.row, ...data };
        return Promise.resolve(state.row);
      },
      updateMany: ({ data }: { data: Partial<LlmConnection> }) => {
        state.updates++;
        state.row = { ...state.row, ...data };
        return Promise.resolve({ count: 1 });
      },
    },
  };
  return { prisma: prisma as unknown as PrismaService, state };
}

describe('Apps OAuth de Nexo para proveedores LLM', () => {
  it('nombres de variables OAUTH_LLM_<PROVEEDOR>_CLIENT_ID/SECRET', () => {
    expect(llmOAuthEnvName('vertex', 'CLIENT_ID')).toBe('OAUTH_LLM_VERTEX_CLIENT_ID');
    expect(llmOAuthEnvName('azure-openai', 'CLIENT_SECRET')).toBe('OAUTH_LLM_AZURE_OPENAI_CLIENT_SECRET');
  });

  it('sin app configurada el mecanismo queda no disponible con el motivo y las variables', () => {
    const views = mechanismViews(config(), vertex());
    expect(views).toEqual([
      expect.objectContaining({ type: 'OAUTH', label: 'Iniciar sesión con Google', available: false, primary: true }),
    ]);
    expect(views[0].unavailableReason).toMatch(/OAUTH_LLM_VERTEX_CLIENT_ID y OAUTH_LLM_VERTEX_CLIENT_SECRET/);
    // Google exige secreto (app web confidencial): solo el client_id no basta.
    expect(mechanismViews(config({ OAUTH_LLM_VERTEX_CLIENT_ID: 'id' }), vertex())[0].available).toBe(false);
    const ok = mechanismViews(
      config({ OAUTH_LLM_VERTEX_CLIENT_ID: 'id', OAUTH_LLM_VERTEX_CLIENT_SECRET: 's' }),
      vertex(),
    );
    expect(ok[0]).toEqual({ type: 'OAUTH', label: 'Iniciar sesión con Google', available: true, primary: true });
  });

  it('Hugging Face admite app pública (sin secreto); clave de API y OpenRouter siempre disponibles', () => {
    const views = mechanismViews(config({ OAUTH_LLM_HUGGINGFACE_CLIENT_ID: 'hf-app' }), hf());
    expect(views.map((v) => [v.type, v.available])).toEqual([
      ['OAUTH', true],
      ['DEVICE_CODE', true],
      ['API_KEY', true],
    ]);
    expect(mechanismViews(config(), findProvider('openrouter')!).every((v) => v.available)).toBe(true);
    expect(mechanismViews(config(), findProvider('openai')!)).toEqual([
      { type: 'API_KEY', label: 'Clave de API', available: true, primary: true },
    ]);
  });

  it('detección local disponible solo si la política SSRF permite redes privadas', () => {
    expect(mechanismViews(config(), findProvider('ollama')!)[0]).toMatchObject({ available: false });
    expect(mechanismViews(config(), findProvider('ollama')!)[0].unavailableReason).toMatch(
      /CONNECTOR_ALLOW_PRIVATE_NETWORKS/,
    );
    const allowed = config({ http: { allowPrivateNetworks: true } });
    expect(mechanismViews(allowed, findProvider('lmstudio')!)[0]).toMatchObject({ available: true });
  });

  it('renderiza el inquilino de Entra ID en las URLs y aplica LLM_OAUTH_ENDPOINT_OVERRIDES', () => {
    const spec = findMechanism(azure(), 'OAUTH')!.oauth!;
    const c = config({ OAUTH_LLM_AZURE_OPENAI_CLIENT_ID: 'id', OAUTH_LLM_AZURE_OPENAI_CLIENT_SECRET: 's' });
    const app = resolveLlmOAuthApp(c, azure(), spec, { tenantId: 'contoso.onmicrosoft.com' });
    expect(app).toMatchObject({
      clientId: 'id',
      clientSecret: 's',
      authorizeUrl: 'https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token',
      scopeOnTokenRequest: true,
    });
    const overridden = config({
      OAUTH_LLM_AZURE_OPENAI_CLIENT_ID: 'id',
      OAUTH_LLM_AZURE_OPENAI_CLIENT_SECRET: 's',
      llm: { oauthEndpointOverrides: { 'azure-openai': { tokenUrl: 'https://idp.corp/{{ tenantId }}/token' } } },
    });
    expect(resolveLlmOAuthApp(overridden, azure(), spec, { tenantId: 't1' }).tokenUrl).toBe(
      'https://idp.corp/t1/token',
    );
    expect(() => resolveLlmOAuthApp(config(), azure(), spec, {})).toThrow(/no está configurada/);
  });

  it('parseOAuthEndpointOverrides acepta solo URLs http(s) de las claves conocidas', () => {
    expect(
      parseOAuthEndpointOverrides(
        '{"vertex":{"tokenUrl":"https://a/t","otro":"https://x","revokeUrl":"ftp://x"},"y":1}',
      ),
    ).toEqual({ vertex: { tokenUrl: 'https://a/t' } });
    expect(parseOAuthEndpointOverrides('no-json')).toEqual({});
    expect(parseOAuthEndpointOverrides(undefined)).toEqual({});
  });

  it('tokensFrom calcula la expiración y conserva el refresh token', () => {
    const t = tokensFrom({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 's' });
    expect(t.accessToken).toBe('a');
    expect(t.refreshToken).toBe('r');
    expect(t.expiresAt!.getTime() - Date.now()).toBeGreaterThan(3_500_000);
    expect(tokensFrom({ access_token: 'a' }).expiresAt).toBeNull();
  });
});

describe('LlmTokenService', () => {
  const vertexConfig = () =>
    config({
      OAUTH_LLM_VERTEX_CLIENT_ID: 'nexo-vertex',
      OAUTH_LLM_VERTEX_CLIENT_SECRET: 'secreto-vertex',
      llm: { oauthEndpointOverrides: {} },
    });
  const crypto = new CryptoService(config());

  const vertexRow = (over: Partial<LlmConnection> = {}): Partial<LlmConnection> => ({
    id: 'c1',
    name: 'Vertex',
    providerId: 'vertex',
    credentialType: 'OAUTH',
    providerFields: { projectId: 'mi-proyecto-123', region: 'global' },
    apiKeyCipher: crypto.encrypt('ya29.viejo'),
    oauthRefreshCipher: crypto.encrypt('1//refresh'),
    oauthExpiresAt: new Date(Date.now() + 10_000),
    ...over,
  });

  it('devuelve el token vigente sin llamar al proveedor', async () => {
    const http = new FakeHttp([]);
    const { prisma } = fakePrisma(vertexRow({ oauthExpiresAt: new Date(Date.now() + 3_600_000) }));
    const svc = new LlmTokenService(prisma, crypto, http as unknown as HttpClientService, vertexConfig());
    await expect(svc.accessToken('c1')).resolves.toBe('ya29.viejo');
    expect(http.requests).toHaveLength(0);
  });

  it('renueva antes de expirar con una sola solicitud aunque haya llamadas concurrentes', async () => {
    const http = new FakeHttp([{ status: 200, body: { access_token: 'ya29.nuevo', expires_in: 3599 }, delayMs: 20 }]);
    const { prisma, state } = fakePrisma(vertexRow());
    const svc = new LlmTokenService(prisma, crypto, http as unknown as HttpClientService, vertexConfig());
    const tokens = await Promise.all([svc.accessToken('c1'), svc.accessToken('c1'), svc.accessToken('c1')]);
    expect(tokens).toEqual(['ya29.nuevo', 'ya29.nuevo', 'ya29.nuevo']);
    expect(http.requests).toHaveLength(1);
    const req = http.requests[0];
    expect(req.url).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(req.body);
    expect(Object.fromEntries(body)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: '1//refresh',
      client_id: 'nexo-vertex',
      client_secret: 'secreto-vertex',
    });
    expect(state.updates).toBe(1);
    expect(crypto.decrypt(state.row.apiKeyCipher!)).toBe('ya29.nuevo');
    // Sin refresh token nuevo se conserva el anterior.
    expect(crypto.decrypt(state.row.oauthRefreshCipher!)).toBe('1//refresh');
    expect(state.row.oauthExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 3_500_000);
  });

  it('Entra ID: envía el scope al renovar y reemplaza el refresh token rotado', async () => {
    const http = new FakeHttp([
      { status: 200, body: { access_token: 'eyJ.nuevo', refresh_token: 'rt-2', expires_in: 3600 } },
    ]);
    const { prisma, state } = fakePrisma(
      vertexRow({
        providerId: 'azure-openai',
        providerFields: { resource: 'r', deployment: 'd', tenantId: 'contoso' },
        oauthRefreshCipher: crypto.encrypt('rt-1'),
      }),
    );
    const c = config({ OAUTH_LLM_AZURE_OPENAI_CLIENT_ID: 'id', OAUTH_LLM_AZURE_OPENAI_CLIENT_SECRET: 's' });
    const svc = new LlmTokenService(prisma, crypto, http as unknown as HttpClientService, c);
    await expect(svc.accessToken('c1')).resolves.toBe('eyJ.nuevo');
    expect(http.requests[0].url).toBe('https://login.microsoftonline.com/contoso/oauth2/v2.0/token');
    expect(new URLSearchParams(http.requests[0].body).get('scope')).toBe(
      'https://ai.azure.com/.default offline_access',
    );
    expect(crypto.decrypt(state.row.oauthRefreshCipher!)).toBe('rt-2');
  });

  it('Entra ID: una conexión creada con el scope de Cognitive Services lo conserva al renovar', async () => {
    const http = new FakeHttp([{ status: 200, body: { access_token: 'eyJ.nuevo', expires_in: 3600 } }]);
    const { prisma } = fakePrisma(
      vertexRow({
        providerId: 'azure-openai',
        providerFields: { resource: 'r', deployment: 'd', tenantId: 'contoso' },
        oauthScope: 'https://cognitiveservices.azure.com/user_impersonation',
      }),
    );
    const c = config({ OAUTH_LLM_AZURE_OPENAI_CLIENT_ID: 'id', OAUTH_LLM_AZURE_OPENAI_CLIENT_SECRET: 's' });
    const svc = new LlmTokenService(prisma, crypto, http as unknown as HttpClientService, c);
    await expect(svc.accessToken('c1')).resolves.toBe('eyJ.nuevo');
    expect(new URLSearchParams(http.requests[0].body).get('scope')).toBe(
      'https://cognitiveservices.azure.com/.default offline_access',
    );
  });

  it('Claude en Foundry renueva con la app de Entra ID de Nexo compartida con Azure OpenAI', async () => {
    const http = new FakeHttp([{ status: 200, body: { access_token: 'eyJ.foundry', expires_in: 3600 } }]);
    const { prisma } = fakePrisma(
      vertexRow({ providerId: 'claude-foundry', providerFields: { resource: 'mi-recurso', tenantId: 'contoso' } }),
    );
    const c = config({ OAUTH_LLM_AZURE_OPENAI_CLIENT_ID: 'id', OAUTH_LLM_AZURE_OPENAI_CLIENT_SECRET: 's' });
    const svc = new LlmTokenService(prisma, crypto, http as unknown as HttpClientService, c);
    await expect(svc.accessToken('c1')).resolves.toBe('eyJ.foundry');
    expect(http.requests[0].url).toBe('https://login.microsoftonline.com/contoso/oauth2/v2.0/token');
    const form = new URLSearchParams(http.requests[0].body);
    expect(form.get('scope')).toBe('https://ai.azure.com/.default offline_access');
    expect(form.get('client_id')).toBe('id');
  });

  it('Hugging Face con secreto usa Authorization: Basic en el endpoint de token', async () => {
    const http = new FakeHttp([{ status: 200, body: { access_token: 'hf_oauth_2', expires_in: 28800 } }]);
    const { prisma } = fakePrisma(vertexRow({ providerId: 'huggingface', providerFields: {} }));
    const c = config({ OAUTH_LLM_HUGGINGFACE_CLIENT_ID: 'hf-id', OAUTH_LLM_HUGGINGFACE_CLIENT_SECRET: 'hf-s' });
    const svc = new LlmTokenService(prisma, crypto, http as unknown as HttpClientService, c);
    await svc.accessToken('c1');
    expect(http.requests[0].headers?.authorization).toBe(`Basic ${Buffer.from('hf-id:hf-s').toString('base64')}`);
    expect(new URLSearchParams(http.requests[0].body).get('client_secret')).toBeNull();
  });

  it('sin refresh token o con el grant revocado (invalid_grant) cierra la sesión y pide volver a iniciarla', async () => {
    const { prisma } = fakePrisma(vertexRow({ oauthRefreshCipher: null }));
    const svc = new LlmTokenService(prisma, crypto, new FakeHttp([]) as unknown as HttpClientService, vertexConfig());
    await expect(svc.accessToken('c1')).rejects.toThrow(/no entrega refresh token/);

    const rejected = fakePrisma(vertexRow());
    const http = new FakeHttp([{ status: 400, body: { error: 'invalid_grant' } }]);
    const svc2 = new LlmTokenService(rejected.prisma, crypto, http as unknown as HttpClientService, vertexConfig());
    const err = await svc2.accessToken('c1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectionUnavailableException);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err).toMatchObject({ reason: 'signed_out' });
    expect((err as Error).message).toMatch(/revocada o caducó.*vuelva a iniciar sesión/);
    // La consola muestra «Sesión cerrada»: se borran los tokens.
    expect(rejected.state.row).toMatchObject({ apiKeyCipher: null, oauthRefreshCipher: null, oauthExpiresAt: null });
  });

  it('un error transitorio al renovar conserva la sesión', async () => {
    const transient = fakePrisma(vertexRow());
    const http = new FakeHttp([{ status: 503, body: { error: 'temporarily_unavailable' } }]);
    const svc = new LlmTokenService(transient.prisma, crypto, http as unknown as HttpClientService, vertexConfig());
    const err = await svc.accessToken('c1').catch((e: unknown) => e);
    expect(err).toMatchObject({ reason: 'session_expired' });
    expect((err as Error).message).toMatch(/HTTP 503.*inténtelo de nuevo/);
    expect(transient.state.updates).toBe(0);
  });

  it('revoca en Google al desconectar y no intenta revocar donde no hay endpoint documentado', async () => {
    const http = new FakeHttp([{ status: 200, body: {} }]);
    const svc = new LlmTokenService(
      fakePrisma({}).prisma,
      crypto,
      http as unknown as HttpClientService,
      vertexConfig(),
    );
    await expect(svc.revoke(vertexRow() as LlmConnection)).resolves.toBe(true);
    expect(http.requests[0]).toMatchObject({ url: 'https://oauth2.googleapis.com/revoke', method: 'POST' });
    expect(new URLSearchParams(http.requests[0].body).get('token')).toBe('1//refresh');

    await expect(svc.revoke({ ...vertexRow(), providerId: 'azure-openai' } as LlmConnection)).resolves.toBe(false);
    await expect(svc.revoke({ ...vertexRow(), credentialType: 'API_KEY' } as LlmConnection)).resolves.toBe(false);
    expect(http.requests).toHaveLength(1);
  });
});
