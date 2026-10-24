import { ROLE_RANK, type WorkspaceRole } from '../decorators/roles.decorator';

/**
 * Alcances de una API key (B3). Cada petición hecha con una API key exige exactamente uno, que se deduce del método y
 * de la ruta (`requiredApiKeyScope`): así el alcance se decide en un único lugar y no en cada controlador.
 *
 * - `read`: consultas (GET/HEAD) y búsquedas que no modifican datos.
 * - `write`: crear, editar o borrar recursos del workspace (además, el rol de la clave debe permitirlo).
 * - `agents:run`: conversar con agentes y lanzar rutinas.
 * - `workflows:run`: ejecutar flujos y cancelar o reintentar ejecuciones.
 * - `connectors:invoke`: invocar operaciones de conectores.
 * - `mcp`: servidor MCP del workspace (`/api/mcp`); sus tools ejecutan los agentes publicados y los flujos activos.
 */
export const API_KEY_SCOPES = ['read', 'write', 'agents:run', 'workflows:run', 'connectors:invoke', 'mcp'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** Alcance completo de las claves anteriores a B3: se conserva su comportamiento, pero la web sugiere rotarlas. */
export const LEGACY_FULL_SCOPE = '*';

/** Roles que puede tener una API key. Nunca OWNER: las operaciones de dueño exigen una sesión de usuario. */
export const API_KEY_ROLES = ['VIEWER', 'EDITOR', 'ADMIN'] as const satisfies readonly WorkspaceRole[];
export type ApiKeyRole = (typeof API_KEY_ROLES)[number];

/** Expiraciones permitidas al crear una clave; `never` solo la decide un OWNER. */
export const API_KEY_EXPIRATIONS = ['30d', '90d', '365d', 'never'] as const;
export type ApiKeyExpiration = (typeof API_KEY_EXPIRATIONS)[number];
export const DEFAULT_API_KEY_EXPIRATION: ApiKeyExpiration = '90d';

const DAY_MS = 24 * 3600 * 1000;

/** Fecha de vencimiento para la expiración elegida (null = sin expiración). */
export function apiKeyExpiresAt(expiration: ApiKeyExpiration, now = new Date()): Date | null {
  if (expiration === 'never') return null;
  return new Date(now.getTime() + Number.parseInt(expiration, 10) * DAY_MS);
}

/** Rutas con un alcance propio (`method: '*'` = cualquiera). `path`: ruta de Nest sin el prefijo `/api`. */
const ROUTE_SCOPES: { method: string; pattern: RegExp; scope: ApiKeyScope }[] = [
  { method: '*', pattern: /^mcp(\/.*)?$/, scope: 'mcp' },
  { method: 'POST', pattern: /^agents\/:id\/chat$/, scope: 'agents:run' },
  { method: 'POST', pattern: /^routines\/:id\/run$/, scope: 'agents:run' },
  { method: 'POST', pattern: /^workflows\/:id\/run$/, scope: 'workflows:run' },
  { method: 'POST', pattern: /^executions\/:id\/(cancel|retry)$/, scope: 'workflows:run' },
  { method: 'POST', pattern: /^connectors\/:id\/operations\/:opId\/invoke$/, scope: 'connectors:invoke' },
  { method: 'POST', pattern: /^knowledge-bases\/:id\/search$/, scope: 'read' },
];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Une la ruta del controlador y la del método (`'workflows'` + `':id/run'` → `'workflows/:id/run'`). */
export function joinRoutePath(
  controllerPath: string | string[] | undefined,
  handlerPath: string | string[] | undefined,
) {
  const first = (p: string | string[] | undefined) => (Array.isArray(p) ? (p[0] ?? '') : (p ?? ''));
  return [first(controllerPath), first(handlerPath)]
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

/** Alcance que exige la petición `method` a la ruta `path` (sin prefijo `/api`). */
export function requiredApiKeyScope(method: string, path: string): ApiKeyScope {
  const m = method.toUpperCase();
  const normalized = path.replace(/^\/+|\/+$/g, '');
  const match = ROUTE_SCOPES.find((r) => (r.method === '*' || r.method === m) && r.pattern.test(normalized));
  if (match) return match.scope;
  return SAFE_METHODS.has(m) ? 'read' : 'write';
}

/** ¿La clave con estos alcances puede hacer una acción que exige `scope`? */
export function apiKeyAllows(scopes: readonly string[], scope: ApiKeyScope): boolean {
  return scopes.includes(LEGACY_FULL_SCOPE) || scopes.includes(scope);
}

/** Rol efectivo: el menor entre el de la clave y el vigente de quien la creó. */
export function effectiveApiKeyRole(keyRole: WorkspaceRole, creatorRole?: WorkspaceRole): WorkspaceRole {
  if (!creatorRole) return keyRole;
  return ROLE_RANK[creatorRole] < ROLE_RANK[keyRole] ? creatorRole : keyRole;
}

/** Nombre legible del alcance para mensajes de error. */
export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, string> = {
  read: 'consultar',
  write: 'crear y modificar recursos',
  'agents:run': 'ejecutar agentes',
  'workflows:run': 'ejecutar flujos',
  'connectors:invoke': 'invocar conectores',
  mcp: 'servidor MCP',
};
