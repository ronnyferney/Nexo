import { Global, Module } from '@nestjs/common';
import { DevLlmSimulatorController } from './dev-simulator/dev-llm-simulator.controller';
import { DevLlmSimulatorService } from './dev-simulator/dev-llm-simulator.service';
import { AnthropicDriver } from './drivers/anthropic.driver';
import { MockDriver } from './drivers/mock.driver';
import { OpenAiCompatibleDriver } from './drivers/openai-compatible.driver';
import { LlmAdminController, LlmCatalogController } from './llm-admin.controller';
import { OAuthModule } from '../oauth/oauth.module';
import { LlmAuthFlowsService } from './llm-auth-flows.service';
import { LlmGatewayService } from './llm-gateway.service';
import { ModelRouterService } from './model-router.service';
import { DataGuardService } from './data-guard/data-guard.service';
import { LLM_DRIVERS } from './llm-provider';
import { LlmOAuthCallbackController, LlmProvidersController } from './llm-providers.controller';
import { LlmProvidersService } from './llm-providers.service';
import { LlmTokenService } from './llm-token.service';
import { LlmUsageService } from './llm-usage.service';
import { OpenRouterOAuthService } from './openrouter-oauth.service';
import { SingleUseModule } from '../../infrastructure/redis/single-use.module';
import { AwsRoleService } from './keyless/aws-role.service';
import { OidcIssuerController } from './keyless/oidc-issuer.controller';
import { OidcIssuerService } from './keyless/oidc-issuer.service';

/** Para agregar un tipo de proveedor (Bedrock, Gemini nativo...) implemente LlmDriver y regístrelo aquí. */
const DRIVERS = [AnthropicDriver, OpenAiCompatibleDriver, MockDriver];

@Global()
@Module({
  imports: [OAuthModule, SingleUseModule],
  controllers: [
    LlmCatalogController,
    LlmAdminController,
    LlmProvidersController,
    LlmOAuthCallbackController,
    DevLlmSimulatorController,
    OidcIssuerController,
  ],
  providers: [
    ...DRIVERS,
    LlmTokenService,
    DataGuardService,
    LlmGatewayService,
    ModelRouterService,
    LlmProvidersService,
    OpenRouterOAuthService,
    LlmAuthFlowsService,
    LlmUsageService,
    DevLlmSimulatorService,
    OidcIssuerService,
    AwsRoleService,
    { provide: LLM_DRIVERS, useFactory: (...d: unknown[]) => d, inject: DRIVERS },
  ],
  exports: [LlmGatewayService, ModelRouterService, LlmTokenService, LlmUsageService, DataGuardService],
})
export class LlmModule {}
