import type { CanalTipo } from '@prisma/client';
import type {
  CanalRuntime,
  ChannelCapability,
  EventoCanalEntrante,
  MensajeEntrante,
  MensajeSaliente,
  ResultadoEnvio,
  ResultadoEstadoEntrega,
  ResultadoPrueba,
  WebhookEntrante,
  WebhookSolicitud,
} from './channel.types';

/**
 * Puerto (arquitectura hexagonal) que implementa cada proveedor de canal externo (ADR 0015 D1). Agregar un proveedor
 * nuevo = crear un adaptador y registrarlo en el arreglo `ADAPTERS` de `ChannelsModule`. La selección del adaptador es
 * por el `proveedor` de la `CanalCuenta`, nunca por ramas `if (proveedor === ...)` dispersas.
 */
export interface ChannelAdapter {
  /** Proveedor que resuelve este adaptador (m365 | simulado | ...). Debe ser único en el registro. */
  readonly proveedor: string;
  /**
   * Alias adicionales por los que también se selecciona este adaptador (p. ej. `meta` para `whatsapp_meta`). Permite
   * que una `CanalCuenta` use una etiqueta corta sin ramas `if (proveedor === ...)` en el servicio.
   */
  readonly alias?: readonly string[];
  /** Tipos de canal que soporta (CORREO | WHATSAPP | VOZ). El servicio valida la combinación con la cuenta. */
  readonly tipos: readonly CanalTipo[];
  /** Capacidades declaradas; el servicio bloquea operaciones no declaradas. */
  readonly capabilities: readonly ChannelCapability[];

  /** Envío saliente. Error de transporte → excepción; error de negocio del proveedor → `estado: FALLIDO`. */
  enviar(runtime: CanalRuntime, mensaje: MensajeSaliente): Promise<ResultadoEnvio>;

  /** Consulta de estado de entrega por `pull` (cuando el proveedor lo ofrece). */
  estadoEntrega(runtime: CanalRuntime, proveedorMensajeId: string): Promise<ResultadoEstadoEntrega>;

  /**
   * Hook de recepción (webhook). Define la interfaz de recepción entrante; la recepción productiva (verificación de
   * firma, traducción del payload) se activa en incrementos posteriores (ADR 0015 D6). Opcional por adaptador.
   */
  recibir?(runtime: CanalRuntime, webhook: WebhookEntrante): Promise<MensajeEntrante>;

  /** Valida credenciales/conectividad sin enviar a un destinatario real. Opcional por adaptador. */
  test?(runtime: CanalRuntime): Promise<ResultadoPrueba>;

  /**
   * Verifica la firma del webhook del proveedor con el secreto de la cuenta (Meta: `X-Hub-Signature-256` HMAC-SHA256
   * sobre el cuerpo crudo; Twilio: `X-Twilio-Signature` HMAC-SHA1 sobre url+params). Función PURA y SIN red: `true`
   * acepta, `false` rechaza. Un webhook sin firma válida se descarta y se audita (ADR 0015 D1, invariante 3). Un
   * adaptador que la implementa DEBE implementar también `traducirWebhook`.
   */
  verificarFirma?(runtime: CanalRuntime, solicitud: WebhookSolicitud): boolean;

  /**
   * Traduce el payload crudo del webhook a eventos normalizados (mensajes entrantes y actualizaciones de estado).
   * Función PURA y SIN red; no asume que la firma ya se verificó (el servicio la verifica antes de llamar).
   */
  traducirWebhook?(solicitud: WebhookSolicitud): EventoCanalEntrante[];
}

/** Token DI del registro de adaptadores de canal. */
export const CHANNEL_ADAPTERS = Symbol('CHANNEL_ADAPTERS');
