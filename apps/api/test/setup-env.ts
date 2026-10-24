/**
 * Variables de entorno de la suite E2E. Se cargan (setupFiles) antes de importar AppModule en cada archivo.
 * Las variables definidas aquí tienen prioridad sobre `apps/api/.env` (ConfigModule no sobrescribe process.env).
 */
const env: Record<string, string> = {
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgresql://nexo:nexo@localhost:5432/nexo?schema=public',
  REDIS_HOST: process.env.E2E_REDIS_HOST ?? 'localhost',
  REDIS_PORT: process.env.E2E_REDIS_PORT ?? '6379',
  REDIS_PASSWORD: process.env.E2E_REDIS_PASSWORD ?? '',
  JWT_SECRET: 'e2e-jwt-secret-0123456789abcdef0123456789abcdef',
  JWT_EXPIRES_IN: '1h',
  ENCRYPTION_KEY: '0f1e2d3c4b5a69788796a5b4c3d2e1f000112233445566778899aabbccddeeff',
  CONNECTOR_ALLOW_PRIVATE_NETWORKS: 'true',
  CONNECTOR_TIMEOUT_MS: '10000',
  WORKER_ENABLED: 'true',
  WORKER_CONCURRENCY: '2',
  // Nunca llamar a un LLM real desde la suite.
  ANTHROPIC_API_KEY: '',
  // El simulador local solo se activa en su propia suite (llm-dev-simulator.e2e-spec.ts).
  LLM_DEV_SIMULATOR: 'false',
  LOG_LEVEL: 'silent',
};
Object.assign(process.env, env);
