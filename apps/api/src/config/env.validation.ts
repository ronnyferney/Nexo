import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { keyringValues, parseKeyring } from '../common/crypto/keyring';
import { trustProxyError } from './trust-proxy';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatorio'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  // Formato y coherencia de ENCRYPTION_KEY / ENCRYPTION_KEYS / ENCRYPTION_ACTIVE_KID: `parseKeyring` (B7).
  ENCRYPTION_KEY: z.string().optional(),
  ENCRYPTION_KEYS: z.string().optional(),
  ENCRYPTION_ACTIVE_KID: z.string().optional(),
  ENCRYPTION_LEGACY_READS: z
    .string()
    .regex(/^(true|false)?$/i, 'ENCRYPTION_LEGACY_READS debe ser true o false')
    .optional(),
  PORT: z.coerce.number().optional(),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.coerce.number().optional(),
  EXECUTIONS_RETENTION_DAYS: z.coerce.number().int().min(1, 'EXECUTIONS_RETENTION_DAYS debe ser al menos 1').optional(),
  CONVERSATIONS_RETENTION_DAYS: z
    .string()
    .regex(/^(\d+)?$/, 'CONVERSATIONS_RETENTION_DAYS debe ser un número de días (vacío = sin límite)')
    .optional(),
  TRUST_PROXY: z
    .string()
    .optional()
    .superRefine((value, ctx) => {
      const error = trustProxyError(value);
      if (error) ctx.addIssue({ code: 'custom', message: error });
    }),
  REGISTRATION_MODE: z
    .string()
    .regex(/^(open|invite_only)?$/i, 'REGISTRATION_MODE debe ser open o invite_only')
    .optional(),
  SMTP_URL: z
    .string()
    .regex(/^(smtps?:\/\/.+)?$/i, 'SMTP_URL debe empezar por smtp:// o smtps://')
    .optional(),
  MAIL_FROM: z.string().optional(),
  SESSION_COOKIE_SECURE: z
    .string()
    .regex(/^(true|false)?$/i, 'SESSION_COOKIE_SECURE debe ser true o false')
    .optional(),
  SWAGGER_ENABLED: z
    .string()
    .regex(/^(true|false)?$/i, 'SWAGGER_ENABLED debe ser true o false')
    .optional(),
});

/** Valores de ejemplo publicados en los `.env.example` y en los scripts del repositorio: nunca valen como secreto. */
const KNOWN_EXAMPLES = new Set([
  'cambie-este-secreto-por-uno-de-al-menos-32-caracteres',
  'no-se-usa-en-local',
  '0'.repeat(64),
]);
/** Marcadores típicos de un valor de relleno. */
const PLACEHOLDER = /cambie|change.?me|ejemplo|example|placeholder|secreto-de-prueba|your.?secret/i;

/** Entropía de Shannon total (bits) estimada a partir de la frecuencia de cada carácter. */
function shannonBits(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let perChar = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    perChar -= p * Math.log2(p);
  }
  return perChar * value.length;
}

/** `true` si el valor es la repetición de un bloque de a lo sumo la mitad de su longitud (`abcabcabc…`). */
function isPeriodic(value: string): boolean {
  for (let period = 1; period <= value.length / 2; period++) {
    if (value.length % period === 0 && value.slice(0, period).repeat(value.length / period) === value) return true;
  }
  return false;
}

function weakness(name: string, value: string, minDistinct: number, minBits: number): string | null {
  const normalized = name.startsWith('ENCRYPTION_KEY') ? value.toLowerCase() : value;
  if (KNOWN_EXAMPLES.has(normalized) || PLACEHOLDER.test(normalized)) {
    return `${name} es un valor de ejemplo del repositorio: genere uno con openssl rand -hex 32`;
  }
  if (/^0+$/.test(normalized)) return `${name} es una clave en ceros: genere una con openssl rand -hex 32`;
  if (new Set(normalized).size < minDistinct || isPeriodic(normalized) || shannonBits(normalized) < minBits) {
    return `${name} tiene muy baja entropía (caracteres repetidos o un patrón): genere uno con openssl rand -hex 32`;
  }
  return null;
}

/**
 * Secretos débiles: valores de ejemplo conocidos, la clave en ceros y claves de baja entropía (pocos caracteres
 * distintos, un patrón repetido o poca entropía estimada: menos de 64 bits en `JWT_SECRET` y de 128 en
 * `ENCRYPTION_KEY`). Los umbrales dejan amplio margen para valores aleatorios (`openssl rand -hex 16` o más).
 */
export function secretWeaknesses(env: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const jwt = typeof env.JWT_SECRET === 'string' ? env.JWT_SECRET : '';
  const jwtIssue = jwt && weakness('JWT_SECRET', jwt, 6, 64);
  if (jwtIssue) issues.push(jwtIssue);
  // Cada clave del anillo (ENCRYPTION_KEY y las de ENCRYPTION_KEYS) con el mismo criterio (B7).
  for (const { name, value } of keyringValues(env)) {
    const keyIssue = weakness(name, value, 8, 128);
    if (keyIssue) issues.push(keyIssue);
    if (jwt && jwt.toLowerCase() === value.toLowerCase()) {
      issues.push(`JWT_SECRET y ${name} no pueden ser el mismo valor`);
    }
  }
  return issues;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Apps OAuth de la plataforma (`OAUTH_<PROVEEDOR>_CLIENT_ID` / `_CLIENT_SECRET`): se definen en pareja y, en Microsoft
 * (Entra ID), el ID es un GUID y el secreto es el "Valor", no el "Id. de secreto" (también un GUID). Detectarlo al
 * arrancar evita que el error aparezca recién en la pantalla de inicio de sesión del proveedor.
 */
export function oauthAppIssues(env: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const val = (k: string) => {
    const v = env[k];
    return typeof v === 'string' ? v.trim() : '';
  };
  const providers = new Set(
    Object.keys(env)
      .map((k) => /^OAUTH_([A-Z0-9_]+)_CLIENT_(?:ID|SECRET)$/.exec(k)?.[1])
      .filter((p): p is string => !!p && !p.startsWith('LLM_')),
  );
  for (const p of providers) {
    const id = val(`OAUTH_${p}_CLIENT_ID`);
    const secret = val(`OAUTH_${p}_CLIENT_SECRET`);
    if (!!id !== !!secret) {
      issues.push(
        `OAUTH_${p}_CLIENT_ID y OAUTH_${p}_CLIENT_SECRET se definen juntos (falta ${id ? 'el secreto' : 'el ID'})`,
      );
    }
  }
  const msId = val('OAUTH_MICROSOFT_CLIENT_ID');
  const msSecret = val('OAUTH_MICROSOFT_CLIENT_SECRET');
  if (msId && !GUID.test(msId)) {
    issues.push('OAUTH_MICROSOFT_CLIENT_ID debe ser el "Id. de aplicación (cliente)" de Entra ID (formato GUID)');
  }
  if (msSecret && GUID.test(msSecret)) {
    issues.push(
      'OAUTH_MICROSOFT_CLIENT_SECRET parece el "Id. de secreto": use la columna "Valor" del secreto en Entra ID',
    );
  }
  if (msId && msSecret && msId.toLowerCase() === msSecret.toLowerCase()) {
    issues.push('OAUTH_MICROSOFT_CLIENT_ID y OAUTH_MICROSOFT_CLIENT_SECRET tienen el mismo valor');
  }
  return issues;
}

export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const parsed = schema
    .refine((e) => !e.SMTP_URL?.trim() || !!e.MAIL_FROM?.trim(), {
      message: 'MAIL_FROM es obligatorio cuando se define SMTP_URL',
      path: ['MAIL_FROM'],
    })
    .safeParse(env);
  const keyringErrors = [...parseKeyring(env).errors, ...oauthAppIssues(env)];
  if (!parsed.success || keyringErrors.length) {
    const issues = [
      ...(parsed.success ? [] : parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`)),
      ...keyringErrors.map((e) => `  - ${e}`),
    ].join('\n');
    throw new Error(`Configuración inválida:\n${issues}`);
  }
  const weak = secretWeaknesses(env);
  if (weak.length) {
    // En producción un secreto de ejemplo permite falsificar sesiones y descifrar la bóveda: no se arranca.
    if (env.NODE_ENV === 'production') {
      throw new Error(`Configuración inválida:\n${weak.map((w) => `  - ${w}`).join('\n')}`);
    }
    for (const w of weak) new Logger('Configuración').warn(`${w} (se rechazará con NODE_ENV=production)`);
  }
  return env;
}
