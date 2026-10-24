import { parseTrustProxy, type TrustProxy } from './trust-proxy';

export interface AppConfig {
  port: number;
  /** URL pública de la API (callbacks OAuth, conexión de Nexo Edge). */
  publicUrl: string;
  /** URL de la aplicación web (redirecciones tras OAuth). */
  webUrl: string;
  corsOrigins: string[];
  /** `trust proxy` de Express (`TRUST_PROXY`): IP real del cliente para el limitador de peticiones y los registros. */
  trustProxy: TrustProxy;
  /** Documentación Swagger en `/api/docs` (`SWAGGER_ENABLED`; por defecto, solo fuera de producción). */
  swaggerEnabled: boolean;
  /** Registro público (`REGISTRATION_MODE`): `open` o `invite_only` (por defecto en producción). C1. */
  registrationMode: RegistrationMode;
  /** Correo saliente (`SMTP_URL`, `MAIL_FROM`), opcional: invitaciones y verificación de correo. */
  mail: { smtpUrl: string | null; from: string | null };
  jwt: { secret: string; expiresIn: string };
  /**
   * Cookie de sesión de la web (M6): `nexo_session` (HttpOnly, SameSite=Strict, path `/api`) y `nexo_csrf` (legible
   * por la web, doble envío). `cookieSecure` (`SESSION_COOKIE_SECURE`; por defecto, solo en producción) añade `Secure`.
   */
  session: { cookieSecure: boolean };
  encryptionKey: string;
  /**
   * Conexión a Redis compartida por BullMQ, el limitador y el bus del Edge. `tls` (opciones de `tls.connect` para
   * ioredis) solo existe con `REDIS_TLS=true` (ElastiCache con cifrado en tránsito); en local se conecta sin TLS.
   */
  redis: RedisConnectionConfig;
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
    /**
     * Nexo como emisor OIDC para Workload Identity Federation con la API de Anthropic (L2, ADR 0002 D9).
     * `issuer` (`LLM_WIF_ISSUER`, por defecto `${PUBLIC_URL}/api/oidc`): valor exacto del claim `iss`; Anthropic lee
     * `${issuer}/.well-known/openid-configuration`, por lo que debe ser https, puerto 443 y DNS público.
     * `signingKeys` (`LLM_WIF_SIGNING_KEYS`, JSON `[{ "kid", "pem", "active" }]`, o `LLM_WIF_SIGNING_KEY` con un PEM):
     * claves privadas asimétricas (RSA o EC P-256/P-384); las públicas sin `active` solo se publican (rotación).
     */
    wif: { issuer: string; signingKeys: OidcSigningKeyConfig[] };
    /**
     * Rol de IAM del cliente con STS AssumeRole + ExternalId (L3, ADR 0002 D9). `principalArn` (`LLM_AWS_PRINCIPAL_ARN`):
     * rol o usuario de IAM de la plataforma Nexo que aparece en la política de confianza del cliente; sus credenciales
     * salen de la cadena estándar del SDK de AWS. `stsEndpoint` (`LLM_AWS_STS_ENDPOINT`): solo pruebas o VPC endpoint.
     */
    aws: { principalArn: string | null; stsEndpoint: string | null };
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

/** Clave de firma del emisor OIDC de Nexo (`kid` opcional: por defecto la huella RFC 7638 de la clave pública). */
export interface OidcSigningKeyConfig {
  kid?: string;
  pem: string;
  /** Firma los tokens nuevos; si ninguna lo indica, firma la primera clave privada. */
  active?: boolean;
}

/**
 * `LLM_WIF_SIGNING_KEYS` (JSON `[{ kid?, pem, active? }]`, con `\n` escapados) o `LLM_WIF_SIGNING_KEY` (un PEM). Un
 * JSON inválido lanza: una configuración de claves rota no debe pasar desapercibida.
 */
export function parseOidcSigningKeys(env: NodeJS.ProcessEnv): OidcSigningKeyConfig[] {
  const raw = env.LLM_WIF_SIGNING_KEYS?.trim();
  if (raw) {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error('LLM_WIF_SIGNING_KEYS debe ser un arreglo JSON');
    return parsed.map((k: unknown, i) => {
      const o = (k && typeof k === 'object' ? k : {}) as Record<string, unknown>;
      if (typeof o.pem !== 'string' || !o.pem.includes('-----BEGIN')) {
        throw new Error(`LLM_WIF_SIGNING_KEYS[${i}].pem debe ser una clave PEM`);
      }
      return {
        pem: o.pem.replace(/\\n/g, '\n'),
        ...(typeof o.kid === 'string' && o.kid ? { kid: o.kid } : {}),
        ...(o.active === true ? { active: true } : {}),
      };
    });
  }
  const single = env.LLM_WIF_SIGNING_KEY?.trim();
  return single ? [{ pem: single.replace(/\\n/g, '\n') }] : [];
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

export type RegistrationMode = 'open' | 'invite_only';

/** `REGISTRATION_MODE=open|invite_only`; sin definir, `invite_only` en producción y `open` fuera de ella. */
export function registrationModeFrom(env: NodeJS.ProcessEnv): RegistrationMode {
  const raw = env.REGISTRATION_MODE?.trim().toLowerCase();
  if (raw === 'open' || raw === 'invite_only') return raw;
  return env.NODE_ENV === 'production' ? 'invite_only' : 'open';
}

export interface RedisConnectionConfig {
  host: string;
  port: number;
  password?: string;
  /** Presente solo con `REDIS_TLS=true`: ioredis abre la conexión con TLS (certificados de confianza del sistema). */
  tls?: Record<string, never>;
}

/** `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` y `REDIS_TLS=true` (opcional; sin definir o `false`, sin TLS). B8. */
export function redisConfigFrom(env: NodeJS.ProcessEnv): RedisConnectionConfig {
  const tls = env.REDIS_TLS?.trim().toLowerCase() === 'true';
  return {
    host: env.REDIS_HOST ?? 'localhost',
    port: parseInt(env.REDIS_PORT ?? '6379', 10),
    password: env.REDIS_PASSWORD || undefined,
    ...(tls ? { tls: {} } : {}),
  };
}

/** `SESSION_COOKIE_SECURE=true|false` manda; sin definir, las cookies de sesión llevan `Secure` solo en producción. */
export function sessionCookieSecureFrom(env: NodeJS.ProcessEnv): boolean {
  const raw = env.SESSION_COOKIE_SECURE?.trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return env.NODE_ENV === 'production';
}

/** Swagger: `SWAGGER_ENABLED=true|false` manda; sin definir, se publica solo fuera de producción. */
export function swaggerEnabledFrom(env: NodeJS.ProcessEnv): boolean {
  const raw = env.SWAGGER_ENABLED?.trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return env.NODE_ENV !== 'production';
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
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY, process.env.NODE_ENV),
  swaggerEnabled: swaggerEnabledFrom(process.env),
  registrationMode: registrationModeFrom(process.env),
  mail: { smtpUrl: process.env.SMTP_URL?.trim() || null, from: process.env.MAIL_FROM?.trim() || null },
  jwt: {
    secret: process.env.JWT_SECRET ?? '',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  },
  session: { cookieSecure: sessionCookieSecureFrom(process.env) },
  encryptionKey: process.env.ENCRYPTION_KEY ?? '',
  redis: redisConfigFrom(process.env),
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
    wif: {
      issuer: (
        process.env.LLM_WIF_ISSUER?.trim() ||
        `${(process.env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/+$/, '')}/api/oidc`
      ).replace(/\/+$/, ''),
      signingKeys: parseOidcSigningKeys(process.env),
    },
    aws: {
      principalArn: process.env.LLM_AWS_PRINCIPAL_ARN?.trim() || null,
      stsEndpoint: process.env.LLM_AWS_STS_ENDPOINT?.trim() || null,
    },
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
