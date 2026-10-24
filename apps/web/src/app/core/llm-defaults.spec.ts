import { DEFAULT_AGENT_MODEL, defaultAgentModel } from './llm-defaults';
import type { LlmKind, ProviderInfo } from './models';

const provider = (id: string, kind: LlmKind, opts: Partial<ProviderInfo> = {}, models = ['m1']): ProviderInfo =>
  ({
    id,
    label: id,
    kind,
    system: false,
    configured: true,
    models: models.map((m) => ({ id: m })),
    ...opts,
  }) as ProviderInfo;

describe('defaultAgentModel', () => {
  it('el modelo por defecto de Nexo es claude-opus-5-5', () => {
    expect(DEFAULT_AGENT_MODEL).toBe('claude-opus-5-5');
  });

  it('sin proveedores listos devuelve null', () => {
    expect(defaultAgentModel([])).toBeNull();
    expect(defaultAgentModel([provider('a', 'ANTHROPIC', { configured: false })])).toBeNull();
    expect(defaultAgentModel([provider('a', 'ANTHROPIC', {}, [])])).toBeNull();
  });

  it('prefiere Claude propio, luego Claude de la plataforma, otra conexión y por último el simulador', () => {
    const mock = provider('mock', 'MOCK');
    const other = provider('openai', 'OPENAI_COMPATIBLE');
    const otherSystem = provider('openai-sys', 'OPENAI_COMPATIBLE', { system: true });
    const claudeSystem = provider('claude-sys', 'ANTHROPIC', { system: true }, [DEFAULT_AGENT_MODEL]);
    const claudeOwn = provider('claude', 'ANTHROPIC', {}, ['claude-otro', DEFAULT_AGENT_MODEL]);

    expect(defaultAgentModel([mock, otherSystem, other, claudeSystem, claudeOwn])).toEqual({
      provider: 'claude',
      model: DEFAULT_AGENT_MODEL,
    });
    expect(defaultAgentModel([mock, otherSystem, other, claudeSystem])?.provider).toBe('claude-sys');
    expect(defaultAgentModel([mock, otherSystem, other])?.provider).toBe('openai');
    expect(defaultAgentModel([mock, otherSystem])?.provider).toBe('openai-sys');
    expect(defaultAgentModel([mock])?.provider).toBe('mock');
  });

  it('sin el modelo por defecto en el proveedor elegido, usa su primer modelo', () => {
    expect(defaultAgentModel([provider('claude', 'ANTHROPIC', {}, ['claude-a', 'claude-b'])])).toEqual({
      provider: 'claude',
      model: 'claude-a',
    });
  });
});
