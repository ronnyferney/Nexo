import type { VoiceInactividad, VoiceRuntime, VoiceTurnoResultado } from '../domain/voice.types';

/**
 * Lógica común de los adaptadores de voz STUB (Amazon Connect, Google Cloud): ADR 0015 incremento 5, GATED. Quedan
 * INACTIVOS y NUNCA contactan al proveedor (sin gasto, sin red):
 * - sin `secretValue` (credenciales de bóveda) → inactivos por falta de credenciales;
 * - con credenciales → inactivos igualmente porque la activación productiva está gated (requiere proveedor elegido por
 *   prueba técnica + evaluación económica y, si hay grabación, validación jurídica). No existe ruta de código que
 *   abra una conexión a AWS/GCP.
 */
export function inactividadStub(runtime: VoiceRuntime, proveedorLegible: string): VoiceInactividad {
  if (!runtime.secretValue) {
    return {
      causa:
        `Cuenta de voz ${proveedorLegible} sin credenciales en la bóveda: configure \`secretRef\`. Sin credenciales ` +
        'el adaptador está inactivo y no cursa llamadas.',
    };
  }
  return {
    causa:
      `Adaptador de voz ${proveedorLegible} gated (ADR 0015 incremento 5): la activación productiva requiere elegir ` +
      'el proveedor por prueba técnica + evaluación económica. No contacta al proveedor (sin gasto).',
  };
}

/** Resultado FALLIDA para una operación de un stub inactivo. No sale a la red. `proveedorCallId` vacío si no hay. */
export function fallidaStub(causa: string, proveedorCallId = ''): VoiceTurnoResultado {
  return { estado: 'FALLIDA', proveedorCallId, error: causa };
}
