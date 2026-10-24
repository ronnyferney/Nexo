import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

/**
 * Ligadura del inicio de sesión OAuth al navegador que lo inició (auditoría M1). Sin ella, un atacante podría iniciar
 * el flujo en su workspace y hacer que la víctima autorice el enlace: el token de la víctima quedaría en el workspace
 * del atacante. Al iniciar se entrega al navegador una cookie HttpOnly con un valor aleatorio y el `state` firmado
 * lleva solo su huella; el callback exige que el navegador presente la cookie que corresponde a ese `state`.
 * La web y la API comparten origen (`/api`), y en local las cookies no distinguen puertos.
 */
export const LLM_OAUTH_COOKIE = 'nexo_llm_oauth';
const COOKIE_PATH = '/api/llm/oauth';
const MAX_AGE_MS = 10 * 60 * 1000;

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

export function setBindingCookie(res: Response, nonce: string, secure: boolean): void {
  res.cookie(LLM_OAUTH_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: COOKIE_PATH,
    maxAge: MAX_AGE_MS,
  });
}

export function clearBindingCookie(res: Response, secure: boolean): void {
  res.clearCookie(LLM_OAUTH_COOKIE, { httpOnly: true, sameSite: 'lax', secure, path: COOKIE_PATH });
}

/** Lee la cookie de la cabecera (sin depender de cookie-parser). */
export function readBindingCookie(req: Pick<Request, 'headers'>): string | undefined {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === LLM_OAUTH_COOKIE) {
      const value = part.slice(i + 1).trim();
      return /^[A-Za-z0-9_-]{16,64}$/.test(value) ? value : undefined;
    }
  }
  return undefined;
}
