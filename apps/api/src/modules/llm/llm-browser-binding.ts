import type { Request, Response } from 'express';
import { browserBindingCookie } from '../../common/oauth/browser-binding';

/**
 * Ligadura del OAuth de proveedores LLM al navegador (auditoría M1). La lógica vive en
 * `common/oauth/browser-binding.ts` (compartida con el OAuth de conectores); aquí solo se fija la cookie del módulo.
 */
export { bindingMatches, bindingTag, newBrowserBinding } from '../../common/oauth/browser-binding';

export const LLM_OAUTH_COOKIE = 'nexo_llm_oauth';
const cookie = browserBindingCookie(LLM_OAUTH_COOKIE, '/api/llm/oauth');

export function setBindingCookie(res: Response, nonce: string, secure: boolean): void {
  cookie.set(res, nonce, secure);
}

export function clearBindingCookie(res: Response, secure: boolean): void {
  cookie.clear(res, secure);
}

export function readBindingCookie(req: Pick<Request, 'headers'>): string | undefined {
  return cookie.read(req);
}
