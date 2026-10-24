import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { CipherContexts } from '../../common/crypto/cipher-context';
import { CryptoService } from '../../common/crypto/crypto.service';
import type { ReplayGuard } from '../../infrastructure/redis/single-use.service';

/** Vida del `state` firmado (ADR 0005, D3). */
export const STATE_TTL_SECONDS = 600;
const AUDIENCE = 'nexo:oauth-state';
/** Ámbito de los `jti` de `state` en el almacén de uso único compartido. */
export const STATE_REPLAY_SCOPE = 'oauth-state';

export interface OAuthStatePayload {
  workspaceId: string;
  connectorId: string;
  userId: string;
  codeVerifier: string;
  /** Huella de la cookie de ligadura al navegador (M1b, `common/oauth/browser-binding.ts`). */
  browserTag?: string;
}

interface StateClaims {
  typ: 'oauth_state';
  ws: string;
  cid: string;
  uid: string;
  /** code_verifier cifrado (AES-256-GCM): el `state` viaja por el navegador y el proveedor. */
  cv: string;
  jti: string;
  /** Huella de la cookie de ligadura al navegador, si el flujo la usa. */
  bt?: string;
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
    const jti = randomBytes(12).toString('base64url');
    const claims: StateClaims = {
      typ: 'oauth_state',
      ws: payload.workspaceId,
      cid: payload.connectorId,
      uid: payload.userId,
      // Ligado (AAD) a este `state` y a quien lo inició: no sirve copiado a otro `state` (B7).
      cv: this.crypto.encrypt(
        payload.codeVerifier,
        CipherContexts.oauthStateVerifier(payload.workspaceId, payload.userId, jti),
      ),
      jti,
      ...(payload.browserTag ? { bt: payload.browserTag } : {}),
    };
    return this.jwt.signAsync(claims, { secret: this.secret, audience: AUDIENCE, expiresIn: ttlSeconds });
  }

  /**
   * Devuelve el contenido del `state` o `null` si es inválido, expiró o ya se usó. Lo marca como consumido.
   *
   * Sin `replayGuard` el uso único es solo por instancia (memoria). Con `replayGuard` (p. ej. `SingleUseService`, en
   * Redis) el `jti` se reclama para todas las réplicas y, si el almacén falla, el `state` se rechaza (auditoría B2).
   * Los proveedores IA ya lo usan; el OAuth de conectores puede adoptarlo pasando la misma opción.
   */
  async consume(state: string, opts: { replayGuard?: ReplayGuard } = {}): Promise<OAuthStatePayload | null> {
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
    if (!claims.jti || this.used.has(claims.jti)) return null;
    this.used.set(claims.jti, claims.exp * 1000);
    if (
      opts.replayGuard &&
      !(await opts.replayGuard.claim(STATE_REPLAY_SCOPE, claims.jti, claims.exp * 1000 - Date.now()))
    )
      return null;
    let codeVerifier: string;
    try {
      codeVerifier = this.crypto.decrypt(
        claims.cv,
        CipherContexts.oauthStateVerifier(claims.ws, claims.uid, claims.jti),
      );
    } catch {
      return null;
    }
    return {
      workspaceId: claims.ws,
      connectorId: claims.cid,
      userId: claims.uid,
      codeVerifier,
      ...(typeof claims.bt === 'string' ? { browserTag: claims.bt } : {}),
    };
  }

  private sweep(): void {
    const now = Date.now();
    for (const [jti, exp] of this.used) if (exp < now) this.used.delete(jti);
  }
}
