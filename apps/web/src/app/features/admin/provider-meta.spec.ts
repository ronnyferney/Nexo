import { llmOAuthError } from './provider-meta';

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
