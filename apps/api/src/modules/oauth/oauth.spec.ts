import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { CryptoService } from '../../common/crypto/crypto.service';
import { slack, SLACK_BOT_SCOPES } from '../connectors/catalog/integrations/slack';
import type { OAuth2CodeAuth } from '../connectors/domain/connector.types';
import { OAUTH_PROVIDERS, platformEnvName } from './oauth.providers';
import { OAuthService, scopeSeparator } from './oauth.service';
import { createPkce, OAuthStateService, pkceChallenge } from './oauth-state.service';

const JWT_SECRET = 'unit-jwt-secret-0123456789abcdef0123456789abcdef';
const config = (extra: Record<string, string> = {}) =>
  new ConfigService({
    jwt: { secret: JWT_SECRET },
    encryptionKey: '0f1e2d3c4b5a69788796a5b4c3d2e1f000112233445566778899aabbccddeeff',
    ...extra,
  });

describe('PKCE (RFC 7636)', () => {
  it('genera verificadores de 43 caracteres base64url y desafío S256', () => {
    const { codeVerifier, codeChallenge } = createPkce();
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(codeChallenge).toBe(createHash('sha256').update(codeVerifier).digest('base64url'));
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createPkce().codeVerifier).not.toBe(codeVerifier);
  });

  it('el desafío es determinista', () => {
    expect(pkceChallenge('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  });
});

describe('state OAuth firmado', () => {
  const cfg = config();
  const crypto = new CryptoService(cfg);
  const jwt = new JwtService({ secret: JWT_SECRET });
  const payload = { workspaceId: 'ws1', connectorId: 'c1', userId: 'u1', codeVerifier: 'verificador-secreto' };

  it('firma y valida el contenido, sin exponer el code_verifier en claro', async () => {
    const svc = new OAuthStateService(jwt, crypto, cfg);
    const state = await svc.sign(payload);
    const claims = JSON.parse(Buffer.from(state.split('.')[1], 'base64url').toString()) as Record<string, unknown>;
    expect(JSON.stringify(claims)).not.toContain('verificador-secreto');
    expect((claims.exp as number) - (claims.iat as number)).toBe(600);
    await expect(svc.consume(state)).resolves.toEqual(payload);
  });

  it('es de un solo uso', async () => {
    const svc = new OAuthStateService(jwt, crypto, cfg);
    const state = await svc.sign(payload);
    await expect(svc.consume(state)).resolves.not.toBeNull();
    await expect(svc.consume(state)).resolves.toBeNull();
  });

  it('rechaza un state expirado, alterado o firmado con otro secreto', async () => {
    const svc = new OAuthStateService(jwt, crypto, cfg);
    await expect(svc.consume(await svc.sign(payload, -5))).resolves.toBeNull();

    const state = await svc.sign(payload);
    const [h, p, s] = state.split('.');
    const tampered = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown>;
    tampered.ws = 'otro-workspace';
    await expect(svc.consume(`${h}.${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${s}`)).resolves.toBe(
      null,
    );

    const other = new OAuthStateService(jwt, crypto, config({ jwt: { secret: 'otro'.repeat(10) } } as never));
    await expect(other.consume(await svc.sign(payload))).resolves.toBeNull();
    await expect(svc.consume('basura')).resolves.toBeNull();
  });

  it('un token de sesión de la API no sirve como state, ni un state como token de sesión', async () => {
    const svc = new OAuthStateService(jwt, crypto, cfg);
    const session = await jwt.signAsync({ sub: 'u1', wid: 'ws1', role: 'OWNER' });
    await expect(svc.consume(session)).resolves.toBeNull();
    await expect(jwt.verifyAsync(await svc.sign(payload))).rejects.toThrow();
  });
});

describe('OAuthService.resolveApp', () => {
  const base: OAuth2CodeAuth = {
    type: 'oauth2_code',
    provider: 'hubspot',
    authorizeUrl: OAUTH_PROVIDERS.hubspot.authorizeUrl,
    tokenUrl: OAUTH_PROVIDERS.hubspot.tokenUrl,
    scopes: ['oauth'],
  };
  const service = (env: Record<string, string> = {}) =>
    new OAuthService(null as never, null as never, null as never, null as never, null as never, config(env));

  it('usa la app propia del cliente con sus URLs', () => {
    const app = service().resolveApp({
      ...base,
      tokenUrl: 'https://idp.cliente.com/token',
      clientIdRef: 'id-propio',
      clientSecretRef: 'secreto-propio',
    });
    expect(app).toMatchObject({ clientId: 'id-propio', tokenUrl: 'https://idp.cliente.com/token' });
  });

  it('usa la app de la plataforma desde el entorno', () => {
    const app = service({
      [platformEnvName('hubspot', 'CLIENT_ID')]: 'pid',
      [platformEnvName('hubspot', 'CLIENT_SECRET')]: 'psecret',
    }).resolveApp(base);
    expect(app).toMatchObject({ clientId: 'pid', clientSecret: 'psecret', tokenUrl: OAUTH_PROVIDERS.hubspot.tokenUrl });
  });

  it('no entrega el secreto de la plataforma a URLs alteradas ni sin configuración', () => {
    const svc = service({ OAUTH_HUBSPOT_CLIENT_ID: 'pid', OAUTH_HUBSPOT_CLIENT_SECRET: 'psecret' });
    expect(() => svc.resolveApp({ ...base, tokenUrl: 'https://atacante.example/token' })).toThrow(BadRequestException);
    expect(() => service().resolveApp(base)).toThrow(/OAUTH_HUBSPOT_CLIENT_ID/);
    expect(() => service().resolveApp({ ...base, clientIdRef: 'solo-id' })).toThrow(/client secret/);
  });
});

describe('OAuthService con Slack (OAuth v2, "Agregar a Slack")', () => {
  const cfg = config();
  const crypto = new CryptoService(cfg);
  const slackAuth = slack.auth.oauth2_code as OAuth2CodeAuth;
  const statePayload = { workspaceId: 'ws1', connectorId: 'c1', userId: 'u1', codeVerifier: 'verificador' };

  /** Servicio con dobles de Prisma, bóveda, state y cliente HTTP; `tokenBody` es la respuesta de oauth.v2.access. */
  const setup = (auth: OAuth2CodeAuth, tokenBody: unknown) => {
    let stored: Record<string, unknown> | null = null;
    const httpCalls: { url: string; body?: string }[] = [];
    const prisma = {
      connector: { findFirst: () => Promise.resolve({ id: 'c1', workspaceId: 'ws1', auth, config: {} }) },
      membership: { findUnique: () => Promise.resolve({ role: 'OWNER' }) },
      oAuthCredential: {
        findUnique: () => Promise.resolve(stored),
        upsert: ({ create }: { create: Record<string, unknown> }) => {
          stored = create;
          return Promise.resolve(create);
        },
      },
    };
    const secrets = { resolveAll: () => Promise.resolve({ SLACK_CLIENT_ID: '123.456', SLACK_CLIENT_SECRET: 'cs' }) };
    const state = { sign: () => Promise.resolve('state-firmado'), consume: () => Promise.resolve(statePayload) };
    const http = {
      request: (req: { url: string; body?: string }) => {
        httpCalls.push(req);
        return Promise.resolve({ ok: true, status: 200, body: tokenBody, durationMs: 1, headers: {} });
      },
    };
    const svc = new OAuthService(
      prisma as never,
      crypto,
      http as never,
      secrets as never,
      state as never,
      config({ publicUrl: 'https://api.nexo.test', webUrl: 'https://app.nexo.test' }),
    );
    return { svc, httpCalls, stored: () => stored };
  };

  it('pide los scopes de bot separados por coma y sin PKCE', async () => {
    const { svc } = setup(slackAuth, {});
    const url = new URL((await svc.start('ws1', 'c1', 'u1')).authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(url.searchParams.get('scope')).toBe(SLACK_BOT_SCOPES.join(','));
    expect(url.searchParams.get('client_id')).toBe('123.456');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.nexo.test/api/oauth/callback');
    expect(url.searchParams.get('state')).toBe('state-firmado');
    expect(url.searchParams.has('code_challenge')).toBe(false);
    expect(url.searchParams.has('code_challenge_method')).toBe(false);
  });

  it('los demás proveedores siguen usando scopes separados por espacio (RFC 6749)', async () => {
    const auth: OAuth2CodeAuth = {
      type: 'oauth2_code',
      provider: 'hubspot',
      authorizeUrl: 'https://idp.cliente.com/authorize',
      tokenUrl: 'https://idp.cliente.com/token',
      scopes: ['oauth', 'crm.objects.contacts.read'],
      clientIdRef: 'id',
      clientSecretRef: 'secreto',
    };
    const { svc } = setup(auth, {});
    const url = new URL((await svc.start('ws1', 'c1', 'u1')).authorizeUrl);
    expect(url.searchParams.get('scope')).toBe('oauth crm.objects.contacts.read');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(scopeSeparator({})).toBe(' ');
    expect(scopeSeparator({ scopeSeparator: '' })).toBe(' ');
  });

  it('guarda el token de bot sin refresh token ni caducidad (rotación desactivada) y lo usa sin renovar', async () => {
    const { svc, httpCalls, stored } = setup(slackAuth, {
      ok: true,
      access_token: 'xoxb-17-bot',
      token_type: 'bot',
      scope: 'chat:write,channels:read',
      bot_user_id: 'U0BOT',
      app_id: 'A0APP',
      team: { id: 'T0TEAM', name: 'Acme Ventas' },
      enterprise: null,
      authed_user: { id: 'U0HUMANO' },
    });
    await expect(svc.callback({ code: 'codigo', state: 'state-firmado' })).resolves.toBe(
      'https://app.nexo.test/connectors/c1?oauth=ok',
    );
    expect(httpCalls).toHaveLength(1);
    expect(httpCalls[0].url).toBe('https://slack.com/api/oauth.v2.access');
    expect(Object.fromEntries(new URLSearchParams(httpCalls[0].body))).toEqual({
      grant_type: 'authorization_code',
      code: 'codigo',
      redirect_uri: 'https://api.nexo.test/api/oauth/callback',
      client_id: '123.456',
      client_secret: 'cs',
    });
    const cred = stored()!;
    expect(cred).toMatchObject({
      refreshTokenCipher: null,
      expiresAt: null,
      scope: 'chat:write,channels:read',
      accountLabel: 'Acme Ventas',
    });
    expect(JSON.stringify(cred)).not.toContain('xoxb-17-bot');
    await expect(svc.accessToken('c1', slackAuth)).resolves.toBe('xoxb-17-bot');
    expect(httpCalls).toHaveLength(1);
  });

  it('con rotación activa guarda refresh token y caducidad', async () => {
    const { svc, stored } = setup(slackAuth, {
      ok: true,
      access_token: 'xoxe.xoxb-1-bot',
      refresh_token: 'xoxe-1-refresh',
      expires_in: 43200,
      scope: 'chat:write',
      team: { id: 'T0TEAM', name: 'Acme' },
    });
    await svc.callback({ code: 'codigo', state: 'state-firmado' });
    const cred = stored()!;
    expect(crypto.decrypt(cred.refreshTokenCipher as string)).toBe('xoxe-1-refresh');
    expect((cred.expiresAt as Date).getTime()).toBeGreaterThan(Date.now() + 43_000_000);
  });

  it('un ok:false de oauth.v2.access (HTTP 200) es un intercambio fallido y no guarda nada', async () => {
    const { svc, stored } = setup(slackAuth, { ok: false, error: 'invalid_code' });
    await expect(svc.callback({ code: 'viejo', state: 'state-firmado' })).resolves.toBe(
      'https://app.nexo.test/connectors/c1?oauth=error&reason=exchange_failed',
    );
    expect(stored()).toBeNull();
  });
});
