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

/** Identidad del canal M365, SIN secretos (el secreto de cliente llega por `CanalRuntime.secretValue`). */
interface M365Config {
  /** Id del tenant de Entra ID (directorio). */
  tenantId?: string;
  /** Id de la aplicación (cliente) registrada en Entra ID. */
  clientId?: string;
  /** Buzón remitente (userPrincipalName o correo) desde el que se envía. */
  remitente?: string;
}

const LOGIN_HOST = 'login.microsoftonline.com';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

/**
 * Mensaje claro cuando falta configuración/credenciales. El adaptador queda implementado pero INACTIVO: sin estos
 * datos NO intenta ninguna llamada de red (condición de activación productiva, ADR 0015 D5).
 */
function faltaCredenciales(config: M365Config, secretValue: string | undefined): string | null {
  if (!secretValue) {
    return 'Cuenta de correo M365 sin credenciales en la bóveda: configure `secretRef` con el secreto de cliente de Entra ID. Sin credenciales el adaptador está inactivo y no envía.';
  }
  const faltan = (['tenantId', 'clientId', 'remitente'] as const).filter((k) => !config[k]);
  if (faltan.length) return `Configuración de M365 incompleta: falta ${faltan.join(', ')} en la cuenta de canal.`;
  return null;
}

/**
 * Adaptador de correo Microsoft 365 (ADR 0015 D1, capability MAILBOX/envío). Toda llamada saliente pasa por
 * `HttpClientService.request()` (anti-SSRF, timeout, tamaño). Las credenciales se referencian por secreto de bóveda
 * (`secretRef` → `CanalRuntime.secretValue`), NUNCA en claro ni en `config`; no se registran ni se devuelven.
 *
 * Condición de activación: una `CanalCuenta` M365 con `secretRef` cargado en la bóveda y `config` completa
 * (`tenantId`, `clientId`, `remitente`). Sin credenciales el adaptador NO intenta red y devuelve `estado: FALLIDO`
 * con causa clara. En CI/QA no se llama a Microsoft (las cuentas de prueba no tienen `secretRef`).
 */
@Injectable()
export class M365MailChannelAdapter implements ChannelAdapter {
  readonly proveedor = 'm365';
  readonly tipos: readonly CanalTipo[] = ['CORREO'];
  readonly capabilities: readonly ChannelCapability[] = ['ENVIAR', 'ESTADO_ENTREGA', 'RECIBIR'];

  constructor(private readonly http: HttpClientService) {}

  async enviar(runtime: CanalRuntime, mensaje: MensajeSaliente): Promise<ResultadoEnvio> {
    const config = runtime.config as M365Config;
    const inactivo = faltaCredenciales(config, runtime.secretValue);
    if (inactivo) return { estado: 'FALLIDO', error: inactivo };

    const token = await this.token(config, runtime.secretValue as string);
    const res = await this.http.request({
      url: `${GRAPH_BASE}/users/${encodeURIComponent(config.remitente as string)}/sendMail`,
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: mensaje.asunto ?? '',
          body: { contentType: 'Text', content: mensaje.cuerpo },
          toRecipients: [{ emailAddress: { address: mensaje.destino } }],
        },
        saveToSentItems: true,
      }),
    });
    // Graph `sendMail` responde 202 Accepted sin cuerpo; cualquier otro código es un error de negocio del proveedor.
    if (res.status === 202) return { estado: 'ENVIADO', proveedorMensajeId: mensaje.idempotencyKey };
    return { estado: 'FALLIDO', error: `Microsoft Graph respondió HTTP ${res.status}` };
  }

  async estadoEntrega(_runtime: CanalRuntime, proveedorMensajeId: string): Promise<ResultadoEstadoEntrega> {
    // Graph no ofrece estado de entrega por pull para `sendMail` (llega por webhooks en incrementos posteriores).
    return { estado: 'ENVIADO', detalle: `Sin consulta de estado por pull para ${proveedorMensajeId}` };
  }

  async test(runtime: CanalRuntime): Promise<ResultadoPrueba> {
    const config = runtime.config as M365Config;
    const inactivo = faltaCredenciales(config, runtime.secretValue);
    if (inactivo) return { ok: false, message: inactivo };
    try {
      await this.token(config, runtime.secretValue as string);
      return { ok: true, message: 'Credenciales de M365 válidas' };
    } catch (err) {
      return { ok: false, message: `No se pudo autenticar con M365: ${(err as Error).message}` };
    }
  }

  /** Token de aplicación (client credentials). El secreto NUNCA se registra ni se devuelve. */
  private async token(config: M365Config, clientSecret: string): Promise<string> {
    const res = await this.http.request({
      url: `https://${LOGIN_HOST}/${encodeURIComponent(config.tenantId as string)}/oauth2/v2.0/token`,
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.clientId as string,
        client_secret: clientSecret,
        scope: GRAPH_SCOPE,
      }).toString(),
    });
    const token = (res.body as { access_token?: string } | undefined)?.access_token;
    if (!res.ok || !token) throw new Error(`autenticación rechazada (HTTP ${res.status})`);
    return token;
  }
}
