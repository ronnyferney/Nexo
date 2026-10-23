import { z } from 'zod';

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
});

export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${issues}`);
  }
  return env;
}
