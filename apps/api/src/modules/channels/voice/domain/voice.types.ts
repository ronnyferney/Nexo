import type { DireccionMensaje, EstadoLlamadaVoz } from '@prisma/client';

/**
 * Tipos del dominio "voz" (ADR 0015 D2), sandbox sin gasto. El contrato `VoiceProvider` está partido en 4 CAPAS
 * independientes (telefonía, STT/TTS, motor conversacional y procesos/autorizaciones de NEXO), cada una con sus
 * `capabilities` declaradas por adaptador. La capa (d) —procesos/herramientas/autorizaciones— NUNCA se delega al
 * proveedor: toda acción con efecto durante la llamada pasa por el `ActionGateway` de E6.
 *
 * Nada aquí contiene el secreto en claro: las credenciales se resuelven desde la bóveda y llegan ya descifradas en
 * `VoiceRuntime.secretValue`. El contenido de voz/transcripción es dato NO confiable.
 */

/** Las 4 capas del contrato de voz (ADR 0015 D2). */
export const VOICE_LAYERS = ['TELEFONIA', 'VOZ', 'DIALOGO', 'PROCESOS'] as const;
export type VoiceLayer = (typeof VOICE_LAYERS)[number];

/** Capa (a) Telefonía / números / gestión de llamadas. */
export type VoiceTelephonyCapability = 'inbound' | 'outbound' | 'transfer' | 'dtmf' | 'numberProvisioning' | 'sipTrunk';

/** Capa (b) STT/TTS (reconocimiento y síntesis). */
export type VoiceSpeechCapability = 'streamingStt' | 'tts' | 'bargeIn' | 'wordTimestamps';

/** Capa (c) Motor conversacional. `externalDialog` = NEXO controla el turno; `providerDialog` = diálogo del proveedor. */
export type VoiceDialogCapability = 'externalDialog' | 'providerDialog' | 'humanHandoff';

/**
 * Capa (d) Procesos / herramientas / autorizaciones de NEXO. SIEMPRE `actionGateway`: toda acción sensible pasa por el
 * `ActionGateway` (E6); nunca se delega al proveedor. Un adaptador que no la declare se bloquea en configuración.
 */
export type VoiceProcessCapability = 'actionGateway';

/** Capabilities declaradas por un adaptador, una lista por capa (ADR 0015 D2). */
export interface VoiceCapabilities {
  readonly telefonia: readonly VoiceTelephonyCapability[];
  readonly voz: readonly VoiceSpeechCapability[];
  readonly dialogo: readonly VoiceDialogCapability[];
  readonly procesos: readonly VoiceProcessCapability[];
}

/**
 * Requisitos de la llamada que la configuración de la cuenta/petición exige al proveedor. El servicio valida esta
 * combinación contra las `capabilities` del adaptador y BLOQUEA las incompatibles en configuración (no en tiempo de
 * llamada): p. ej. pedir `transferencia` a una telefonía sin `transfer`, `bargeIn` a un STT que no lo soporta, o
 * diálogo `externalDialog` a un proveedor que solo ofrece `providerDialog` (ADR 0015 D2, invariante 5).
 */
export interface VoiceRequisitos {
  direccion: DireccionMensaje;
  /** Se exige poder transferir a un humano durante la llamada. */
  transferencia?: boolean;
  /** Se exige barge-in (interrupción del usuario sobre el TTS). */
  bargeIn?: boolean;
  /** Motor de diálogo requerido; por defecto `externalDialog` (runtime de agentes de NEXO). */
  dialogo?: Extract<VoiceDialogCapability, 'externalDialog' | 'providerDialog'>;
}

/**
 * Recursos/credenciales que una capa requeriría para activarse en producción (INSUMO de presupuesto, NO cotización).
 * `faltaCotizar` enumera tarifas que Finanzas debe cotizar por región; NUNCA se inventan precios.
 */
export interface VoiceRequisitoCapa {
  capa: VoiceLayer;
  recursos: string;
  faltaCotizar: string;
}

/** Causa por la que un adaptador está INACTIVO (sin credenciales, o gated): nunca sale a la red. */
export interface VoiceInactividad {
  causa: string;
}

/** Contexto de ejecución de una cuenta de voz. `secretValue` es el valor YA descifrado del `secretRef` (o undefined). */
export interface VoiceRuntime {
  cuentaId: string;
  workspaceId: string;
  empresaId: string;
  proveedor: string;
  config: Record<string, unknown>;
  secretValue?: string;
}

/** Parámetros para iniciar una llamada. `numero` es el destino (saliente) u origen (entrante). */
export interface VoiceInicioParams {
  direccion: DireccionMensaje;
  numero: string;
  /** Clave de idempotencia (E5): el mismo inicio no origina dos llamadas (deriva el `proveedorCallId` en el simulado). */
  idempotencyKey: string;
  requisitos: VoiceRequisitos;
}

/** Contexto de un turno conversacional: el texto reconocido del usuario (STT). Dato NO confiable. */
export interface VoiceTurnoContexto {
  proveedorCallId: string;
  /** Texto del usuario reconocido por STT en este turno. */
  entrada: string;
  /** El usuario interrumpió el TTS en curso (barge-in). */
  bargeIn?: boolean;
}

/** Contexto de una transferencia a humano. */
export interface VoiceTransferenciaContexto {
  proveedorCallId: string;
  destino: string;
}

/** Contexto del cierre de la llamada. */
export interface VoiceFinContexto {
  proveedorCallId: string;
}

/**
 * Acción sensible de NEXO surgida durante la llamada (capa d). NO la ejecuta el proveedor: el servicio la enruta al
 * `ActionGateway` (E6). Es un DESCRIPTOR puro producido por el motor conversacional del adaptador.
 */
export interface VoiceAccionSensible {
  /** Tipo de acción con efecto (p. ej. `VOICE_PAYMENT`, `VOICE_DATA_ACCESS`). */
  tipoAccion: string;
  descripcion: string;
  destinatarios?: string[];
  importe?: number;
  moneda?: string;
}

/**
 * Resultado de una operación de llamada (iniciar/turno/transferir/finalizar). `respuesta` es el TTS que el agente dice;
 * `transcripcion` es el STT del usuario (dato NO confiable). Error de transporte → excepción; error de negocio del
 * sistema remoto o adaptador inactivo → `estado: FALLIDA` con detalle.
 */
export interface VoiceTurnoResultado {
  estado: EstadoLlamadaVoz;
  proveedorCallId: string;
  respuesta?: string;
  transcripcion?: string;
  bargeIn?: boolean;
  /** Si el turno requiere una acción sensible de NEXO (capa d), descriptor para el `ActionGateway`. */
  accionSensible?: VoiceAccionSensible;
  /** Duración acumulada estimada (determinista en el simulado); el coste real queda null hasta tener tarifas. */
  duracionSeg?: number;
  /** Detalle del fallo cuando `estado: FALLIDA` (adaptador inactivo/gated o error de negocio). Sin secretos. */
  error?: string;
}
