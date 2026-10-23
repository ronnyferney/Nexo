import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { CryptoService } from '../../common/crypto/crypto.service';
import type { OAuth2CodeAuth } from '../connectors/domain/connector.types';
import { OAUTH_PROVIDERS, platformEnvName } from './oauth.providers';
import { OAuthService } from './oauth.service';
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
