import { createHmac, timingSafeEqual } from 'node:crypto';
import type { EstadoMensajeCanal } from '@prisma/client';
import { render, type TemplateContext } from '../../../common/template/template.engine';
import type { AdjuntoMensaje, EventoCanalEntrante, PlantillaMensaje } from '../domain/channel.types';

/**
 * Funciones PURAS compartidas por los adaptadores de WhatsApp (Meta Cloud API y Twilio). No realizan ninguna llamada
 * de red: parseo de credenciales de bóveda, validación/expansión de plantillas (solo con `template.engine`, NUNCA
 * `eval`), verificación de firmas de webhook y mapeo de estados de entrega. Se exportan para probarse con fixtures.
 */

// ---------- Credenciales (desde `CanalRuntime.secretValue`, nunca en claro en `config`) ----------

/** Credenciales de Meta WhatsApp Business: token de la cuenta (envío) y app secret (firma de webhooks). */
export interface MetaCredenciales {
  accessToken?: string;
  appSecret?: string;
}

/** Credenciales de Twilio: Account SID y Auth Token. */
export interface TwilioCredenciales {
  accountSid?: string;
  authToken?: string;
}

function comoTexto(v: unknown): string | undefined {
  return typeof v === 'string' && v.length ? v : undefined;
}

function parseJsonSecret(secretValue: string | undefined): Record<string, unknown> | undefined {
  if (!secretValue) return undefined;
  const t = secretValue.trim();
  if (!t.startsWith('{')) return undefined;
  try {
    const parsed: unknown = JSON.parse(t);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Credenciales de Meta desde el secreto de bóveda. Admite un JSON `{ accessToken, appSecret }` (lo recomendado, para
 * aislar envío y firma) o un texto plano, que se interpreta como `accessToken` (sin verificación de webhook).
 */
export function parseMetaCredenciales(secretValue: string | undefined): MetaCredenciales {
  const obj = parseJsonSecret(secretValue);
  if (obj) {
    return {
      accessToken: comoTexto(obj.accessToken ?? obj.access_token),
      appSecret: comoTexto(obj.appSecret ?? obj.app_secret),
    };
  }
  return { accessToken: comoTexto(secretValue?.trim()) };
}

/**
 * Credenciales de Twilio desde el secreto de bóveda y la `config`. Admite un JSON `{ accountSid, authToken }` o un
 * texto plano (interpretado como `authToken`), con el `accountSid` tomado de `config.accountSid` si no viene en el
 * secreto. El Auth Token NUNCA se toma de `config`.
 */
export function parseTwilioCredenciales(
  secretValue: string | undefined,
  config: Record<string, unknown>,
): TwilioCredenciales {
  const obj = parseJsonSecret(secretValue);
  if (obj) {
    return {
      accountSid: comoTexto(obj.accountSid ?? obj.account_sid) ?? comoTexto(config.accountSid),
      authToken: comoTexto(obj.authToken ?? obj.auth_token),
    };
  }
  return { accountSid: comoTexto(config.accountSid), authToken: comoTexto(secretValue?.trim()) };
}

// ---------- Plantillas (solo `template.engine`, sin eval; parámetros sin secretos) ----------

/**
 * Nombre de plantilla aprobada: letras, dígitos y guion bajo. Cubre el formato de Meta (snake_case en minúsculas) y el
 * Content SID de Twilio (`HX` + hex). Rechaza espacios y caracteres inseguros (evita inyección en el payload).
 */
const NOMBRE_PLANTILLA = /^[A-Za-z0-9_]{1,512}$/;
/** Idioma BCP-47 simplificado: `es`, `es_AR`, `en_US`, ... */
const IDIOMA_PLANTILLA = /^[a-z]{2,3}(_[A-Z]{2})?$/;

/** Plantilla ya validada y con parámetros expandidos (listos para el shape del proveedor). */
export interface PlantillaResuelta {
  nombre: string;
  idioma: string;
  parametros: string[];
}

/**
 * Valida y expande una plantilla declarativa. Los valores de parámetro se renderizan con `template.engine` (`{{
 * input.x }}` / `{{ secrets.X }}`), NUNCA con `eval`. Lanza `Error` con mensaje en español si la plantilla es
 * inválida (nombre/idioma con formato incorrecto o parámetro que queda vacío tras expandir).
 */
export function resolverPlantilla(plantilla: PlantillaMensaje, ctx: TemplateContext = {}): PlantillaResuelta {
  const nombre = (plantilla.nombre ?? '').trim();
  if (!NOMBRE_PLANTILLA.test(nombre)) {
    throw new Error('Nombre de plantilla inválido: use minúsculas, dígitos y guion bajo (ej. confirmacion_cita).');
  }
  const idioma = (plantilla.idioma ?? 'es').trim();
  if (!IDIOMA_PLANTILLA.test(idioma)) {
    throw new Error(`Idioma de plantilla inválido: ${idioma} (use formato BCP-47, ej. es, es_AR, en_US).`);
  }
  const crudos = plantilla.parametros ?? [];
  if (!Array.isArray(crudos)) {
    throw new Error('Los parámetros de plantilla deben ser una lista de valores posicionales.');
  }
  const parametros = crudos.map((valor, i) => {
    const expandido = render<string>(String(valor ?? ''), ctx);
    const texto = typeof expandido === 'string' ? expandido : String(expandido ?? '');
    if (!texto.trim()) {
      throw new Error(`El parámetro ${i + 1} de la plantilla ${nombre} quedó vacío tras expandir la variable.`);
    }
    return texto;
  });
  return { nombre, idioma, parametros };
}

// ---------- Firmas de webhook (puras, SIN red) ----------

function igualSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Verifica la firma `X-Hub-Signature-256` de Meta: `sha256=` + HMAC-SHA256(appSecret, cuerpoCrudo). Compara en tiempo
 * constante. Sin `appSecret` o sin cabecera devuelve `false` (se rechaza y audita).
 */
export function firmaMetaValida(appSecret: string | undefined, firma: string | undefined, rawBody: string): boolean {
  if (!appSecret || !firma) return false;
  const esperado = `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`;
  return igualSeguro(firma, esperado);
}

/**
 * Verifica la firma `X-Twilio-Signature`: base64(HMAC-SHA1(authToken, url + concat(clave+valor de params ordenados))).
 * `params` es el cuerpo form-encoded del webhook ya parseado. Sin `authToken` o sin cabecera devuelve `false`.
 */
export function firmaTwilioValida(
  authToken: string | undefined,
  firma: string | undefined,
  url: string,
  params: Record<string, unknown>,
): boolean {
  if (!authToken || !firma) return false;
  let data = url;
  for (const clave of Object.keys(params).sort()) data += clave + String(params[clave] ?? '');
  const esperado = createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
  return igualSeguro(firma, esperado);
}

// ---------- Mapeo de estados de entrega ----------

/** Mapea el estado de Meta (`sent|delivered|read|failed`) al estado normalizado del dominio. */
export function estadoDesdeMeta(status: string | undefined): EstadoMensajeCanal {
  switch ((status ?? '').toLowerCase()) {
    case 'sent':
      return 'ENVIADO';
    case 'delivered':
      return 'ENTREGADO';
    case 'read':
      return 'LEIDO';
    case 'failed':
      return 'FALLIDO';
    default:
      return 'PENDIENTE';
  }
}

/** Mapea el `MessageStatus` de Twilio al estado normalizado del dominio. */
export function estadoDesdeTwilio(status: string | undefined): EstadoMensajeCanal {
  switch ((status ?? '').toLowerCase()) {
    case 'queued':
    case 'accepted':
    case 'scheduled':
    case 'sending':
      return 'PENDIENTE';
    case 'sent':
      return 'ENVIADO';
    case 'delivered':
      return 'ENTREGADO';
    case 'read':
      return 'LEIDO';
    case 'failed':
    case 'undelivered':
      return 'FALLIDO';
    default:
      return 'PENDIENTE';
  }
}

// ---------- Traducción de payloads de webhook a eventos normalizados ----------

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Traduce el payload de un webhook de Meta Cloud API a eventos normalizados. Forma:
 * `{ entry: [{ changes: [{ value: { messages: [...], statuses: [...] } }] }] }`.
 */
export function traducirWebhookMeta(body: unknown): EventoCanalEntrante[] {
  const eventos: EventoCanalEntrante[] = [];
  for (const entry of arr(obj(body).entry)) {
    for (const change of arr(obj(entry).changes)) {
      const value = obj(obj(change).value);
      for (const m of arr(value.messages)) {
        const msg = obj(m);
        const id = comoTexto(msg.id);
        if (!id) continue;
        eventos.push({
          tipo: 'MENSAJE',
          proveedorMensajeId: id,
          origen: comoTexto(msg.from) ?? 'desconocido',
          cuerpo: comoTexto(obj(msg.text).body) ?? '',
        });
      }
      for (const s of arr(value.statuses)) {
        const st = obj(s);
        const id = comoTexto(st.id);
        if (!id) continue;
        eventos.push({ tipo: 'ESTADO', proveedorMensajeId: id, estado: estadoDesdeMeta(comoTexto(st.status)) });
      }
    }
  }
  return eventos;
}

/**
 * Traduce el payload (form-encoded ya parseado) de un webhook de Twilio. Un entrante trae `MessageSid`, `From`,
 * `Body`; una devolución de estado trae `MessageSid`/`SmsSid` y `MessageStatus`/`SmsStatus`.
 */
export function traducirWebhookTwilio(body: unknown): EventoCanalEntrante[] {
  const b = obj(body);
  const id = comoTexto(b.MessageSid) ?? comoTexto(b.SmsSid) ?? comoTexto(b.SmsMessageSid);
  if (!id) return [];
  const status = comoTexto(b.MessageStatus) ?? comoTexto(b.SmsStatus);
  if (status) {
    return [{ tipo: 'ESTADO', proveedorMensajeId: id, estado: estadoDesdeTwilio(status) }];
  }
  return [
    {
      tipo: 'MENSAJE',
      proveedorMensajeId: id,
      origen: comoTexto(b.From) ?? 'desconocido',
      cuerpo: comoTexto(b.Body) ?? '',
    },
  ];
}

// ---------- Adjuntos ----------

/** Tipo de adjunto de dominio → tipo de media de Meta Cloud API. */
export function tipoMediaMeta(tipo: AdjuntoMensaje['tipo']): 'image' | 'document' | 'audio' | 'video' {
  switch (tipo) {
    case 'imagen':
      return 'image';
    case 'documento':
      return 'document';
    case 'audio':
      return 'audio';
    case 'video':
      return 'video';
  }
}
