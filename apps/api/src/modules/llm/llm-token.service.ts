import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LlmConnection } from '@prisma/client';
import { CryptoService } from '../../common/crypto/crypto.service';
import { HttpClientService } from '../../common/http/http-client.service';
import { ConnectionUnavailableException } from './llm-errors';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LlmOAuthAppError, resolveLlmOAuthApp, type ResolvedLlmOAuthApp } from './llm-oauth-apps';
import { findMechanism, findProvider, type OAuthAppSpec, type ProviderCatalogEntry } from './providers';

/** Renovar si el access token expira en menos de este margen. */
export const LLM_REFRESH_MARGIN_MS = 60_000;
const TOKEN_TIMEOUT_MS = 15_000;

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number | string;
  scope?: string;
  token_type?: string;
  [key: string]: unknown;
}

/** Respuesta de error del endpoint de token (`{ error, error_description }`, RFC 6749 §5.2 / RFC 8628 §3.5). */
export class OAuthTokenError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly body: Record<string, unknown> = {},
  ) {
    super(`El proveedor de identidad rechazó la solicitud de token (HTTP ${status}${code ? `, ${code}` : ''})`);
    this.name = 'OAuthTokenError';
  }
}

/** Tokens OAuth de una conexión nueva (se guardan cifrados). */
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date | null;
  scope: string | null;
}

/** JSON o form-urlencoded (GitHub y otros responden en form por defecto). */
function parseLoose(body: unknown, raw: string): Record<string, unknown> {
  if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // no es JSON
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

export function tokensFrom(token: OAuthTokenResponse): OAuthTokens {
  const expiresIn = Number(token.expires_in ?? NaN);
  return {
    accessToken: token.access_token,
    ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null,
    scope: typeof token.scope === 'string' ? token.scope : null,
  };
}

/**
 * Tokens OAuth de las conexiones LLM (ADR 0002, D8): solicitudes al endpoint de token con la app de Nexo, renovación
 * automática antes de expirar (serializada por conexión) y revocación al desconectar si el proveedor la documenta.
 */
@Injectable()
export class LlmTokenService {
  private readonly logger = new Logger(LlmTokenService.name);
  private readonly refreshing = new Map<string, Promise<string>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly http: HttpClientService,
    private readonly config: ConfigService,
  ) {}

  /** Spec OAuth de la entrada del catálogo (mecanismo OAUTH o DEVICE_CODE con app de Nexo). */
  oauthSpec(entry: ProviderCatalogEntry): OAuthAppSpec | undefined {
    return findMechanism(entry, 'OAUTH')?.oauth ?? findMechanism(entry, 'DEVICE_CODE')?.oauth;
  }

  app(entry: ProviderCatalogEntry, spec: OAuthAppSpec, values: Record<string, string>): ResolvedLlmOAuthApp {
    try {
      return resolveLlmOAuthApp(this.config, entry, spec, values);
    } catch (err) {
      if (err instanceof LlmOAuthAppError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  /** POST form-urlencoded al endpoint de token (o de dispositivo) con la autenticación de cliente de la app. */
  async post(app: ResolvedLlmOAuthApp, url: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const form = new URLSearchParams(params);
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    };
    if (app.clientAuth === 'basic' && app.clientSecret) {
      const basic = Buffer.from(`${encodeURIComponent(app.clientId)}:${encodeURIComponent(app.clientSecret)}`).toString(
        'base64',
      );
      headers.authorization = `Basic ${basic}`;
      form.set('client_id', app.clientId);
    } else {
      form.set('client_id', app.clientId);
      if (app.clientSecret) form.set('client_secret', app.clientSecret);
    }
    const res = await this.http.request({
      url,
      method: 'POST',
      headers,
      body: form.toString(),
      timeoutMs: TOKEN_TIMEOUT_MS,
    });
    const data = parseLoose(res.body, res.rawBody);
    const code = typeof data.error === 'string' ? data.error : null;
    // Algunos proveedores (GitHub) responden los errores del flujo de dispositivo con HTTP 200 y `error`.
    if (!res.ok || code) throw new OAuthTokenError(res.status, code, data);
    return data;
  }

  /** Solicitud de token: exige `access_token`. */
  async token(app: ResolvedLlmOAuthApp, params: Record<string, string>): Promise<OAuthTokenResponse> {
    const data = await this.post(app, app.tokenUrl, {
      ...params,
      ...(app.scopeOnTokenRequest ? { scope: app.scopes.join(' ') } : {}),
    });
    if (typeof data.access_token !== 'string' || !data.access_token) throw new OAuthTokenError(200, null, data);
    return data as OAuthTokenResponse;
  }

  /**
   * Access token vigente de una conexión OAuth. Si expira en menos de 60 s lo renueva con el refresh token; las
   * renovaciones concurrentes de la misma conexión comparten una sola solicitud al proveedor.
   */
  async accessToken(connectionId: string): Promise<string> {
    const c = await this.prisma.llmConnection.findUnique({ where: { id: connectionId } });
    if (!c?.apiKeyCipher) throw new ConnectionUnavailableException(SIGNED_OUT_MESSAGE, 'signed_out');
    if (!this.expiringSoon(c)) return this.crypto.decrypt(c.apiKeyCipher);
    const inflight = this.refreshing.get(connectionId);
    if (inflight) return inflight;
    const p = this.refresh(connectionId).finally(() => this.refreshing.delete(connectionId));
    this.refreshing.set(connectionId, p);
    return p;
  }

  private expiringSoon(c: Pick<LlmConnection, 'oauthExpiresAt'>): boolean {
    return !!c.oauthExpiresAt && c.oauthExpiresAt.getTime() - Date.now() < LLM_REFRESH_MARGIN_MS;
  }

  private async refresh(connectionId: string): Promise<string> {
    const c = await this.prisma.llmConnection.findUnique({ where: { id: connectionId } });
    if (!c?.apiKeyCipher) throw new ConnectionUnavailableException(SIGNED_OUT_MESSAGE, 'signed_out');
    if (!this.expiringSoon(c)) return this.crypto.decrypt(c.apiKeyCipher);
    const entry = c.providerId ? findProvider(c.providerId) : undefined;
    const spec = entry ? this.oauthSpec(entry) : undefined;
    const name = entry?.name ?? c.name;
    if (!entry || !spec) throw new BadRequestException(`La conexión "${c.name}" no admite renovar su sesión OAuth`);
    if (!c.oauthRefreshCipher) {
      throw new ConnectionUnavailableException(
        `La sesión de ${name} expiró y el proveedor no entrega refresh token: vuelva a iniciar sesión en Proveedores IA`,
        'session_expired',
      );
    }
    const app = this.app(entry, spec, stringValues(c.providerFields));
    let token: OAuthTokenResponse;
    try {
      token = await this.token(app, {
        grant_type: 'refresh_token',
        refresh_token: this.crypto.decrypt(c.oauthRefreshCipher),
      });
    } catch (err) {
      const detail = err instanceof OAuthTokenError ? ` (HTTP ${err.status}${err.code ? `, ${err.code}` : ''})` : '';
      this.logger.warn(`Renovación OAuth fallida para la conexión LLM ${connectionId}${detail}`);
      // `invalid_grant` (RFC 6749 §5.2): el grant fue revocado o caducó en el proveedor. La sesión queda cerrada para
      // que la consola lo muestre y ofrezca «Iniciar sesión de nuevo»; un error transitorio conserva los tokens.
      if (err instanceof OAuthTokenError && err.code === 'invalid_grant') {
        await this.prisma.llmConnection.updateMany({
          where: { id: connectionId, oauthRefreshCipher: c.oauthRefreshCipher },
          data: { apiKeyCipher: null, oauthRefreshCipher: null, oauthExpiresAt: null },
        });
        throw new ConnectionUnavailableException(
          `La sesión de ${name} fue revocada o caducó en el proveedor: vuelva a iniciar sesión en Proveedores IA`,
          'signed_out',
        );
      }
      throw new ConnectionUnavailableException(
        `No se pudo renovar la sesión de ${name}${detail}: inténtelo de nuevo o vuelva a iniciar sesión en Proveedores IA`,
        'session_expired',
      );
    }
    const t = tokensFrom(token);
    await this.prisma.llmConnection.update({
      where: { id: connectionId },
      data: {
        apiKeyCipher: this.crypto.encrypt(t.accessToken),
        // Entra ID puede rotar el refresh token: se reemplaza si llega uno nuevo.
        ...(t.refreshToken ? { oauthRefreshCipher: this.crypto.encrypt(t.refreshToken) } : {}),
        oauthExpiresAt: t.expiresAt,
        ...(t.scope ? { oauthScope: t.scope } : {}),
      },
    });
    return t.accessToken;
  }

  /**
   * Revoca el grant en el proveedor si documenta un endpoint de revocación (RFC 7009; hoy Google). Nunca lanza: la
   * desconexión borra los tokens de Nexo de todos modos. Devuelve si se revocó.
   */
  async revoke(c: LlmConnection): Promise<boolean> {
    if (c.credentialType !== 'OAUTH' || !c.providerId) return false;
    const entry = findProvider(c.providerId);
    const spec = entry ? this.oauthSpec(entry) : undefined;
    if (!entry || !spec?.revokeUrl) return false;
    const cipher = c.oauthRefreshCipher ?? c.apiKeyCipher;
    if (!cipher) return false;
    try {
      const app = resolveLlmOAuthApp(this.config, entry, spec, stringValues(c.providerFields));
      const res = await this.http.request({
        url: app.revokeUrl!,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: this.crypto.decrypt(cipher) }).toString(),
        timeoutMs: 10_000,
      });
      if (!res.ok) this.logger.warn(`Revocación OAuth de la conexión LLM ${c.id}: HTTP ${res.status}`);
      return res.ok;
    } catch (err) {
      this.logger.warn(`Revocación OAuth fallida para la conexión LLM ${c.id}: ${(err as Error).message}`);
      return false;
    }
  }
}

/** Error al usar una conexión OAuth cuya sesión se cerró. */
export const SIGNED_OUT_MESSAGE =
  'La sesión de esta conexión está cerrada: vuelva a iniciar sesión en Administración → Proveedores IA';

export function stringValues(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
}
