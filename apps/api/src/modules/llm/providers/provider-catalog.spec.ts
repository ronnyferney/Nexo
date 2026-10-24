import { parseUrlOverrides } from '../../../config/configuration';
import { LlmHttpError } from '../llm-provider';
import { describeProbeError, publicEntry } from '../llm-providers.service';
import { SYSTEM_ANTHROPIC_MODELS } from '../pricing';
import {
  entryMechanisms,
  findMechanism,
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

/** Proveedores reales: el simulador de desarrollo (`devOnly`) tiene reglas propias (ver al final). */
const REAL_PROVIDERS = PROVIDER_CATALOG.filter((p) => !p.devOnly);

describe('Catálogo de proveedores LLM', () => {
  it('incluye los proveedores acordados con ids únicos y logo = id', () => {
    const ids = REAL_PROVIDERS.map((p) => p.id);
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
        'vertex',
      ]),
    );
    for (const p of REAL_PROVIDERS) {
      expect(p.logo).toBe(p.id);
      expect(p.id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('no ofrece suscripciones personales (decisión de negocio, ADR 0002 D8)', () => {
    const text = JSON.stringify(REAL_PROVIDERS).toLowerCase();
    for (const banned of ['claude.ai', 'claude pro', 'claude max', 'chatgpt plus', 'copilot']) {
      expect(text).not.toContain(banned);
    }
  });

  it.each(REAL_PROVIDERS.map((p) => [p.id, p] as const))('%s: metadatos coherentes', (_id, p) => {
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

  it.each(REAL_PROVIDERS.map((p) => [p.id, p] as const))('%s: campos y autenticación', (_id, p) => {
    const keys = p.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    const secrets = p.fields.filter((f) => f.secret);
    // El único secreto es la clave de API (se cifra en apiKeyCipher).
    expect(secrets.every((f) => f.key === 'apiKey')).toBe(true);
    // Sin mecanismo API_KEY (p. ej. Vertex AI, solo OAuth) no hay secreto en el formulario.
    if (p.auth === 'NONE' || !findMechanism(p, 'API_KEY')) expect(secrets).toHaveLength(0);
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

  it.each(REAL_PROVIDERS.map((p) => [p.id, p] as const))('%s: plantilla de URL base renderizable', (_id, p) => {
    const vars = templateVariables(p.baseUrl);
    const sample = Object.fromEntries(p.fields.filter((f) => !f.secret).map((f) => [f.key, f.placeholder ?? 'x']));
    const plain = [...Object.keys(sample), ...Object.keys(p.deriveValues?.(sample) ?? {})];
    for (const v of vars) expect(plain).toContain(v);
    const { baseUrl } = validateProviderFields(p, sampleFields(p));
    const url = new URL(baseUrl);
    expect(baseUrl).not.toMatch(/\{\{|\}\}|\/$/);
    expect(url.protocol).toBe(p.category === 'LOCAL' ? 'http:' : 'https:');
  });

  it.each(REAL_PROVIDERS.map((p) => [p.id, p] as const))('%s: modelos sugeridos válidos', (_id, p) => {
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

  it('solo los canales con tarifas de la API de Anthropic traen precios: el resto queda pendiente de tarifa', () => {
    // Claude en Microsoft Foundry se factura con las tarifas de la API de Anthropic (Microsoft Marketplace).
    const priced = new Set(['anthropic', 'claude-foundry']);
    const anthropic = REAL_PROVIDERS.find((x) => x.id === 'anthropic')!;
    expect(REAL_PROVIDERS.find((x) => x.id === 'claude-foundry')!.suggestedModels).toEqual(anthropic.suggestedModels);
    for (const p of REAL_PROVIDERS.filter((x) => !priced.has(x.id))) {
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
    const v = validateProviderFields(
      azure(),
      { resource: 'contoso-ia', apiKey: ' k-123 ', deployment: 'gpt-prod' },
      'API_KEY',
    );
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

describe('Mecanismos de conexión y metadatos de modelos (ADR 0002 D8)', () => {
  it('cada entrada tiene exactamente un mecanismo principal y tipos válidos', () => {
    for (const p of REAL_PROVIDERS) {
      const mechanisms = entryMechanisms(p);
      expect(mechanisms.filter((m) => m.primary)).toHaveLength(1);
      for (const m of mechanisms) {
        expect(['API_KEY', 'OAUTH', 'DEVICE_CODE', 'LOCAL_DETECT']).toContain(m.type);
        expect(m.label.length).toBeGreaterThan(0);
      }
      if (p.category === 'LOCAL') expect(mechanisms.map((m) => m.type)).toEqual(['LOCAL_DETECT']);
    }
  });

  it('las apps OAuth son de Nexo: sin client_id embebido y solo endpoints https oficiales', () => {
    for (const p of REAL_PROVIDERS) {
      for (const m of entryMechanisms(p)) {
        if (!m.oauth) continue;
        expect(m.oauth).not.toHaveProperty('clientId');
        expect(JSON.stringify(m.oauth)).not.toMatch(/client_id/i);
        for (const url of [m.oauth.authorizeUrl, m.oauth.tokenUrl, m.oauth.deviceUrl, m.oauth.revokeUrl]) {
          if (url)
            expect(url).toMatch(
              /^https:\/\/(accounts\.google\.com|oauth2\.googleapis\.com|login\.microsoftonline\.com|huggingface\.co)\//,
            );
        }
      }
    }
  });

  it('Vertex AI: solo OAuth con Google, scope cloud-platform y host según la región', () => {
    const vertex = findProvider('vertex')!;
    expect(entryMechanisms(vertex).map((m) => m.type)).toEqual(['OAUTH']);
    const oauth = findMechanism(vertex, 'OAUTH')!.oauth!;
    expect(oauth.scopes).toEqual(['https://www.googleapis.com/auth/cloud-platform']);
    expect(oauth.authorizeParams).toMatchObject({ access_type: 'offline' });
    expect(validateProviderFields(vertex, { projectId: 'mi-proyecto-123' }, 'OAUTH').baseUrl).toBe(
      'https://aiplatform.googleapis.com/v1/projects/mi-proyecto-123/locations/global/endpoints/openapi',
    );
    expect(
      validateProviderFields(vertex, { projectId: 'mi-proyecto-123', region: 'us-central1' }, 'OAUTH').baseUrl,
    ).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/mi-proyecto-123/locations/us-central1/endpoints/openapi',
    );
    expect(() => validateProviderFields(vertex, { projectId: 'x/../y' }, 'OAUTH')).toThrow(/formato/);
  });

  it('Azure OpenAI: OAuth con Entra ID (scope de Cognitive Services + offline_access) sin clave en el formulario', () => {
    const oauth = findMechanism(azure(), 'OAUTH')!.oauth!;
    expect(oauth.scopes).toEqual(['https://cognitiveservices.azure.com/.default', 'offline_access']);
    expect(oauth.tokenUrl).toBe('https://login.microsoftonline.com/{{ tenantId }}/oauth2/v2.0/token');
    const v = validateProviderFields(azure(), { resource: 'contoso-ia', deployment: 'gpt-prod' }, 'OAUTH');
    expect(v).toEqual({
      apiKey: undefined,
      values: { resource: 'contoso-ia', deployment: 'gpt-prod', tenantId: 'organizations' },
      baseUrl: 'https://contoso-ia.openai.azure.com/openai/v1',
    });
    // La clave no pertenece al mecanismo OAuth y el inquilino no puede inyectar rutas.
    expect(() => validateProviderFields(azure(), { resource: 'a', deployment: 'd', apiKey: 'k' }, 'OAUTH')).toThrow(
      /no reconocidos/,
    );
    expect(() =>
      validateProviderFields(azure(), { resource: 'a', deployment: 'd', tenantId: 'x/../../evil' }, 'OAUTH'),
    ).toThrow(/formato/);
  });

  it('Hugging Face: OAuth (scope inference-api), código de dispositivo y token hf_', () => {
    const hf = findProvider('huggingface')!;
    expect(entryMechanisms(hf).map((m) => m.type)).toEqual(['OAUTH', 'DEVICE_CODE', 'API_KEY']);
    expect(findMechanism(hf, 'OAUTH')!.oauth!.scopes).toContain('inference-api');
    expect(findMechanism(hf, 'DEVICE_CODE')!.oauth!.deviceUrl).toBe('https://huggingface.co/oauth/device');
  });

  it('la vista pública normaliza especialidades y contexto y oculta las apps OAuth', () => {
    const anthropic = publicEntry(findProvider('anthropic')!);
    expect(anthropic).not.toHaveProperty('mechanisms');
    expect(anthropic.suggestedModels.find((m) => m.id === 'claude-opus-5-5')).toMatchObject({
      tier: 'PREMIUM',
      specialties: ['CODE', 'GENERAL', 'VISION'],
      contextTokens: 1_000_000,
    });
    const openai = publicEntry(findProvider('openai')!);
    expect(openai.suggestedModels.every((m) => m.specialties.join() === 'GENERAL' && m.contextTokens === null)).toBe(
      true,
    );
    expect(publicEntry(findProvider('vertex')!)).not.toHaveProperty('deriveValues');
  });
});

describe('Simulador de desarrollo (LLM_DEV_SIMULATOR)', () => {
  const dev = PROVIDER_CATALOG.filter((p) => p.devOnly);

  it('solo el simulador usa client_id incorporado y rutas relativas a PUBLIC_URL', () => {
    expect(dev.map((p) => p.id)).toEqual(['nexo-simulado']);
    for (const p of REAL_PROVIDERS) {
      for (const m of p.mechanisms ?? []) expect(m.oauth?.builtinClientId).toBeUndefined();
      expect(p.baseUrl.startsWith('/')).toBe(false);
    }
    for (const m of dev[0].mechanisms ?? []) {
      expect(m.oauth?.builtinClientId).toBe('nexo-simulador-local');
      for (const url of [m.oauth!.authorizeUrl, m.oauth!.tokenUrl, m.oauth!.deviceUrl, m.oauth!.revokeUrl]) {
        expect(url).toMatch(/^\/api\/dev\/llm-sim\//);
      }
    }
  });
});
