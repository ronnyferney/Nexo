import { Module } from '@nestjs/common';
import { AmazonConnectVoiceAdapter } from './adapters/amazon-connect-voice.adapter';
import { GoogleCloudVoiceAdapter } from './adapters/google-cloud-voice.adapter';
import { SimuladoVoiceAdapter } from './adapters/simulado-voice.adapter';
import { VOICE_ADAPTERS } from './domain/voice-provider';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';

/**
 * Voz (E14 · ADR 0015 D2), sandbox SIN gasto. Contrato `VoiceProvider` en 4 capas + adaptadores: `simulado`
 * (determinista, base de QA, sin red ni credenciales) y stubs `amazon_connect` / `google_cloud` (apertura confirmada,
 * INACTIVOS sin credenciales y gated: NUNCA contactan a AWS/GCP). Agregar un proveedor = crear un adaptador y
 * registrarlo en `VOICE_ADAPTERS` (la selección es por `proveedor`/`alias`, sin ramas `if`). `SecretsService`,
 * `HttpClientService`, `ActionGatewayService` y `AuditService` llegan por módulos globales.
 */
const VOICE_ADAPTER_PROVIDERS = [SimuladoVoiceAdapter, AmazonConnectVoiceAdapter, GoogleCloudVoiceAdapter];

@Module({
  controllers: [VoiceController],
  providers: [
    VoiceService,
    ...VOICE_ADAPTER_PROVIDERS,
    { provide: VOICE_ADAPTERS, useFactory: (...a: unknown[]) => a, inject: VOICE_ADAPTER_PROVIDERS },
  ],
  exports: [VoiceService],
})
export class VoiceModule {}
