/**
 * Cuenta que autorizó un código de dispositivo (M1b). El código de dispositivo no puede ligarse al navegador con una
 * cookie: quien escribe el código en la página del proveedor puede ser otra persona. Por eso, antes de activar la
 * conexión, Nexo muestra al ADMIN que inició el flujo la cuenta que devolvió el proveedor y exige su confirmación.
 */
export interface AuthorizedAccount {
  /** El proveedor informó la identidad (en el `id_token` o en su endpoint de usuario). */
  available: boolean;
  source: 'id_token' | 'userinfo' | null;
  /** Identificador estable de la cuenta en el proveedor (`sub`). */
  subject?: string;
  email?: string;
  name?: string;
  /** Nombre de usuario (`preferred_username`, `login`, `username`). */
  username?: string;
}

export const ACCOUNT_UNAVAILABLE: AuthorizedAccount = { available: false, source: null };

const MAX = 200;
const text = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  // Sin caracteres de control: el valor se muestra en la consola tal cual.
  // eslint-disable-next-line no-control-regex
  const clean = v.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return clean ? clean.slice(0, MAX) : undefined;
};

/** Campos de identidad de un objeto de claims o de una respuesta de usuario (OIDC, GitHub y similares). */
function pick(claims: Record<string, unknown>, source: 'id_token' | 'userinfo'): AuthorizedAccount {
  const account: AuthorizedAccount = { available: false, source };
  // GitHub y otros devuelven el id numérico.
  const id = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : text(v));
  const subject = id(claims.sub) ?? id(claims.id);
  const email = text(claims.email);
  const name = text(claims.name);
  const username = text(claims.preferred_username) ?? text(claims.login) ?? text(claims.username);
  if (subject) account.subject = subject;
  if (email) account.email = email;
  if (name) account.name = name;
  if (username) account.username = username;
  account.available = !!(email || name || username || subject);
  return account.available ? account : ACCOUNT_UNAVAILABLE;
}

/**
 * Identidad del `id_token` que entregó el endpoint de token. Se recibe directamente del proveedor por TLS (OIDC Core
 * §3.1.3.7: el canal sustituye la verificación de la firma), pero se exige que la audiencia sea la app de Nexo y que no
 * haya expirado. Un token mal formado o de otra audiencia se ignora.
 */
export function accountFromIdToken(idToken: unknown, clientId: string, now = Date.now()): AuthorizedAccount {
  if (typeof idToken !== 'string' || idToken.length > 16_384) return ACCOUNT_UNAVAILABLE;
  const parts = idToken.split('.');
  if (parts.length !== 3) return ACCOUNT_UNAVAILABLE;
  let claims: Record<string, unknown>;
  try {
    const parsed = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ACCOUNT_UNAVAILABLE;
    claims = parsed as Record<string, unknown>;
  } catch {
    return ACCOUNT_UNAVAILABLE;
  }
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) return ACCOUNT_UNAVAILABLE;
  if (typeof claims.exp === 'number' && claims.exp * 1000 < now - 60_000) return ACCOUNT_UNAVAILABLE;
  return pick(claims, 'id_token');
}

/** Identidad de la respuesta del endpoint de usuario del proveedor (OIDC UserInfo u objeto equivalente). */
export function accountFromUserinfo(body: unknown): AuthorizedAccount {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ACCOUNT_UNAVAILABLE;
  return pick(body as Record<string, unknown>, 'userinfo');
}
