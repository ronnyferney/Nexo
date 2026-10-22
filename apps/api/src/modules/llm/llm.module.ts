import { Global, Module } from '@nestjs/common';
import { LLM_PROVIDERS } from './llm-provider';
import { LlmRegistry } from './llm.registry';
import { AnthropicProvider } from './providers/anthropic.provider';
import { MockProvider } from './providers/mock.provider';

/** Para agregar un proveedor (OpenAI, Gemini, Ollama...) implemente LlmProvider y regístrelo aquí. */
const PROVIDERS = [AnthropicProvider, MockProvider];

@Global()
@Module({
  providers: [
    ...PROVIDERS,
    LlmRegistry,
    { provide: LLM_PROVIDERS, useFactory: (...p: unknown[]) => p, inject: PROVIDERS },
  ],
  exports: [LlmRegistry],
})
export class LlmModule {}
