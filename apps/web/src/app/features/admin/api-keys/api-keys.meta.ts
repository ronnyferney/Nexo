import type { ApiKey, ApiKeyExpiration, ApiKeyRole, ApiKeyScope, Role } from '../../../core/models';

/** Alcances que se pueden elegir al crear una API key (B3), con su explicación para el formulario. */
export const API_KEY_SCOPE_OPTIONS: { value: ApiKeyScope; label: string; hint: string }[] = [
  {
    value: 'read',
    label: 'Consultar',
    hint: 'Leer agentes, flujos, conectores, ejecuciones y buscar en conocimiento.',
  },
  {
    value: 'agents:run',
    label: 'Ejecutar agentes',
    hint: 'Conversar con agentes y lanzar rutinas.',
  },
  {
    value: 'workflows:run',
    label: 'Ejecutar flujos',
    hint: 'Ejecutar flujos y cancelar o reintentar ejecuciones.',
  },
  {
    value: 'connectors:invoke',
    label: 'Invocar conectores',
    hint: 'Llamar operaciones de conectores.',
  },
  {
    value: 'mcp',
    label: 'Servidor MCP',
    hint: 'Clientes MCP (Claude Desktop, Cursor…): agentes publicados y flujos activos.',
  },
  {
    value: 'write',
    label: 'Crear y modificar',
    hint: 'Crear, editar y borrar recursos del workspace (según el rol).',
  },
];

export const API_KEY_EXPIRATION_OPTIONS: { value: ApiKeyExpiration; label: string }[] = [
  { value: '30d', label: '30 días' },
  { value: '90d', label: '90 días' },
  { value: '365d', label: '1 año' },
  { value: 'never', label: 'Sin expiración' },
];

const ROLE_RANK: Record<Role, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2, OWNER: 3 };
const KEY_ROLES: ApiKeyRole[] = ['VIEWER', 'EDITOR', 'ADMIN'];

/** Roles que puede tener una clave creada por alguien con `role`: nunca más que el suyo, nunca OWNER. */
export function apiKeyRoleOptions(role: Role | undefined): ApiKeyRole[] {
  const rank = ROLE_RANK[role ?? 'VIEWER'];
  return KEY_ROLES.filter((r) => ROLE_RANK[r] <= rank);
}

/** Expiraciones disponibles: «sin expiración» solo para un OWNER. */
export function apiKeyExpirationOptions(role: Role | undefined) {
  return API_KEY_EXPIRATION_OPTIONS.filter((o) => o.value !== 'never' || role === 'OWNER');
}

export function apiKeyScopeLabel(scope: string): string {
  if (scope === '*') return 'Completo (heredado)';
  return API_KEY_SCOPE_OPTIONS.find((o) => o.value === scope)?.label ?? scope;
}

/** Avisos de rotación de una clave activa (vacío si no hay nada que sugerir). */
export function apiKeyWarnings(key: ApiKey, now = Date.now()): string[] {
  if (key.status !== 'ACTIVE') return [];
  const out: string[] = [];
  if (key.legacy)
    out.push(
      'Clave anterior a los alcances: tiene acceso completo. Cree una nueva con solo lo necesario y revoque esta.',
    );
  if (!key.expiresAt) out.push('Sin expiración: conviene rotarla periódicamente.');
  else if (new Date(key.expiresAt).getTime() - now <= 14 * 24 * 3600 * 1000)
    out.push('Vence pronto: cree una nueva antes de que deje de funcionar.');
  return out;
}

export function apiKeyStatusLabel(key: ApiKey): {
  text: string;
  tone: 'success' | 'warning' | 'danger';
} {
  if (key.status === 'REVOKED') {
    return {
      text: key.revokedReason === 'account_takeover' ? 'Revocada (cuenta recuperada)' : 'Revocada',
      tone: 'danger',
    };
  }
  if (key.status === 'EXPIRED') return { text: 'Vencida', tone: 'danger' };
  return key.rotationSuggested
    ? { text: 'Rotar', tone: 'warning' }
    : { text: 'Activa', tone: 'success' };
}
