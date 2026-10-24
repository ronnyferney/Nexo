import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

/**
 * Ligadura de un inicio de sesión OAuth al navegador que lo inició (auditoría M1/M1b). Sin ella, un atacante podría
 * iniciar el flujo en su workspace y hacer que la víctima autorice el enlace: el token de la víctima quedaría en el
 * workspace del atacante. Al iniciar se entrega al navegador una cookie HttpOnly (SameSite=Lax) con un valor aleatorio
 * y el `state` firmado lleva solo su huella; el callback exige que el navegador presente la cookie que corresponde a
 * ese `state` (si no, motivo `browser_mismatch`). La web y la API comparten origen (`/api`), y en local las cookies no
 * distinguen puertos. Lo usan el OAuth de proveedores LLM y el de conectores (ADR 0005).
 */
const MAX_AGE_MS = 10 * 60 * 1000;
const NONCE_FORMAT = /^[A-Za-z0-9_-]{16,64}$/;

export function newBrowserBinding(): { nonce: string; tag: string } {
  const nonce = randomBytes(24).toString('base64url');
  return { nonce, tag: bindingTag(nonce) };
}

/** Huella del valor de la cookie que viaja en el `state` (no permite reconstruir la cookie). */
export function bindingTag(nonce: string): string {
  return createHash('sha256').update(nonce).digest('base64url').slice(0, 22);
}

/** ¿La cookie del navegador corresponde a la huella del `state`? Comparación en tiempo constante. */
export function bindingMatches(tag: string | undefined, nonce: string | undefined): boolean {
  if (!tag || !nonce) return false;
  const a = Buffer.from(bindingTag(nonce));
  const b = Buffer.from(tag);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Cookie de ligadura de un flujo concreto: nombre propio y `path` limitado a su callback. */
export interface BrowserBindingCookie {
  readonly name: string;
  set(res: Response, nonce: string, secure: boolean): void;
  clear(res: Response, secure: boolean): void;
  /** Lee la cookie de la cabecera (sin depender de cookie-parser); `undefined` si falta o tiene otro formato. */
  read(req: Pick<Request, 'headers'>): string | undefined;
}

export function browserBindingCookie(name: string, path: string): BrowserBindingCookie {
  return {
    name,
    set(res, nonce, secure) {
      res.cookie(name, nonce, { httpOnly: true, sameSite: 'lax', secure, path, maxAge: MAX_AGE_MS });
    },
    clear(res, secure) {
      res.clearCookie(name, { httpOnly: true, sameSite: 'lax', secure, path });
    },
    read(req) {
      for (const part of String(req.headers.cookie ?? '').split(';')) {
        const i = part.indexOf('=');
        if (i > 0 && part.slice(0, i).trim() === name) {
          const value = part.slice(i + 1).trim();
          return NONCE_FORMAT.test(value) ? value : undefined;
        }
      }
      return undefined;
    },
  };
}
