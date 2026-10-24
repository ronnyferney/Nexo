import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign as cryptoSign,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';
import { isIP } from 'node:net';
import type { OidcSigningKeyConfig } from '../../../config/configuration';

/**
 * Audiencia de las aserciones para Anthropic. Fuente: platform.claude.com/docs/en/manage-claude/wif-providers/okta
 * («set the audience to `https://api.anthropic.com` … Anthropic validates `aud` against this fixed value»); la regla de
 * federación la fija en `match.audience`.
 */
export const ANTHROPIC_WIF_AUDIENCE = 'https://api.anthropic.com';
/**
 * Vida de cada aserción. Anthropic exige `exp − iat` ≤ el máximo del emisor (1 hora por defecto) y emite un token de
 * vida ≤ 2 × la vida restante del JWT, nunca menor de 60 s (wif-reference, «JWT verification»; workload-identity-
 * federation, «Token lifetime and refresh»). 10 minutos permiten tokens de hasta 20 minutos.
 */
export const WIF_ASSERTION_TTL_S = 600;

type JwsAlg = 'RS256' | 'RS384' | 'RS512' | 'ES256' | 'ES384' | 'ES512';
const HASH: Record<JwsAlg, string> = {
  RS256: 'sha256',
  RS384: 'sha384',
  RS512: 'sha512',
  ES256: 'sha256',
  ES384: 'sha384',
  ES512: 'sha512',
};
const EC_ALG: Record<string, JwsAlg> = { 'P-256': 'ES256', 'P-384': 'ES384', 'P-521': 'ES512' };

interface SigningKey {
  kid: string;
  alg: JwsAlg;
  privateKey?: KeyObject;
  jwk: JsonWebKey & { kid: string; alg: JwsAlg; use: 'sig' };
}

export class OidcKeyError extends Error {}

const b64 = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

/** Huella de la clave pública (RFC 7638): `kid` estable si el operador no fija uno. */
export function jwkThumbprint(jwk: JsonWebKey): string {
  const members =
    jwk.kty === 'RSA' ? { e: jwk.e, kty: jwk.kty, n: jwk.n } : { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
  return createHash('sha256').update(JSON.stringify(members)).digest('base64url');
}

/**
 * Carga una clave del emisor. Solo algoritmos asimétricos que Anthropic acepta (RSA ≥ 2048 bits o EC P-256/384/521;
 * HMAC y `none` se rechazan, wif-reference «JWT verification»). Un PEM público solo se publica (rotación).
 */
export function loadSigningKey(cfg: OidcSigningKeyConfig): SigningKey {
  let privateKey: KeyObject | undefined;
  let publicKey: KeyObject;
  try {
    if (cfg.pem.includes('PRIVATE KEY')) {
      privateKey = createPrivateKey(cfg.pem);
      publicKey = createPublicKey(privateKey);
    } else {
      publicKey = createPublicKey(cfg.pem);
    }
  } catch {
    throw new OidcKeyError('La clave del emisor OIDC no es un PEM válido');
  }
  const jwk = publicKey.export({ format: 'jwk' });
  let alg: JwsAlg;
  if (jwk.kty === 'RSA') {
    if ((publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
      throw new OidcKeyError('La clave RSA del emisor OIDC debe tener al menos 2048 bits');
    }
    alg = 'RS256';
  } else if (jwk.kty === 'EC' && jwk.crv && EC_ALG[jwk.crv]) {
    alg = EC_ALG[jwk.crv];
  } else {
    throw new OidcKeyError('El emisor OIDC solo admite claves RSA o EC (P-256, P-384, P-521)');
  }
  const kid = cfg.kid?.trim() || jwkThumbprint(jwk);
  if (!/^[\w.-]{1,128}$/.test(kid)) throw new OidcKeyError('El kid de la clave del emisor OIDC no es válido');
  return { kid, alg, privateKey, jwk: { ...jwk, kid, alg, use: 'sig' } };
}

/**
 * Nexo como emisor OIDC para Workload Identity Federation con la API de Anthropic (plan de mejora L2).
 *
 * Fuente: platform.claude.com/docs/en/manage-claude/workload-identity-federation y …/wif-reference (2026-10-24):
 * Anthropic valida el JWT con el JWKS del emisor (`discovery`: lee `<issuer>/.well-known/openid-configuration` y su
 * `jwks_uri`; https, puerto 443, DNS público), exige `kid`, `sub`, `iat` no futuro, `exp` futuro, algoritmo asimétrico
 * y trata cada `jti` como de un solo uso por emisor. Por eso cada intercambio firma una aserción nueva.
 *
 * Claves: `LLM_WIF_SIGNING_KEYS` (rotación con `kid`; se publican todas, firma la activa) o `LLM_WIF_SIGNING_KEY`.
 * Fuera de producción, sin clave, se genera una efímera (EC P-256) con aviso: su JWKS cambia en cada arranque.
 */
@Injectable()
export class OidcIssuerService {
  private readonly logger = new Logger(OidcIssuerService.name);
  private readonly keys: SigningKey[];
  private readonly active?: SigningKey;
  /** La clave de firma es efímera (desarrollo). */
  readonly ephemeral: boolean;

  constructor(private readonly config: ConfigService) {
    const configured = (config.get<OidcSigningKeyConfig[]>('llm.wif.signingKeys') ?? []).map(loadSigningKey);
    const kids = new Set<string>();
    for (const k of configured) {
      if (kids.has(k.kid)) throw new OidcKeyError(`kid repetido en LLM_WIF_SIGNING_KEYS: ${k.kid}`);
      kids.add(k.kid);
    }
    const raw = config.get<OidcSigningKeyConfig[]>('llm.wif.signingKeys') ?? [];
    const flagged = configured.filter((k, i) => raw[i]?.active);
    if (flagged.length > 1) throw new OidcKeyError('Solo una clave de LLM_WIF_SIGNING_KEYS puede estar activa');
    if (flagged[0] && !flagged[0].privateKey)
      throw new OidcKeyError('La clave activa del emisor OIDC debe ser privada');
    this.active = flagged[0] ?? configured.find((k) => k.privateKey);
    this.ephemeral = false;
    if (!this.active && process.env.NODE_ENV !== 'production') {
      const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const key = loadSigningKey({ pem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString() });
      configured.push(key);
      this.active = key;
      this.ephemeral = true;
      this.logger.warn(
        'Emisor OIDC de Nexo con clave de firma EFÍMERA (solo desarrollo): defina LLM_WIF_SIGNING_KEYS para que la ' +
          'federación con Anthropic sobreviva a los reinicios.',
      );
    }
    this.keys = configured;
  }

  /** Valor exacto del claim `iss` (y base del documento de descubrimiento). */
  get issuer(): string {
    const publicUrl = (this.config.get<string>('publicUrl') ?? 'http://localhost:3000').replace(/\/+$/, '');
    return (this.config.get<string>('llm.wif.issuer') || `${publicUrl}/api/oidc`).replace(/\/+$/, '');
  }

  get jwksUri(): string {
    return `${this.issuer}/jwks`;
  }

  get discoveryUrl(): string {
    return `${this.issuer}/.well-known/openid-configuration`;
  }

  /** Hay una clave para firmar (configurada o efímera de desarrollo). */
  get signingEnabled(): boolean {
    return !!this.active;
  }

  /**
   * Motivo por el que la federación no está disponible en esta instalación, o `null`. Anthropic solo lee emisores
   * https en el puerto 443 con un nombre DNS público (sin IP literales): `localhost` no sirve.
   */
  unavailableReason(): string | null {
    if (!this.active) {
      return (
        'El operador de Nexo debe configurar la clave de firma del emisor OIDC (LLM_WIF_SIGNING_KEYS, una clave ' +
        'privada RSA o EC en PEM).'
      );
    }
    let url: URL;
    try {
      url = new URL(this.issuer);
    } catch {
      return `El emisor OIDC de Nexo (${this.issuer}) no es una URL válida: revise PUBLIC_URL o LLM_WIF_ISSUER.`;
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const local = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.');
    if (url.protocol !== 'https:' || (url.port && url.port !== '443') || isIP(host) || local) {
      return (
        `Anthropic debe poder leer el emisor OIDC de Nexo (${this.issuer}) por https en el puerto 443 con un dominio ` +
        'público. Publique la API con un dominio (PUBLIC_URL o LLM_WIF_ISSUER) para usar la federación.'
      );
    }
    return null;
  }

  /** `sub` de las aserciones de un workspace de Nexo: la regla de federación lo fija en `subject_prefix` (exacto). */
  subjectFor(workspaceId: string): string {
    return `nexo:workspace:${workspaceId}`;
  }

  /** Documento de descubrimiento OIDC (solo los campos que usa un verificador de JWT). */
  discovery() {
    return {
      issuer: this.issuer,
      jwks_uri: this.jwksUri,
      id_token_signing_alg_values_supported: [...new Set(this.keys.map((k) => k.alg))],
      response_types_supported: ['id_token'],
      subject_types_supported: ['public'],
      claims_supported: ['iss', 'sub', 'aud', 'iat', 'nbf', 'exp', 'jti', 'nexo_workspace_id'],
    };
  }

  /** JWKS público: todas las claves (la activa y las de rotación). Nunca material privado. */
  jwks(): { keys: SigningKey['jwk'][] } {
    return { keys: this.keys.map((k) => ({ ...k.jwk })) };
  }

  /** Firma una aserción nueva (con `jti` único) para el workspace. */
  mint(workspaceId: string): string {
    const key = this.active;
    if (!key?.privateKey) throw new OidcKeyError('El emisor OIDC de Nexo no tiene clave de firma');
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: key.alg, typ: 'JWT', kid: key.kid };
    const payload = {
      iss: this.issuer,
      sub: this.subjectFor(workspaceId),
      aud: ANTHROPIC_WIF_AUDIENCE,
      iat: now,
      nbf: now,
      exp: now + WIF_ASSERTION_TTL_S,
      jti: randomUUID(),
      nexo_workspace_id: workspaceId,
    };
    const data = `${b64(header)}.${b64(payload)}`;
    const signature = cryptoSign(
      HASH[key.alg],
      Buffer.from(data),
      key.alg.startsWith('ES') ? { key: key.privateKey, dsaEncoding: 'ieee-p1363' } : key.privateKey,
    );
    return `${data}.${signature.toString('base64url')}`;
  }
}
