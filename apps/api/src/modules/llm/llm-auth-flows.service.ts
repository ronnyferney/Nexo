import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LlmAuthFlow } from '@prisma/client';
import { CipherContexts } from '../../common/crypto/cipher-context';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ROLE_RANK } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SingleUseService } from '../../infrastructure/redis/single-use.service';
import { createPkce, OAuthStateService, STATE_TTL_SECONDS } from '../oauth/oauth-state.service';
import type { AuthorizedAccount } from './llm-authorized-account';
import { bindingMatches, newBrowserBinding } from './llm-browser-binding';
import { LlmProvidersService } from './llm-providers.service';
import { serializeConnection } from './llm-serializers';
import {
  LlmTokenService,
  OAuthTokenError,
  stringValues,
  tokensFrom,
  type OAuthTokenResponse,
  type OAuthTokens,
} from './llm-token.service';
import { findMechanism, type OAuthAppSpec, type ProviderCatalogEntry, type ValidatedFields } from './providers';

/** Prefijo del `connectorId` del `state` firmado: `llm-provider:<proveedor>:<flujo>` (ADR 0002 D8, ADR 0005 D3). */
export const LLM_STATE_PREFIX = 'llm-provider:';

/** Motivos que la web recibe en `?llm=error&reason=` (nunca detalles del proveedor). */
export type LlmOAuthErrorReason =
  | 'invalid_state'
  | 'access_denied'
  | 'missing_code'
  | 'forbidden'
  | 'not_configured'
  | 'exchange_failed'
  | 'verification_failed'
  | 'browser_mismatch';

/**
 * `confirm`: el proveedor ya entregó los tokens y el flujo espera que el ADMIN que lo inició confirme la cuenta
 * autorizada (M1b). `cancelled`: el ADMIN la rechazó (los tokens se descartan y, si el proveedor lo permite, se revocan).
 */
export type DeviceFlowStatus = 'pending' | 'slow_down' | 'confirm' | 'connected' | 'expired' | 'denied' | 'cancelled';

export interface FlowInput {
  name?: string;
  fields?: Record<string, string>;
  models?: string[];
  /** «Volver a iniciar sesión»: conexión OAuth existente cuyos tokens se reemplazan (conserva modelos y agentes). */
  connectionId?: string;
}

export interface DeviceStartResult {
  flowId: string;
  userCode: string;
  verificationUri: string;
  /** URL con el código ya incluido, si el proveedor la entrega (RFC 8628 §3.2). */
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
}

export interface DevicePollResult {
  status: DeviceFlowStatus;
  /** Segundos mínimos hasta el siguiente sondeo. */
  interval?: number;
  /** Detalle en español cuando la conexión no se pudo completar. */
  message?: string;
  connection?: ReturnType<typeof serializeConnection>;
  /** Con `status: 'confirm'`: cuenta que autorizó el código según el proveedor (o `available: false`). */
  account?: AuthorizedAccount;
  /** Con `status: 'confirm'`: segundos que quedan para confirmar antes de descartar la autorización. */
  confirmExpiresIn?: number;
}

/** Tokens emitidos y cuenta autorizada mientras se espera la confirmación (cifrados en `deviceCodeCipher`). */
interface PendingAuthorization {
  tokens: { accessToken: string; refreshToken?: string; expiresAt: string | null; scope: string | null };
  account: AuthorizedAccount;
}

/** Intervalo por defecto del flujo de dispositivo (RFC 8628 §3.2) y vida máxima del código. */
const DEFAULT_INTERVAL_S = 5;
const DEFAULT_DEVICE_TTL_S = 900;
const MAX_DEVICE_TTL_S = 1800;
/** Plazo para confirmar la cuenta autorizada (M1b); vencido, los tokens se descartan. */
export const DEVICE_CONFIRM_TTL_S = 600;

/**
 * Inicio de sesión con la app OAuth **de Nexo** en el proveedor (ADR 0002, D8): authorization code + PKCE S256 con
 * `state` firmado de un solo uso, y código de dispositivo (RFC 8628). Los tokens resultantes se guardan cifrados en la
 * conexión y se renuevan con `LlmTokenService`. Nunca usa client_id de otros productos.
 */
@Injectable()
export class LlmAuthFlowsService {
  private readonly logger = new Logger(LlmAuthFlowsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly states: OAuthStateService,
    private readonly providers: LlmProvidersService,
    private readonly tokens: LlmTokenService,
    private readonly config: ConfigService,
    /** Uso único del `state` compartido entre réplicas (Redis, falla cerrado; B2). */
    private readonly singleUse: SingleUseService,
  ) {}

  private get publicUrl(): string {
    return this.config.get<string>('publicUrl') ?? 'http://localhost:3000';
  }

  private get webUrl(): string {
    return this.config.get<string>('webUrl') ?? 'http://localhost:4200';
  }

  /** Redirect URI que debe registrarse en la app de Nexo del proveedor. */
  callbackUrl(providerId: string): string {
    return `${this.publicUrl}/api/llm/oauth/${encodeURIComponent(providerId)}/callback`;
  }

  private spec(entry: ProviderCatalogEntry, type: 'OAUTH' | 'DEVICE_CODE'): OAuthAppSpec {
    const mechanism = findMechanism(entry, type);
    if (!mechanism?.oauth || (type === 'DEVICE_CODE' && !mechanism.oauth.deviceUrl)) {
      throw new BadRequestException(
        type === 'OAUTH'
          ? `${entry.name} no admite inicio de sesión OAuth en Nexo`
          : `${entry.name} no admite conexión con código de dispositivo en Nexo`,
      );
    }
    return mechanism.oauth;
  }

  private async sweep(): Promise<void> {
    await this.prisma.llmAuthFlow.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 3_600_000) } } });
  }

  // ---------- OAuth con redirección ----------
  async oauthStart(
    workspaceId: string,
    userId: string | undefined,
    providerId: string,
    input: FlowInput,
  ): Promise<{ authorizeUrl: string; browserNonce: string }> {
    if (!userId) throw new BadRequestException('Inicie la conexión OAuth desde una sesión de usuario (no con API key)');
    const entry = this.providers.provider(providerId);
    const spec = this.spec(entry, 'OAUTH');
    const target = await this.reauthTarget(workspaceId, entry, input.connectionId);
    const validated = this.providers.validate(entry, target?.fields ?? input.fields ?? {}, 'OAUTH');
    const app = this.tokens.app(entry, spec, validated.values);
    await this.sweep();

    const flow = await this.prisma.llmAuthFlow.create({
      data: {
        type: 'OAUTH',
        providerId: entry.id,
        userId,
        workspaceId,
        name: input.name?.trim() || null,
        fields: validated.values,
        models: input.models ?? [],
        connectionId: target?.id ?? null,
        expiresAt: new Date(Date.now() + STATE_TTL_SECONDS * 1000),
      },
    });
    const { codeVerifier, codeChallenge } = createPkce();
    const binding = newBrowserBinding();
    const state = await this.states.sign({
      workspaceId,
      userId,
      connectorId: `${LLM_STATE_PREFIX}${entry.id}:${flow.id}:${binding.tag}`,
      codeVerifier,
    });
    const url = new URL(app.authorizeUrl);
    for (const [k, v] of Object.entries(app.authorizeParams)) url.searchParams.set(k, v);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('redirect_uri', this.callbackUrl(entry.id));
    url.searchParams.set('scope', app.scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return { authorizeUrl: url.toString(), browserNonce: binding.nonce };
  }

  /** Procesa el callback público y devuelve la URL (siempre bajo `webUrl`) a la que se redirige al navegador. */
  async oauthCallback(
    providerId: string,
    query: { code?: string; state?: string; error?: string },
    browserNonce?: string,
  ): Promise<string> {
    const payload = query.state ? await this.states.consume(query.state, { replayGuard: this.singleUse }) : null;
    const prefix = `${LLM_STATE_PREFIX}${providerId}:`;
    if (!payload || !payload.connectorId.startsWith(prefix)) return this.redirect(providerId, 'invalid_state');
    const [flowId, tag] = payload.connectorId.slice(prefix.length).split(':');
    // El consentimiento debe volver al mismo navegador que lo inició (M1): si no, el flujo se descarta.
    if (!bindingMatches(tag, browserNonce)) {
      await this.prisma.llmAuthFlow.deleteMany({ where: { id: flowId, workspaceId: payload.workspaceId } });
      return this.redirect(providerId, 'browser_mismatch');
    }
    const flow = await this.prisma.llmAuthFlow.findFirst({
      where: { id: flowId, workspaceId: payload.workspaceId, userId: payload.userId, type: 'OAUTH' },
    });
    if (!flow || flow.status !== 'pending' || flow.expiresAt.getTime() < Date.now()) {
      return this.redirect(providerId, 'invalid_state');
    }
    await this.prisma.llmAuthFlow.delete({ where: { id: flow.id } });
    if (query.error) return this.redirect(providerId, 'access_denied');
    if (!query.code) return this.redirect(providerId, 'missing_code');
    if (!(await this.isAdmin(payload.userId, payload.workspaceId))) return this.redirect(providerId, 'forbidden');

    const entry = this.providers.provider(providerId);
    const values = (flow.fields ?? {}) as Record<string, string>;
    let tokens: OAuthTokens;
    try {
      const app = this.tokens.app(entry, this.spec(entry, 'OAUTH'), values);
      tokens = tokensFrom(
        await this.tokens.token(app, {
          grant_type: 'authorization_code',
          code: query.code,
          redirect_uri: this.callbackUrl(providerId),
          code_verifier: payload.codeVerifier,
        }),
      );
    } catch (err) {
      if (err instanceof BadRequestException) return this.redirect(providerId, 'not_configured');
      this.logger.warn(`Canje OAuth de ${providerId} fallido: ${(err as Error).message}`);
      return this.redirect(providerId, 'exchange_failed');
    }
    try {
      const saved = await this.save(flow, entry, tokens);
      const params = new URLSearchParams({ llm: 'connected', provider: providerId, connectionId: saved.id });
      return `${this.webUrl}/admin/providers?${params.toString()}`;
    } catch (err) {
      this.logger.warn(`La sesión OAuth de ${providerId} no pasó la verificación: ${(err as Error).message}`);
      return this.redirect(providerId, 'verification_failed');
    }
  }

  // ---------- Código de dispositivo (RFC 8628) ----------
  async deviceStart(
    workspaceId: string,
    userId: string | undefined,
    providerId: string,
    input: FlowInput,
  ): Promise<DeviceStartResult> {
    if (!userId) throw new BadRequestException('Inicie la conexión desde una sesión de usuario (no con API key)');
    const entry = this.providers.provider(providerId);
    const spec = this.spec(entry, 'DEVICE_CODE');
    const target = await this.reauthTarget(workspaceId, entry, input.connectionId);
    const validated = this.providers.validate(entry, target?.fields ?? input.fields ?? {}, 'DEVICE_CODE');
    const app = this.tokens.app(entry, spec, validated.values);
    await this.sweep();

    let data: Record<string, unknown>;
    try {
      data = await this.tokens.post(app, app.deviceUrl!, { scope: app.scopes.join(' ') });
    } catch (err) {
      const detail = err instanceof OAuthTokenError ? ` (HTTP ${err.status}${err.code ? `, ${err.code}` : ''})` : '';
      throw new BadRequestException(`${app.idpName} rechazó la solicitud de código de dispositivo${detail}`);
    }
    const deviceCode = typeof data.device_code === 'string' ? data.device_code : '';
    const userCode = typeof data.user_code === 'string' ? data.user_code : '';
    const verificationUri = typeof data.verification_uri === 'string' ? data.verification_uri : '';
    if (!deviceCode || !userCode || !isVerificationUrl(verificationUri)) {
      throw new BadRequestException(`${app.idpName} devolvió una respuesta de código de dispositivo inválida`);
    }
    const expiresIn = clampInt(data.expires_in, DEFAULT_DEVICE_TTL_S, 60, MAX_DEVICE_TTL_S);
    const interval = clampInt(data.interval, DEFAULT_INTERVAL_S, 1, 120);
    const complete =
      typeof data.verification_uri_complete === 'string' && isVerificationUrl(data.verification_uri_complete)
        ? data.verification_uri_complete
        : undefined;

    const flow = await this.prisma.llmAuthFlow.create({
      data: {
        type: 'DEVICE_CODE',
        providerId: entry.id,
        userId,
        workspaceId,
        name: input.name?.trim() || null,
        fields: validated.values,
        models: input.models ?? [],
        connectionId: target?.id ?? null,
        deviceCodeCipher: this.crypto.encrypt(deviceCode, CipherContexts.llmDeviceCode(workspaceId, userId)),
        intervalSec: interval,
        nextPollAt: new Date(Date.now() + interval * 1000),
        expiresAt: new Date(Date.now() + expiresIn * 1000),
      },
    });
    return {
      flowId: flow.id,
      userCode,
      verificationUri,
      ...(complete ? { verificationUriComplete: complete } : {}),
      expiresIn,
      interval,
    };
  }

  /**
   * Consulta el estado del flujo. Respeta el `interval` del proveedor: si la web sondea antes, responde `pending` sin
   * llamar al proveedor. El reclamo del turno de sondeo es atómico (dos sondeos simultáneos no canjean dos veces).
   *
   * M1b: cuando el proveedor entrega los tokens la conexión **no** se activa: el flujo pasa a `confirm` con la cuenta
   * autorizada y espera `deviceConfirm` del mismo ADMIN que lo inició. Solo ese usuario consulta el flujo.
   */
  async devicePoll(
    workspaceId: string,
    userId: string | undefined,
    providerId: string,
    flowId: string,
  ): Promise<DevicePollResult> {
    const flow = await this.deviceFlow(workspaceId, userId, providerId, flowId);
    const interval = flow.intervalSec ?? DEFAULT_INTERVAL_S;
    if (flow.status === 'connected' && flow.connectionId) {
      const row = await this.prisma.llmConnection.findFirst({
        where: { id: flow.connectionId, workspaceId },
        include: { models: { orderBy: { label: 'asc' } } },
      });
      return row ? { status: 'connected', connection: serializeConnection(row) } : { status: 'expired' };
    }
    if (flow.status === 'expired' || flow.status === 'denied' || flow.status === 'cancelled') {
      return { status: flow.status };
    }
    // Confirmación en curso (otra pestaña): se sigue mostrando la cuenta hasta que termine.
    if (flow.status === 'confirming' && flow.deviceCodeCipher) return this.confirmView(flow);
    if (flow.expiresAt.getTime() < Date.now()) {
      await this.discard(flow, 'expired');
      return { status: 'expired' };
    }
    if (flow.status === 'confirm') return this.confirmView(flow);

    const now = new Date();
    const claimed = await this.prisma.llmAuthFlow.updateMany({
      where: { id: flow.id, status: 'pending', OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }] },
      data: { nextPollAt: new Date(now.getTime() + interval * 1000) },
    });
    if (!claimed.count) return { status: 'pending', interval };

    const entry = this.providers.provider(providerId);
    const values = (flow.fields ?? {}) as Record<string, string>;
    const app = this.tokens.app(entry, this.spec(entry, 'DEVICE_CODE'), values);
    let response: OAuthTokenResponse;
    try {
      response = await this.tokens.token(app, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: this.crypto.decrypt(
          flow.deviceCodeCipher!,
          CipherContexts.llmDeviceCode(flow.workspaceId, flow.userId),
        ),
      });
    } catch (err) {
      if (!(err instanceof OAuthTokenError)) throw err;
      switch (err.code) {
        case 'authorization_pending':
          return { status: 'pending', interval };
        case 'slow_down': {
          // RFC 8628 §3.5: sumar 5 s; GitHub devuelve el nuevo `interval` en la respuesta.
          const next = clampInt(err.body.interval, interval + 5, interval + 1, 120);
          await this.prisma.llmAuthFlow.update({
            where: { id: flow.id },
            data: { intervalSec: next, nextPollAt: new Date(Date.now() + next * 1000) },
          });
          return { status: 'slow_down', interval: next };
        }
        case 'expired_token':
        case 'token_expired':
        case 'incorrect_device_code':
          await this.finish(flow.id, 'expired');
          return { status: 'expired' };
        case 'access_denied':
          await this.finish(flow.id, 'denied');
          return { status: 'denied' };
        default:
          this.logger.warn(`Flujo de dispositivo de ${providerId}: ${err.message}`);
          await this.finish(flow.id, 'denied');
          return { status: 'denied', message: `${app.idpName} rechazó la autorización (${err.code ?? err.status}).` };
      }
    }

    // M1b: se guardan los tokens (cifrados, ligados al flujo) y la cuenta autorizada hasta la confirmación del ADMIN.
    const tokens = tokensFrom(response);
    const pending: PendingAuthorization = {
      tokens: {
        accessToken: tokens.accessToken,
        ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
        expiresAt: tokens.expiresAt?.toISOString() ?? null,
        scope: tokens.scope,
      },
      account: await this.tokens.authorizedAccount(app, response),
    };
    const expiresAt = new Date(Date.now() + DEVICE_CONFIRM_TTL_S * 1000);
    await this.prisma.llmAuthFlow.update({
      where: { id: flow.id },
      data: {
        status: 'confirm',
        deviceCodeCipher: this.crypto.encrypt(
          JSON.stringify(pending),
          CipherContexts.llmPendingTokens(flow.workspaceId, flow.userId),
        ),
        nextPollAt: null,
        expiresAt,
      },
    });
    return { status: 'confirm', account: pending.account, confirmExpiresIn: DEVICE_CONFIRM_TTL_S };
  }

  /**
   * Confirma la cuenta autorizada y activa la conexión (M1b). Solo el ADMIN que inició el flujo, mientras siga siendo
   * ADMIN y dentro del plazo. El reclamo es atómico: dos confirmaciones simultáneas no crean dos conexiones.
   */
  async deviceConfirm(
    workspaceId: string,
    userId: string | undefined,
    providerId: string,
    flowId: string,
  ): Promise<DevicePollResult> {
    const flow = await this.deviceFlow(workspaceId, userId, providerId, flowId);
    if (!(await this.isAdmin(flow.userId, workspaceId))) {
      throw new ForbiddenException('Solo un administrador del workspace puede activar la conexión');
    }
    if (flow.status !== 'confirm') {
      throw new BadRequestException('La autorización no está pendiente de confirmación: genere un código nuevo');
    }
    if (flow.expiresAt.getTime() < Date.now()) {
      await this.discard(flow, 'expired');
      return { status: 'expired' };
    }
    const claimed = await this.prisma.llmAuthFlow.updateMany({
      where: { id: flow.id, status: 'confirm' },
      data: { status: 'confirming' },
    });
    if (!claimed.count) {
      throw new BadRequestException('La autorización ya se está confirmando o se descartó');
    }
    const pending = this.pending(flow);
    const entry = this.providers.provider(providerId);
    try {
      const saved = await this.save(flow, entry, {
        accessToken: pending.tokens.accessToken,
        ...(pending.tokens.refreshToken ? { refreshToken: pending.tokens.refreshToken } : {}),
        expiresAt: pending.tokens.expiresAt ? new Date(pending.tokens.expiresAt) : null,
        scope: pending.tokens.scope,
      });
      await this.prisma.llmAuthFlow.update({
        where: { id: flow.id },
        data: { status: 'connected', connectionId: saved.id, deviceCodeCipher: null },
      });
      return { status: 'connected', connection: saved };
    } catch (err) {
      await this.finish(flow.id, 'denied');
      return { status: 'denied', message: err instanceof BadRequestException ? err.message : 'Verificación fallida' };
    }
  }

  /**
   * «No es mi cuenta»: descarta la autorización pendiente (o el código aún sin autorizar) y, si el proveedor documenta
   * revocación, revoca los tokens emitidos. Solo el ADMIN que inició el flujo.
   */
  async deviceCancel(
    workspaceId: string,
    userId: string | undefined,
    providerId: string,
    flowId: string,
  ): Promise<DevicePollResult> {
    const flow = await this.deviceFlow(workspaceId, userId, providerId, flowId);
    if (flow.status === 'connected') {
      throw new BadRequestException('La conexión ya está activa: use «Cerrar sesión» o «Desconectar»');
    }
    if (flow.status === 'confirming') throw new BadRequestException('La conexión se está activando en este momento');
    if (flow.status !== 'pending' && flow.status !== 'confirm') return { status: flow.status as DeviceFlowStatus };
    await this.discard(flow, 'cancelled');
    return { status: 'cancelled' };
  }

  // ---------- Internos ----------
  /** Flujo de código de dispositivo del workspace iniciado por `userId` (otro usuario recibe 404). */
  private async deviceFlow(workspaceId: string, userId: string | undefined, providerId: string, flowId: string) {
    const flow = userId
      ? await this.prisma.llmAuthFlow.findFirst({
          where: { id: flowId, workspaceId, providerId, userId, type: 'DEVICE_CODE' },
        })
      : null;
    if (!flow) throw new NotFoundException('Flujo de conexión no encontrado');
    return flow;
  }

  private pending(flow: LlmAuthFlow): PendingAuthorization {
    return JSON.parse(
      this.crypto.decrypt(flow.deviceCodeCipher!, CipherContexts.llmPendingTokens(flow.workspaceId, flow.userId)),
    ) as PendingAuthorization;
  }

  private confirmView(flow: LlmAuthFlow): DevicePollResult {
    return {
      status: 'confirm',
      account: this.pending(flow).account,
      confirmExpiresIn: Math.max(0, Math.round((flow.expiresAt.getTime() - Date.now()) / 1000)),
    };
  }

  /**
   * Cierra un flujo sin conexión. Si ya había tokens sin confirmar, los revoca en el proveedor (si lo documenta) antes
   * de borrarlos: una autorización rechazada o vencida no debe quedar viva en la cuenta de quien escribió el código.
   */
  private async discard(flow: LlmAuthFlow, status: 'expired' | 'cancelled'): Promise<void> {
    if (flow.status === 'confirm' && flow.deviceCodeCipher) {
      try {
        const pending = this.pending(flow);
        const entry = this.providers.provider(flow.providerId);
        const app = this.tokens.app(
          entry,
          this.spec(entry, 'DEVICE_CODE'),
          (flow.fields ?? {}) as Record<string, string>,
        );
        await this.tokens.revokeToken(app, pending.tokens.refreshToken ?? pending.tokens.accessToken);
      } catch (err) {
        this.logger.warn(
          `No se pudo revocar la autorización descartada del flujo ${flow.id}: ${(err as Error).message}`,
        );
      }
    }
    await this.prisma.llmAuthFlow.updateMany({
      where: { id: flow.id, status: flow.status },
      data: { status, deviceCodeCipher: null },
    });
  }

  /**
   * Conexión OAuth del workspace y del mismo proveedor sobre la que se vuelve a iniciar sesión. Se reutilizan sus campos
   * guardados (proyecto, región, recurso) para que la sesión nueva apunte al mismo destino.
   */
  private async reauthTarget(workspaceId: string, entry: ProviderCatalogEntry, connectionId: string | undefined) {
    if (!connectionId) return null;
    const c = await this.prisma.llmConnection.findFirst({ where: { id: connectionId, workspaceId } });
    if (!c) throw new NotFoundException('Conexión no encontrada');
    if (c.providerId !== entry.id) throw new BadRequestException(`La conexión no pertenece al proveedor ${entry.name}`);
    if (c.credentialType !== 'OAUTH') {
      throw new BadRequestException('La conexión usa clave de API: actualice la clave en lugar de iniciar sesión');
    }
    return { id: c.id, fields: stringValues(c.providerFields) };
  }

  /**
   * Prueba el token contra el endpoint del proveedor (como Bearer) y crea la conexión OAuth del workspace del flujo o,
   * si el flujo es «Volver a iniciar sesión», reemplaza los tokens de la conexión existente (mismo id, modelos y agentes).
   */
  private async save(flow: LlmAuthFlow, entry: ProviderCatalogEntry, tokens: OAuthTokens) {
    const values = (flow.fields ?? {}) as Record<string, string>;
    const base = this.providers.validate(entry, values, flow.type === 'OAUTH' ? 'OAUTH' : 'DEVICE_CODE');
    const validated: ValidatedFields = { ...base, apiKey: tokens.accessToken };
    const discovered = await this.providers.probe(entry, validated, 'bearer');
    if (flow.connectionId) {
      const renewed = await this.prisma.llmConnection.updateMany({
        where: { id: flow.connectionId, workspaceId: flow.workspaceId, providerId: entry.id, credentialType: 'OAUTH' },
        data: {
          apiKeyCipher: this.crypto.encrypt(tokens.accessToken, CipherContexts.llmApiKey(flow.workspaceId)),
          oauthRefreshCipher: tokens.refreshToken
            ? this.crypto.encrypt(tokens.refreshToken, CipherContexts.llmRefresh(flow.workspaceId))
            : null,
          oauthExpiresAt: tokens.expiresAt,
          oauthScope: tokens.scope,
        },
      });
      if (!renewed.count) throw new BadRequestException('La conexión ya no existe: conéctela de nuevo');
      const row = await this.prisma.llmConnection.findUniqueOrThrow({
        where: { id: flow.connectionId },
        include: { models: { orderBy: { label: 'asc' } } },
      });
      return serializeConnection(row);
    }
    const saved = await this.providers.saveConnection(flow.workspaceId, entry, {
      name: flow.name ?? undefined,
      validated: { ...base, apiKey: undefined },
      models: flow.models.length ? flow.models : undefined,
      discovered,
      oauth: tokens,
    });
    return { ...saved.connection, models: saved.models };
  }

  private async finish(flowId: string, status: 'expired' | 'denied' | 'cancelled'): Promise<void> {
    await this.prisma.llmAuthFlow.update({ where: { id: flowId }, data: { status, deviceCodeCipher: null } });
  }

  private async isAdmin(userId: string, workspaceId: string): Promise<boolean> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { role: true },
    });
    return !!membership && ROLE_RANK[membership.role] >= ROLE_RANK.ADMIN;
  }

  private redirect(providerId: string, reason: LlmOAuthErrorReason): string {
    const params = new URLSearchParams({ llm: 'error', provider: providerId, reason });
    return `${this.webUrl}/admin/providers?${params.toString()}`;
  }
}

/** La página de verificación debe ser https; http solo en loopback (simulador local de desarrollo). */
function isVerificationUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
    );
  } catch {
    return false;
  }
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.max(n, min), max) : fallback;
}
