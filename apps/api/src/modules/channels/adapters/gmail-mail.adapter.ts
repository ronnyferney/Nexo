import { Injectable } from '@nestjs/common';
import type { CanalTipo } from '@prisma/client';
import { HttpClientService } from '../../../common/http/http-client.service';
import type { ChannelAdapter } from '../domain/channel-adapter';
import type {
  CanalRuntime,
  ChannelCapability,
  MensajeSaliente,
  ResultadoEnvio,
  ResultadoEstadoEntrega,
  ResultadoPrueba,
} from '../domain/channel.types';

/** Identidad del canal Gmail, SIN secretos (las credenciales OAuth2 llegan por `CanalRuntime.secretValue`). */
interface GmailConfig {
  /** Buzón remitente (dirección de correo) desde el que se envía; debe coincidir con la cuenta autorizada. */
  remitente?: string;
}

/**
 * Forma del secreto de bóveda para Gmail: JSON con las credenciales OAuth2 de una app de Google Cloud autorizada por
 * la empresa (D1: cuentas/credenciales por empresa). El `refreshToken` se intercambia por un `access_token` de corta
 * vida contra el endpoint de token de Google. NUNCA se registra ni se devuelve en errores.
 */
interface GmailSecret {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
}

const OAUTH_HOST = 'oauth2.googleapis.com';
const TOKEN_URL = `https://${OAUTH_HOST}/token`;
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

/** Parsea el secreto de bóveda (JSON). Nunca lanza con el contenido del secreto: un JSON inválido no filtra su valor. */
function parseSecret(secretValue: string | undefined): GmailSecret | null {
  if (!secretValue) return null;
  try {
    const parsed: unknown = JSON.parse(secretValue);
    if (parsed && typeof parsed === 'object') return parsed;
    return {};
  } catch {
    // No se incluye el valor del secreto en el error.
    return {};
  }
}

/**
 * Mensaje claro cuando falta configuración/credenciales. El adaptador queda implementado pero INACTIVO: sin estos
 * datos NO intenta ninguna llamada de red (condición de activación productiva, espejo de M365, ADR 0015 D5).
 */
function faltaCredenciales(config: GmailConfig, secret: GmailSecret | null): string | null {
  if (!secret) {
    return 'Cuenta de correo Gmail sin credenciales en la bóveda: configure `secretRef` con el JSON OAuth2 (clientId, clientSecret, refreshToken). Sin credenciales el adaptador está inactivo y no envía.';
  }
  const faltan = (['clientId', 'clientSecret', 'refreshToken'] as const).filter((k) => !secret[k]);
  if (faltan.length) {
    return `Credenciales de Gmail incompletas en la bóveda: falta ${faltan.join(', ')} en el secreto OAuth2.`;
  }
  if (!config.remitente) return 'Configuración de Gmail incompleta: falta remitente en la cuenta de canal.';
  return null;
}

/** Codifica texto a base64url (RFC 4648 §5), formato que exige la Gmail API para `raw`. */
function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Codifica una cabecera con palabras no ASCII usando MIME encoded-word (RFC 2047) para preservar acentos/UTF-8. */
function encodeHeader(value: string): string {
  // ASCII puro: se deja tal cual (más legible). Con cualquier byte no ASCII, encoded-word base64 UTF-8.
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/**
 * Construye el mensaje MIME (RFC 5322) listo para `users.messages.send`. Función PURA y sin red: facilita las pruebas
 * del formato. El cuerpo es texto plano UTF-8; las cabeceras no ASCII se codifican con encoded-word.
 */
export function construirMimeGmail(remitente: string, mensaje: MensajeSaliente): string {
  const lineas = [
    `From: ${encodeHeader(remitente)}`,
    `To: ${encodeHeader(mensaje.destino)}`,
    `Subject: ${encodeHeader(mensaje.asunto ?? '')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    mensaje.cuerpo,
  ];
  return lineas.join('\r\n');
}

/**
 * Adaptador de correo Gmail (ADR 0015 D1, alternativa por adaptador a M365; cuentas/credenciales por empresa). Toda
 * llamada saliente pasa por `HttpClientService.request()` (anti-SSRF, timeout, tamaño). Las credenciales se refieren
 * por secreto de bóveda (`secretRef` → `CanalRuntime.secretValue`, JSON OAuth2), NUNCA en claro ni en `config`; no se
 * registran ni se devuelven en errores.
 *
 * Condición de activación: una `CanalCuenta` Gmail con `secretRef` cargado (clientId, clientSecret, refreshToken) y
 * `config.remitente`. Sin credenciales el adaptador NO intenta red y devuelve `estado: FALLIDO` con causa clara. En
 * CI/QA no se llama a Google (las cuentas de prueba no tienen `secretRef`; el sandbox no hace envíos reales).
 *
 * Recepción (Gmail push vía Pub/Sub, ADR 0015 D6): no se implementa en este incremento. El hook `recibir`/
 * `verificarFirma` se activará junto con la verificación del token de Pub/Sub cuando se habilite la recepción.
 */
@Injectable()
export class GmailMailChannelAdapter implements ChannelAdapter {
  readonly proveedor = 'gmail';
  readonly alias: readonly string[] = ['google_mail'];
  readonly tipos: readonly CanalTipo[] = ['CORREO'];
  readonly capabilities: readonly ChannelCapability[] = ['ENVIAR', 'ESTADO_ENTREGA'];

  constructor(private readonly http: HttpClientService) {}

  async enviar(runtime: CanalRuntime, mensaje: MensajeSaliente): Promise<ResultadoEnvio> {
    const config = runtime.config as GmailConfig;
    const secret = parseSecret(runtime.secretValue);
    const inactivo = faltaCredenciales(config, secret);
    if (inactivo) return { estado: 'FALLIDO', error: inactivo };

    const token = await this.token(secret as GmailSecret);
    const raw = base64url(construirMimeGmail(config.remitente as string, mensaje));
    const res = await this.http.request({
      url: `${GMAIL_BASE}/users/${encodeURIComponent(config.remitente as string)}/messages/send`,
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    // `messages.send` responde 200 con el recurso del mensaje; cualquier otro código es error de negocio del proveedor.
    const id = (res.body as { id?: string } | undefined)?.id;
    if (res.ok && id) return { estado: 'ENVIADO', proveedorMensajeId: id };
    return { estado: 'FALLIDO', error: `Gmail API respondió HTTP ${res.status}` };
  }

  async estadoEntrega(_runtime: CanalRuntime, proveedorMensajeId: string): Promise<ResultadoEstadoEntrega> {
    // Gmail no ofrece estado de entrega por pull para `messages.send` (las notificaciones llegan por Pub/Sub, D6).
    return { estado: 'ENVIADO', detalle: `Sin consulta de estado por pull para ${proveedorMensajeId}` };
  }

  async test(runtime: CanalRuntime): Promise<ResultadoPrueba> {
    const config = runtime.config as GmailConfig;
    const secret = parseSecret(runtime.secretValue);
    const inactivo = faltaCredenciales(config, secret);
    if (inactivo) return { ok: false, message: inactivo };
    try {
      await this.token(secret as GmailSecret);
      return { ok: true, message: 'Credenciales de Gmail válidas' };
    } catch (err) {
      return { ok: false, message: `No se pudo autenticar con Gmail: ${(err as Error).message}` };
    }
  }

  /** Intercambia el refresh token por un access token (OAuth2). El secreto NUNCA se registra ni se devuelve. */
  private async token(secret: GmailSecret): Promise<string> {
    const res = await this.http.request({
      url: TOKEN_URL,
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: secret.clientId as string,
        client_secret: secret.clientSecret as string,
        refresh_token: secret.refreshToken as string,
        scope: GMAIL_SCOPE,
      }).toString(),
    });
    const token = (res.body as { access_token?: string } | undefined)?.access_token;
    if (!res.ok || !token) throw new Error(`autenticación rechazada (HTTP ${res.status})`);
    return token;
  }
}
