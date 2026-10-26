import { Injectable } from '@nestjs/common';
import type { CanalTipo } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { ChannelAdapter } from '../domain/channel-adapter';
import type {
  CanalRuntime,
  ChannelCapability,
  MensajeEntrante,
  MensajeSaliente,
  ResultadoEnvio,
  ResultadoEstadoEntrega,
  ResultadoPrueba,
  WebhookEntrante,
} from '../domain/channel.types';

/**
 * Identificador determinista del proveedor simulado a partir de la clave de idempotencia y la cuenta: la misma entrada
 * produce siempre el mismo id, lo que permite probar dedup/idempotencia sin estado externo.
 */
export function simuladoMensajeId(cuentaId: string, idempotencyKey: string): string {
  const hash = createHash('sha256').update(`${cuentaId}:${idempotencyKey}`).digest('hex');
  return `sim_${hash.slice(0, 24)}`;
}

/**
 * Adaptador de canal SIMULADO (ADR 0015 D5), espejo del proveedor LLM mock: determinista y SIN salida de red. "Envía"
 * registrando lo que haría y devuelve un id/estado deterministas. Es la base de QA y del entorno de pruebas; no
 * requiere credenciales. Soporta los tres tipos de canal para ejercer todos los recorridos.
 */
@Injectable()
export class SimuladoChannelAdapter implements ChannelAdapter {
  readonly proveedor = 'simulado';
  readonly tipos: readonly CanalTipo[] = ['CORREO', 'WHATSAPP', 'VOZ'];
  readonly capabilities: readonly ChannelCapability[] = ['ENVIAR', 'ESTADO_ENTREGA', 'RECIBIR'];

  async enviar(runtime: CanalRuntime, mensaje: MensajeSaliente): Promise<ResultadoEnvio> {
    // Sin red: el id es una función pura de (cuenta, idempotencyKey).
    return { estado: 'SIMULADO', proveedorMensajeId: simuladoMensajeId(runtime.cuentaId, mensaje.idempotencyKey) };
  }

  async estadoEntrega(_runtime: CanalRuntime, proveedorMensajeId: string): Promise<ResultadoEstadoEntrega> {
    return { estado: 'SIMULADO', detalle: `Mensaje simulado ${proveedorMensajeId}` };
  }

  /** Inyección de un entrante sintético (webhook simulado) para ejercer la recepción, sin red. */
  async recibir(_runtime: CanalRuntime, webhook: WebhookEntrante): Promise<MensajeEntrante> {
    const body = (webhook.body ?? {}) as Record<string, unknown>;
    return {
      proveedorMensajeId: String(body.proveedorMensajeId ?? `sim_in_${Date.now()}`),
      origen: String(body.origen ?? 'remitente@simulado.test'),
      asunto: body.asunto != null ? String(body.asunto) : undefined,
      cuerpo: String(body.cuerpo ?? ''),
      estado: 'SIMULADO',
    };
  }

  async test(): Promise<ResultadoPrueba> {
    return { ok: true, message: 'Canal simulado disponible' };
  }
}
