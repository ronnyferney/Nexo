import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { VoiceProvider } from '../domain/voice-provider';
import type {
  VoiceCapabilities,
  VoiceFinContexto,
  VoiceInicioParams,
  VoiceRequisitoCapa,
  VoiceRuntime,
  VoiceTransferenciaContexto,
  VoiceTurnoContexto,
  VoiceTurnoResultado,
  VoiceAccionSensible,
} from '../domain/voice.types';

/**
 * Id determinista de la llamada simulada a partir de la cuenta y la clave de idempotencia: la misma entrada produce
 * siempre el mismo `proveedorCallId`, lo que permite probar idempotencia/dedup sin estado externo ni red.
 */
export function simuladoVoiceCallId(cuentaId: string, idempotencyKey: string): string {
  const hash = createHash('sha256').update(`${cuentaId}:${idempotencyKey}`).digest('hex');
  return `simcall_${hash.slice(0, 24)}`;
}

/** Duración determinista (segundos) derivada del id de llamada; el coste real queda null hasta tener tarifas. */
function duracionDeterminista(proveedorCallId: string): number {
  const n = parseInt(createHash('sha256').update(proveedorCallId).digest('hex').slice(0, 6), 16);
  return 20 + (n % 180);
}

/**
 * Decide, de forma determinista, si el texto del usuario (STT, dato NO confiable) dispara una acción sensible de NEXO
 * (capa d). NO ejecuta nada ni usa `eval`: solo clasifica por palabras clave para que el SERVICIO enrute la acción al
 * `ActionGateway` (E6). Devuelve `undefined` si el turno no requiere acción con efecto.
 */
export function detectarAccionSensibleSimulada(entrada: string): VoiceAccionSensible | undefined {
  const texto = entrada.toLowerCase();
  if (texto.includes('pago') || texto.includes('pagar') || texto.includes('transferencia')) {
    return {
      tipoAccion: 'VOICE_PAYMENT',
      descripcion: 'El interlocutor solicitó realizar un pago durante la llamada',
      importe: 0,
      moneda: 'USD',
    };
  }
  if (texto.includes('saldo') || texto.includes('dato') || texto.includes('cuenta')) {
    return {
      tipoAccion: 'VOICE_DATA_ACCESS',
      descripcion: 'El interlocutor solicitó acceder a datos sensibles de su cuenta',
    };
  }
  return undefined;
}

/**
 * Adaptador de voz SIMULADO (ADR 0015 D2/D5), espejo del proveedor LLM mock: determinista y SIN salida de red, sin
 * credenciales. Recorre el ciclo completo de una llamada (iniciar → turnos → transferir → finalizar) para que QA
 * ejercite el gobierno (capa d por `ActionGateway`), la idempotencia y las capabilities, sin gasto ni proveedores
 * reales. Declara capabilities amplias en las 4 capas; el diálogo lo controla NEXO (`externalDialog`).
 */
@Injectable()
export class SimuladoVoiceAdapter implements VoiceProvider {
  readonly proveedor = 'simulado';
  readonly capabilities: VoiceCapabilities = {
    telefonia: ['inbound', 'outbound', 'transfer', 'dtmf', 'numberProvisioning'],
    voz: ['streamingStt', 'tts', 'bargeIn', 'wordTimestamps'],
    dialogo: ['externalDialog', 'humanHandoff'],
    procesos: ['actionGateway'],
  };
  readonly requisitosActivacion: readonly VoiceRequisitoCapa[] = [
    {
      capa: 'TELEFONIA',
      recursos: 'Ninguno: el simulador no aprovisiona números ni cursa llamadas reales.',
      faltaCotizar: 'Nada (sin gasto).',
    },
    { capa: 'VOZ', recursos: 'Ninguno: STT/TTS simulados en memoria.', faltaCotizar: 'Nada (sin gasto).' },
    { capa: 'DIALOGO', recursos: 'Runtime de agentes de NEXO (ya existente).', faltaCotizar: 'Nada (sin gasto).' },
    { capa: 'PROCESOS', recursos: 'ActionGateway de E6 (ya existente).', faltaCotizar: 'Nada (sin gasto).' },
  ];

  /** Siempre listo: no requiere credenciales ni red. */
  estadoActivacion(): null {
    return null;
  }

  async iniciar(runtime: VoiceRuntime, params: VoiceInicioParams): Promise<VoiceTurnoResultado> {
    const proveedorCallId = simuladoVoiceCallId(runtime.cuentaId, params.idempotencyKey);
    return {
      estado: 'SIMULADA',
      proveedorCallId,
      respuesta: 'Hola, le atiende el asistente de NEXO (llamada simulada). ¿En qué puedo ayudarle?',
      duracionSeg: 0,
    };
  }

  async turno(_runtime: VoiceRuntime, ctx: VoiceTurnoContexto): Promise<VoiceTurnoResultado> {
    const accionSensible = detectarAccionSensibleSimulada(ctx.entrada);
    const respuesta = accionSensible
      ? 'Entiendo su solicitud; requiere una autorización antes de continuar.'
      : `He registrado: "${ctx.entrada}". ¿Algo más?`;
    return {
      estado: 'EN_CURSO',
      proveedorCallId: ctx.proveedorCallId,
      // La transcripción se devuelve como dato NO confiable; el servicio NO la persiste cruda (grabación OFF).
      transcripcion: ctx.entrada,
      respuesta,
      bargeIn: ctx.bargeIn ?? false,
      accionSensible,
    };
  }

  async transferir(_runtime: VoiceRuntime, ctx: VoiceTransferenciaContexto): Promise<VoiceTurnoResultado> {
    return {
      estado: 'TRANSFERIDA',
      proveedorCallId: ctx.proveedorCallId,
      respuesta: `Le transfiero con un agente humano (${ctx.destino}).`,
    };
  }

  async finalizar(_runtime: VoiceRuntime, ctx: VoiceFinContexto): Promise<VoiceTurnoResultado> {
    return {
      estado: 'FINALIZADA',
      proveedorCallId: ctx.proveedorCallId,
      respuesta: 'Gracias por su llamada. Hasta luego.',
      duracionSeg: duracionDeterminista(ctx.proveedorCallId),
    };
  }
}
