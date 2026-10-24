import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Connector, OAuthCredential } from '@prisma/client';
import { CipherContexts } from '../../common/crypto/cipher-context';
import { CryptoService } from '../../common/crypto/crypto.service';
import { bindingMatches, browserBindingCookie, newBrowserBinding } from '../../common/oauth/browser-binding';
import { ROLE_RANK } from '../../common/decorators/roles.decorator';
import { HttpClientService } from '../../common/http/http-client.service';
import { getPath, render } from '../../common/template/template.engine';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SingleUseService } from '../../infrastructure/redis/single-use.service';
import type { OAuth2CodeAuth } from '../connectors/domain/connector.types';
import { assertSecretRefsAllowed, collectSecretRefs } from '../connectors/domain/secret-refs';
import { SecretsService } from '../workspaces/secrets.service';
import { OAUTH_PROVIDERS, platformEnvName } from './oauth.providers';
import { createPkce, OAuthStateService } from './oauth-state.service';

/** Renovar si el access token expira en menos de este margen. */
export const REFRESH_MARGIN_MS = 60_000;

/** Client ID abreviado para mostrarlo (no es secreto, pero basta con reconocerlo): `caac…e5a6`. */
export function maskClientId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

/** Cookie de ligadura al navegador del OAuth de conectores (M1b): solo viaja al callback `/api/oauth/callback`. */
export const CONNECTOR_OAUTH_COOKIE = browserBindingCookie('nexo_connector_oauth', '/api/oauth');

/** Motivos de error que la web recibe en `?oauth=error&reason=` (nunca detalles del proveedor). */
export type OAuthErrorReason =
  | 'invalid_state'
  | 'browser_mismatch'
  | 'access_denied'
  | 'missing_code'
  | 'forbidden'
  | 'not_found'
  | 'not_configured'
  | 'exchange_failed';

interface ResolvedApp {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number | string;
  scope?: string;
  [key: string]: unknown;
}

class TokenEndpointError extends Error {
  constructor(readonly status: number) {
    super(`El proveedor OAuth rechazó la solicitud de token (HTTP ${status})`);
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Separador de scopes del proveedor: espacio (RFC 6749) salvo que el conector indique otro (Slack: coma). */
export const scopeSeparator = (auth: Pick<OAuth2CodeAuth, 'scopeSeparator'>): string =>
  typeof auth.scopeSeparator === 'string' && auth.scopeSeparator.length > 0 ? auth.scopeSeparator : ' ';

/**
 * OAuth2 de usuario (ADR 0005, D3): authorization code + PKCE S256, `state` firmado, tokens cifrados en
 * `OAuthCredential` y renovación serializada por conector con `refresh_token`.
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private readonly refreshing = new Map<string, Promise<string>>();
  private readonly publicUrl: string;
  private readonly webUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly http: HttpClientService,
    private readonly secrets: SecretsService,
    private readonly state: OAuthStateService,
    private readonly config: ConfigService,
    /** Uso único del `state` compartido entre réplicas (Redis, falla cerrado; B2). */
    private readonly singleUse: SingleUseService,
  ) {
    this.publicUrl = config.get<string>('publicUrl') ?? 'http://localhost:3000';
    this.webUrl = config.get<string>('webUrl') ?? 'http://localhost:4200';
  }

  get redirectUri(): string {
    return `${this.publicUrl}/api/oauth/callback`;
  }

  /** Cookie `Secure` cuando la API se publica por https. */
  /** ¿Hay app OAuth de la plataforma para este proveedor? Con su client ID abreviado (nunca el secreto). */
  platformApp(provider: string): { available: boolean; clientIdHint: string | null } {
    const id = str(this.config.get<string>(platformEnvName(provider, 'CLIENT_ID')));
    const secret = str(this.config.get<string>(platformEnvName(provider, 'CLIENT_SECRET')));
    const available = !!(OAUTH_PROVIDERS[provider] && id && secret);
    return { available, clientIdHint: available ? maskClientId(id) : null };
  }

  get secureCookies(): boolean {
    return this.publicUrl.startsWith('https://');
  }

  // ---------- Consentimiento ----------
  /**
   * URL de consentimiento. `browserNonce` debe entregarse al navegador solo en la cookie HttpOnly
   * `CONNECTOR_OAUTH_COOKIE` (nunca en el cuerpo): el `state` lleva su huella y el callback la exige (M1b).
   */
  async start(
    workspaceId: string,
    connectorId: string,
    userId?: string,
  ): Promise<{ authorizeUrl: string; browserNonce: string }> {
    if (!userId) throw new BadRequestException('Inicie la conexión OAuth desde una sesión de usuario (no con API key)');
    const { auth, app } = await this.load(workspaceId, connectorId);
    const { codeVerifier, codeChallenge } = createPkce();
    const binding = newBrowserBinding();
    const state = await this.state.sign({ workspaceId, connectorId, userId, codeVerifier, browserTag: binding.tag });

    const url = new URL(app.authorizeUrl);
    for (const [k, v] of Object.entries(auth.authorizeParams ?? {})) url.searchParams.set(k, String(v));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    if (auth.scopes?.length) url.searchParams.set('scope', auth.scopes.join(scopeSeparator(auth)));
    url.searchParams.set('state', state);
    if (auth.pkce !== false) {
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return { authorizeUrl: url.toString(), browserNonce: binding.nonce };
  }

  /**
   * Procesa el callback público y devuelve la URL (siempre bajo `webUrl`) a la que se redirige al navegador.
   * @param browserNonce valor de la cookie `CONNECTOR_OAUTH_COOKIE` que presentó el navegador.
   */
  async callback(query: { code?: string; state?: string; error?: string }, browserNonce?: string): Promise<string> {
    // B2: el `jti` se reclama en Redis para todas las réplicas; si Redis no responde, el `state` se rechaza.
    const payload = query.state ? await this.state.consume(query.state, { replayGuard: this.singleUse }) : null;
    if (!payload) return this.webRedirect(null, 'invalid_state');
    const { workspaceId, connectorId, userId, codeVerifier } = payload;
    // El consentimiento debe volver al mismo navegador que lo inició (M1b); el `state` ya quedó consumido.
    if (!bindingMatches(payload.browserTag, browserNonce)) return this.webRedirect(connectorId, 'browser_mismatch');
    if (query.error) return this.webRedirect(connectorId, 'access_denied');
    if (!query.code) return this.webRedirect(connectorId, 'missing_code');

    // El usuario que inició el flujo debe seguir siendo EDITOR+ del workspace.
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { role: true },
    });
    if (!membership || ROLE_RANK[membership.role] < ROLE_RANK.EDITOR) return this.webRedirect(connectorId, 'forbidden');

    let loaded: Awaited<ReturnType<OAuthService['load']>>;
    try {
      loaded = await this.load(workspaceId, connectorId);
    } catch (err) {
      return this.webRedirect(connectorId, err instanceof NotFoundException ? 'not_found' : 'not_configured');
    }

    try {
      const token = await this.tokenRequest(loaded.app, {
        grant_type: 'authorization_code',
        code: query.code,
        redirect_uri: this.redirectUri,
        ...(loaded.auth.pkce !== false ? { code_verifier: codeVerifier } : {}),
      });
      await this.store(loaded.connector, loaded.auth, token, null);
    } catch (err) {
      this.logger.warn(`OAuth callback fallido para el conector ${connectorId}: ${(err as Error).message}`);
      return this.webRedirect(connectorId, 'exchange_failed');
    }
    return `${this.webUrl}/connectors/${encodeURIComponent(connectorId)}?oauth=ok`;
  }

  // ---------- Estado / desconexión ----------
  async status(workspaceId: string, connectorId: string) {
    await this.connector(workspaceId, connectorId);
    const cred = await this.prisma.oAuthCredential.findUnique({ where: { connectorId } });
    return {
      connected: !!cred,
      accountLabel: cred?.accountLabel ?? null,
      scope: cred?.scope ?? null,
      expiresAt: cred?.expiresAt ?? null,
      app: await this.appSummary(workspaceId, connectorId),
    };
  }

  /**
   * Qué app OAuth usará el inicio de sesión (la de la plataforma o una propia) con su client ID abreviado, o el motivo
   * por el que no se puede usar. Permite diagnosticar en Nexo un client ID equivocado antes de que el proveedor lo
   * rechace en su pantalla (p. ej. AADSTS700016 en Microsoft). El client ID no es secreto; el secreto nunca se expone.
   */
  private async appSummary(
    workspaceId: string,
    connectorId: string,
  ): Promise<{ kind: 'platform' | 'own' | null; clientIdHint: string | null; problem: string | null }> {
    let own = false;
    try {
      const { auth, app } = await this.load(workspaceId, connectorId);
      own = !!str(auth.clientIdRef);
      return { kind: own ? 'own' : 'platform', clientIdHint: maskClientId(app.clientId), problem: null };
    } catch (err) {
      return { kind: null, clientIdHint: null, problem: (err as Error).message };
    }
  }

  async disconnect(workspaceId: string, connectorId: string) {
    const connector = await this.connector(workspaceId, connectorId);
    const cred = await this.prisma.oAuthCredential.findUnique({ where: { connectorId } });
    if (!cred) return { connected: false };
    await this.revoke(connector, cred).catch((err: Error) =>
      this.logger.warn(`Revocación OAuth fallida para el conector ${connectorId}: ${err.message}`),
    );
    await this.prisma.oAuthCredential.deleteMany({ where: { connectorId } });
    return { connected: false };
  }

  // ---------- Runtime (AuthResolverService) ----------
  /**
   * Access token vigente del conector. Si expira en menos de 60 s lo renueva con el refresh token; las renovaciones
   * concurrentes del mismo conector comparten una sola solicitud al proveedor.
   * @param auth autenticación `oauth2_code` ya renderizada con los secretos del workspace.
   */
  async accessToken(connectorId: string, auth: OAuth2CodeAuth): Promise<string> {
    const cred = await this.prisma.oAuthCredential.findUnique({
      where: { connectorId },
      include: { connector: { select: { workspaceId: true } } },
    });
    if (!cred) throw new BadRequestException('Conecte la cuenta OAuth del conector');
    if (!this.expiringSoon(cred)) {
      return this.crypto.decrypt(
        cred.accessTokenCipher,
        CipherContexts.oauthAccess(cred.connector.workspaceId, connectorId),
      );
    }

    const inflight = this.refreshing.get(connectorId);
    if (inflight) return inflight;
    const p = this.refresh(connectorId, auth).finally(() => this.refreshing.delete(connectorId));
    this.refreshing.set(connectorId, p);
    return p;
  }

  private async refresh(connectorId: string, auth: OAuth2CodeAuth): Promise<string> {
    const cred = await this.prisma.oAuthCredential.findUnique({
      where: { connectorId },
      include: { connector: true },
    });
    if (!cred) throw new BadRequestException('Conecte la cuenta OAuth del conector');
    const workspaceId = cred.connector.workspaceId;
    if (!this.expiringSoon(cred)) {
      return this.crypto.decrypt(cred.accessTokenCipher, CipherContexts.oauthAccess(workspaceId, connectorId));
    }
    if (!cred.refreshTokenCipher) {
      throw new BadRequestException(
        'La sesión OAuth expiró y el proveedor no entregó refresh token: vuelva a conectar la cuenta',
      );
    }
    const app = this.resolveApp(auth);
    let token: TokenResponse;
    try {
      token = await this.tokenRequest(app, {
        grant_type: 'refresh_token',
        refresh_token: this.crypto.decrypt(
          cred.refreshTokenCipher,
          CipherContexts.oauthRefresh(workspaceId, connectorId),
        ),
      });
    } catch (err) {
      const status = err instanceof TokenEndpointError ? ` (HTTP ${err.status})` : '';
      throw new BadRequestException(`No se pudo renovar el token OAuth${status}: vuelva a conectar la cuenta`);
    }
    await this.store(cred.connector, auth, token, cred);
    return token.access_token;
  }

  private expiringSoon(cred: OAuthCredential): boolean {
    return !!cred.expiresAt && cred.expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;
  }

  // ---------- Internos ----------
  private webRedirect(connectorId: string | null, reason: OAuthErrorReason): string {
    const base = connectorId
      ? `${this.webUrl}/connectors/${encodeURIComponent(connectorId)}`
      : `${this.webUrl}/connectors`;
    return `${base}?oauth=error&reason=${reason}`;
  }

  private async connector(workspaceId: string, connectorId: string): Promise<Connector> {
    const connector = await this.prisma.connector.findFirst({ where: { id: connectorId, workspaceId } });
    if (!connector) throw new NotFoundException('Conector no encontrado');
    if ((connector.auth as { type?: string } | null)?.type !== 'oauth2_code') {
      throw new BadRequestException('El conector no usa autenticación OAuth2 de usuario (oauth2_code)');
    }
    return connector;
  }

  private async load(workspaceId: string, connectorId: string) {
    const connector = await this.connector(workspaceId, connectorId);
    const auth = render<OAuth2CodeAuth>(connector.auth, { secrets: await this.connectorSecrets(connector) });
    return { connector, auth, app: this.resolveApp(auth) };
  }

  /** Secretos que usa la autenticación del conector, solo si están entre sus secretos permitidos (A4). */
  private async connectorSecrets(connector: Connector): Promise<Record<string, string>> {
    const names = assertSecretRefsAllowed(collectSecretRefs(connector.auth), connector.allowedSecrets);
    return this.secrets.resolveMany(connector.workspaceId, names);
  }

  /** App OAuth propia (secretos del workspace) o de la plataforma (entorno, con URLs fijas del registro). */
  resolveApp(auth: OAuth2CodeAuth): ResolvedApp {
    const ownId = str(auth.clientIdRef);
    if (ownId) {
      const ownSecret = str(auth.clientSecretRef);
      if (!ownSecret) throw new BadRequestException('Falta el client secret de la app OAuth propia del conector');
      return {
        clientId: ownId,
        clientSecret: ownSecret,
        authorizeUrl: auth.authorizeUrl,
        tokenUrl: auth.tokenUrl,
        revokeUrl: auth.revokeUrl,
      };
    }
    const idVar = platformEnvName(auth.provider ?? '', 'CLIENT_ID');
    const secretVar = platformEnvName(auth.provider ?? '', 'CLIENT_SECRET');
    const provider = OAUTH_PROVIDERS[auth.provider];
    const clientId = str(this.config.get<string>(idVar));
    const clientSecret = str(this.config.get<string>(secretVar));
    if (!provider || !clientId || !clientSecret) {
      throw new BadRequestException(
        `No hay app OAuth de la plataforma para "${auth.provider}": defina ${idVar} y ${secretVar} o ingrese las credenciales de su propia app OAuth`,
      );
    }
    if (auth.authorizeUrl !== provider.authorizeUrl || auth.tokenUrl !== provider.tokenUrl) {
      throw new BadRequestException(
        'Las URLs OAuth del conector no coinciden con las del proveedor; para personalizarlas use una app OAuth propia',
      );
    }
    return { clientId, clientSecret, ...provider };
  }

  private async tokenRequest(app: ResolvedApp, params: Record<string, string>): Promise<TokenResponse> {
    const body = new URLSearchParams({ ...params, client_id: app.clientId, client_secret: app.clientSecret });
    const res = await this.http.request({
      url: app.tokenUrl,
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
    let data = res.body as Partial<TokenResponse> | string;
    if (typeof data === 'string') data = parseLoose(data);
    if (!res.ok || !data || typeof data.access_token !== 'string' || !data.access_token) {
      throw new TokenEndpointError(res.status);
    }
    return data as TokenResponse;
  }

  /** Guarda (cifrados) los tokens; en la renovación conserva el refresh token anterior si no llega uno nuevo. */
  private async store(
    connector: Connector,
    auth: OAuth2CodeAuth,
    token: TokenResponse,
    previous: OAuthCredential | null,
  ): Promise<void> {
    const expiresIn = Number(token.expires_in ?? auth.defaultExpiresIn ?? NaN);
    const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
    const refreshContext = CipherContexts.oauthRefresh(connector.workspaceId, connector.id);
    // Si no llega un refresh token nuevo se conserva el anterior, re-cifrado con la clave activa si hace falta (B7).
    const refreshTokenCipher = token.refresh_token
      ? this.crypto.encrypt(token.refresh_token, refreshContext)
      : previous?.refreshTokenCipher
        ? this.crypto.reencrypt(previous.refreshTokenCipher, refreshContext)
        : null;

    let accountLabel = previous?.accountLabel ?? null;
    const instance = await this.applyInstanceUrl(connector, auth, token);
    if (!previous) accountLabel = (await this.fetchAccountLabel(auth, token)) ?? instance ?? null;

    const data = {
      accessTokenCipher: this.crypto.encrypt(
        token.access_token,
        CipherContexts.oauthAccess(connector.workspaceId, connector.id),
      ),
      refreshTokenCipher,
      expiresAt,
      scope:
        typeof token.scope === 'string'
          ? token.scope
          : (previous?.scope ?? (auth.scopes ?? []).join(scopeSeparator(auth))),
      accountLabel,
    };
    await this.prisma.oAuthCredential.upsert({
      where: { connectorId: connector.id },
      create: { connectorId: connector.id, ...data },
      update: data,
    });
  }

  /** Salesforce: la URL de la instancia llega con el token y pasa a ser la base del conector (host validado). */
  private async applyInstanceUrl(connector: Connector, auth: OAuth2CodeAuth, token: TokenResponse) {
    if (!auth.instanceUrl) return null;
    const raw = str(getPath(token, auth.instanceUrl.field));
    if (!raw) return null;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error('URL de instancia inválida en la respuesta del token');
    }
    const host = url.hostname.toLowerCase();
    const allowed = auth.instanceUrl.allowedHostSuffixes.some((s) => host.endsWith(s.toLowerCase()));
    if (url.protocol !== 'https:' || !allowed) throw new Error(`URL de instancia no permitida: ${host}`);
    const baseUrl = `${url.origin}${auth.instanceUrl.baseUrlSuffix ?? ''}`;
    const config = (connector.config ?? {}) as Record<string, unknown>;
    if (config.baseUrl !== baseUrl) {
      await this.prisma.connector.update({
        where: { id: connector.id },
        data: { config: { ...config, baseUrl } },
      });
    }
    return host;
  }

  private async fetchAccountLabel(auth: OAuth2CodeAuth, token: TokenResponse): Promise<string | null> {
    const spec = auth.accountLabel;
    if (!spec) return null;
    if (spec.tokenField) return str(getPath(token, spec.tokenField)) || null;
    if (!spec.url || !spec.path) return null;
    try {
      const res = await this.http.request({
        url: spec.url,
        headers: { authorization: `Bearer ${token.access_token}`, accept: 'application/json' },
        timeoutMs: 10_000,
      });
      return res.ok ? str(getPath(res.body, spec.path)).slice(0, 200) || null : null;
    } catch {
      return null;
    }
  }

  private async revoke(connector: Connector, cred: OAuthCredential): Promise<void> {
    const auth = render<OAuth2CodeAuth>(connector.auth, { secrets: await this.connectorSecrets(connector) });
    let app: ResolvedApp;
    try {
      app = this.resolveApp(auth);
    } catch {
      return;
    }
    if (!app.revokeUrl) return;
    const token = cred.refreshTokenCipher
      ? this.crypto.decrypt(cred.refreshTokenCipher, CipherContexts.oauthRefresh(connector.workspaceId, connector.id))
      : this.crypto.decrypt(cred.accessTokenCipher, CipherContexts.oauthAccess(connector.workspaceId, connector.id));
    await this.http.request({
      url: app.revokeUrl,
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      timeoutMs: 10_000,
    });
  }
}

/** Respuestas de token en JSON o form-urlencoded. */
function parseLoose(raw: string): Partial<TokenResponse> {
  try {
    return JSON.parse(raw) as Partial<TokenResponse>;
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}
