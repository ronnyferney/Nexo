import type { CanalTipo } from '@prisma/client';
import type {
  CanalRuntime,
  ChannelCapability,
  MensajeEntrante,
  MensajeSaliente,
  ResultadoEnvio,
  ResultadoEstadoEntrega,
  ResultadoPrueba,
  WebhookEntrante,
} from './channel.types';

/**
 * Puerto (arquitectura hexagonal) que implementa cada proveedor de canal externo (ADR 0015 D1). Agregar un proveedor
 * nuevo = crear un adaptador y registrarlo en el arreglo `ADAPTERS` de `ChannelsModule`. La selección del adaptador es
 * por el `proveedor` de la `CanalCuenta`, nunca por ramas `if (proveedor === ...)` dispersas.
 */
export interface ChannelAdapter {
  /** Proveedor que resuelve este adaptador (m365 | simulado | ...). Debe ser único en el registro. */
  readonly proveedor: string;
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
}

/** Token DI del registro de adaptadores de canal. */
export const CHANNEL_ADAPTERS = Symbol('CHANNEL_ADAPTERS');
