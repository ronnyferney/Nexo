import { Injectable } from '@nestjs/common';
import { HttpClientService } from '../../../../common/http/http-client.service';
import type { VoiceProvider } from '../domain/voice-provider';
import type {
  VoiceCapabilities,
  VoiceFinContexto,
  VoiceInactividad,
  VoiceRequisitoCapa,
  VoiceRuntime,
  VoiceTransferenciaContexto,
  VoiceTurnoContexto,
  VoiceTurnoResultado,
} from '../domain/voice.types';
import { fallidaStub, inactividadStub } from './voice-stub.shared';

const LEGIBLE = 'Amazon Connect';

/**
 * Adaptador STUB de voz para Amazon Connect (ADR 0015 D2, apertura confirmada; incremento 5 GATED). Declara sus
 * capabilities por capa pero queda INACTIVO sin credenciales y NUNCA contacta a AWS (sin gasto, sin red): no hay ruta
 * de código que abra conexión. Cuando se active, TODA salida pasaría por `HttpClientService.assertPublicHost()` antes de
 * conectar (por eso se inyecta, aunque gated no lo usa); las credenciales llegarían por `secretRef` de bóveda. La capa
 * (d) —procesos/autorizaciones— seguiría en NEXO vía `ActionGateway`, nunca en Connect/Lex.
 *
 * Insumo de presupuesto (NO cotización) en `requisitosActivacion`: recursos por capa y tarifas pendientes de cotizar por
 * región; los precios NO se inventan.
 */
@Injectable()
export class AmazonConnectVoiceAdapter implements VoiceProvider {
  readonly proveedor = 'amazon_connect';
  readonly alias = ['connect'] as const;
  readonly capabilities: VoiceCapabilities = {
    telefonia: ['inbound', 'outbound', 'transfer', 'dtmf', 'numberProvisioning'],
    voz: ['streamingStt', 'tts', 'bargeIn'],
    // Connect ofrece diálogo propio (Lex) y permite diálogo externo (Lambda/streaming) controlado por NEXO.
    dialogo: ['externalDialog', 'providerDialog', 'humanHandoff'],
    procesos: ['actionGateway'],
  };
  readonly requisitosActivacion: readonly VoiceRequisitoCapa[] = [
    {
      capa: 'TELEFONIA',
      recursos:
        'Instancia de Amazon Connect; números reclamados (DID/toll-free) por región; contact flows; rol IAM con ' +
        'permisos de Connect; opcional SIP trunk vía Chime Voice Connector.',
      faltaCotizar: 'Tarifa por minuto de llamada entrante/saliente y renta mensual por número, por región de Connect.',
    },
    {
      capa: 'VOZ',
      recursos: 'Amazon Transcribe (streaming STT) y Amazon Polly (TTS), o Lex para ASR/NLU; idiomas/voces por región.',
      faltaCotizar: 'Tarifa por minuto de Transcribe, por carácter de Polly y por solicitud de Lex, por región.',
    },
    {
      capa: 'DIALOGO',
      recursos:
        'Diálogo externo de NEXO vía Lambda/streaming (preferido) o Amazon Lex como motor del proveedor; integración ' +
        'con el runtime de agentes.',
      faltaCotizar: 'Tarifa de Lex/Lambda y transferencia de datos, por región.',
    },
    {
      capa: 'PROCESOS',
      recursos:
        'Ninguno adicional: las acciones sensibles permanecen en NEXO (ActionGateway de E6); Connect no ejecuta negocio.',
      faltaCotizar: 'Nada por este concepto (gobierno propio de NEXO).',
    },
  ];

  constructor(private readonly http: HttpClientService) {}

  estadoActivacion(runtime: VoiceRuntime): VoiceInactividad {
    // Nunca null: el adaptador está gated. Referencia a `http` documenta el egress futuro sin ejecutarlo.
    void this.http;
    return inactividadStub(runtime, LEGIBLE);
  }

  async iniciar(runtime: VoiceRuntime): Promise<VoiceTurnoResultado> {
    return fallidaStub(this.estadoActivacion(runtime).causa);
  }

  async turno(runtime: VoiceRuntime, ctx: VoiceTurnoContexto): Promise<VoiceTurnoResultado> {
    return fallidaStub(this.estadoActivacion(runtime).causa, ctx.proveedorCallId);
  }

  async transferir(runtime: VoiceRuntime, ctx: VoiceTransferenciaContexto): Promise<VoiceTurnoResultado> {
    return fallidaStub(this.estadoActivacion(runtime).causa, ctx.proveedorCallId);
  }

  async finalizar(runtime: VoiceRuntime, ctx: VoiceFinContexto): Promise<VoiceTurnoResultado> {
    return fallidaStub(this.estadoActivacion(runtime).causa, ctx.proveedorCallId);
  }
}
