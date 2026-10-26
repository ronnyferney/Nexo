import type { CanalTipo, EstadoMensajeCanal } from '@prisma/client';

/**
 * Tipos del dominio "canal externo" (ADR 0015 D1/D4/D5). Espejo del patrón `ConnectorAdapter`: contratos uniformes
 * independientes del proveedor. Nunca contienen el secreto en claro; las credenciales se resuelven desde la bóveda y
 * se entregan al adaptador ya descifradas en `CanalRuntime.secretValue`.
 */

/** Capacidades que un adaptador declara soportar. Bloquea en servicio operaciones no declaradas. */
export type ChannelCapability = 'ENVIAR' | 'ESTADO_ENTREGA' | 'RECIBIR';

/** Mensaje saliente a despachar por un adaptador. El `cuerpo`/`asunto` ya vienen renderizados (sin plantillas). */
export interface MensajeSaliente {
  destino: string;
  asunto?: string;
  cuerpo: string;
  /** Clave de idempotencia de negocio (E5): el mismo efecto no se despacha dos veces. */
  idempotencyKey: string;
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
