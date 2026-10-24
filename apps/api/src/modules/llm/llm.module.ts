import { Global, Module } from '@nestjs/common';
import { AnthropicDriver } from './drivers/anthropic.driver';
import { MockDriver } from './drivers/mock.driver';
import { OpenAiCompatibleDriver } from './drivers/openai-compatible.driver';
import { LlmAdminController, LlmCatalogController } from './llm-admin.controller';
import { OAuthModule } from '../oauth/oauth.module';
import { LlmAuthFlowsService } from './llm-auth-flows.service';
import { LlmGatewayService } from './llm-gateway.service';
import { LLM_DRIVERS } from './llm-provider';
import { LlmOAuthCallbackController, LlmProvidersController } from './llm-providers.controller';
import { LlmProvidersService } from './llm-providers.service';
import { LlmTokenService } from './llm-token.service';
import { LlmUsageService } from './llm-usage.service';
import { OpenRouterOAuthService } from './openrouter-oauth.service';

/** Para agregar un tipo de proveedor (Bedrock, Gemini nativo...) implemente LlmDriver y regístrelo aquí. */
const DRIVERS = [AnthropicDriver, OpenAiCompatibleDriver, MockDriver];

@Global()
@Module({
  imports: [OAuthModule],
  controllers: [LlmCatalogController, LlmAdminController, LlmProvidersController, LlmOAuthCallbackController],
  providers: [
    ...DRIVERS,
    LlmTokenService,
    LlmGatewayService,
    LlmProvidersService,
    OpenRouterOAuthService,
    LlmAuthFlowsService,
    LlmUsageService,
    { provide: LLM_DRIVERS, useFactory: (...d: unknown[]) => d, inject: DRIVERS },
  ],
  exports: [LlmGatewayService, LlmTokenService, LlmUsageService],
})
export class LlmModule {}
