import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { render } from '../../../common/template/template.engine';
import { OAUTH_PROVIDERS } from '../../oauth/oauth.providers';
import { CATALOG, findCatalogEntry } from './catalog.index';
import { PATTERNS, secretName, WRITE_NOTICE, type CatalogEntry } from './catalog.types';
import { COMMERCIAL_SKILLS } from './commercial-skills';

const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
const OP_KEY = /^[a-zA-Z0-9_-]{1,64}$/;

/** Recorre una plantilla y devuelve todas las expresiones `{{ ... }}`. */
function expressions(template: unknown): string[] {
  if (typeof template === 'string') return [...template.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]);
  if (Array.isArray(template)) return template.flatMap(expressions);
  if (template && typeof template === 'object') return Object.values(template).flatMap(expressions);
  return [];
}

const refs = (template: unknown, root: 'secrets' | 'input') =>
  expressions(template)
    .map((e) => e.split('|')[0].trim())
    .filter((p) => p.startsWith(`${root}.`))
    .map((p) => p.slice(root.length + 1).split('.')[0]);

const declaredSecrets = (e: CatalogEntry) => new Set(e.credentialFields.map((f) => secretName(e.slug, f.key)));

describe('catálogo de conectores (ADR 0005, D2)', () => {
  const ajv = addFormats(new Ajv({ strict: true, strictRequired: false, allowUnionTypes: true, allErrors: true }));

  it('incluye la primera tanda de integraciones con ids y slugs únicos', () => {
    const ids = CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(CATALOG.map((e) => e.slug)).size).toBe(CATALOG.length);
    for (const id of [
      'lusha-mcp',
      'lusha',
      'hubspot',
      'salesforce',
      'pipedrive',
      'google-sheets',
      'gmail',
      'microsoft-outlook',
      'whatsapp',
      'slack',
    ]) {
      expect(findCatalogEntry(id)).toBeDefined();
    }
  });

  describe.each(CATALOG.map((e) => [e.id, e] as const))('%s', (_id, entry) => {
    it('tiene metadatos completos y documentación oficial', () => {
      expect(entry.id).toMatch(/^[a-z0-9-]+$/);
      expect(entry.slug).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(['CRM', 'PROSPECCION', 'PRODUCTIVIDAD', 'MENSAJERIA', 'DATOS']).toContain(entry.category);
      expect(entry.docsUrl).toMatch(/^https:\/\//);
      expect(entry.name.length).toBeGreaterThan(1);
      expect(entry.description.length).toBeGreaterThan(10);
      expect(Object.keys(entry.auth).length).toBeGreaterThan(0);
      if (!entry.verified) expect(entry.verificationNotes).toBeTruthy();
      // Una entrada con alguna operación sin verificar no puede declararse verificada.
      if (entry.operations.some((o) => !o.verified)) expect(entry.verified).toBe(false);
      if (entry.discoverOnInstall) expect(entry.connectorType).toBe('MCP');
      else expect(entry.operations.length).toBeGreaterThan(0);
    });

    it('declara campos de credencial válidos y nombres de secretos en MAYÚSCULAS', () => {
      const keys = entry.credentialFields.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const f of entry.credentialFields) {
        expect(f.key).toMatch(/^[a-z][a-zA-Z0-9]*$/);
        expect(secretName(entry.slug, f.key)).toMatch(SECRET_NAME);
        if (f.pattern) {
          const re = new RegExp(f.pattern);
          if (f.default) expect(re.test(f.default)).toBe(true);
        }
        if (f.default) expect(f.secret).toBe(false);
        for (const m of f.authMethods ?? []) expect(Object.keys(entry.auth)).toContain(m);
      }
      // Cada método debe tener al menos un campo requerido o ser OAuth (credenciales en el flujo de consentimiento).
      for (const method of Object.keys(entry.auth)) {
        const required = entry.credentialFields.filter(
          (f) => f.required && (!f.authMethods || f.authMethods.includes(method as never)),
        );
        if (method !== 'oauth2_code') expect(required.length).toBeGreaterThan(0);
      }
    });

    it('solo referencia secretos declarados en config, auth y operaciones', () => {
      const declared = declaredSecrets(entry);
      const used = [
        ...refs(entry.config, 'secrets'),
        ...refs(entry.auth, 'secrets'),
        ...entry.operations.flatMap((o) => refs(o.definition, 'secrets')),
      ];
      for (const name of used) expect(declared).toContain(name);
      // Los campos sensibles se usan en algún lado (nada se pide sin motivo).
      for (const f of entry.credentialFields) expect(used).toContain(secretName(entry.slug, f.key));
    });

    it('usa las URLs del registro OAuth de la plataforma para su proveedor', () => {
      const auth = entry.auth.oauth2_code;
      if (!auth || auth.type !== 'oauth2_code') return;
      const provider = OAUTH_PROVIDERS[auth.provider];
      expect(provider).toBeDefined();
      expect(auth.authorizeUrl).toBe(provider.authorizeUrl);
      expect(auth.tokenUrl).toBe(provider.tokenUrl);
      expect(auth.scopes.length).toBeGreaterThan(0);
    });

    if (entry.operations.length) {
      it.each(entry.operations.map((o) => [o.key, o] as const))('operación %s', (_key, op) => {
        expect(op.key).toMatch(OP_KEY);
        expect(entry.operations.filter((o) => o.key === op.key)).toHaveLength(1);
        expect(op.docsUrl).toMatch(/^https:\/\//);
        expect(op.description.length).toBeGreaterThan(40);
        if (op.write) expect(op.description).toContain(WRITE_NOTICE);
        else expect(op.description).not.toContain(WRITE_NOTICE);

        // JSON Schema válido y mínimo (objeto con propiedades declaradas).
        expect(ajv.validateSchema(op.inputSchema)).toBe(true);
        expect(() => ajv.compile(op.inputSchema)).not.toThrow();
        expect(op.inputSchema.type).toBe('object');
        const properties = (op.inputSchema.properties ?? {}) as Record<string, unknown>;
        for (const r of (op.inputSchema.required as string[] | undefined) ?? []) expect(properties).toHaveProperty(r);

        // Las plantillas solo usan entradas declaradas en el esquema.
        for (const name of refs(op.definition, 'input')) expect(properties).toHaveProperty(name);

        if (entry.connectorType === 'REST') {
          expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(op.definition.method);
          expect(String(op.definition.path)).toMatch(/^\//);
        }
      });
    }
  });

  it('las consultas SOQL rechazan comillas y saltos de línea en los filtros', () => {
    const re = new RegExp(PATTERNS.soqlText);
    expect(re.test('Acme Corp')).toBe(true);
    expect(re.test("x' OR Name != '")).toBe(false);
    expect(re.test('a\\')).toBe(false);
    expect(re.test('a\nb')).toBe(false);

    const op = findCatalogEntry('salesforce')!.operations.find((o) => o.key === 'query_leads')!;
    const def = render<{ query: { q: string } }>(op.definition, { input: { search: 'Acme', limit: 5 } });
    expect(def.query.q).toContain("Company LIKE '%Acme%'");
    expect(def.query.q).toContain("Status LIKE '%'");
    expect(def.query.q).toMatch(/LIMIT 5$/);
  });

  it('el correo de Gmail no admite saltos de línea en cabeceras (inyección de Bcc)', () => {
    const op = findCatalogEntry('gmail')!.operations[0];
    const validate = ajv.compile(op.inputSchema);
    expect(validate({ to: 'ana@acme.com', subject: 'Hola', body: 'Texto\r\ncon saltos' })).toBe(true);
    expect(validate({ to: 'ana@acme.com\r\nBcc: x@evil.com', subject: 'Hola', body: 'x' })).toBe(false);
    expect(validate({ to: 'ana@acme.com', subject: 'Hola\nBcc: x@evil.com', body: 'x' })).toBe(false);
  });

  it('omite propiedades opcionales no enviadas al renderizar el cuerpo', () => {
    const op = findCatalogEntry('hubspot')!.operations.find((o) => o.key === 'create_contact')!;
    const def = render<{ body: unknown }>(op.definition, { input: { email: 'ana@acme.com' } });
    expect(JSON.parse(JSON.stringify(def.body))).toEqual({ properties: { email: 'ana@acme.com' } });
  });
});

describe('kit comercial', () => {
  it('define 4 skills en español que mencionan el CRM conectado y la herramienta de enriquecimiento', () => {
    expect(COMMERCIAL_SKILLS).toHaveLength(4);
    for (const s of COMMERCIAL_SKILLS) {
      expect(s.name.length).toBeLessThanOrEqual(80);
      expect(s.description.length).toBeLessThanOrEqual(1000);
      expect(s.instructions).toContain('CRM conectado');
      expect(s.instructions).toContain('herramienta de enriquecimiento');
    }
    expect(COMMERCIAL_SKILLS.map((s) => s.name).join(' ')).toContain('BANT');
  });
});
