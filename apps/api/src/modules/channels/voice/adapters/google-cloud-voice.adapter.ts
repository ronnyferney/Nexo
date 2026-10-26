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

const LEGIBLE = 'Google Cloud';

/**
 * Adaptador STUB de voz para Google Cloud (ADR 0015 D2, apertura confirmada; incremento 5 GATED). Declara capabilities
 * por capa pero queda INACTIVO sin credenciales y NUNCA contacta a GCP (sin gasto, sin red): no hay ruta de código que
 * abra conexión. Cuando se active, TODA salida pasaría por `HttpClientService.assertPublicHost()` antes de conectar; las
 * credenciales llegarían por `secretRef` de bóveda. La capa (d) —procesos/autorizaciones— seguiría en NEXO vía
 * `ActionGateway`, nunca en Dialogflow.
 *
 * Nota de telefonía: Google Cloud aporta STT/TTS y Dialogflow CX; la telefonía (números/troncal) suele requerir un
 * socio de telefonía CCAI o SIP propio — se refleja en `requisitosActivacion` como pendiente de definir/cotizar.
 */
@Injectable()
export class GoogleCloudVoiceAdapter implements VoiceProvider {
  readonly proveedor = 'google_cloud';
  readonly alias = ['gcp'] as const;
  readonly capabilities: VoiceCapabilities = {
    // La telefonía nativa depende de un socio CCAI/SIP; se declara el conjunto previsto, a confirmar en la activación.
    telefonia: ['inbound', 'outbound', 'transfer', 'dtmf'],
    voz: ['streamingStt', 'tts', 'bargeIn', 'wordTimestamps'],
    dialogo: ['externalDialog', 'providerDialog', 'humanHandoff'],
    procesos: ['actionGateway'],
  };
  readonly requisitosActivacion: readonly VoiceRequisitoCapa[] = [
    {
      capa: 'TELEFONIA',
      recursos:
        'Integración de telefonía CCAI (socio de telefonía habilitado por Google) o SIP propio; números por región; ' +
        'proyecto GCP con APIs habilitadas y cuenta de servicio.',
      faltaCotizar:
        'Tarifa por minuto de telefonía del socio CCAI y renta por número (depende del socio/región); pendiente de ' +
        'definir el socio.',
    },
    {
      capa: 'VOZ',
      recursos: 'Cloud Speech-to-Text (streaming) y Cloud Text-to-Speech (voces estándar/WaveNet); idiomas por región.',
      faltaCotizar:
        'Tarifa por minuto de Speech-to-Text y por carácter de Text-to-Speech (estándar vs WaveNet), por región.',
    },
    {
      capa: 'DIALOGO',
      recursos: 'Diálogo externo de NEXO (preferido) o Dialogflow CX como motor del proveedor; webhooks al runtime.',
      faltaCotizar: 'Tarifa por solicitud de Dialogflow CX y transferencia de datos, por región.',
    },
    {
      capa: 'PROCESOS',
      recursos:
        'Ninguno adicional: las acciones sensibles permanecen en NEXO (ActionGateway de E6); GCP no ejecuta negocio.',
      faltaCotizar: 'Nada por este concepto (gobierno propio de NEXO).',
    },
  ];

  constructor(private readonly http: HttpClientService) {}

  estadoActivacion(runtime: VoiceRuntime): VoiceInactividad {
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
