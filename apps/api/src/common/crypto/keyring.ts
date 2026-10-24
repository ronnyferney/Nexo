/**
 * Anillo de claves de cifrado (auditoría B7) a partir del entorno:
 *
 * - `ENCRYPTION_KEY` (32 bytes en hexadecimal): clave **legacy**. Descifra los valores del formato anterior (sin
 *   prefijo) y queda registrada con el `kid` reservado `k0`.
 * - `ENCRYPTION_KEYS`: claves adicionales `kid:hex` separadas por coma (p. ej. `k2026a:9f…,k2026b:41…`). El `kid` es
 *   de 1 a 32 caracteres `[A-Za-z0-9_-]` y viaja en claro en cada valor cifrado (`v2:<kid>:…`).
 * - `ENCRYPTION_ACTIVE_KID`: `kid` con el que se cifra todo lo nuevo. Obligatorio si hay más de una clave; con una sola,
 *   es esa. Puede ser `k0` (seguir cifrando con `ENCRYPTION_KEY` mientras la clave nueva se despliega en todas las
 *   réplicas).
 * - `ENCRYPTION_LEGACY_READS=false`: rechaza los valores sin prefijo (tras completar `npm run crypto:rotate`).
 */
export const LEGACY_KID = 'k0';
const KID = /^[A-Za-z0-9_-]{1,32}$/;
const HEX_KEY = /^[0-9a-fA-F]{64}$/;

export interface EncryptionKeyring {
  /** `kid` → clave en hexadecimal (minúsculas). */
  keys: Record<string, string>;
  activeKid: string;
  /** `kid` de la clave que descifra el formato sin prefijo, o `null` si no hay `ENCRYPTION_KEY`. */
  legacyKid: string | null;
  /** Se aceptan valores del formato anterior (sin prefijo). */
  legacyReads: boolean;
}

/** Anillo de claves y errores de configuración (mensajes en español, sin revelar las claves). */
export function parseKeyring(env: Record<string, unknown>): { keyring: EncryptionKeyring | null; errors: string[] } {
  const errors: string[] = [];
  const keys: Record<string, string> = {};
  const legacy = typeof env.ENCRYPTION_KEY === 'string' ? env.ENCRYPTION_KEY.trim() : '';
  if (legacy) {
    if (HEX_KEY.test(legacy)) keys[LEGACY_KID] = legacy.toLowerCase();
    else errors.push('ENCRYPTION_KEY debe ser 32 bytes en hexadecimal (64 caracteres)');
  }
  const list = typeof env.ENCRYPTION_KEYS === 'string' ? env.ENCRYPTION_KEYS.trim() : '';
  for (const raw of list ? list.split(',') : []) {
    const entry = raw.trim();
    if (!entry) continue;
    const sep = entry.indexOf(':');
    const kid = sep > 0 ? entry.slice(0, sep).trim() : '';
    const hex = sep > 0 ? entry.slice(sep + 1).trim() : '';
    if (!KID.test(kid)) {
      errors.push('ENCRYPTION_KEYS: cada entrada debe ser kid:clave con un kid de 1 a 32 caracteres [A-Za-z0-9_-]');
      continue;
    }
    if (kid === LEGACY_KID) {
      errors.push(`ENCRYPTION_KEYS: el kid ${LEGACY_KID} está reservado para ENCRYPTION_KEY`);
      continue;
    }
    if (keys[kid]) {
      errors.push(`ENCRYPTION_KEYS: el kid ${kid} está repetido`);
      continue;
    }
    if (!HEX_KEY.test(hex)) {
      errors.push(`ENCRYPTION_KEYS: la clave ${kid} debe ser 32 bytes en hexadecimal (64 caracteres)`);
      continue;
    }
    keys[kid] = hex.toLowerCase();
  }
  const values = Object.values(keys);
  if (new Set(values).size !== values.length) errors.push('ENCRYPTION_KEYS: dos kid no pueden usar la misma clave');
  if (!values.length && !errors.length) {
    errors.push('Defina ENCRYPTION_KEY (o ENCRYPTION_KEYS con ENCRYPTION_ACTIVE_KID): 32 bytes en hexadecimal');
  }

  const requested = typeof env.ENCRYPTION_ACTIVE_KID === 'string' ? env.ENCRYPTION_ACTIVE_KID.trim() : '';
  let activeKid = requested;
  if (!activeKid) {
    const all = Object.keys(keys);
    if (all.length === 1) activeKid = all[0];
    else if (all.length > 1) errors.push('Defina ENCRYPTION_ACTIVE_KID: hay varias claves de cifrado');
  } else if (!keys[activeKid]) {
    errors.push(
      `ENCRYPTION_ACTIVE_KID (${activeKid}) no corresponde a ninguna clave de ENCRYPTION_KEY/ENCRYPTION_KEYS`,
    );
  }

  const legacyReads =
    String(env.ENCRYPTION_LEGACY_READS ?? '')
      .trim()
      .toLowerCase() !== 'false';
  if (errors.length) return { keyring: null, errors };
  return {
    keyring: { keys, activeKid, legacyKid: keys[LEGACY_KID] ? LEGACY_KID : null, legacyReads },
    errors,
  };
}

/** Claves en hexadecimal con su nombre de variable, para la validación de entropía de `env.validation.ts`. */
export function keyringValues(env: Record<string, unknown>): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  if (typeof env.ENCRYPTION_KEY === 'string' && env.ENCRYPTION_KEY.trim()) {
    out.push({ name: 'ENCRYPTION_KEY', value: env.ENCRYPTION_KEY.trim() });
  }
  const list = typeof env.ENCRYPTION_KEYS === 'string' ? env.ENCRYPTION_KEYS : '';
  for (const raw of list.split(',')) {
    const sep = raw.indexOf(':');
    if (sep <= 0) continue;
    const value = raw.slice(sep + 1).trim();
    if (value) out.push({ name: `ENCRYPTION_KEYS (${raw.slice(0, sep).trim()})`, value });
  }
  return out;
}
