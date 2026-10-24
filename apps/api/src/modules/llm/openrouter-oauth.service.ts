import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ROLE_RANK } from '../../common/decorators/roles.decorator';
import { HttpClientService } from '../../common/http/http-client.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { createPkce, OAuthStateService } from '../oauth/oauth-state.service';
import { bindingMatches, newBrowserBinding } from './llm-browser-binding';
import { LlmProvidersService } from './llm-providers.service';
import { findProvider } from './providers';

/** `connectorId` del `state` firmado: distingue este flujo del OAuth de conectores (ADR 0005, D3). */
export const OPENROUTER_STATE_ID = 'llm-provider:openrouter';

/** Motivos que la web recibe en `?llm=error&reason=` (nunca detalles del proveedor). */
export type OpenRouterOAuthErrorReason =
  'invalid_state' | 'access_denied' | 'missing_code' | 'forbidden' | 'exchange_failed' | 'browser_mismatch';

/**
 * OAuth PKCE oficial de OpenRouter (ADR 0002, D8): el usuario autoriza en `openrouter.ai/auth`, OpenRouter redirige
 * al callback con `code` y Nexo lo canjea en `POST /api/v1/auth/keys` por una clave de API del usuario, que se guarda
 * cifrada como conexión del workspace del `state`.
 */
@Injectable()
export class OpenRouterOAuthService {
  private readonly logger = new Logger(OpenRouterOAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpClientService,
    private readonly states: OAuthStateService,
    private readonly providers: LlmProvidersService,
    private readonly config: ConfigService,
  ) {}

  private get publicUrl(): string {
    return this.config.get<string>('publicUrl') ?? 'http://localhost:3000';
  }

  private get webUrl(): string {
    return this.config.get<string>('webUrl') ?? 'http://localhost:4200';
  }

  /** API de OpenRouter (respeta `LLM_PROVIDER_URL_OVERRIDES.openrouter`). */
  private get apiBase(): string {
    const override = this.config.get<Record<string, string>>('llm.providerUrlOverrides')?.openrouter;
    return (override ?? findProvider('openrouter')!.baseUrl).replace(/\/+$/, '');
  }

  get callbackUrl(): string {
    return `${this.publicUrl}/api/llm/oauth/openrouter/callback`;
  }

  async start(
    workspaceId: string,
    userId: string | undefined,
    limit?: number,
  ): Promise<{ authorizeUrl: string; browserNonce: string }> {
    if (!userId) throw new BadRequestException('Inicie la conexión OAuth desde una sesión de usuario (no con API key)');
    const { codeVerifier, codeChallenge } = createPkce();
    const binding = newBrowserBinding();
    const state = await this.states.sign({
      workspaceId,
      connectorId: `${OPENROUTER_STATE_ID}:${binding.tag}`,
      userId,
      codeVerifier,
    });
    // OpenRouter no tiene parámetro `state`: viaja en la query del callback_url y vuelve junto al `code`.
    const callback = new URL(this.callbackUrl);
    callback.searchParams.set('state', state);
    const url = new URL(this.config.get<string>('llm.openrouterAuthUrl') ?? 'https://openrouter.ai/auth');
    url.searchParams.set('callback_url', callback.toString());
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (limit !== undefined) url.searchParams.set('limit', String(limit));
    return { authorizeUrl: url.toString(), browserNonce: binding.nonce };
  }

  /** Procesa el callback público y devuelve la URL (siempre bajo `webUrl`) a la que se redirige al navegador. */
  async callback(query: { code?: string; state?: string; error?: string }, browserNonce?: string): Promise<string> {
    const payload = query.state ? await this.states.consume(query.state) : null;
    const prefix = `${OPENROUTER_STATE_ID}:`;
    if (!payload || !payload.connectorId.startsWith(prefix)) return this.redirect('invalid_state');
    // Mismo navegador que inició (M1).
    if (!bindingMatches(payload.connectorId.slice(prefix.length), browserNonce))
      return this.redirect('browser_mismatch');
    if (query.error) return this.redirect('access_denied');
    if (!query.code) return this.redirect('missing_code');

    // Quien inició el flujo debe seguir siendo ADMIN+ del workspace (los proveedores IA son de administración).
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: payload.userId, workspaceId: payload.workspaceId } },
      select: { role: true },
    });
    if (!membership || ROLE_RANK[membership.role] < ROLE_RANK.ADMIN) return this.redirect('forbidden');

    let key: string;
    try {
      key = await this.exchange(query.code, payload.codeVerifier);
    } catch (err) {
      this.logger.warn(`Canje OAuth de OpenRouter fallido: ${(err as Error).message}`);
      return this.redirect('exchange_failed');
    }

    const entry = findProvider('openrouter')!;
    const validated = { apiKey: key, values: {}, baseUrl: this.apiBase };
    const discovered = await this.providers.probe(entry, validated).catch((err: Error) => {
      this.logger.warn(`La clave de OpenRouter recién emitida no pasó la verificación: ${err.message}`);
      return null;
    });
    if (discovered === null) return this.redirect('exchange_failed');
    const saved = await this.providers.saveConnection(payload.workspaceId, entry, { validated, discovered });
    const params = new URLSearchParams({ llm: 'connected', provider: 'openrouter', connectionId: saved.connection.id });
    return `${this.webUrl}/admin/providers?${params.toString()}`;
  }

  private async exchange(code: string, codeVerifier: string): Promise<string> {
    const res = await this.http.request({
      url: `${this.apiBase}/auth/keys`,
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'X-OpenRouter-Title': 'Nexo' },
      body: JSON.stringify({ code, code_verifier: codeVerifier, code_challenge_method: 'S256' }),
      timeoutMs: 15_000,
    });
    const key = (res.body as { key?: unknown } | null)?.key;
    if (!res.ok || typeof key !== 'string' || !key) throw new Error(`OpenRouter respondió HTTP ${res.status}`);
    return key;
  }

  private redirect(reason: OpenRouterOAuthErrorReason): string {
    const params = new URLSearchParams({ llm: 'error', provider: 'openrouter', reason });
    return `${this.webUrl}/admin/providers?${params.toString()}`;
  }
}
