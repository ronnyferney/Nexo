import { Module } from '@nestjs/common';
import { M365MailChannelAdapter } from './adapters/m365-mail.adapter';
import { SimuladoChannelAdapter } from './adapters/simulado.adapter';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { CHANNEL_ADAPTERS } from './domain/channel-adapter';

/**
 * Canales externos (E14 · ADR 0015, incremento 1): contrato `ChannelAdapter` + adaptadores `simulado` (sandbox/QA) y
 * `m365` (correo Microsoft 365, inactivo sin credenciales). Agregar un proveedor = crear un adaptador y registrarlo
 * en `ADAPTERS`. `SecretsService`, `HttpClientService` y `ActionGatewayService` llegan por módulos globales.
 */
const ADAPTERS = [SimuladoChannelAdapter, M365MailChannelAdapter];

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
