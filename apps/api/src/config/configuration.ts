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
  llm: {
    anthropicApiKey?: string;
    defaultModel: string;
    /**
     * URL base por proveedor del catálogo (`LLM_PROVIDER_URL_OVERRIDES`, JSON `{ "openai": "https://..." }`): gateways
     * corporativos de salida y pruebas. Sustituye la URL renderizada de la plantilla.
     */
    providerUrlOverrides: Record<string, string>;
    /** Pantalla de consentimiento OAuth de OpenRouter (`OPENROUTER_AUTH_URL`). */
    openrouterAuthUrl: string;
    /**
     * Endpoints OAuth por proveedor del catálogo (`LLM_OAUTH_ENDPOINT_OVERRIDES`, JSON
     * `{ "vertex": { "tokenUrl": "https://..." } }`; claves `authorizeUrl`, `tokenUrl`, `deviceUrl`, `revokeUrl`):
     * proxies de identidad corporativos y pruebas. Solo lo define el operador de la plataforma.
     */
    oauthEndpointOverrides: Record<string, OAuthEndpointOverride>;
    /**
     * Proveedor simulado con inicio de sesión OAuth y código de dispositivo servido por la propia API
     * (`LLM_DEV_SIMULATOR=true`), para probar el flujo completo en local sin cuentas ni dominio. Nunca en producción.
     */
    devSimulator: boolean;
    /**
     * Cupo mensual (USD) por workspace de la conexión «Incluido por Nexo» (`ANTHROPIC_API_KEY`, la paga la plataforma):
     * `PLATFORM_LLM_MONTHLY_USD`, por defecto 5; 0 la deshabilita. `PLATFORM_LLM_UNLIMITED_WORKSPACES` (ids separados
     * por coma) exime a workspaces propios o con plan pagado.
     */
    platformMonthlyUsd: number;
    platformUnlimitedWorkspaces: string[];
  };
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

/** `{ "<providerId>": "<url>" }`; un JSON inválido o valores no http(s) se ignoran. */
export function parseUrlOverrides(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (e): e is [string, string] => typeof e[1] === 'string' && /^https?:\/\//.test(e[1]),
      ),
    );
  } catch {
    return {};
  }
}

export interface OAuthEndpointOverride {
  authorizeUrl?: string;
  tokenUrl?: string;
  deviceUrl?: string;
  revokeUrl?: string;
}

const OAUTH_ENDPOINT_KEYS = ['authorizeUrl', 'tokenUrl', 'deviceUrl', 'revokeUrl'] as const;

/** `{ "<providerId>": { tokenUrl, ... } }`; un JSON inválido o valores no http(s) se ignoran. */
export function parseOAuthEndpointOverrides(raw: string | undefined): Record<string, OAuthEndpointOverride> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, OAuthEndpointOverride> = {};
    for (const [provider, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const entry: OAuthEndpointOverride = {};
      for (const key of OAUTH_ENDPOINT_KEYS) {
        const url = (value as Record<string, unknown>)[key];
        if (typeof url === 'string' && /^https?:\/\//.test(url)) entry[key] = url;
      }
      if (Object.keys(entry).length) out[provider] = entry;
    }
    return out;
  } catch {
    return {};
  }
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
    providerUrlOverrides: parseUrlOverrides(process.env.LLM_PROVIDER_URL_OVERRIDES),
    openrouterAuthUrl: process.env.OPENROUTER_AUTH_URL || 'https://openrouter.ai/auth',
    oauthEndpointOverrides: parseOAuthEndpointOverrides(process.env.LLM_OAUTH_ENDPOINT_OVERRIDES),
    // Solo con un entorno de desarrollo o pruebas explícito: un servidor sin NODE_ENV nunca lo expone.
    devSimulator:
      process.env.LLM_DEV_SIMULATOR === 'true' && ['development', 'test'].includes(process.env.NODE_ENV ?? ''),
    platformMonthlyUsd: nonNegative(process.env.PLATFORM_LLM_MONTHLY_USD, 5),
    platformUnlimitedWorkspaces: (process.env.PLATFORM_LLM_UNLIMITED_WORKSPACES ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
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
