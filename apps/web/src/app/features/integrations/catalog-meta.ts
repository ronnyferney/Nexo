import type { CatalogAuthMethod, CatalogCategory, CatalogEntry } from '../../core/integrations.models';
import { hasIcon } from '../../shared/icon.component';

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

/** Logo de la entrada: URL de imagen, ícono del mapa o, en su defecto, el ícono de la categoría. */
export function catalogLogo(e: Pick<CatalogEntry, 'icon' | 'category'>): { img: string | null; icon: string } {
  const icon = e.icon ?? '';
  if (/^(https?:\/\/|\/|data:image\/)/.test(icon)) return { img: icon, icon: 'puzzle' };
  if (hasIcon(icon)) return { img: null, icon };
  return { img: null, icon: CATEGORIES.find((c) => c.id === e.category)?.icon ?? 'puzzle' };
}
