import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Sesión de la web en cookie (auditoría M6). El JWT ya no vive en `localStorage`: viaja en `nexo_session`, una cookie
 * HttpOnly que el JavaScript de la página no puede leer (una XSS ya no se lleva un token persistente).
 *
 * Atributos:
 * - `HttpOnly`, `Path=/api` (solo viaja hacia la API) y `Secure` en producción (`SESSION_COOKIE_SECURE`).
 * - `SameSite=Strict`: la web y la API comparten sitio (`/api` detrás del mismo nginx), y ningún flujo necesita la
 *   sesión en una navegación que llega desde otro sitio: los callbacks OAuth (`/api/oauth/callback`,
 *   `/api/llm/oauth/:p/callback`) son públicos y se validan con el `state` firmado y su propia cookie de ligadura
 *   (`nexo_llm_oauth`, Lax). Tras volver del proveedor, la web pide `/api/auth/me` desde su propio origen (petición del
 *   mismo sitio), así que la cookie Strict sí viaja. Lo mismo con los enlaces de los correos (invitación, verificación).
 *
 * CSRF: doble envío firmado. Junto a la sesión se emite `nexo_csrf` (legible por la web, `Path=/`), cuyo valor es un
 * HMAC del token de sesión con un secreto derivado de `JWT_SECRET`. Toda petición autenticada con la cookie que
 * modifica datos (POST, PUT, PATCH, DELETE) debe repetirlo en `X-CSRF-Token`; el servidor lo recalcula a partir de la
 * cookie de sesión, de modo que un valor plantado por un subdominio no sirve. Se eligió frente a comparar `Origin`
 * con `CORS_ORIGINS` porque no depende de la topología del despliegue (mismo origen detrás de nginx, varios orígenes,
 * proxies que reescriben cabeceras). Las peticiones con `Authorization: Bearer` o `x-api-key` no llevan cookie
 * ambiental y no lo necesitan.
 */
export const SESSION_COOKIE = 'nexo_session';
export const CSRF_COOKIE = 'nexo_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const SESSION_COOKIE_PATH = '/api';
/** `nexo_csrf` en `/`: la página (rutas fuera de `/api`) debe poder leerla con `document.cookie`. */
export const CSRF_COOKIE_PATH = '/';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Lee una cookie de la cabecera `Cookie` (sin depender de cookie-parser). */
export function readCookie(req: Pick<Request, 'headers'>, name: string): string | undefined {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      const value = part.slice(i + 1).trim();
      return value || undefined;
    }
  }
  return undefined;
}

export function isUnsafeMethod(method: string | undefined): boolean {
  return UNSAFE_METHODS.has((method ?? '').toUpperCase());
}

/** Segundos hasta `exp` del JWT (sin verificar la firma: el token lo acabamos de emitir). */
function secondsToExpiry(token: string): number | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
      exp?: number;
    };
    return typeof payload.exp === 'number' ? Math.max(payload.exp - Math.floor(Date.now() / 1000), 0) : undefined;
  } catch {
    return undefined;
  }
}

@Injectable()
export class SessionCookieService {
  readonly secure: boolean;
  /** Secreto derivado: el token CSRF no sirve como sesión ni permite reconstruirla. */
  private readonly csrfSecret: string;

  constructor(config: ConfigService) {
    this.secure = config.get<boolean>('session.cookieSecure') ?? false;
    this.csrfSecret = createHmac('sha256', config.getOrThrow<string>('jwt.secret')).update('nexo::csrf').digest('hex');
  }

  /** Token CSRF de una sesión: HMAC del JWT de sesión. */
  csrfTokenFor(sessionToken: string): string {
    return createHmac('sha256', this.csrfSecret).update(sessionToken).digest('base64url');
  }

  /** ¿La cabecera `X-CSRF-Token` corresponde a esta sesión? Comparación en tiempo constante. */
  csrfMatches(req: Pick<Request, 'headers'>, sessionToken: string): boolean {
    const raw = req.headers[CSRF_HEADER];
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (!header) return false;
    const expected = Buffer.from(this.csrfTokenFor(sessionToken));
    const given = Buffer.from(header);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /** Emite (o renueva) la sesión: cookie HttpOnly con el JWT y cookie CSRF legible, con la misma vida que el token. */
  set(res: Response, accessToken: string): void {
    const seconds = secondsToExpiry(accessToken);
    const maxAge = seconds !== undefined ? seconds * 1000 : undefined;
    res.cookie(SESSION_COOKIE, accessToken, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'strict',
      path: SESSION_COOKIE_PATH,
      maxAge,
    });
    this.setCsrf(res, accessToken, maxAge);
  }

  /** Solo la cookie CSRF (p. ej. si el navegador la perdió pero conserva la sesión). */
  setCsrf(res: Response, sessionToken: string, maxAge?: number): void {
    res.cookie(CSRF_COOKIE, this.csrfTokenFor(sessionToken), {
      httpOnly: false,
      secure: this.secure,
      sameSite: 'strict',
      path: CSRF_COOKIE_PATH,
      maxAge,
    });
  }

  clear(res: Pick<Response, 'clearCookie'>): void {
    res.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'strict',
      path: SESSION_COOKIE_PATH,
    });
    res.clearCookie(CSRF_COOKIE, { httpOnly: false, secure: this.secure, sameSite: 'strict', path: CSRF_COOKIE_PATH });
  }
}
