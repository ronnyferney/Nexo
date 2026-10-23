export interface AppConfig {
  port: number;
  /** URL pública de la API (callbacks OAuth, conexión de Nexo Edge). */
  publicUrl: string;
  /** URL de la aplicación web (redirecciones tras OAuth). */
  webUrl: string;
  corsOrigins: string[];
  jwt: { secret: string; expiresIn: string };
  encryptionKey: string;
  redis: { host: string; port: number; password?: string };
  llm: { anthropicApiKey?: string; defaultModel: string };
  http: { timeoutMs: number; allowPrivateNetworks: boolean };
  executions: { retentionDays: number };
  /** Nexo Copilot (ADR 0006 D2): modelo de plataforma y cupo mensual por workspace pagado por Nexo. */
  copilot: { provider: string; model: string; monthlyQuotaUsd: number };
  /** Usuario maestro del primer arranque (BOOTSTRAP_ADMIN_*). */
  bootstrapAdmin: { email: string | null; password: string | null; name: string; workspaceName: string };
  /** Administradores de la plataforma Nexo (no son roles de workspace, ADR 0006 D6). */
  platform: { adminEmails: string[] };
}

/**
 * Modelo del Copilot: `COPILOT_PROVIDER`/`COPILOT_MODEL` (por defecto `anthropic`/`claude-opus-5-5`). Sin
 * `ANTHROPIC_API_KEY` (o con un proveedor que no sea de sistema) se usa `mock`/`mock-echo` para desarrollo.
 */
export function copilotModelFrom(env: NodeJS.ProcessEnv): { provider: string; model: string } {
  // Solo conexiones de sistema: el Copilot nunca usa (ni cobra a) las conexiones LLM de un workspace.
  const requested = (env.COPILOT_PROVIDER || 'anthropic').trim();
  if (requested !== 'anthropic' || !env.ANTHROPIC_API_KEY) {
    return { provider: 'mock', model: requested === 'mock' && env.COPILOT_MODEL ? env.COPILOT_MODEL : 'mock-echo' };
  }
  return { provider: requested, model: env.COPILOT_MODEL || 'claude-opus-5-5' };
}

const nonNegative = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
};

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
  webUrl: (process.env.WEB_URL ?? 'http://localhost:4200').replace(/\/+$/, ''),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:4200').split(',').map((o) => o.trim()),
  jwt: {
    secret: process.env.JWT_SECRET ?? '',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  },
  encryptionKey: process.env.ENCRYPTION_KEY ?? '',
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  llm: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    defaultModel: process.env.DEFAULT_MODEL ?? 'claude-opus-5-5',
  },
  http: {
    timeoutMs: parseInt(process.env.CONNECTOR_TIMEOUT_MS ?? '30000', 10),
    allowPrivateNetworks: process.env.CONNECTOR_ALLOW_PRIVATE_NETWORKS === 'true',
  },
  executions: {
    /** Días que se conservan ejecuciones terminadas e historial de rutinas (limpieza diaria). */
    retentionDays: Math.max(parseInt(process.env.EXECUTIONS_RETENTION_DAYS ?? '30', 10) || 30, 1),
  },
  copilot: {
    ...copilotModelFrom(process.env),
    monthlyQuotaUsd: nonNegative(process.env.COPILOT_MONTHLY_QUOTA_USD, 2),
  },
  bootstrapAdmin: {
    /** Usuario maestro del primer arranque (OWNER del workspace inicial). Sin ambos valores no se crea nada. */
    email: process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() || null,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || null,
    name: process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Administrador de Nexo',
    workspaceName: process.env.BOOTSTRAP_WORKSPACE_NAME?.trim() || 'Nexo',
  },
  platform: {
    adminEmails: (process.env.PLATFORM_ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  },
});
