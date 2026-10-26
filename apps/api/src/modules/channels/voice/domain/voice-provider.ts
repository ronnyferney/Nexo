import type {
  VoiceCapabilities,
  VoiceFinContexto,
  VoiceInactividad,
  VoiceInicioParams,
  VoiceRequisitoCapa,
  VoiceRuntime,
  VoiceTransferenciaContexto,
  VoiceTurnoContexto,
  VoiceTurnoResultado,
} from './voice.types';

/**
 * Puerto (arquitectura hexagonal) que implementa cada proveedor de voz (ADR 0015 D2). Agregar un proveedor nuevo
 * (Amazon Connect, Google Cloud, Twilio, Vonage, ...) = crear un adaptador y registrarlo en el arreglo `VOICE_ADAPTERS`
 * de `VoiceModule`. La selección es por el `proveedor` de la `CanalCuenta` (tipo VOZ), nunca por ramas
 * `if (proveedor === ...)` dispersas.
 *
 * El contrato cubre las 4 capas: telefonía/llamadas (`iniciar`/`transferir`/`finalizar`), STT/TTS y motor conversacional
 * (`turno`), y procesos/autorizaciones de NEXO (capa d): el adaptador NUNCA ejecuta la acción sensible, solo la DESCRIBE
 * (`VoiceTurnoResultado.accionSensible`); el servicio la enruta al `ActionGateway` (E6). Toda salida de red (cuando un
 * adaptador productivo exista) pasa por `HttpClientService`; los adaptadores sin credenciales quedan INACTIVOS.
 */
export interface VoiceProvider {
  /** Proveedor que resuelve este adaptador (simulado | amazon_connect | google_cloud | ...). Único en el registro. */
  readonly proveedor: string;
  /** Alias adicionales por los que también se selecciona (p. ej. `connect`, `gcp`). */
  readonly alias?: readonly string[];
  /** Capabilities declaradas por capa; el servicio bloquea combinaciones incompatibles en configuración. */
  readonly capabilities: VoiceCapabilities;
  /** Recursos/credenciales que requeriría activar cada capa + qué falta cotizar (insumo de presupuesto, no precios). */
  readonly requisitosActivacion: readonly VoiceRequisitoCapa[];

  /**
   * Estado de activación del adaptador para esta cuenta. Devuelve `null` si está LISTO para operar; o una
   * `VoiceInactividad` con la causa (sin credenciales en bóveda, o activación productiva gated). Función PURA y SIN red.
   */
  estadoActivacion(runtime: VoiceRuntime): VoiceInactividad | null;

  /** Capa (a): origina/recibe la llamada. Determinista y SIN red en el simulado. */
  iniciar(runtime: VoiceRuntime, params: VoiceInicioParams): Promise<VoiceTurnoResultado>;

  /** Capas (b)+(c): un turno conversacional (STT→diálogo→TTS), con barge-in/interrupción. */
  turno(runtime: VoiceRuntime, ctx: VoiceTurnoContexto): Promise<VoiceTurnoResultado>;

  /** Capa (a)+(c): transferencia a humano. */
  transferir(runtime: VoiceRuntime, ctx: VoiceTransferenciaContexto): Promise<VoiceTurnoResultado>;

  /** Capa (a): cuelga/cierra la llamada. */
  finalizar(runtime: VoiceRuntime, ctx: VoiceFinContexto): Promise<VoiceTurnoResultado>;
}

/** Token DI del registro de adaptadores de voz. */
export const VOICE_ADAPTERS = Symbol('VOICE_ADAPTERS');
