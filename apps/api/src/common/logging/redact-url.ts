/** Marcador que sustituye los valores sensibles en los registros. */
export const REDACTED = '[REDACTADO]';

/**
 * Parámetros de query que nunca se registran: `code`/`state` de los callbacks OAuth (conectores y proveedores IA) y
 * cualquier token o credencial que un cliente pueda enviar por la URL.
 */
const SENSITIVE_QUERY = new Set([
  'code',
  'state',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'device_code',
  'api_key',
  'apikey',
  'key',
  'password',
]);

/**
 * Rutas cuyo segmento es una credencial de un solo uso o de larga vida: el token de `/api/hooks/<token>` (webhooks),
 * el de las invitaciones (`/api/auth/invitations/<token>[/accept]`) y el de verificación de correo.
 */
const TOKEN_PATHS = [
  /^(\/(?:api\/)?hooks\/)[^/?#]+/i,
  /^(\/(?:api\/)?auth\/invitations\/)[^/?#]+/i,
  /^(\/(?:api\/)?auth\/verify-email\/)(?!request(?:[/?#]|$))[^/?#]+/i,
];

/**
 * URL apta para los registros: oculta los tokens de webhooks, invitaciones y verificación de correo, y los valores de los parámetros sensibles de la query
 * (se conserva el nombre para poder diagnosticar). Nunca lanza: ante una URL ilegible devuelve solo la ruta.
 */
export function redactUrl(url: string | undefined): string {
  if (!url) return '';
  const q = url.indexOf('?');
  const path = TOKEN_PATHS.reduce(
    (acc, pattern) => acc.replace(pattern, `$1${REDACTED}`),
    q === -1 ? url : url.slice(0, q),
  );
  if (q === -1) return path;
  const query = url
    .slice(q + 1)
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      const rawName = eq === -1 ? pair : pair.slice(0, eq);
      let name = rawName;
      try {
        name = decodeURIComponent(rawName.replace(/\+/g, ' '));
      } catch {
        // nombre mal codificado: se compara tal cual
      }
      return eq !== -1 && SENSITIVE_QUERY.has(name.trim().toLowerCase()) ? `${rawName}=${REDACTED}` : pair;
    })
    .join('&');
  return `${path}?${query}`;
}
