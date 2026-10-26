import type { Aprobacion } from '@prisma/client';
import type { ActionContext } from '../policy/policy.types';

/**
 * Seam de despacho (ADR 0013 D2/D5/D6). El `ActionGateway` decide y gobierna; el EFECTO real (correo/WhatsApp/voz vía
 * E14, herramientas de agente, internet/RPA vía E8) lo realizan despachadores registrados por otros módulos
 * (`nexo-backend-integrations`, `nexo-backend-ai`). El núcleo de gobierno NO conoce los canales concretos: cada uno se
 * registra bajo el token `ACTION_DISPATCHERS` para su `tipoAccion`. Sin despachador, la acción queda modelada pero no
 * se ejecuta hacia el exterior.
 */

export type DispatchStatus = 'CONFIRMADO' | 'INCIERTO' | 'SEAM';

export interface DispatchResult {
  status: DispatchStatus;
  /** Referencia del proveedor (id de mensaje/transacción) para idempotencia/conciliación (E7). */
  providerRef?: string | null;
  detalle?: string;
}

export interface DispatchInput {
  ctx: ActionContext;
  aprobacion?: Aprobacion;
  /** Clave de idempotencia (ADR 0013 D2): el mismo efecto no se despacha dos veces. */
  idempotencyKey: string;
}

export interface ActionDispatcher {
  /** Tipo de acción que este despachador sabe ejecutar (EMAIL_SEND, WHATSAPP_SEND, ...). */
  readonly tipoAccion: string;
  dispatch(input: DispatchInput): Promise<DispatchResult>;
}

/** Token DI del registro de despachadores (array, vacío por defecto). */
export const ACTION_DISPATCHERS = Symbol('ACTION_DISPATCHERS');
