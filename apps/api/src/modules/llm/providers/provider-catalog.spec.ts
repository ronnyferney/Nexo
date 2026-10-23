import { parseUrlOverrides } from '../../../config/configuration';
import { LlmHttpError } from '../llm-provider';
import { describeProbeError, publicEntry } from '../llm-providers.service';
import { SYSTEM_ANTHROPIC_MODELS } from '../pricing';
import {
  findProvider,
  PROVIDER_CATALOG,
  ProviderFieldsError,
  templateVariables,
  validateProviderFields,
  type ProviderCatalogEntry,
} from '.';

const CATEGORIES = ['FRONTIER', 'OPEN_MODELS', 'ENTERPRISE_CLOUD', 'LOCAL', 'ROUTER'];
const BILLING = ['PAY_AS_YOU_GO', 'FREE_TIER', 'ENTERPRISE', 'LOCAL'];
const TIERS = ['ECONOMY', 'STANDARD', 'PREMIUM'];

/** Valores de ejemplo: el placeholder de cada campo (o un valor genérico). */
function sampleFields(entry: ProviderCatalogEntry): Record<string, string> {
  return Object.fromEntries(entry.fields.map((f) => [f.key, f.placeholder ?? (f.secret ? 'clave-de-prueba' : 'x')]));
}

const azure = () => findProvider('azure-openai')!;

describe('Catálogo de proveedores LLM', () => {
  it('incluye los proveedores acordados con ids únicos y logo = id', () => {
    const ids = PROVIDER_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        'anthropic',
        'openai',
        'gemini',
        'mistral',
        'groq',
        'deepseek',
        'xai',
        'cerebras',
        'fireworks',
        'together',
        'nvidia',
        'moonshot',
        'huggingface',
        'openrouter',
        'azure-openai',
        'bedrock',
        'ollama',
        'lmstudio',
      ]),
    );
    for (const p of PROVIDER_CATALOG) {
      expect(p.logo).toBe(p.id);
      expect(p.id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('no ofrece suscripciones personales (decisión de negocio, ADR 0002 D8)', () => {
    const text = JSON.stringify(PROVIDER_CATALOG).toLowerCase();
    for (const banned of ['claude.ai', 'claude pro', 'claude max', 'chatgpt plus', 'copilot']) {
      expect(text).not.toContain(banned);
    }
  });

  it.each(PROVIDER_CATALOG.map((p) => [p.id, p] as const))('%s: metadatos coherentes', (_id, p) => {
    expect(CATEGORIES).toContain(p.category);
    expect(BILLING).toContain(p.billing);
    expect(['ANTHROPIC', 'OPENAI_COMPATIBLE']).toContain(p.kind);
    expect(p.description).not.toMatch(/\n/);
    expect(p.description.length).toBeLessThanOrEqual(140);
    expect(p.docsUrl).toMatch(/^https:\/\//);
    if (p.keyUrl) expect(p.keyUrl).toMatch(/^https:\/\//);
    expect(p.keySteps.length === 0 || (p.keySteps.length >= 2 && p.keySteps.length <= 4)).toBe(true);
    expect(Array.isArray(p.pendingVerification)).toBe(true);
    if (p.category === 'LOCAL') expect(p.billing).toBe('LOCAL');
  });

  it.each(PROVIDER_CATALOG.map((p) => [p.id, p] as const))('%s: campos y autenticación', (_id, p) => {
    const keys = p.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    const secrets = p.fields.filter((f) => f.secret);
    // El único secreto es la clave de API (se cifra en apiKeyCipher).
    expect(secrets.every((f) => f.key === 'apiKey')).toBe(true);
    if (p.auth === 'NONE') expect(secrets).toHaveLength(0);
    else expect(secrets).toHaveLength(1);
    if (p.auth === 'API_KEY') expect(secrets[0].required).toBe(true);
    for (const f of p.fields) {
      if (f.pattern) {
        const re = new RegExp(f.pattern);
        expect(f.pattern.startsWith('^') && f.pattern.endsWith('$')).toBe(true);
        if (f.placeholder) expect(re.test(f.placeholder)).toBe(true);
        if (f.default) expect(re.test(f.default)).toBe(true);
      }
    }
    if (p.keyPrefix) {
      const placeholder = secrets[0]?.placeholder;
      if (placeholder) expect(placeholder.startsWith(p.keyPrefix)).toBe(true);
    }
  });

  it.each(PROVIDER_CATALOG.map((p) => [p.id, p] as const))('%s: plantilla de URL base renderizable', (_id, p) => {
    const vars = templateVariables(p.baseUrl);
    const plain = p.fields.filter((f) => !f.secret).map((f) => f.key);
    for (const v of vars) expect(plain).toContain(v);
    const { baseUrl } = validateProviderFields(p, sampleFields(p));
    const url = new URL(baseUrl);
    expect(baseUrl).not.toMatch(/\{\{|\}\}|\/$/);
    expect(url.protocol).toBe(p.category === 'LOCAL' ? 'http:' : 'https:');
  });

  it.each(PROVIDER_CATALOG.map((p) => [p.id, p] as const))('%s: modelos sugeridos válidos', (_id, p) => {
    const ids = p.suggestedModels.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of p.suggestedModels) {
      expect(TIERS).toContain(m.tier);
      expect(m.label.length).toBeGreaterThan(0);
      // Precio completo o ninguno: nunca a medias.
      expect(m.inputUsdPerMTok === undefined).toBe(m.outputUsdPerMTok === undefined);
      if (m.inputUsdPerMTok !== undefined) expect(m.inputUsdPerMTok).toBeGreaterThanOrEqual(0);
    }
  });

  it('Anthropic usa las tarifas verificadas del catálogo de sistema (incluida la caché de Sonnet 5.5)', () => {
    const anthropic = findProvider('anthropic')!;
    expect(anthropic.kind).toBe('ANTHROPIC');
    expect(anthropic.suggestedModels.map((m) => m.id)).toEqual(SYSTEM_ANTHROPIC_MODELS.map((m) => m.id));
    expect(anthropic.suggestedModels[0].id).toBe('claude-opus-5-5');
    const sonnet = anthropic.suggestedModels.find((m) => m.id === 'claude-sonnet-5-5')!;
    // Regresión: la lectura de caché de Sonnet 5.5 es 0,05x de 2 USD = 0,10 USD/MTok (antes 0,20).
    expect(sonnet).toMatchObject({ inputUsdPerMTok: 2, outputUsdPerMTok: 10, cacheReadUsdPerMTok: 0.1 });
    expect(SYSTEM_ANTHROPIC_MODELS.find((m) => m.id === 'claude-sonnet-5-5')!.cacheReadUsdPerMTok).toBe(0.1);
  });

  it('solo Anthropic trae precios: el resto queda pendiente de tarifa', () => {
    for (const p of PROVIDER_CATALOG.filter((x) => x.id !== 'anthropic')) {
      expect(p.suggestedModels.every((m) => m.inputUsdPerMTok === undefined)).toBe(true);
    }
  });

  it('Azure usa la cabecera api-key y OpenRouter valida con /key', () => {
    expect(azure().authHeader).toBe('api-key');
    expect(findProvider('openrouter')).toMatchObject({ auth: 'OAUTH', verifyPath: '/key', authHeader: 'bearer' });
    expect(findProvider('ollama')!.authHeader).toBe('none');
  });

  it('la vista pública no expone detalles del driver', () => {
    const view = publicEntry(findProvider('openrouter')!);
    expect(view).not.toHaveProperty('authHeader');
    expect(view).not.toHaveProperty('verifyPath');
    expect(view).not.toHaveProperty('headers');
    expect(view).toHaveProperty('keySteps');
  });
});

describe('validateProviderFields', () => {
  it('renderiza la URL de Azure y separa el secreto de los valores', () => {
    const v = validateProviderFields(azure(), { resource: 'contoso-ia', apiKey: ' k-123 ', deployment: 'gpt-prod' });
    expect(v).toEqual({
      apiKey: 'k-123',
      values: { resource: 'contoso-ia', deployment: 'gpt-prod' },
      baseUrl: 'https://contoso-ia.openai.azure.com/openai/v1',
    });
  });

  it('rechaza campos desconocidos, faltantes y con formato inválido', () => {
    expect(() => validateProviderFields(azure(), { resource: 'a', apiKey: 'k', deployment: 'd', extra: '1' })).toThrow(
      /no reconocidos/,
    );
    expect(() => validateProviderFields(azure(), { resource: 'a', deployment: 'd' })).toThrow(/Clave de API/);
    // Un recurso no puede cambiar el host de la plantilla.
    expect(() => validateProviderFields(azure(), { resource: 'evil.com/x?', apiKey: 'k', deployment: 'd' })).toThrow(
      ProviderFieldsError,
    );
    expect(() => validateProviderFields(findProvider('bedrock')!, { region: 'us-east-1.evil', apiKey: 'k' })).toThrow(
      /formato/,
    );
    expect(() => validateProviderFields(findProvider('openai')!, { apiKey: 42 })).toThrow(/texto/);
  });

  it('aplica el valor por defecto de los locales y exige http(s)', () => {
    expect(validateProviderFields(findProvider('ollama')!, {}).baseUrl).toBe('http://localhost:11434/v1');
    expect(validateProviderFields(findProvider('lmstudio')!, { baseUrl: 'http://10.0.0.5:1234/v1/' }).baseUrl).toBe(
      'http://10.0.0.5:1234/v1',
    );
    expect(() => validateProviderFields(findProvider('ollama')!, { baseUrl: 'file:///etc/passwd' })).toThrow();
    expect(() => validateProviderFields(findProvider('ollama')!, { baseUrl: 'http://u:p@host/v1' })).toThrow(
      /credenciales/,
    );
  });

  it('renderiza Bedrock con la región', () => {
    expect(validateProviderFields(findProvider('bedrock')!, { region: 'eu-west-1', apiKey: 'k' }).baseUrl).toBe(
      'https://bedrock-mantle.eu-west-1.api.aws/openai/v1',
    );
  });
});

describe('describeProbeError', () => {
  const openai = findProvider('openai')!;
  const url = 'https://api.openai.com/v1';

  it('clave inválida (401/403 y el 400 de Gemini)', () => {
    expect(describeProbeError(new LlmHttpError(401, 'Incorrect API key'), openai, url)).toMatch(/rechazó la clave/);
    expect(describeProbeError(new LlmHttpError(403, 'Forbidden'), openai, url)).toMatch(/HTTP 403/);
    expect(
      describeProbeError(new LlmHttpError(400, 'Please pass a valid API key'), findProvider('gemini')!, url),
    ).toMatch(/Google Gemini rechazó la clave/);
  });

  it('URL incorrecta, SSRF, inalcanzable y tiempo agotado', () => {
    expect(describeProbeError(new LlmHttpError(404, 'Not found'), openai, url)).toMatch(/HTTP 404 en api.openai.com/);
    expect(describeProbeError(new Error('Destino bloqueado por política de red: 10.0.0.1'), openai, url)).toMatch(
      /CONNECTOR_ALLOW_PRIVATE_NETWORKS/,
    );
    const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    expect(describeProbeError(refused, openai, url)).toMatch(/No se pudo alcanzar api.openai.com \(ECONNREFUSED\)/);
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    expect(describeProbeError(timeout, openai, url)).toMatch(/no respondió a tiempo/);
  });
});

describe('parseUrlOverrides (LLM_PROVIDER_URL_OVERRIDES)', () => {
  it('acepta solo un objeto JSON con URL http(s)', () => {
    expect(parseUrlOverrides('{"openai":"https://gw.test/v1","x":"ftp://a","y":3}')).toEqual({
      openai: 'https://gw.test/v1',
    });
    expect(parseUrlOverrides('no-json')).toEqual({});
    expect(parseUrlOverrides('["https://a"]')).toEqual({});
    expect(parseUrlOverrides(undefined)).toEqual({});
  });
});
