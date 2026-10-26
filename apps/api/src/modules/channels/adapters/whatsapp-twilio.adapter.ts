import { Injectable } from '@nestjs/common';
import type { CanalTipo } from '@prisma/client';
import { HttpClientService } from '../../../common/http/http-client.service';
import type { ChannelAdapter } from '../domain/channel-adapter';
import type {
  CanalRuntime,
  ChannelCapability,
  EventoCanalEntrante,
  MensajeSaliente,
  ResultadoEnvio,
  ResultadoEstadoEntrega,
  ResultadoPrueba,
  WebhookSolicitud,
} from '../domain/channel.types';
import {
  firmaTwilioValida,
  parseTwilioCredenciales,
  resolverPlantilla,
  traducirWebhookTwilio,
  type TwilioCredenciales,
} from './whatsapp.shared';

/** Identidad del canal Twilio WhatsApp, SIN secretos (SID/token llegan por bóveda; SID puede ir aquí). */
interface TwilioConfig {
  /** Número remitente de WhatsApp aprobado en Twilio (E.164, ej. `+14155238886`). */
  fromNumber?: string;
  /** Account SID; opcional aquí si viene en el secreto. No es secreto por sí mismo. */
  accountSid?: string;
}

const API_HOST = 'api.twilio.com';

/** Mensaje claro cuando falta configuración/credenciales. Sin estos datos el adaptador está INACTIVO y no toca red. */
function faltaCredenciales(config: TwilioConfig, cred: TwilioCredenciales): string | null {
  if (!cred.authToken) {
    return 'Cuenta de WhatsApp Twilio sin credenciales en la bóveda: configure `secretRef` con el Auth Token (JSON `{ accountSid, authToken }`). Sin credenciales el adaptador está inactivo y no envía.';
  }
  if (!cred.accountSid) {
    return 'Configuración de WhatsApp Twilio incompleta: falta `accountSid` (en el secreto o en la cuenta de canal).';
  }
  if (!config.fromNumber) {
    return 'Configuración de WhatsApp Twilio incompleta: falta `fromNumber` en la cuenta de canal.';
  }
  return null;
}

/** Prefija `whatsapp:` si el valor no lo trae ya (Twilio direcciona WhatsApp con ese esquema). */
function direccionWhatsapp(valor: string): string {
  return valor.startsWith('whatsapp:') ? valor : `whatsapp:${valor}`;
}

/** Construye los parámetros form-encoded del mensaje (texto, plantilla por Content SID o adjunto por URL). */
function construirParametros(config: TwilioConfig, mensaje: MensajeSaliente): URLSearchParams {
  const params = new URLSearchParams();
  params.set('From', direccionWhatsapp(config.fromNumber as string));
  params.set('To', direccionWhatsapp(mensaje.destino));

  if (mensaje.plantilla) {
    // Twilio referencia plantillas aprobadas por Content SID; los parámetros posicionales van como ContentVariables.
    const p = resolverPlantilla(mensaje.plantilla, { input: mensaje.metadatos ?? {} });
    params.set('ContentSid', p.nombre);
    if (p.parametros.length) {
      const variables: Record<string, string> = {};
      p.parametros.forEach((valor, i) => (variables[String(i + 1)] = valor));
      params.set('ContentVariables', JSON.stringify(variables));
    }
    return params;
  }

  if (mensaje.adjunto) {
    if (mensaje.adjunto.url) params.set('MediaUrl', mensaje.adjunto.url);
    if (mensaje.adjunto.caption) params.set('Body', mensaje.adjunto.caption);
    return params;
  }

  params.set('Body', mensaje.cuerpo);
  return params;
}

/**
 * Adaptador de WhatsApp sobre Twilio (proveedor tipo "BSP", decisión del CEO: opción por adaptador independiente, NO
 * obligatorio). Toda llamada saliente pasa por `HttpClientService.request()` (anti-SSRF, timeout, tamaño). Las
 * credenciales (Account SID + Auth Token) se referencian por secreto de bóveda; NUNCA en claro, nunca se registran.
 *
 * Soporta texto, plantilla (Content SID + variables) y adjunto por URL. Mapea los estados de entrega de Twilio
 * (queued/sent/delivered/read/failed/undelivered). Sin credenciales NO intenta red y devuelve `estado: FALLIDO`.
 */
@Injectable()
export class WhatsappTwilioChannelAdapter implements ChannelAdapter {
  readonly proveedor = 'whatsapp_twilio';
  readonly alias = ['twilio'] as const;
  readonly tipos: readonly CanalTipo[] = ['WHATSAPP'];
  readonly capabilities: readonly ChannelCapability[] = ['ENVIAR', 'ESTADO_ENTREGA', 'RECIBIR'];

  constructor(private readonly http: HttpClientService) {}

  async enviar(runtime: CanalRuntime, mensaje: MensajeSaliente): Promise<ResultadoEnvio> {
    const config = runtime.config as TwilioConfig;
    const cred = parseTwilioCredenciales(runtime.secretValue, runtime.config);
    const inactivo = faltaCredenciales(config, cred);
    if (inactivo) return { estado: 'FALLIDO', error: inactivo };

    let params: URLSearchParams;
    try {
      params = construirParametros(config, mensaje);
    } catch (err) {
      return { estado: 'FALLIDO', error: (err as Error).message };
    }

    const res = await this.http.request({
      url: `https://${API_HOST}/2010-04-01/Accounts/${encodeURIComponent(cred.accountSid as string)}/Messages.json`,
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${cred.accountSid}:${cred.authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (res.ok) {
      const sid = (res.body as { sid?: string } | undefined)?.sid;
      return { estado: 'ENVIADO', proveedorMensajeId: sid ?? mensaje.idempotencyKey };
    }
    // Error de negocio del proveedor: nunca se filtran el Auth Token ni el cuerpo crudo del error.
    return { estado: 'FALLIDO', error: `Twilio respondió HTTP ${res.status}` };
  }

  async estadoEntrega(runtime: CanalRuntime, proveedorMensajeId: string): Promise<ResultadoEstadoEntrega> {
    // Twilio ofrece estado por pull en Messages/{sid}.json, pero lo normal es recibirlo por webhook (statusCallback).
    return { estado: 'ENVIADO', detalle: `El estado de ${proveedorMensajeId} llega por webhook (statusCallback).` };
  }

  async test(runtime: CanalRuntime): Promise<ResultadoPrueba> {
    const config = runtime.config as TwilioConfig;
    const cred = parseTwilioCredenciales(runtime.secretValue, runtime.config);
    const inactivo = faltaCredenciales(config, cred);
    if (inactivo) return { ok: false, message: inactivo };
    try {
      const res = await this.http.request({
        url: `https://${API_HOST}/2010-04-01/Accounts/${encodeURIComponent(cred.accountSid as string)}.json`,
        method: 'GET',
        headers: {
          authorization: `Basic ${Buffer.from(`${cred.accountSid}:${cred.authToken}`).toString('base64')}`,
        },
      });
      if (res.ok) return { ok: true, message: 'Credenciales de WhatsApp Twilio válidas' };
      return { ok: false, message: `Twilio respondió HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, message: `No se pudo validar con Twilio: ${(err as Error).message}` };
    }
  }

  verificarFirma(runtime: CanalRuntime, solicitud: WebhookSolicitud): boolean {
    const { authToken } = parseTwilioCredenciales(runtime.secretValue, runtime.config);
    const params = (solicitud.body ?? {}) as Record<string, unknown>;
    return firmaTwilioValida(authToken, solicitud.headers['x-twilio-signature'], solicitud.url, params);
  }

  traducirWebhook(solicitud: WebhookSolicitud): EventoCanalEntrante[] {
    return traducirWebhookTwilio(solicitud.body);
  }
}
