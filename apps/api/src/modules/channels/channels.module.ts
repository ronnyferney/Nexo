import { Module } from '@nestjs/common';
import { M365MailChannelAdapter } from './adapters/m365-mail.adapter';
import { SimuladoChannelAdapter } from './adapters/simulado.adapter';
import { WhatsappMetaChannelAdapter } from './adapters/whatsapp-meta.adapter';
import { WhatsappTwilioChannelAdapter } from './adapters/whatsapp-twilio.adapter';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { CHANNEL_ADAPTERS } from './domain/channel-adapter';

/**
 * Canales externos (E14 · ADR 0015): contrato `ChannelAdapter` + adaptadores `simulado` (sandbox/QA), `m365` (correo
 * Microsoft 365) y WhatsApp vía `whatsapp_meta` (Meta Cloud API directa) y `whatsapp_twilio` (Twilio), ambos inactivos
 * sin credenciales. Agregar un proveedor = crear un adaptador y registrarlo en `ADAPTERS` (la selección es por
 * `proveedor`/`alias`, sin ramas `if`). `SecretsService`, `HttpClientService`, `ActionGatewayService` y `AuditService`
 * llegan por módulos globales.
 */
const ADAPTERS = [
  SimuladoChannelAdapter,
  M365MailChannelAdapter,
  WhatsappMetaChannelAdapter,
  WhatsappTwilioChannelAdapter,
];

@Module({
  controllers: [ChannelsController],
  providers: [
    ChannelsService,
    ...ADAPTERS,
    { provide: CHANNEL_ADAPTERS, useFactory: (...a: unknown[]) => a, inject: ADAPTERS },
  ],
  exports: [ChannelsService],
})
export class ChannelsModule {}
