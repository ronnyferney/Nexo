import type { CanalTipo, EstadoMensajeCanal } from '@prisma/client';

/**
 * Tipos del dominio "canal externo" (ADR 0015 D1/D4/D5). Espejo del patrón `ConnectorAdapter`: contratos uniformes
 * independientes del proveedor. Nunca contienen el secreto en claro; las credenciales se resuelven desde la bóveda y
 * se entregan al adaptador ya descifradas en `CanalRuntime.secretValue`.
 */

/** Capacidades que un adaptador declara soportar. Bloquea en servicio operaciones no declaradas. */
export type ChannelCapability = 'ENVIAR' | 'ESTADO_ENTREGA' | 'RECIBIR';

/**
 * Plantilla declarativa de mensajería (WhatsApp Meta/Twilio): `nombre` de la plantilla aprobada por el proveedor,
 * `idioma` (código BCP-47, p. ej. `es`, `es_AR`) y `parametros` posicionales del cuerpo. Los valores de parámetro se
 * expanden SOLO con `common/template/template.engine.ts` (NUNCA `eval`) y NUNCA contienen secretos (ADR 0015 D1).
 */
export interface PlantillaMensaje {
  nombre: string;
  idioma?: string;
  /** Parámetros posicionales del cuerpo de la plantilla (orden significativo). */
  parametros?: string[];
}

/**
 * Adjunto por REFERENCIA (nunca binarios en columnas de texto, ADR 0015/0008): se envía una `url` pública (validada
 * por `HttpClientService` en el egress) o un `mediaId` previamente subido al proveedor. `caption` es texto opcional.
 */
export interface AdjuntoMensaje {
  tipo: 'imagen' | 'documento' | 'audio' | 'video';
  url?: string;
  mediaId?: string;
  nombreArchivo?: string;
  caption?: string;
}

/** Mensaje saliente a despachar por un adaptador. El `cuerpo`/`asunto` ya vienen renderizados (sin plantillas). */
export interface MensajeSaliente {
  destino: string;
  asunto?: string;
  cuerpo: string;
  /** Clave de idempotencia de negocio (E5): el mismo efecto no se despacha dos veces. */
  idempotencyKey: string;
  /** Plantilla aprobada (WhatsApp): si viene, el adaptador envía plantilla en vez de texto libre. */
  plantilla?: PlantillaMensaje;
  /** Adjunto por referencia (imagen/documento/...); el adaptador lo traduce al shape del proveedor. */
  adjunto?: AdjuntoMensaje;
  metadatos?: Record<string, unknown>;
}

/** Resultado de un envío. Errores de transporte → excepción; errores de negocio del proveedor → `estado: FALLIDO`. */
export interface ResultadoEnvio {
  estado: EstadoMensajeCanal;
  proveedorMensajeId?: string;
  error?: string;
}

/** Estado de entrega consultado por `pull` cuando el proveedor lo ofrece. */
export interface ResultadoEstadoEntrega {
  estado: EstadoMensajeCanal;
  detalle?: string;
}

/** Resultado de `test`: valida credenciales/conectividad sin enviar a un destinatario real. */
export interface ResultadoPrueba {
  ok: boolean;
  message: string;
}

/**
 * Payload entrante crudo de un webhook de proveedor. Se define la forma del hook en este incremento; la recepción
 * productiva (verificación de firma, traducción) llega en incrementos posteriores (ADR 0015 D6).
 */
export interface WebhookEntrante {
  headers: Record<string, string>;
  body: unknown;
  firma?: string;
}

/** Mensaje entrante normalizado (hook de recepción). Contenido entrante = dato NO confiable (ADR 0015 D1). */
export interface MensajeEntrante {
  proveedorMensajeId: string;
  origen: string;
  asunto?: string;
  cuerpo: string;
  estado?: EstadoMensajeCanal;
}

/**
 * Solicitud de webhook entrante tal como llega al endpoint público (ADR 0015 D1/D6). Lleva el cuerpo YA parseado
 * (`body`), el cuerpo CRUDO (`rawBody`, bytes exactos necesarios para verificar la firma HMAC de Meta) y la `url`
 * absoluta del endpoint (necesaria para la firma de Twilio). `headers` en minúsculas.
 */
export interface WebhookSolicitud {
  headers: Record<string, string>;
  body: unknown;
  rawBody: string;
  url: string;
}

/**
 * Evento normalizado traducido desde el payload de un proveedor. `MENSAJE` = entrante nuevo (texto recibido);
 * `ESTADO` = actualización de entrega de un saliente ya registrado (por `proveedorMensajeId`). El contenido es dato
 * NO confiable: no habilita herramientas ni cambia políticas (ADR 0015 D1, invariante 4).
 */
export interface EventoCanalEntrante {
  tipo: 'MENSAJE' | 'ESTADO';
  /** Id del proveedor; clave de dedup/idempotencia del entrante o del saliente a actualizar. */
  proveedorMensajeId: string;
  /** Remitente externo (solo `MENSAJE`). */
  origen?: string;
  /** Texto recibido (solo `MENSAJE`). */
  cuerpo?: string;
  /** Nuevo estado de entrega mapeado (solo `ESTADO`). */
  estado?: EstadoMensajeCanal;
}

/**
 * Contexto de ejecución de una cuenta de canal. `secretValue` es el valor ya descifrado del `secretRef` (o `undefined`
 * si la cuenta no tiene credenciales configuradas): el adaptador NUNCA lee la bóveda ni recibe el nombre del secreto.
 */
export interface CanalRuntime {
  cuentaId: string;
  workspaceId: string;
  empresaId: string;
  tipo: CanalTipo;
  proveedor: string;
  config: Record<string, unknown>;
  secretValue?: string;
}
