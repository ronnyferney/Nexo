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
 * Identificador determinista del despacho simulado del piloto (análogo al del proveedor `simulado`): la misma entrada
 * produce siempre el mismo id, para probar dedup/idempotencia sin estado externo ni red.
 */
export function pilotoMensajeId(cuentaId: string, idempotencyKey: string): string {
  const hash = createHash('sha256').update(`piloto:${cuentaId}:${idempotencyKey}`).digest('hex');
  return `pil_${hash.slice(0, 24)}`;
}

/**
 * Adaptador de correo del PILOTO INTERNO CONTROLADO (ADR 0015 · `docs/activacion-correo-controles.md`). Es un
 * adaptador SANDBOX (no sale a la red, no necesita credenciales), PERO a diferencia del `simulado` puro SÍ pasa por el
 * gobierno de acciones E6 (`requiereGobierno = true`): guardarraíles de cuenta, política `EMAIL_SEND`, aprobación
 * humana de la bandeja y suspensión/kill-switch. Así el piloto ejerce TODOS los controles reales mientras el despacho
 * es simulado.
 *
 * IMPIDE POR CONSTRUCCIÓN el uso de credenciales reales: si la cuenta tuviera un `secretRef` resuelto
 * (`secretValue` presente), el adaptador NO despacha y devuelve `FALLIDO` con causa clara. El preset del piloto nunca
 * asigna `secretRef`; este refuerzo cubre un cambio manual posterior. El canal permanece SIN activación productiva.
 */
@Injectable()
export class SimuladoPilotoChannelAdapter implements ChannelAdapter {
  readonly proveedor = 'simulado_piloto';
  readonly alias = ['piloto_correo'] as const;
  readonly tipos: readonly CanalTipo[] = ['CORREO'];
  readonly capabilities: readonly ChannelCapability[] = ['ENVIAR', 'ESTADO_ENTREGA', 'RECIBIR'];
  /** Sandbox (sin red) PERO gobernado por E6 (guardarraíles + pasarela + aprobación + suspensión). */
  readonly esSandbox = true;
  readonly requiereGobierno = true;

  async enviar(runtime: CanalRuntime, mensaje: MensajeSaliente): Promise<ResultadoEnvio> {
    // Barrera por construcción: el piloto NO admite credenciales reales. Con un secreto presente no se despacha.
    if (runtime.secretValue) {
      return {
        estado: 'FALLIDO',
        error:
          'El piloto interno controlado no admite credenciales: retire `secretRef` de la cuenta. El proveedor es ' +
          'simulado y no sale a la red (sin activación productiva).',
      };
    }
    // Sin red: el id es una función pura de (cuenta, idempotencyKey). El despacho queda "SIMULADO".
    return { estado: 'SIMULADO', proveedorMensajeId: pilotoMensajeId(runtime.cuentaId, mensaje.idempotencyKey) };
  }

  async estadoEntrega(_runtime: CanalRuntime, proveedorMensajeId: string): Promise<ResultadoEstadoEntrega> {
    return { estado: 'SIMULADO', detalle: `Despacho simulado del piloto ${proveedorMensajeId}` };
  }

  /** Entrante sintético (sandbox), para ejercer la recepción del piloto sin red. */
  async recibir(_runtime: CanalRuntime, webhook: WebhookEntrante): Promise<MensajeEntrante> {
    const body = (webhook.body ?? {}) as Record<string, unknown>;
    return {
      proveedorMensajeId: String(body.proveedorMensajeId ?? `pil_in_${Date.now()}`),
      origen: String(body.origen ?? 'remitente@piloto.test'),
      asunto: body.asunto != null ? String(body.asunto) : undefined,
      cuerpo: String(body.cuerpo ?? ''),
      estado: 'SIMULADO',
    };
  }

  async test(runtime: CanalRuntime): Promise<ResultadoPrueba> {
    if (runtime.secretValue) {
      return { ok: false, message: 'El piloto interno controlado no admite credenciales reales (proveedor simulado).' };
    }
    return { ok: true, message: 'Piloto interno de correo disponible (simulado, sin salida de red).' };
  }
}
