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
  firmaMetaValida,
  parseMetaCredenciales,
  resolverPlantilla,
  tipoMediaMeta,
  traducirWebhookMeta,
} from './whatsapp.shared';

/** Identidad del canal Meta WhatsApp, SIN secretos (el token/app secret llegan por `CanalRuntime.secretValue`). */
interface MetaConfig {
  /** Id del número de teléfono de WhatsApp Business (Cloud API). Identifica al remitente. */
  phoneNumberId?: string;
  /** Versión de Graph API a usar (por defecto `v21.0`). */
  graphVersion?: string;
}

const GRAPH_HOST = 'graph.facebook.com';
const DEFAULT_GRAPH_VERSION = 'v21.0';

/**
 * Mensaje claro cuando falta configuración/credenciales. El adaptador queda implementado pero INACTIVO: sin estos
 * datos NO intenta ninguna llamada de red (condición de activación productiva, ADR 0015 D5), igual que el de M365.
 */
function faltaCredenciales(config: MetaConfig, accessToken: string | undefined): string | null {
  if (!accessToken) {
    return 'Cuenta de WhatsApp Meta sin credenciales en la bóveda: configure `secretRef` con el token de la cuenta de WhatsApp Business (JSON `{ accessToken, appSecret }`). Sin credenciales el adaptador está inactivo y no envía.';
  }
  if (!config.phoneNumberId) {
    return 'Configuración de WhatsApp Meta incompleta: falta `phoneNumberId` en la cuenta de canal.';
  }
  return null;
}

/** Construye el cuerpo del mensaje de Meta según el tipo (texto, plantilla o adjunto). */
function construirCuerpo(mensaje: MensajeSaliente): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp', to: mensaje.destino };

  if (mensaje.plantilla) {
    const p = resolverPlantilla(mensaje.plantilla, { input: mensaje.metadatos ?? {} });
    return {
      ...base,
      type: 'template',
      template: {
        name: p.nombre,
        language: { code: p.idioma },
        ...(p.parametros.length
          ? { components: [{ type: 'body', parameters: p.parametros.map((text) => ({ type: 'text', text })) }] }
          : {}),
      },
    };
  }

  if (mensaje.adjunto) {
    const tipo = tipoMediaMeta(mensaje.adjunto.tipo);
    const media: Record<string, unknown> = {};
    if (mensaje.adjunto.mediaId) media.id = mensaje.adjunto.mediaId;
    else if (mensaje.adjunto.url) media.link = mensaje.adjunto.url;
    if (mensaje.adjunto.caption) media.caption = mensaje.adjunto.caption;
    if (mensaje.adjunto.nombreArchivo && tipo === 'document') media.filename = mensaje.adjunto.nombreArchivo;
    return { ...base, type: tipo, [tipo]: media };
  }

  return { ...base, type: 'text', text: { preview_url: false, body: mensaje.cuerpo } };
}

/**
 * Adaptador de WhatsApp sobre la Meta WhatsApp Business Platform (Cloud API), vía directa cuenta/número por empresa
 * (decisión del CEO). Toda llamada saliente pasa por `HttpClientService.request()` (anti-SSRF, timeout, tamaño). Las
 * credenciales se referencian por secreto de bóveda (`secretRef` → `CanalRuntime.secretValue`): token de la cuenta de
 * WhatsApp Business y, para verificar webhooks, el app secret; NUNCA en claro ni en `config`, nunca se registran.
 *
 * Soporta texto, plantilla (con parámetros) y adjunto por referencia. Mapea los estados de entrega de Meta
 * (sent/delivered/read/failed). Sin credenciales el adaptador NO intenta red y devuelve `estado: FALLIDO` con causa.
 */
@Injectable()
export class WhatsappMetaChannelAdapter implements ChannelAdapter {
  readonly proveedor = 'whatsapp_meta';
  readonly alias = ['meta'] as const;
  readonly tipos: readonly CanalTipo[] = ['WHATSAPP'];
  readonly capabilities: readonly ChannelCapability[] = ['ENVIAR', 'ESTADO_ENTREGA', 'RECIBIR'];

  constructor(private readonly http: HttpClientService) {}

  async enviar(runtime: CanalRuntime, mensaje: MensajeSaliente): Promise<ResultadoEnvio> {
    const config = runtime.config as MetaConfig;
    const { accessToken } = parseMetaCredenciales(runtime.secretValue);
    const inactivo = faltaCredenciales(config, accessToken);
    if (inactivo) return { estado: 'FALLIDO', error: inactivo };

    let cuerpo: Record<string, unknown>;
    try {
      cuerpo = construirCuerpo(mensaje);
    } catch (err) {
      // Plantilla inválida: error de negocio, sin tocar la red.
      return { estado: 'FALLIDO', error: (err as Error).message };
    }

    const version = config.graphVersion ?? DEFAULT_GRAPH_VERSION;
    const res = await this.http.request({
      url: `https://${GRAPH_HOST}/${version}/${encodeURIComponent(config.phoneNumberId as string)}/messages`,
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken as string}`, 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });

    if (res.ok) {
      const id = (res.body as { messages?: { id?: string }[] } | undefined)?.messages?.[0]?.id;
      return { estado: 'ENVIADO', proveedorMensajeId: id ?? mensaje.idempotencyKey };
    }
    // Error de negocio del proveedor: nunca se filtra el token ni el cuerpo crudo del error.
    return { estado: 'FALLIDO', error: `Meta WhatsApp respondió HTTP ${res.status}` };
  }

  async estadoEntrega(_runtime: CanalRuntime, proveedorMensajeId: string): Promise<ResultadoEstadoEntrega> {
    // Meta no ofrece estado por pull: llega por webhook (`statuses[]`). Se devuelve lo último conocido.
    return { estado: 'ENVIADO', detalle: `El estado de ${proveedorMensajeId} llega por webhook, no por consulta.` };
  }

  async test(runtime: CanalRuntime): Promise<ResultadoPrueba> {
    const config = runtime.config as MetaConfig;
    const { accessToken } = parseMetaCredenciales(runtime.secretValue);
    const inactivo = faltaCredenciales(config, accessToken);
    if (inactivo) return { ok: false, message: inactivo };
    try {
      const version = config.graphVersion ?? DEFAULT_GRAPH_VERSION;
      const res = await this.http.request({
        url: `https://${GRAPH_HOST}/${version}/${encodeURIComponent(config.phoneNumberId as string)}?fields=id`,
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken as string}` },
      });
      if (res.ok) return { ok: true, message: 'Credenciales de WhatsApp Meta válidas' };
      return { ok: false, message: `Meta WhatsApp respondió HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, message: `No se pudo validar con Meta WhatsApp: ${(err as Error).message}` };
    }
  }

  verificarFirma(runtime: CanalRuntime, solicitud: WebhookSolicitud): boolean {
    const { appSecret } = parseMetaCredenciales(runtime.secretValue);
    return firmaMetaValida(appSecret, solicitud.headers['x-hub-signature-256'], solicitud.rawBody);
  }

  traducirWebhook(solicitud: WebhookSolicitud): EventoCanalEntrante[] {
    return traducirWebhookMeta(solicitud.body);
  }
}
