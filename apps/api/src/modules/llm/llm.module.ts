import { Global, Module } from '@nestjs/common';
import { AnthropicDriver } from './drivers/anthropic.driver';
import { MockDriver } from './drivers/mock.driver';
import { OpenAiCompatibleDriver } from './drivers/openai-compatible.driver';
import { LlmAdminController, LlmCatalogController } from './llm-admin.controller';
import { LlmGatewayService } from './llm-gateway.service';
import { LLM_DRIVERS } from './llm-provider';

/** Para agregar un tipo de proveedor (Bedrock, Gemini nativo...) implemente LlmDriver y regístrelo aquí. */
const DRIVERS = [AnthropicDriver, OpenAiCompatibleDriver, MockDriver];

@Global()
@Module({
  controllers: [LlmCatalogController, LlmAdminController],
  providers: [
    ...DRIVERS,
    LlmGatewayService,
    { provide: LLM_DRIVERS, useFactory: (...d: unknown[]) => d, inject: DRIVERS },
  ],
  exports: [LlmGatewayService],
})
export class LlmModule {}
