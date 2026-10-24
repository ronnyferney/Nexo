import { AssumeRoleCommand, STSClient, type STSClientConfig } from '@aws-sdk/client-sts';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { HttpClientService } from '../../../common/http/http-client.service';
import { KeylessAuthError } from './keyless-errors';
import { EXTERNAL_ID_PATTERN, type AwsRoleOptions } from './keyless-options';

/** Credenciales temporales de AWS con las que los SDK de Claude firman con SigV4. */
export interface AwsTemporaryCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiration?: Date;
}

/** Canal de Claude en AWS: decide la política de permisos sugerida. */
export type AwsClaudeChannel = 'bedrock' | 'aws';

/** Vida pedida a STS (`DurationSeconds`): 1 hora, el valor por defecto documentado y el máximo de un rol encadenado. */
export const ASSUME_ROLE_SECONDS = 3600;
/** Se renuevan las credenciales 5 minutos antes de expirar (una sola solicitud por rol aunque haya concurrencia). */
const REFRESH_MARGIN_MS = 5 * 60_000;
/** Vida del comprobante del ExternalId entre «Preparar» y «Conectar». */
const SETUP_TOKEN_TTL_S = 24 * 3600;

/** Petición HTTP de Smithy que recibe un `requestHandler` del SDK de AWS v3 (solo los campos que se usan). */
interface SmithyRequest {
  method: string;
  protocol: string;
  hostname: string;
  port?: number;
  path: string;
  query?: Record<string, string | string[] | null>;
  headers: Record<string, string>;
  body?: unknown;
}

/**
 * `requestHandler` del SDK de AWS que envía cada llamada por `HttpClientService.safeFetch` (política SSRF de Nexo, sin
 * redirecciones, con límites de tiempo y tamaño), como hace el driver de Claude (auditoría A1). Las respuestas de STS son
 * pequeñas: se leen completas y se entregan al SDK como un flujo de Node.
 */
export function safeFetchRequestHandler(fetchFn: typeof fetch): NonNullable<STSClientConfig['requestHandler']> {
  const handler = {
    metadata: { handlerProtocol: 'http/1.1' },
    async handle(request: SmithyRequest, options?: { abortSignal?: AbortSignal }) {
      const query = Object.entries(request.query ?? {})
        .flatMap(([k, v]) =>
          (Array.isArray(v) ? v : [v]).map((x) =>
            x === null ? encodeURIComponent(k) : `${encodeURIComponent(k)}=${encodeURIComponent(x)}`,
          ),
        )
        .join('&');
      const port = request.port ? `:${request.port}` : '';
      const url = `${request.protocol}//${request.hostname}${port}${request.path}${query ? `?${query}` : ''}`;
      // `host` y `content-length` los fija fetch con los mismos valores que firmó SigV4.
      const headers = Object.fromEntries(
        Object.entries(request.headers).filter(([k]) => !['host', 'content-length'].includes(k.toLowerCase())),
      );
      const res = await fetchFn(url, {
        method: request.method,
        headers,
        body: request.body as BodyInit | undefined,
        signal: options?.abortSignal,
      });
      const body = Buffer.from(await res.arrayBuffer());
      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => (responseHeaders[k] = v));
      return {
        response: {
          statusCode: res.status,
          reason: res.statusText,
          headers: responseHeaders,
          body: Readable.from([body]),
        },
      };
    },
    updateHttpClientConfig() {},
    httpHandlerConfigs() {
      return {};
    },
    destroy() {},
  };
  return handler;
}

/**
 * Conexión de Claude en AWS (Amazon Bedrock y Claude Platform on AWS) **sin claves de larga duración** (plan de mejora
 * L3): el cliente crea en su cuenta un rol de IAM que confía en el principal de la plataforma Nexo solo con el
 * `ExternalId` único de la conexión; Nexo lo asume con STS `AssumeRole` usando las credenciales de la plataforma (cadena
 * estándar del SDK de AWS: variables de entorno, rol de tarea de ECS, perfil, IMDS…) y firma con SigV4.
 *
 * Fuentes: platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock («IAM assumed roles»: rol con
 * `bedrock-mantle:CreateInference`, credenciales temporales de STS) y …/claude-platform-on-aws (SigV4 con el servicio
 * `aws-external-anthropic`, acciones `aws-external-anthropic:*`, ARN del workspace); `@aws-sdk/client-sts` (modelo
 * oficial de `AssumeRole`: `ExternalId` con alfanuméricos y `_+=,.@:/-`, `DurationSeconds` por defecto 3600). El
 * `ExternalId` lo genera Nexo y el cliente no puede elegirlo, para evitar el «confused deputy» (guía de IAM
 * docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-user_externalid.html, enlazada desde el SDK).
 */
@Injectable()
export class AwsRoleService {
  private readonly logger = new Logger(AwsRoleService.name);
  private readonly cache = new Map<string, AwsTemporaryCredentials>();
  private readonly inflight = new Map<string, Promise<AwsTemporaryCredentials>>();
  private readonly clients = new Map<string, STSClient>();
  private readonly secret: Buffer;

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpClientService,
  ) {
    this.secret = createHash('sha256')
      .update(`${config.get<string>('jwt.secret') ?? ''}::llm-aws-external-id`)
      .digest();
  }

  /** Principal de IAM de la plataforma Nexo que el cliente pone en la política de confianza. */
  get principalArn(): string | null {
    return this.config.get<string | null>('llm.aws.principalArn') ?? null;
  }

  unavailableReason(): string | null {
    if (!this.principalArn) {
      return (
        'El operador de Nexo debe definir LLM_AWS_PRINCIPAL_ARN (el rol de IAM de la plataforma con el que Nexo asume ' +
        'los roles de los clientes) y dar a la API credenciales de AWS de la plataforma.'
      );
    }
    return null;
  }

  /** ExternalId nuevo para una conexión y su comprobante firmado, ligado al workspace (vida de 24 horas). */
  newExternalId(workspaceId: string): { externalId: string; setupToken: string; expiresAt: string } {
    const externalId = `nexo-${randomBytes(24).toString('base64url')}`;
    const exp = Math.floor(Date.now() / 1000) + SETUP_TOKEN_TTL_S;
    const body = Buffer.from(JSON.stringify({ ws: workspaceId, xid: externalId, exp })).toString('base64url');
    return { externalId, setupToken: `${body}.${this.mac(body)}`, expiresAt: new Date(exp * 1000).toISOString() };
  }

  /** ExternalId del comprobante si es auténtico, vigente y de este workspace; si no, 400. */
  verifySetupToken(token: string | undefined, workspaceId: string): string {
    const invalid = new BadRequestException(
      'El ExternalId de la conexión no es válido o expiró: pulse «Generar ExternalId» y actualice la política de confianza del rol',
    );
    if (!token || token.length > 1024) throw invalid;
    const [body, mac] = token.split('.');
    if (!body || !mac) throw invalid;
    const expected = Buffer.from(this.mac(body));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid;
    let claims: { ws?: unknown; xid?: unknown; exp?: unknown };
    try {
      claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as typeof claims;
    } catch {
      throw invalid;
    }
    if (
      claims.ws !== workspaceId ||
      typeof claims.xid !== 'string' ||
      !new RegExp(EXTERNAL_ID_PATTERN).test(claims.xid) ||
      typeof claims.exp !== 'number' ||
      claims.exp * 1000 < Date.now()
    ) {
      throw invalid;
    }
    return claims.xid;
  }

  private mac(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }

  /** Política de confianza que el cliente asigna a su rol: solo el principal de Nexo y solo con este ExternalId. */
  trustPolicy(externalId: string) {
    return {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: this.principalArn ?? '<ARN del principal de Nexo>' },
          Action: 'sts:AssumeRole',
          Condition: { StringEquals: { 'sts:ExternalId': externalId } },
        },
      ],
    };
  }

  /**
   * Política de permisos mínima sugerida. Bedrock: `bedrock-mantle:CreateInference` (platform.claude.com, «IAM assumed
   * roles»; el ARN exacto de los modelos de bedrock-mantle queda en `pendingVerification`, por eso `Resource: *`).
   * Claude Platform on AWS: acciones y ARN de workspace del ejemplo oficial.
   */
  permissionsPolicy(channel: AwsClaudeChannel, values: { region?: string; workspaceId?: string } = {}) {
    if (channel === 'bedrock') {
      return {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: ['bedrock-mantle:CreateInference'], Resource: '*' }],
      };
    }
    const region = values.region || '*';
    const workspace = values.workspaceId || '*';
    return {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: [
            'aws-external-anthropic:CreateInference',
            'aws-external-anthropic:CountTokens',
            'aws-external-anthropic:GetModel',
            'aws-external-anthropic:ListModels',
            'aws-external-anthropic:GetWorkspace',
          ],
          Resource: `arn:aws:aws-external-anthropic:${region}:*:workspace/${workspace}`,
        },
      ],
    };
  }

  /** `RoleSessionName` (2–64 caracteres `[\w+=,.@-]`): identifica al workspace de Nexo en CloudTrail del cliente. */
  sessionName(workspaceId: string): string {
    return `nexo-${workspaceId.replace(/[^\w+=,.@-]/g, '')}`.slice(0, 64);
  }

  /**
   * Credenciales temporales del rol, en caché hasta 5 minutos antes de expirar. Las llamadas concurrentes comparten
   * una sola solicitud a STS.
   */
  async credentials(role: AwsRoleOptions, sessionName: string): Promise<AwsTemporaryCredentials> {
    const key = `${role.roleArn}|${role.externalId}|${role.region}`;
    const cached = this.cache.get(key);
    if (cached && (!cached.expiration || cached.expiration.getTime() - Date.now() > REFRESH_MARGIN_MS)) return cached;
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.assume(role, sessionName)
        .then((creds) => {
          this.cache.set(key, creds);
          return creds;
        })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return pending;
  }

  /** Olvida las credenciales en caché de un rol (p. ej. al borrar la conexión). */
  forget(role: AwsRoleOptions): void {
    this.cache.delete(`${role.roleArn}|${role.externalId}|${role.region}`);
  }

  private client(region: string): STSClient {
    let client = this.clients.get(region);
    if (!client) {
      const endpoint = this.config.get<string | null>('llm.aws.stsEndpoint') || undefined;
      client = new STSClient({
        region,
        ...(endpoint ? { endpoint } : {}),
        maxAttempts: 2,
        requestHandler: safeFetchRequestHandler(
          this.http.safeFetch({ timeoutMs: 15_000, idleTimeoutMs: 15_000, maxBodyBytes: 256 * 1024 }),
        ),
      });
      this.clients.set(region, client);
    }
    return client;
  }

  private async assume(role: AwsRoleOptions, sessionName: string): Promise<AwsTemporaryCredentials> {
    if (!this.principalArn) throw new KeylessAuthError(this.unavailableReason()!);
    let out;
    try {
      out = await this.client(role.region).send(
        new AssumeRoleCommand({
          RoleArn: role.roleArn,
          RoleSessionName: sessionName,
          ExternalId: role.externalId,
          DurationSeconds: ASSUME_ROLE_SECONDS,
        }),
      );
    } catch (err) {
      const e = err as Error & { $metadata?: { httpStatusCode?: number } };
      const status = e.$metadata?.httpStatusCode;
      this.logger.warn(`AssumeRole de ${role.roleArn} fallido: ${e.name}${status ? ` (HTTP ${status})` : ''}`);
      if (status === 403 || /AccessDenied/i.test(e.name)) {
        throw new KeylessAuthError(
          'AWS no permitió que Nexo asumiera el rol: revise que la política de confianza del rol nombre al principal de ' +
            'Nexo y exija exactamente el ExternalId de esta conexión (sts:ExternalId).',
        );
      }
      if (/credential/i.test(e.name) || /credential/i.test(e.message)) {
        throw new KeylessAuthError(
          'La plataforma Nexo no tiene credenciales de AWS para llamar a STS: el operador debe asignarle un rol de IAM.',
        );
      }
      throw new KeylessAuthError(`No se pudo asumir el rol de IAM con AWS STS (${e.name}).`);
    }
    const c = out.Credentials;
    if (!c?.AccessKeyId || !c.SecretAccessKey) {
      throw new KeylessAuthError('AWS STS no devolvió credenciales temporales para el rol.');
    }
    return {
      accessKeyId: c.AccessKeyId,
      secretAccessKey: c.SecretAccessKey,
      ...(c.SessionToken ? { sessionToken: c.SessionToken } : {}),
      ...(c.Expiration ? { expiration: new Date(c.Expiration) } : {}),
    };
  }
}
