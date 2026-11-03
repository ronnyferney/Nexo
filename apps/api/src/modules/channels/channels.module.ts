import { Module } from '@nestjs/common';
import { ProfilesModule } from '../profiles/profiles.module';
import { GmailMailChannelAdapter } from './adapters/gmail-mail.adapter';
import { M365MailChannelAdapter } from './adapters/m365-mail.adapter';
import { SimuladoChannelAdapter } from './adapters/simulado.adapter';
import { SimuladoPilotoChannelAdapter } from './adapters/simulado-piloto.adapter';
import { WhatsappMetaChannelAdapter } from './adapters/whatsapp-meta.adapter';
import { WhatsappTwilioChannelAdapter } from './adapters/whatsapp-twilio.adapter';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { CHANNEL_ADAPTERS } from './domain/channel-adapter';

/**
 * Canales externos (E14 · ADR 0015): contrato `ChannelAdapter` + adaptadores `simulado` (sandbox/QA), `simulado_piloto`
 * (piloto interno controlado: sandbox sin red PERO gobernado por E6, alias `piloto_correo`), `m365` (correo
 * Microsoft 365), `gmail` (correo Google, alias `google_mail`) y WhatsApp vía `whatsapp_meta` (Meta Cloud API directa)
 * y `whatsapp_twilio` (Twilio); todos los productivos inactivos sin credenciales. Agregar un proveedor = crear un
 * adaptador y registrarlo en `ADAPTERS` (la selección es por `proveedor`/`alias`, sin ramas `if`). `SecretsService`,
 * `HttpClientService`, `ActionGatewayService` y `AuditService` llegan por módulos globales.
 */
const ADAPTERS = [
  SimuladoChannelAdapter,
  SimuladoPilotoChannelAdapter,
  M365MailChannelAdapter,
  GmailMailChannelAdapter,
  WhatsappMetaChannelAdapter,
  WhatsappTwilioChannelAdapter,
];

@Module({
  imports: [ProfilesModule],
  controllers: [ChannelsController],
  providers: [
    ChannelsService,
    ...ADAPTERS,
    { provide: CHANNEL_ADAPTERS, useFactory: (...a: unknown[]) => a, inject: ADAPTERS },
  ],
  exports: [ChannelsService],
})
export class ChannelsModule {}
