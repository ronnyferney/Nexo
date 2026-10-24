import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { trustProxyError } from './trust-proxy';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatorio'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY debe ser 32 bytes en hexadecimal (64 caracteres)'),
  PORT: z.coerce.number().optional(),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.coerce.number().optional(),
  EXECUTIONS_RETENTION_DAYS: z.coerce.number().int().min(1, 'EXECUTIONS_RETENTION_DAYS debe ser al menos 1').optional(),
  TRUST_PROXY: z
    .string()
    .optional()
    .superRefine((value, ctx) => {
      const error = trustProxyError(value);
      if (error) ctx.addIssue({ code: 'custom', message: error });
    }),
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
  const normalized = name === 'ENCRYPTION_KEY' ? value.toLowerCase() : value;
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
  const key = typeof env.ENCRYPTION_KEY === 'string' ? env.ENCRYPTION_KEY : '';
  const jwtIssue = jwt && weakness('JWT_SECRET', jwt, 6, 64);
  const keyIssue = key && weakness('ENCRYPTION_KEY', key, 8, 128);
  if (jwtIssue) issues.push(jwtIssue);
  if (keyIssue) issues.push(keyIssue);
  if (jwt && key && jwt.toLowerCase() === key.toLowerCase()) {
    issues.push('JWT_SECRET y ENCRYPTION_KEY no pueden ser el mismo valor');
  }
  return issues;
}

export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
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
