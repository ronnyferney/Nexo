import type { ProviderView } from '../../core/llm-providers.models';
import { CLAUDE_CHANNELS, isKeyless, llmOAuthError, mechanismsOf, mechanismSubtitle } from './provider-meta';

describe('llmOAuthError', () => {
  it('traduce cada motivo conocido del retorno OAuth con el nombre del proveedor', () => {
    expect(llmOAuthError('access_denied', 'Vertex AI')).toBe(
      'No se pudo conectar Vertex AI. Se canceló la autorización en Vertex AI.',
    );
    expect(llmOAuthError('not_configured', 'Azure OpenAI')).toBe(
      'No se pudo conectar Azure OpenAI. El administrador de la plataforma debe configurar la app de Azure OpenAI.',
    );
    expect(llmOAuthError('invalid_state', 'X')).toContain('expiró o ya fue usada');
    expect(llmOAuthError('browser_mismatch', 'X')).toContain('mismo navegador');
  });

  it('con motivo vacío o desconocido usa un mensaje genérico y no refleja el texto recibido', () => {
    expect(llmOAuthError(null)).toBe('No se pudo conectar el proveedor. Intente de nuevo.');
    expect(llmOAuthError('', 'Hugging Face')).toBe('No se pudo conectar Hugging Face. Intente de nuevo.');
    const hostile = '<img src=x onerror=alert(1)>';
    expect(llmOAuthError(hostile, 'X')).toBe('No se pudo conectar X. Intente de nuevo.');
  });

  // Regresión: `LLM_OAUTH_ERRORS[reason]` resolvía propiedades heredadas de Object (`?reason=toString`).
  it('no confunde propiedades heredadas de Object con motivos', () => {
    expect(llmOAuthError('toString', 'X')).toBe('No se pudo conectar X. Intente de nuevo.');
    expect(llmOAuthError('constructor', 'X')).toBe('No se pudo conectar X. Intente de nuevo.');
  });
});

describe('Mecanismos sin claves (L2/L3)', () => {
  const base = {
    id: 'claude-bedrock',
    name: 'Claude en Amazon Bedrock',
    description: '',
    logo: 'claude-bedrock',
    category: 'ENTERPRISE_CLOUD',
    billing: 'ENTERPRISE',
    kind: 'ANTHROPIC',
    auth: 'NONE',
    fields: [],
    docsUrl: 'https://platform.claude.com',
    suggestedModels: [],
    modelCount: 0,
    connected: [],
    family: 'CLAUDE',
    claudeChannel: 'bedrock',
  } as unknown as ProviderView;

  it('conserva los mecanismos sin claves, los reconoce y los subtitula', () => {
    const p = {
      ...base,
      mechanisms: [{ type: 'AWS_ROLE', label: 'Rol de IAM de AWS (sin claves)', available: true, primary: true }],
    } as ProviderView;
    const [m] = mechanismsOf(p);
    expect(m.type).toBe('AWS_ROLE');
    expect(isKeyless(m)).toBe(true);
    expect(isKeyless({ type: 'API_KEY' })).toBe(false);
    expect(mechanismSubtitle(p)).toBe('Rol de IAM de AWS (sin claves) · Empresarial');
    expect(CLAUDE_CHANNELS.bedrock.operator).toBe('AWS');
    expect(CLAUDE_CHANNELS.aws.billing).toBe('AWS Marketplace');
  });

  it('la federación de identidad queda como alternativa a la clave de API', () => {
    const p = {
      ...base,
      id: 'anthropic',
      claudeChannel: 'anthropic',
      mechanisms: [
        { type: 'API_KEY', label: 'Clave de API', available: true, primary: true },
        { type: 'WORKLOAD_IDENTITY', label: 'Federación de identidad (sin claves)', available: false, primary: false },
      ],
    } as ProviderView;
    expect(mechanismsOf(p).map((m) => m.type)).toEqual(['API_KEY', 'WORKLOAD_IDENTITY']);
  });
});
