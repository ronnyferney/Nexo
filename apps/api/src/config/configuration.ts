export interface AppConfig {
  port: number;
  corsOrigins: string[];
  jwt: { secret: string; expiresIn: string };
  encryptionKey: string;
  redis: { host: string; port: number; password?: string };
  llm: { anthropicApiKey?: string; defaultModel: string };
  http: { timeoutMs: number; allowPrivateNetworks: boolean };
  executions: { retentionDays: number };
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
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
});
