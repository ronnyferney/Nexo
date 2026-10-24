import Anthropic from '@anthropic-ai/sdk';
import { AnthropicFoundry } from '@anthropic-ai/foundry-sdk';
import { AnthropicGoogleCloud } from '@anthropic-ai/google-cloud-sdk';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import { parseClaudeOptions } from '../llm-gateway.service';
import { claudeSdkClient, isCustomAnthropicEndpoint, providerErrorMessage } from './anthropic.driver';

describe('Driver de Claude por canal', () => {
  const token = () => Promise.resolve('token-google');

  it('elige el cliente oficial de cada canal', async () => {
    expect(await claudeSdkClient({ apiKey: 'sk-ant-x' })()).toBeInstanceOf(Anthropic);
    expect(
      await claudeSdkClient({
        getAccessToken: token,
        claude: { channel: 'google-cloud', project: 'mi-proyecto-123', workspaceId: 'wrkspc_abc1' },
      })(),
    ).toBeInstanceOf(AnthropicGoogleCloud);
    expect(
      await claudeSdkClient({ getAccessToken: token, claude: { channel: 'vertex', project: 'mi-proyecto-123' } })(),
    ).toBeInstanceOf(AnthropicVertex);
    expect(
      await claudeSdkClient({ apiKey: 'clave', claude: { channel: 'foundry', resource: 'mi-recurso' } })(),
    ).toBeInstanceOf(AnthropicFoundry);
  });

  it('Vertex AI crea un cliente por solicitud con el token vigente', async () => {
    let n = 0;
    const factory = claudeSdkClient({
      getAccessToken: () => Promise.resolve(`token-${++n}`),
      claude: { channel: 'vertex', project: 'mi-proyecto-123', region: 'global' },
    });
    const a = await factory();
    const b = await factory();
    expect(a).not.toBe(b);
    expect(n).toBe(2);
  });

  it('exige los datos de cada canal y nunca acepta Google Cloud o Vertex sin inicio de sesión', () => {
    expect(() => claudeSdkClient({})).toThrow(/API key/);
    expect(() => claudeSdkClient({ claude: { channel: 'google-cloud', project: 'p', workspaceId: 'w' } })).toThrow(
      /iniciar sesión con Google/,
    );
    expect(() => claudeSdkClient({ getAccessToken: token, claude: { channel: 'google-cloud', project: 'p' } })).toThrow(
      /workspace/,
    );
    expect(() => claudeSdkClient({ getAccessToken: token, claude: { channel: 'vertex' } })).toThrow(/proyecto/);
  });

  it('distingue los hosts oficiales de un proxy por canal', () => {
    expect(isCustomAnthropicEndpoint(undefined)).toBe(false);
    expect(isCustomAnthropicEndpoint('https://api.anthropic.com')).toBe(false);
    expect(isCustomAnthropicEndpoint('https://gateway.empresa.com')).toBe(true);
    expect(isCustomAnthropicEndpoint('https://claude.googleapis.com', 'google-cloud')).toBe(false);
    expect(isCustomAnthropicEndpoint('https://us-east5-aiplatform.googleapis.com/v1', 'vertex')).toBe(false);
    expect(isCustomAnthropicEndpoint('https://mi-recurso.services.ai.azure.com/anthropic', 'foundry')).toBe(false);
    expect(isCustomAnthropicEndpoint('https://evil.services.ai.azure.com.example.com', 'foundry')).toBe(true);
  });

  it('solo lee de driverOptions canales conocidos y campos de texto acotados', () => {
    expect(parseClaudeOptions({ channel: 'vertex', project: 'p', region: 'global', extra: 'x' })).toEqual({
      channel: 'vertex',
      project: 'p',
      region: 'global',
    });
    expect(parseClaudeOptions({ channel: 'bedrock' })).toBeNull();
    expect(parseClaudeOptions('vertex')).toBeNull();
    expect(parseClaudeOptions({ channel: 'foundry', resource: 'x'.repeat(500) })).toEqual({ channel: 'foundry' });
  });
});

describe('A1 · errores del proveedor sin el cuerpo crudo', () => {
  it('solo el mensaje con forma de la API de Anthropic; si no, el estado HTTP', () => {
    expect(
      providerErrorMessage({
        status: 401,
        error: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
      }),
    ).toBe('invalid x-api-key');
    // Respuesta de un servicio interno (p. ej. metadatos): nunca se devuelve su contenido.
    expect(providerErrorMessage({ status: 404, error: { secreto_interno: 'datos-de-red-privada' } })).toBe(
      'El proveedor respondió HTTP 404',
    );
    expect(providerErrorMessage({ status: 500, error: '<html>interno</html>' })).toBe(
      'El proveedor respondió HTTP 500',
    );
  });
});
