import type { CatalogAuthMethod, CatalogCategory, CatalogEntry, CatalogOperation } from '../../core/integrations.models';

export const CATEGORIES: { id: CatalogCategory; label: string; icon: string }[] = [
  { id: 'CRM', label: 'CRM', icon: 'users' },
  { id: 'PROSPECCION', label: 'Prospección', icon: 'target' },
  { id: 'PRODUCTIVIDAD', label: 'Productividad', icon: 'calendar' },
  { id: 'MENSAJERIA', label: 'Mensajería', icon: 'send' },
  { id: 'DATOS', label: 'Datos', icon: 'database' },
];

export const categoryLabel = (c: CatalogCategory) => CATEGORIES.find((x) => x.id === c)?.label ?? c;

export const AUTH_METHOD_META: Record<CatalogAuthMethod, { label: string; description: string }> = {
  apiKey: { label: 'Clave de API', description: 'Pegue la clave que genera el proveedor en su panel.' },
  bearer: { label: 'Token de acceso', description: 'Token de app privada o de bot emitido por el proveedor.' },
  oauth2_code: { label: 'Iniciar sesión (OAuth2)', description: 'Autorice el acceso con su cuenta; no necesita copiar claves.' },
  mcp: { label: 'Servidor MCP', description: 'Conexión al servidor MCP oficial del proveedor.' },
};

/**
 * Campos que `GET /connector-catalog` ya devuelve y el modelo de `core/` aún no declara (opcionales para tolerar
 * versiones anteriores de la API): verificación contra la documentación oficial y operaciones de escritura.
 */
export type CatalogEntryView = CatalogEntry & {
  verified?: boolean;
  verificationNotes?: string;
  operations: (CatalogOperation & { write?: boolean })[];
};

/** Selección curada para la sección «Más usadas» (en este orden); los ids ausentes del catálogo se ignoran. */
export const FEATURED_IDS = [
  'gmail-inbox',
  'google-calendar',
  'microsoft-mail',
  'microsoft-outlook',
  'microsoft-teams',
  'slack',
  'hubspot',
  'google-sheets',
  'linkedin',
];

/** Filas visibles por sección antes de «Ver las N aplicaciones». */
export const SECTION_PREVIEW = 6;
