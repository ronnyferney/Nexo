import { render } from '../../../common/template/template.engine';
import { DEV_PROVIDERS } from './dev.providers';
import { ENTERPRISE_PROVIDERS } from './enterprise.providers';
import { FRONTIER_PROVIDERS } from './frontier.providers';
import { LOCAL_PROVIDERS } from './local.providers';
import { OPEN_MODEL_PROVIDERS } from './open-models.providers';
import type { MechanismType, ProviderCatalogEntry, ProviderField } from './provider-catalog.types';
import { ROUTER_PROVIDERS } from './router.providers';

export * from './provider-catalog.types';

/**
 * Orden de la galería: fronteras, modelos abiertos, nube empresarial, enrutadores y locales. Al final, el simulador
 * de desarrollo (`devOnly`), que `LlmProvidersService` oculta salvo con `LLM_DEV_SIMULATOR=true`.
 */
export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  ...FRONTIER_PROVIDERS,
  ...OPEN_MODEL_PROVIDERS,
  ...ENTERPRISE_PROVIDERS,
  ...ROUTER_PROVIDERS,
  ...LOCAL_PROVIDERS,
  ...DEV_PROVIDERS,
];

const BY_ID = new Map(PROVIDER_CATALOG.map((p) => [p.id, p]));

export function findProvider(id: string): ProviderCatalogEntry | undefined {
  return BY_ID.get(id);
}

/** Variables `{{ campo }}` de una plantilla de URL base. */
export function templateVariables(template: string): string[] {
  return [...template.matchAll(/\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g)].map((m) => m[1]);
}

export interface ValidatedFields {
  /** Clave de API (único campo secreto); se cifra al guardar. */
  apiKey?: string;
  /** Valores no secretos (se guardan en `LlmConnection.providerFields`). */
  values: Record<string, string>;
  /** URL base ya renderizada y validada. */
  baseUrl: string;
}

export class ProviderFieldsError extends Error {}

const MAX_FIELD_LENGTH = 4096;

/** Campos del formulario que aplican a un mecanismo (sin mecanismo: todos). */
export function fieldsFor(entry: ProviderCatalogEntry, mechanism?: MechanismType): ProviderField[] {
  return mechanism ? entry.fields.filter((f) => !f.mechanisms || f.mechanisms.includes(mechanism)) : entry.fields;
}

/**
 * Valida los campos enviados contra la definición del proveedor (desconocidos, obligatorios, patrón, longitud),
 * aplica valores por defecto y renderiza la URL base con el motor de plantillas de Nexo. Con `mechanism` solo se
 * aceptan los campos de ese mecanismo (p. ej. OAuth no lleva clave de API).
 */
export function validateProviderFields(
  entry: ProviderCatalogEntry,
  input: Record<string, unknown>,
  mechanism?: MechanismType,
): ValidatedFields {
  const fields = fieldsFor(entry, mechanism);
  const known = new Set(fields.map((f) => f.key));
  const unknown = Object.keys(input).filter((k) => !known.has(k));
  if (unknown.length) throw new ProviderFieldsError(`Campos no reconocidos para ${entry.name}: ${unknown.join(', ')}`);

  const values: Record<string, string> = {};
  let apiKey: string | undefined;
  for (const field of fields) {
    const raw = input[field.key];
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      throw new ProviderFieldsError(`El campo «${field.label}» debe ser texto`);
    }
    const value = (raw ?? '').trim() || field.default || '';
    if (!value) {
      if (field.required) throw new ProviderFieldsError(`Falta el campo obligatorio «${field.label}»`);
      continue;
    }
    if (value.length > MAX_FIELD_LENGTH) throw new ProviderFieldsError(`El campo «${field.label}» es demasiado largo`);
    if (field.pattern && !new RegExp(field.pattern).test(value)) {
      throw new ProviderFieldsError(`El campo «${field.label}» no tiene un formato válido`);
    }
    if (field.secret) apiKey = value;
    else values[field.key] = value;
  }

  const ctx = { ...values, ...(entry.deriveValues?.(values) ?? {}) };
  const baseUrl = String(render<unknown>(entry.baseUrl, ctx) ?? '').replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ProviderFieldsError(`La URL base resultante no es válida: ${baseUrl || '(vacía)'}`);
  }
  const allowed = entry.category === 'LOCAL' ? ['http:', 'https:'] : ['https:'];
  if (!allowed.includes(url.protocol)) {
    throw new ProviderFieldsError(`La URL base de ${entry.name} debe usar ${allowed.join(' o ')}`);
  }
  if (url.username || url.password) throw new ProviderFieldsError('La URL base no puede incluir credenciales');
  return { apiKey, values, baseUrl };
}
