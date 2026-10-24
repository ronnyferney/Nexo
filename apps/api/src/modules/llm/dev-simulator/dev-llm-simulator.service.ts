import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { DEV_SIM_CLIENT_ID, DEV_SIM_PATH } from '../providers/dev.providers';

/** Vida del access token simulado: corta a propósito para ejercitar la renovación automática de Nexo. */
export const SIM_ACCESS_TTL_S = 120;
const CODE_TTL_MS = 60_000;
const DEVICE_TTL_S = 600;
const DEVICE_INTERVAL_S = 2;
export const SIM_MODELS = ['sim-rapido', 'sim-experto'];

type DeviceState = 'pending' | 'approved' | 'denied';

/** Error OAuth (RFC 6749 §5.2 / RFC 8628 §3.5) que el controlador responde con 400. */
export class SimOAuthError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const token = (prefix: string) => `${prefix}${randomBytes(18).toString('base64url')}`;

/**
 * Estado en memoria del proveedor simulado (un solo proceso de desarrollo). Reproduce lo que hace un proveedor real:
 * códigos de un solo uso con PKCE S256, refresh token, revocación (RFC 7009) y código de dispositivo (RFC 8628).
 */
@Injectable()
export class DevLlmSimulatorService {
  private readonly codes = new Map<string, { challenge: string; redirectUri: string; scope: string; exp: number }>();
  private readonly access = new Map<string, number>();
  private readonly refresh = new Map<string, string>();
  private readonly devices = new Map<string, { userCode: string; state: DeviceState; exp: number }>();

  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return this.config.get<boolean>('llm.devSimulator') ?? false;
  }

  assertEnabled(): void {
    if (!this.enabled) throw new NotFoundException();
  }

  get webUrl(): string {
    return (this.config.get<string>('webUrl') ?? 'http://localhost:4200').replace(/\/+$/, '');
  }

  get base(): string {
    return `${(this.config.get<string>('publicUrl') ?? 'http://localhost:3000').replace(/\/+$/, '')}${DEV_SIM_PATH}`;
  }

  /** Solo se redirige al callback LLM de esta misma instalación (nunca una URL arbitraria). */
  validRedirect(clientId: string | undefined, redirectUri: string | undefined): boolean {
    const publicUrl = (this.config.get<string>('publicUrl') ?? 'http://localhost:3000').replace(/\/+$/, '');
    return clientId === DEV_SIM_CLIENT_ID && !!redirectUri && redirectUri.startsWith(`${publicUrl}/api/llm/oauth/`);
  }

  issueCode(challenge: string, redirectUri: string, scope: string): string {
    const code = token('sim-code-');
    this.codes.set(code, { challenge, redirectUri, scope, exp: Date.now() + CODE_TTL_MS });
    return code;
  }

  exchangeCode(code: string, redirectUri: string, verifier: string) {
    const c = this.codes.get(code);
    this.codes.delete(code);
    if (!c || c.exp < Date.now() || c.redirectUri !== redirectUri) throw new SimOAuthError('invalid_grant');
    if (createHash('sha256').update(verifier).digest('base64url') !== c.challenge)
      throw new SimOAuthError('invalid_grant');
    return this.issueTokens(c.scope);
  }

  refreshTokens(refreshToken: string) {
    const scope = this.refresh.get(refreshToken);
    if (scope === undefined) throw new SimOAuthError('invalid_grant');
    const access = token('sim-at-');
    this.access.set(access, Date.now() + SIM_ACCESS_TTL_S * 1000);
    return { access_token: access, token_type: 'Bearer', expires_in: SIM_ACCESS_TTL_S, scope };
  }

  startDevice() {
    const deviceCode = token('sim-dc-');
    const raw = randomBytes(4).toString('hex').toUpperCase();
    const userCode = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    this.devices.set(deviceCode, { userCode, state: 'pending', exp: Date.now() + DEVICE_TTL_S * 1000 });
    return {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: `${this.base}/device`,
      verification_uri_complete: `${this.base}/device?user_code=${encodeURIComponent(userCode)}`,
      expires_in: DEVICE_TTL_S,
      interval: DEVICE_INTERVAL_S,
    };
  }

  decideDevice(userCode: string, approve: boolean): boolean {
    for (const d of this.devices.values()) {
      if (d.userCode === userCode.trim().toUpperCase() && d.state === 'pending' && d.exp > Date.now()) {
        d.state = approve ? 'approved' : 'denied';
        return true;
      }
    }
    return false;
  }

  pollDevice(deviceCode: string) {
    const d = this.devices.get(deviceCode);
    if (!d || d.exp < Date.now()) throw new SimOAuthError('expired_token');
    if (d.state === 'pending') throw new SimOAuthError('authorization_pending');
    this.devices.delete(deviceCode);
    if (d.state === 'denied') throw new SimOAuthError('access_denied');
    return this.issueTokens('inference');
  }

  /** RFC 7009: revocar un refresh token invalida también sus access tokens (aquí, todos los vigentes). */
  revoke(value: string): void {
    if (this.refresh.delete(value)) this.access.clear();
    this.access.delete(value);
  }

  /** «Revocar todas las sesiones»: la próxima renovación de Nexo recibe `invalid_grant` (sesión cerrada). */
  revokeAll(): void {
    this.access.clear();
    this.refresh.clear();
  }

  validAccess(authorization: string | undefined): boolean {
    const t = (authorization ?? '').replace(/^Bearer\s+/i, '');
    const exp = this.access.get(t);
    return !!exp && exp > Date.now();
  }

  private issueTokens(scope: string) {
    const refresh = token('sim-rt-');
    this.refresh.set(refresh, scope);
    return { ...this.refreshTokens(refresh), refresh_token: refresh };
  }
}

interface SimMessage {
  role: string;
  content?: string | null;
  tool_call_id?: string;
}
interface SimTool {
  function?: { name?: string };
}

/**
 * Respuesta de chat compatible con OpenAI. Eco del último mensaje; `/tool <nombre> <json>` pide esa herramienta
 * (igual que el proveedor simulado sin red) para probar agentes con conectores sin un LLM real.
 */
export function simulatedCompletion(body: { model?: string; messages?: SimMessage[]; tools?: SimTool[] }) {
  const model = SIM_MODELS.includes(body.model ?? '') ? body.model! : SIM_MODELS[0];
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages.at(-1);
  const text = typeof last?.content === 'string' ? last.content : '';
  const usage = { prompt_tokens: Math.ceil(JSON.stringify(messages).length / 4), completion_tokens: 12 };
  const tool = /^\/tool\s+(\S+)\s*([\s\S]*)$/.exec(text.trim());
  const names = new Set((body.tools ?? []).map((t) => t.function?.name).filter(Boolean));
  if (last?.role === 'user' && tool && names.has(tool[1])) {
    return {
      model,
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: token('call_'), type: 'function', function: { name: tool[1], arguments: tool[2] || '{}' } },
            ],
          },
        },
      ],
      usage,
    };
  }
  const content =
    last?.role === 'tool'
      ? `Resultado de la herramienta recibido (simulado): ${text.slice(0, 400)}`
      : `Respuesta simulada de ${model}: ${text.slice(0, 400) || '(mensaje vacío)'}`;
  return { model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }], usage };
}
