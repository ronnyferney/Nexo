import type { VoiceCapabilities, VoiceRequisitos } from './domain/voice.types';

/**
 * Validación PURA (sin red, sin estado) de la combinación de `capabilities` de las 4 capas contra los `requisitos` de
 * la cuenta/llamada (ADR 0015 D2, invariante 5): "las combinaciones incompatibles se bloquean en CONFIGURACIÓN, no en
 * tiempo de llamada". Se exporta para probarse con fixtures. Devuelve la lista de incompatibilidades (en español);
 * vacía = combinación válida.
 */
export function validarCapabilitiesVoz(caps: VoiceCapabilities, req: VoiceRequisitos): string[] {
  const problemas: string[] = [];

  // Capa (a) Telefonía: la dirección pedida debe estar soportada.
  if (req.direccion === 'SALIENTE' && !caps.telefonia.includes('outbound')) {
    problemas.push('La telefonía del proveedor no soporta llamadas salientes (capability `outbound`).');
  }
  if (req.direccion === 'ENTRANTE' && !caps.telefonia.includes('inbound')) {
    problemas.push('La telefonía del proveedor no soporta llamadas entrantes (capability `inbound`).');
  }
  if (req.transferencia && !caps.telefonia.includes('transfer')) {
    problemas.push('Se exige transferencia a humano pero la telefonía no la soporta (capability `transfer`).');
  }

  // Capa (b) STT/TTS: barge-in requiere soporte del reconocimiento.
  if (req.bargeIn && !caps.voz.includes('bargeIn')) {
    problemas.push('Se exige barge-in (interrupción) pero el STT del proveedor no lo soporta (capability `bargeIn`).');
  }

  // Capa (c) Motor conversacional: el modo de diálogo pedido debe estar soportado.
  const dialogo = req.dialogo ?? 'externalDialog';
  if (!caps.dialogo.includes(dialogo)) {
    problemas.push(
      dialogo === 'externalDialog'
        ? 'Se exige diálogo controlado por NEXO (`externalDialog`) pero el proveedor solo ofrece diálogo propio.'
        : 'Se exige diálogo del proveedor (`providerDialog`) pero el adaptador no lo ofrece.',
    );
  }
  if (req.transferencia && !caps.dialogo.includes('humanHandoff')) {
    problemas.push('Se exige transferencia a humano pero el motor conversacional no la contempla (`humanHandoff`).');
  }

  // Capa (d) Procesos/autorizaciones de NEXO: SIEMPRE por el ActionGateway; nunca se delega al proveedor.
  if (!caps.procesos.includes('actionGateway')) {
    problemas.push(
      'El adaptador no declara la capa de procesos/autorizaciones por `actionGateway` (E6): no se admite delegar ' +
        'las acciones de negocio al proveedor.',
    );
  }

  return problemas;
}
