import { ForbiddenException } from '@nestjs/common';

/**
 * Secretos permitidos por conector (auditoría A4). Un conector solo puede resolver los secretos de la bóveda que un
 * ADMIN incluyó en `Connector.allowedSecrets`; cualquier otra referencia `{{ secrets.X }}` en su configuración, su
 * autenticación o las definiciones de sus operaciones se rechaza antes de leer la bóveda, de modo que el error no
 * revela si el secreto existe.
 */

/** Mismo patrón de expresión que `common/template/template.engine.ts`. */
const EXPR = /\{\{\s*([^}]+?)\s*\}\}/g;
/** Formato de nombre de secreto de la bóveda (`UpsertSecretDto`). */
export const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
/** Tope de nombres en la lista de un conector. */
export const MAX_ALLOWED_SECRETS = 100;

export interface SecretRefs {
  /** Nombres referenciados como `secrets.NOMBRE` (o `secrets[NOMBRE]`). */
  names: string[];
  /** Hay alguna expresión que usa el objeto `secrets` completo (p. ej. `{{ secrets | json }}`). */
  wholeVault: boolean;
}

/** Recorre cadenas, arreglos y objetos y extrae las referencias a la bóveda de sus plantillas. */
export function collectSecretRefs(...values: unknown[]): SecretRefs {
  const names = new Set<string>();
  let wholeVault = false;
  const visit = (value: unknown, depth: number): void => {
    if (depth > 64) return;
    if (typeof value === 'string') {
      for (const match of value.matchAll(EXPR)) {
        const ref = secretRefOf(match[1]);
        if (ref === null) continue;
        if (ref === '') wholeVault = true;
        else names.add(ref);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item, depth + 1);
    }
  };
  for (const v of values) visit(v, 0);
  return { names: [...names].sort(), wholeVault };
}

/**
 * Nombre del secreto que usa una expresión: `null` si no toca `secrets`, `''` si usa el objeto completo. Normaliza la
 * ruta igual que `getPath` (`a[b]` → `a.b`).
 */
function secretRefOf(expression: string): string | null {
  const path = expression.split('|')[0].trim();
  if (/^'.*'$|^".*"$/.test(path)) return null;
  const parts = path
    .replace(/\[(\w+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  if (parts[0] !== 'secrets') return null;
  return parts[1] ?? '';
}

/** Referencias que la lista de permitidos no cubre (el objeto completo de la bóveda nunca se permite). */
export function disallowedSecretRefs(refs: SecretRefs, allowed: readonly string[]): string[] {
  const set = new Set(allowed);
  const blocked = refs.names.filter((n) => !set.has(n));
  return refs.wholeVault ? ['secrets', ...blocked] : blocked;
}

/** Error de resolución: lista solo los nombres escritos en el conector, nunca si existen en la bóveda. */
export class SecretNotAllowedException extends ForbiddenException {
  constructor(readonly names: string[]) {
    super(
      names.includes('secrets')
        ? 'El conector no puede usar la bóveda completa ({{ secrets }}); referencie cada secreto por su nombre'
        : `El conector referencia secretos no permitidos: ${names.join(', ')}. ` +
            'Un administrador debe autorizarlos en «Secretos permitidos» del conector',
    );
  }
}

/** Lanza `SecretNotAllowedException` si hay referencias fuera de la lista; devuelve los nombres a resolver. */
export function assertSecretRefsAllowed(refs: SecretRefs, allowed: readonly string[]): string[] {
  const blocked = disallowedSecretRefs(refs, allowed);
  if (blocked.length) throw new SecretNotAllowedException(blocked);
  return refs.names;
}

/**
 * Campos de `config` y `auth` que deciden a qué servidor viajan los secretos (URL base, endpoints de descubrimiento,
 * host/puerto de BD, agente Edge, URLs OAuth). Cambiarlos en un conector con secretos permitidos equivale a reenviar
 * esos secretos a otro destino, así que solo puede hacerlo un ADMIN.
 */
const DESTINATION_KEYS = {
  config: [
    'baseUrl',
    'openApiUrl',
    'endpoint',
    'wsdlUrl',
    'url',
    'transport',
    'engine',
    'mode',
    'host',
    'port',
    'edgeId',
    'connectionKey',
  ],
  auth: ['tokenUrl', 'authorizeUrl', 'revokeUrl', 'accountLabel', 'instanceUrl'],
} as const;

/** JSON con las claves ordenadas: PostgreSQL (`jsonb`) no conserva el orden de las claves. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Huella estable de los campos de destino de un conector. */
export function destinationFingerprint(config: unknown, auth: unknown): string {
  const pick = (source: unknown, keys: readonly string[]) => {
    const obj = source && typeof source === 'object' ? (source as Record<string, unknown>) : {};
    return keys.map((k) => [k, obj[k] ?? null]);
  };
  return stableJson([pick(config, DESTINATION_KEYS.config), pick(auth, DESTINATION_KEYS.auth)]);
}
