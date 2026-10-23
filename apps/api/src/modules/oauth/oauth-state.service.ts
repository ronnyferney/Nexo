import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { CryptoService } from '../../common/crypto/crypto.service';

/** Vida del `state` firmado (ADR 0005, D3). */
export const STATE_TTL_SECONDS = 600;
const AUDIENCE = 'nexo:oauth-state';

export interface OAuthStatePayload {
  workspaceId: string;
  connectorId: string;
  userId: string;
  codeVerifier: string;
}

interface StateClaims {
  typ: 'oauth_state';
  ws: string;
  cid: string;
  uid: string;
  /** code_verifier cifrado (AES-256-GCM): el `state` viaja por el navegador y el proveedor. */
  cv: string;
  jti: string;
}

/** PKCE (RFC 7636): verificador aleatorio de 43 caracteres base64url y desafío S256. */
export function createPkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  return { codeVerifier, codeChallenge: pkceChallenge(codeVerifier) };
}

export function pkceChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

/**
 * Firma y valida el `state` OAuth como JWT de 10 minutos. Usa un secreto derivado del JWT de sesión (y audiencia
 * propia) para que un `state` nunca sea aceptado como token de acceso a la API, y viceversa.
 */
@Injectable()
export class OAuthStateService {
  private readonly secret: string;
  /** `jti` ya consumidos (uso único por instancia) hasta su expiración. */
  private readonly used = new Map<string, number>();

  constructor(
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
    config: ConfigService,
  ) {
    this.secret = createHash('sha256')
      .update(`${config.getOrThrow<string>('jwt.secret')}::oauth-state`)
      .digest('hex');
  }

  sign(payload: OAuthStatePayload, ttlSeconds = STATE_TTL_SECONDS): Promise<string> {
    const claims: StateClaims = {
      typ: 'oauth_state',
      ws: payload.workspaceId,
      cid: payload.connectorId,
      uid: payload.userId,
      cv: this.crypto.encrypt(payload.codeVerifier),
      jti: randomBytes(12).toString('base64url'),
    };
    return this.jwt.signAsync(claims, { secret: this.secret, audience: AUDIENCE, expiresIn: ttlSeconds });
  }

  /** Devuelve el contenido del `state` o `null` si es inválido, expiró o ya se usó. Lo marca como consumido. */
  async consume(state: string): Promise<OAuthStatePayload | null> {
    let claims: StateClaims & { exp: number };
    try {
      claims = await this.jwt.verifyAsync<StateClaims & { exp: number }>(state, {
        secret: this.secret,
        audience: AUDIENCE,
      });
    } catch {
      return null;
    }
    if (claims.typ !== 'oauth_state' || !claims.ws || !claims.cid || !claims.uid || !claims.cv) return null;
    this.sweep();
    if (this.used.has(claims.jti)) return null;
    this.used.set(claims.jti, claims.exp * 1000);
    let codeVerifier: string;
    try {
      codeVerifier = this.crypto.decrypt(claims.cv);
    } catch {
      return null;
    }
    return { workspaceId: claims.ws, connectorId: claims.cid, userId: claims.uid, codeVerifier };
  }

  private sweep(): void {
    const now = Date.now();
    for (const [jti, exp] of this.used) if (exp < now) this.used.delete(jti);
  }
}
