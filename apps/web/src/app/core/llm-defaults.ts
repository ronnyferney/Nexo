import type { ProviderInfo } from './models';

/** Modelo por defecto de Nexo para agentes nuevos (CLAUDE.md). */
export const DEFAULT_AGENT_MODEL = 'claude-opus-5-5';

/**
 * Proveedor y modelo con que nace un agente: primero una conexión propia de Claude, luego la de la plataforma si está
 * configurada, luego cualquier otra conexión lista y, solo si no hay nada más, el proveedor simulado de pruebas. Dentro
 * del proveedor, el modelo por defecto de Nexo si existe.
 */
export function defaultAgentModel(catalog: ProviderInfo[]): { provider: string; model: string } | null {
  const ready = catalog.filter((p) => p.configured && p.models.length);
  const rank = (p: ProviderInfo) =>
    p.kind === 'MOCK' ? 4 : p.kind === 'ANTHROPIC' ? (p.system ? 1 : 0) : p.system ? 3 : 2;
  const provider = [...ready].sort((a, b) => rank(a) - rank(b))[0];
  if (!provider) return null;
  const model = provider.models.find((m) => m.id === DEFAULT_AGENT_MODEL) ?? provider.models[0];
  return { provider: provider.id, model: model.id };
}
