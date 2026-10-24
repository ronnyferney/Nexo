import Anthropic from '@anthropic-ai/sdk';
import { AnthropicFoundry } from '@anthropic-ai/foundry-sdk';
import { AnthropicGoogleCloud } from '@anthropic-ai/google-cloud-sdk';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import { Injectable, Logger } from '@nestjs/common';
import { HttpClientService } from '../../../common/http/http-client.service';
import { OAuth2Client } from 'google-auth-library';
import {
  LlmHttpError,
  type ClaudeChannelOptions,
  type LlmClient,
  type LlmCredentials,
  type LlmDriver,
  type LlmRunRequest,
  type LlmRunResult,
} from '../llm-provider';

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ToolResultBlock = Anthropic.Beta.Messages.BetaToolResultBlockParam;

/** Modelo con el que se verifica un canal sin API de modelos (conteo de tokens: gratuito). */
const VERIFY_MODEL = 'claude-haiku-5-5';

/** Host oficial de cada canal: otra URL es un proxy o un servidor de pruebas (sin fallback server-side). */
const OFFICIAL_HOSTS: Record<ClaudeChannelOptions['channel'], (host: string) => boolean> = {
  anthropic: (h) => h === 'api.anthropic.com',
  'google-cloud': (h) => h === 'claude.googleapis.com',
  vertex: (h) => h.endsWith('aiplatform.googleapis.com'),
  foundry: (h) => h.endsWith('.services.ai.azure.com'),
};

/** Un proxy/gateway propio (no la API directa de Anthropic): sin fallback server-side. */
export function isCustomAnthropicEndpoint(
  baseUrl?: string,
  channel: ClaudeChannelOptions['channel'] = 'anthropic',
): boolean {
  if (!baseUrl) return false;
  try {
    return !OFFICIAL_HOSTS[channel](new URL(baseUrl).hostname);
  } catch {
    return true;
  }
}

/**
 * Cliente oficial de Anthropic para el canal de la conexión. Todos exponen la misma Messages API; cambia quién opera
 * el servicio y cómo se autentica:
 * - `anthropic`: API de Anthropic con clave de API.
 * - `google-cloud`: Claude en Google Cloud (operado por Anthropic) con el token de Google de «Iniciar sesión con Google».
 * - `vertex`: Claude en Vertex AI (operado por Google) con el mismo token de Google.
 * - `foundry`: Claude en Microsoft Foundry con clave del recurso o token de Microsoft Entra ID.
 * Los tokens OAuth se piden en cada llamada para que `LlmTokenService` los renueve antes de expirar.
 */
export function claudeSdkClient(
  credentials: LlmCredentials,
  fetch?: typeof globalThis.fetch,
): () => Promise<Anthropic> {
  const ch = credentials.claude ?? { channel: 'anthropic' as const };
  const baseURL = credentials.baseUrl || undefined;
  const custom = isCustomAnthropicEndpoint(baseURL, ch.channel);
  const token = credentials.getAccessToken ?? (credentials.apiKey ? async () => credentials.apiKey! : undefined);
  // `fetch` con la política de red de Nexo (SSRF, IP fijada, sin redirecciones, límite de tamaño): auditoría A1.
  const common = { defaultHeaders: credentials.headers, ...(fetch ? { fetch } : {}) };
  switch (ch.channel) {
    case 'google-cloud': {
      if (!token) throw new Error('Claude en Google Cloud requiere iniciar sesión con Google');
      if (!ch.project || !ch.workspaceId) throw new Error('Claude en Google Cloud requiere el proyecto y el workspace');
      const client = new AnthropicGoogleCloud({
        ...common,
        project: ch.project,
        workspaceId: ch.workspaceId,
        bearerTokenProvider: token,
        ...(custom ? { baseURL } : {}),
      });
      return async () => client;
    }
    case 'vertex': {
      if (!token) throw new Error('Claude en Vertex AI requiere iniciar sesión con Google');
      if (!ch.project) throw new Error('Claude en Vertex AI requiere el proyecto de Google Cloud');
      // El SDK de Vertex autentica con un `AuthClient` de google-auth-library (la opción `accessToken` no se usa):
      // por solicitud se crea uno con el token vigente de la sesión de Google, que Nexo renueva.
      // Expone la misma Messages API que `Anthropic` (sin API de modelos ni lotes).
      return async () => {
        const authClient = new OAuth2Client();
        authClient.setCredentials({ access_token: await token() });
        return new AnthropicVertex({
          ...common,
          projectId: ch.project,
          region: ch.region || 'global',
          authClient,
          ...(custom ? { baseURL } : {}),
        }) as unknown as Anthropic;
      };
    }
    case 'foundry': {
      if (!token) throw new Error('Claude en Microsoft Foundry requiere la clave del recurso o iniciar sesión');
      const client = new AnthropicFoundry({
        ...common,
        ...(credentials.getAccessToken
          ? { azureADTokenProvider: credentials.getAccessToken }
          : { apiKey: credentials.apiKey }),
        ...(baseURL ? { baseURL } : { resource: ch.resource }),
      });
      // Misma Messages API que `Anthropic`, sin lotes (que el driver no usa).
      return async () => client as unknown as Anthropic;
    }
    default: {
      if (!credentials.apiKey) throw new Error('La conexión Anthropic no tiene API key');
      const client = new Anthropic({ ...common, apiKey: credentials.apiKey, baseURL });
      return async () => client;
    }
  }
}

/**
 * Mensaje de un error HTTP del proveedor sin el cuerpo crudo de la respuesta (podría ser el de un servicio interno):
 * solo el `error.message` con la forma de la API de Anthropic, acotado; si no, el estado HTTP.
 */
export function providerErrorMessage(err: { status?: number; error?: unknown }): string {
  const body = err.error as { error?: { type?: unknown; message?: unknown } } | undefined;
  const message = body?.error?.message;
  if (typeof body?.error?.type === 'string' && typeof message === 'string') return message.slice(0, 300);
  return `El proveedor respondió HTTP ${err.status ?? 'desconocido'}`;
}

/**
 * Cliente Claude (Messages API) con bucle de tool use manual:
 * streaming, thinking adaptativo + effort, caché automática de prompts (ahorro de costos),
 * fallback server-side ante rechazos por política e historial nativo append-only.
 */
class AnthropicClient implements LlmClient {
  private readonly logger = new Logger('AnthropicClient');
  private readonly sdk: () => Promise<Anthropic>;
  private readonly channel: ClaudeChannelOptions['channel'];
  /** Fallback server-side: solo en los canales operados por Anthropic y sin proxy de por medio. */
  private readonly serverFallback: boolean;

  constructor(credentials: LlmCredentials, fetch?: typeof globalThis.fetch) {
    this.sdk = claudeSdkClient(credentials, fetch);
    this.channel = credentials.claude?.channel ?? 'anthropic';
    this.serverFallback =
      (this.channel === 'anthropic' || this.channel === 'google-cloud') &&
      !isCustomAnthropicEndpoint(credentials.baseUrl, this.channel);
  }

  /** Vertex AI y Foundry no ofrecen la API de modelos: se verifica con un conteo de tokens. */
  private get hasModelsApi(): boolean {
    return this.channel === 'anthropic' || this.channel === 'google-cloud';
  }

  async test() {
    const client = await this.sdk();
    if (!this.hasModelsApi) {
      await this.probe(() => this.countTokens(client));
      return { ok: true, message: 'Conexión correcta' };
    }
    const page = await this.probe(() => client.models.list({ limit: 5 }, { timeout: 15_000, maxRetries: 0 }));
    return { ok: true, message: `Conexión correcta: ${page.data.map((m) => m.id).join(', ')}` };
  }

  private countTokens(client: Anthropic) {
    return client.messages.countTokens(
      { model: VERIFY_MODEL, messages: [{ role: 'user', content: 'ping' }] },
      { timeout: 15_000, maxRetries: 0 },
    );
  }

  /** Errores HTTP del SDK como `LlmHttpError` (estado + mensaje del proveedor). */
  private async probe<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Anthropic.APIError && typeof err.status === 'number') {
        throw new LlmHttpError(err.status, providerErrorMessage(err));
      }
      throw err;
    }
  }

  async verify(): Promise<void> {
    const client = await this.sdk();
    if (!this.hasModelsApi) {
      await this.probe(() => this.countTokens(client));
      return;
    }
    await this.probe(() => client.models.list({ limit: 1 }, { timeout: 15_000, maxRetries: 0 }));
  }

  async listModels(): Promise<string[]> {
    if (!this.hasModelsApi) return [];
    const client = await this.sdk();
    return this.probe(async () => {
      const ids: string[] = [];
      for await (const m of client.models.list({ limit: 100 }, { timeout: 15_000, maxRetries: 0 })) {
        ids.push(m.id);
        if (ids.length >= 500) break;
      }
      return ids;
    });
  }

  async run(req: LlmRunRequest): Promise<LlmRunResult> {
    const history = [...(req.history as MessageParam[]), { role: 'user', content: req.userMessage } as MessageParam];
    const tools: Anthropic.Beta.Messages.BetaTool[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
      eager_input_streaming: true,
    }));
    const usage = { inputTokens: 0, outputTokens: 0 };
    let text = '';
    let stopReason = 'end_turn';
    let turns = 0;

    while (turns < req.maxTurns) {
      await req.beforeTurn?.();
      turns++;
      const client = await this.sdk();
      const stream = client.beta.messages.stream(
        {
          model: req.model,
          max_tokens: 64000,
          system: req.system || undefined,
          messages: history,
          tools: tools.length ? tools : undefined,
          thinking: { type: 'adaptive' },
          output_config: { effort: req.effort },
          cache_control: { type: 'ephemeral' },
          // El fallback server-side solo aplica a los canales operados por Anthropic (no a proxies/gateways).
          ...(!this.serverFallback
            ? {}
            : {
                betas: ['server-side-fallback-2026-07-01'] as Anthropic.Beta.AnthropicBeta[],
                fallbacks: 'default' as const,
              }),
        },
        { signal: req.signal },
      );
      stream.on('text', (delta) => req.onEvent?.({ type: 'text', text: delta }));
      const message = await this.probe(() => stream.finalMessage());

      const u = message.usage;
      usage.inputTokens += u.input_tokens;
      usage.outputTokens += u.output_tokens;
      await req.onUsage?.({
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      });

      stopReason = message.stop_reason ?? 'end_turn';
      history.push({ role: 'assistant', content: message.content });
      text = message.content
        .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      if (stopReason === 'pause_turn') continue;
      if (stopReason === 'refusal') {
        req.onEvent?.({ type: 'notice', message: 'El modelo declinó la solicitud por política de seguridad.' });
        break;
      }
      if (stopReason === 'max_tokens') {
        req.onEvent?.({ type: 'notice', message: 'Respuesta truncada por límite de tokens.' });
        break;
      }
      if (stopReason !== 'tool_use') break;

      const calls = message.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use');
      // Las tools se ejecutan en paralelo y todos los resultados vuelven en un solo mensaje.
      const results = await Promise.all(
        calls.map(async (call): Promise<ToolResultBlock> => {
          const input = (call.input ?? {}) as Record<string, unknown>;
          req.onEvent?.({ type: 'tool_call', id: call.id, name: call.name, input });
          const outcome = await req.executeTool({ id: call.id, name: call.name, input }).catch((err: Error) => ({
            content: `Error: ${err.message}`,
            isError: true,
          }));
          req.onEvent?.({
            type: 'tool_result',
            id: call.id,
            name: call.name,
            output: outcome.content,
            isError: !!outcome.isError,
          });
          return { type: 'tool_result', tool_use_id: call.id, content: outcome.content, is_error: outcome.isError };
        }),
      );
      history.push({ role: 'user', content: results });
    }

    if (turns >= req.maxTurns && stopReason === 'tool_use') {
      this.logger.warn(`Agente alcanzó maxTurns=${req.maxTurns}`);
      req.onEvent?.({ type: 'notice', message: `Se alcanzó el máximo de ${req.maxTurns} turnos.` });
    }
    return { history, text, stopReason, turns, usage };
  }
}

@Injectable()
export class AnthropicDriver implements LlmDriver {
  readonly kind = 'ANTHROPIC' as const;

  constructor(private readonly http: HttpClientService) {}

  /**
   * Toda llamada de los SDK de Claude sale por `HttpClientService.safeFetch` (auditoría A1): sin redes internas ni
   * DNS rebinding, sin seguir redirecciones y con límite de tamaño. Tiempos holgados para respuestas largas en flujo.
   */
  create(credentials: LlmCredentials): LlmClient {
    const fetch = this.http.safeFetch({
      timeoutMs: 120_000,
      idleTimeoutMs: 300_000,
      maxBodyBytes: 64 * 1024 * 1024,
    });
    return new AnthropicClient(credentials, fetch);
  }
}
