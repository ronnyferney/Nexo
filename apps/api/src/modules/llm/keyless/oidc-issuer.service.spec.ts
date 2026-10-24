import type { ConfigService } from '@nestjs/config';
import {
  createPublicKey,
  generateKeyPairSync,
  verify as cryptoVerify,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';
import { parseOidcSigningKeys, type OidcSigningKeyConfig } from '../../../config/configuration';
import {
  ANTHROPIC_WIF_AUDIENCE,
  jwkThumbprint,
  loadSigningKey,
  OidcIssuerService,
  OidcKeyError,
  WIF_ASSERTION_TTL_S,
} from './oidc-issuer.service';

const pkcs8 = (k: KeyObject) => k.export({ format: 'pem', type: 'pkcs8' }).toString();
const ecPem = (namedCurve = 'P-256') => pkcs8(generateKeyPairSync('ec', { namedCurve }).privateKey);
const rsaPem = (modulusLength = 2048) => pkcs8(generateKeyPairSync('rsa', { modulusLength }).privateKey);
const edPem = () => pkcs8(generateKeyPairSync('ed25519').privateKey);
const publicPem = (privatePem: string) =>
  createPublicKey(privatePem).export({ format: 'pem', type: 'spki' }).toString();

function issuer(keys: OidcSigningKeyConfig[], extra: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    publicUrl: 'https://nexo.example.com',
    'llm.wif.issuer': 'https://nexo.example.com/api/oidc',
    'llm.wif.signingKeys': keys,
    ...extra,
  };
  return new OidcIssuerService({ get: (k: string) => values[k] } as unknown as ConfigService);
}

function decode(jwt: string) {
  const [h, p, s] = jwt.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString()) as Record<string, unknown>,
    payload: JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown>,
    signingInput: `${h}.${p}`,
    signature: Buffer.from(s, 'base64url'),
  };
}

/** Verifica la firma con la clave pública del JWKS, como hace Anthropic (por `kid`). */
function verifyWithJwks(jwt: string, jwks: { keys: (JsonWebKey & { kid: string })[] }): boolean {
  const { header, signingInput, signature } = decode(jwt);
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) return false;
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const alg = String(header.alg);
  const hash = `sha${alg.slice(2)}`;
  return cryptoVerify(
    hash,
    Buffer.from(signingInput),
    alg.startsWith('ES') ? { key, dsaEncoding: 'ieee-p1363' } : key,
    signature,
  );
}

describe('Emisor OIDC de Nexo para Workload Identity Federation (L2)', () => {
  const env = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = env;
  });

  it('firma una aserción ES256 con kid, iss, sub del workspace, aud de Anthropic, vida corta y jti único', () => {
    const svc = issuer([{ pem: ecPem(), kid: 'nexo-2026-10' }]);
    const before = Math.floor(Date.now() / 1000);
    const a = svc.mint('ws_123');
    const b = svc.mint('ws_123');
    const { header, payload } = decode(a);
    expect(header).toEqual({ alg: 'ES256', typ: 'JWT', kid: 'nexo-2026-10' });
    expect(payload).toMatchObject({
      iss: 'https://nexo.example.com/api/oidc',
      sub: 'nexo:workspace:ws_123',
      aud: ANTHROPIC_WIF_AUDIENCE,
      nexo_workspace_id: 'ws_123',
    });
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    expect(Number(payload.exp) - Number(payload.iat)).toBe(WIF_ASSERTION_TTL_S);
    // Anthropic: vida ≤ 1 hora por defecto y `jti` de un solo uso por emisor.
    expect(WIF_ASSERTION_TTL_S).toBeLessThanOrEqual(3600);
    expect(payload.jti).not.toBe(decode(b).payload.jti);
    expect(verifyWithJwks(a, svc.jwks())).toBe(true);
    expect(a.length).toBeLessThan(16 * 1024);
  });

  it('RS256 con kid por defecto = huella RFC 7638; el JWKS no expone material privado', () => {
    const svc = issuer([{ pem: rsaPem() }]);
    const jwks = svc.jwks();
    expect(jwks.keys).toHaveLength(1);
    const [key] = jwks.keys;
    expect(key).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' });
    expect(key.kid).toBe(jwkThumbprint(key));
    for (const priv of ['d', 'p', 'q', 'dp', 'dq', 'qi']) expect(key).not.toHaveProperty(priv);
    const jwt = svc.mint('ws');
    expect(decode(jwt).header.kid).toBe(key.kid);
    expect(verifyWithJwks(jwt, jwks)).toBe(true);
  });

  it('rotación: publica todas las claves y firma solo con la activa', () => {
    const old = ecPem();
    const next = ecPem('P-384');
    const svc = issuer([
      { pem: publicPem(old), kid: 'anterior' },
      { pem: next, kid: 'vigente', active: true },
    ]);
    expect(svc.jwks().keys.map((k) => k.kid)).toEqual(['anterior', 'vigente']);
    const { header } = decode(svc.mint('ws'));
    expect(header).toMatchObject({ kid: 'vigente', alg: 'ES384' });
    expect(svc.discovery()).toEqual(
      expect.objectContaining({
        issuer: 'https://nexo.example.com/api/oidc',
        jwks_uri: 'https://nexo.example.com/api/oidc/jwks',
        id_token_signing_alg_values_supported: ['ES256', 'ES384'],
      }),
    );
  });

  it('rechaza claves que Anthropic no acepta y configuraciones ambiguas', () => {
    expect(() => loadSigningKey({ pem: edPem() })).toThrow(OidcKeyError);
    expect(() => loadSigningKey({ pem: rsaPem(1024) })).toThrow(/2048/);
    expect(() => loadSigningKey({ pem: 'no es un pem' })).toThrow(OidcKeyError);
    const k = ecPem();
    expect(() =>
      issuer([
        { pem: k, kid: 'a' },
        { pem: rsaPem(), kid: 'a' },
      ]),
    ).toThrow(/kid repetido/);
    expect(() => issuer([{ pem: publicPem(k), active: true }])).toThrow(/privada/);
  });

  it('sin clave: efímera con aviso fuera de producción; en producción no firma y explica qué falta', () => {
    process.env.NODE_ENV = 'development';
    const dev = issuer([]);
    expect(dev.ephemeral).toBe(true);
    expect(dev.signingEnabled).toBe(true);
    expect(verifyWithJwks(dev.mint('ws'), dev.jwks())).toBe(true);

    process.env.NODE_ENV = 'production';
    const prod = issuer([]);
    expect(prod.signingEnabled).toBe(false);
    expect(prod.unavailableReason()).toMatch(/LLM_WIF_SIGNING_KEYS/);
    expect(() => prod.mint('ws')).toThrow(OidcKeyError);
  });

  it('exige un emisor público https:443 con DNS (Anthropic no lee localhost, IP ni otros puertos)', () => {
    const key = [{ pem: ecPem() }];
    expect(issuer(key).unavailableReason()).toBeNull();
    for (const url of [
      'http://localhost:3000/api/oidc',
      'https://localhost/api/oidc',
      'https://127.0.0.1/api/oidc',
      'https://nexo.example.com:8443/api/oidc',
      'http://nexo.example.com/api/oidc',
      'https://intranet/api/oidc',
    ]) {
      expect(issuer(key, { 'llm.wif.issuer': url }).unavailableReason()).toMatch(/443|dominio|URL/);
    }
    // Sin LLM_WIF_ISSUER, el emisor es PUBLIC_URL + /api/oidc.
    expect(issuer(key, { 'llm.wif.issuer': '' }).issuer).toBe('https://nexo.example.com/api/oidc');
  });
});

describe('parseOidcSigningKeys (LLM_WIF_SIGNING_KEYS / LLM_WIF_SIGNING_KEY)', () => {
  it('lee el arreglo JSON con \\n escapados o un PEM suelto; un JSON inválido no pasa desapercibido', () => {
    const k = ecPem();
    const escaped = JSON.stringify([{ kid: 'k1', pem: k.replace(/\n/g, '\\n'), active: true }]);
    expect(parseOidcSigningKeys({ LLM_WIF_SIGNING_KEYS: escaped })).toEqual([{ kid: 'k1', pem: k, active: true }]);
    expect(parseOidcSigningKeys({ LLM_WIF_SIGNING_KEY: k })).toEqual([{ pem: k.trim() }]);
    expect(parseOidcSigningKeys({})).toEqual([]);
    expect(() => parseOidcSigningKeys({ LLM_WIF_SIGNING_KEYS: '{no-json' })).toThrow();
    expect(() => parseOidcSigningKeys({ LLM_WIF_SIGNING_KEYS: '[{"pem":"x"}]' })).toThrow(/PEM/);
  });
});
