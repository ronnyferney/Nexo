/**
 * Valor de `trust proxy` de Express (`TRUST_PROXY`): decide qué saltos de `X-Forwarded-For` son de confianza para
 * obtener la IP real del cliente (`req.ip`), que usan el limitador de peticiones y los registros.
 *
 * - Sin definir: en producción `loopback, uniquelocal` (confía en cualquier salto con IP privada o de loopback, que es
 *   lo que hay entre el cliente y la API en el piloto ALB → nginx → API y en `docker compose`: la primera IP pública
 *   de la cadena es la del cliente y no se puede suplantar con un `X-Forwarded-For` inventado). Fuera de producción,
 *   solo `loopback` (proxy de `ng serve` o pruebas en la misma máquina).
 * - `false`: ignora `X-Forwarded-For` (API expuesta directamente, sin proxies).
 * - Un entero `N`: confía exactamente en los últimos N saltos (topología fija; p. ej. `2` para ALB + nginx).
 * - Lista separada por comas de IP, CIDR o los nombres `loopback`, `linklocal`, `uniquelocal`.
 * - `true` confía en todo el encabezado: cualquiera elige su IP. Solo detrás de un proxy que lo reescriba entero.
 */
export type TrustProxy = boolean | number | string[];

const NAMED = new Set(['loopback', 'linklocal', 'uniquelocal']);
const IPV4_CIDR = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
const IPV6_CIDR = /^[0-9a-f:.]+(\/\d{1,3})?$/i;

/** Valida el formato de `TRUST_PROXY`; devuelve el mensaje de error o `null` si es válido. */
export function trustProxyError(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value || /^(true|false|\d+)$/i.test(value)) return null;
  const invalid = value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => !NAMED.has(v) && !IPV4_CIDR.test(v) && !(v.includes(':') && IPV6_CIDR.test(v)));
  return invalid.length
    ? `TRUST_PROXY no reconoce ${invalid.map((v) => `"${v}"`).join(', ')}: use true, false, un número de saltos o una lista de IP/CIDR/loopback/linklocal/uniquelocal`
    : null;
}

export function parseTrustProxy(raw: string | undefined, nodeEnv: string | undefined): TrustProxy {
  const value = raw?.trim();
  if (!value) return nodeEnv === 'production' ? ['loopback', 'uniquelocal'] : ['loopback'];
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}
