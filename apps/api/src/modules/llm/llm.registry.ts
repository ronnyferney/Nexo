import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { LLM_PROVIDERS, type LlmProvider } from './llm-provider';

@Injectable()
export class LlmRegistry {
  private readonly providers: Map<string, LlmProvider>;

  constructor(@Inject(LLM_PROVIDERS) providers: LlmProvider[]) {
    this.providers = new Map(providers.map((p) => [p.id, p]));
  }

  get(id: string): LlmProvider {
    const p = this.providers.get(id);
    if (!p) throw new BadRequestException(`Proveedor LLM desconocido: ${id}`);
    if (!p.isConfigured()) throw new BadRequestException(`El proveedor ${p.label} no está configurado`);
    return p;
  }

  catalog() {
    return [...this.providers.values()].map((p) => ({
      id: p.id,
      label: p.label,
      configured: p.isConfigured(),
      models: p.models(),
    }));
  }
}
