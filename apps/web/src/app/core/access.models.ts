/** Visibilidad, permisos, salud y lanzamiento de agentes (ADR 0006 D3/D4 y ADR 0007). */

export type AgentVisibility = 'PRIVATE' | 'TEAM' | 'WORKSPACE';
export type AgentPermission = 'OWNER' | 'EDIT' | 'USE' | 'ADMIN_VIEW';
export type SharePrincipal = 'USER' | 'UNIT' | 'GROUP';
export type SharePermission = 'USE' | 'EDIT';
export type LaunchStatus = 'DRAFT' | 'LAUNCHED';

/** Share de un agente (solo visible para quien tiene EDIT). */
export interface AgentShare {
  id: string;
  principalType: SharePrincipal;
  principalId: string;
  principalName: string;
  permission: SharePermission;
}

/** Cuerpo de `PUT /agents/:id/shares`. */
export interface AgentShareInput {
  principalType: SharePrincipal;
  principalId: string;
  permission: SharePermission;
}

/** Etiqueta e ícono por tipo de destino de un share (persona, unidad o grupo). */
export const PRINCIPAL_META: Record<SharePrincipal, { label: string; detail: string; icon: string }> = {
  USER: { label: 'Persona', detail: 'Persona', icon: 'user' },
  UNIT: { label: 'Unidad', detail: 'Unidad y subunidades', icon: 'building' },
  GROUP: { label: 'Grupo', detail: 'Grupo de usuarios', icon: 'users' },
};

// ----- Grupos de usuarios (ADR 0007 D6) -----

/** Fila de `GET /groups` (EDITOR+), usada para compartir agentes con un grupo. */
export interface UserGroupSummary {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
}

export interface UserGroupMember {
  userId: string;
  name: string;
  email: string;
}

/** Grupo con miembros de `GET /admin/groups` y respuesta de las mutaciones de administración (ADMIN+). */
export interface UserGroup extends UserGroupSummary {
  createdAt: string;
  members: UserGroupMember[];
}

/** Cuerpo de `POST /admin/groups`. */
export interface UserGroupCreateInput {
  name: string;
  description?: string;
  userIds?: string[];
}

/** Cuerpo de `PATCH /admin/groups/:id`. */
export interface UserGroupUpdateInput {
  name?: string;
  description?: string;
}

// ----- Salud (ADR 0006 D3) -----

export type HealthCategory = 'PROFILE' | 'TOOLS' | 'KNOWLEDGE' | 'QUALITY' | 'COST' | 'OPERATIONS';
export type HealthLevel = 'CRITICAL' | 'NEEDS_WORK' | 'GOOD' | 'EXCELLENT';
export type HealthSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface HealthCheck {
  id: string;
  category: HealthCategory;
  severity: HealthSeverity;
  passed: boolean;
  message: string;
  recommendation: string;
  action?: { type: 'OPEN_TAB' | 'COPILOT'; tab?: string; prompt?: string };
}

/** `GET /agents/:id/health`. */
export interface AgentHealth {
  agentId?: string;
  score: number;
  level: HealthLevel;
  checks: HealthCheck[];
  evaluatedAt?: string;
}

/**
 * Fila de `GET /agents/health` (resumen del workspace). El contrato no fija la forma exacta: se normaliza con
 * `normalizeHealthSummary` aceptando `name` o `agentName` y una lista, `{ agents }` (contrato de la API) o `{ items }`.
 */
export interface AgentHealthSummary {
  agentId: string;
  name: string;
  score: number;
  level: HealthLevel;
}

/** `POST /agents/:id/launch`. */
export interface LaunchInput {
  override?: boolean;
  reason?: string;
}

/** Puntaje de salud mínimo para lanzar sin forzar (ADR 0006 D4). */
export const LAUNCH_MIN_HEALTH = 70;

export const VISIBILITY_META: Record<AgentVisibility, { label: string; icon: string; description: string }> = {
  PRIVATE: { label: 'Personal', icon: 'lock', description: 'Solo usted (y la administración del workspace por gobierno).' },
  TEAM: { label: 'Equipo', icon: 'users', description: 'Las personas, unidades (con sus subunidades) y grupos con los que lo comparta.' },
  WORKSPACE: { label: 'Empresa', icon: 'building', description: 'Todos los miembros del workspace pueden usarlo.' },
};

export const PERMISSION_LABELS: Record<AgentPermission, string> = {
  OWNER: 'Dueño',
  EDIT: 'Puede editar',
  USE: 'Puede usar',
  ADMIN_VIEW: 'Vista de administración',
};

export const HEALTH_LEVEL_META: Record<HealthLevel, { label: string; tone: 'danger' | 'warning' | 'info' | 'success' }> = {
  CRITICAL: { label: 'Crítico', tone: 'danger' },
  NEEDS_WORK: { label: 'Necesita trabajo', tone: 'warning' },
  GOOD: { label: 'Bueno', tone: 'info' },
  EXCELLENT: { label: 'Excelente', tone: 'success' },
};

export const HEALTH_CATEGORY_LABELS: Record<HealthCategory, string> = {
  PROFILE: 'Perfil',
  TOOLS: 'Herramientas',
  KNOWLEDGE: 'Conocimiento',
  QUALITY: 'Calidad',
  COST: 'Costo',
  OPERATIONS: 'Operación',
};

/**
 * Metadatos por severidad de un hallazgo (ADR 0006 D3, §4.3 del rediseño UX): etiqueta orientada a la acción,
 * tono del design system, ícono y rango de orden (bloqueantes primero). Un hallazgo es una revisión no superada.
 */
export const HEALTH_SEVERITY_META: Record<
  HealthSeverity,
  { label: string; tone: 'danger' | 'warning' | 'info'; icon: string; rank: number }
> = {
  CRITICAL: { label: 'Bloqueante', tone: 'danger', icon: 'xCircle', rank: 0 },
  WARNING: { label: 'Advertencia', tone: 'warning', icon: 'alert', rank: 1 },
  INFO: { label: 'Informativa', tone: 'info', icon: 'info', rank: 2 },
};

/**
 * Estado de publicación derivado de los hallazgos (§4.3): el criterio NO es solo el puntaje.
 * - `BLOCKED`: hay al menos un hallazgo bloqueante (severidad CRITICAL sin superar).
 * - `WARNINGS`: sin bloqueantes, pero quedan advertencias.
 * - `READY`: sin bloqueantes ni advertencias (a lo sumo hallazgos informativos).
 */
export type PublishState = 'READY' | 'WARNINGS' | 'BLOCKED';

export const PUBLISH_STATE_META: Record<
  PublishState,
  { label: string; tone: 'success' | 'warning' | 'danger'; icon: string; description: string }
> = {
  READY: {
    label: 'Preparado para publicar',
    tone: 'success',
    icon: 'checkCircle',
    description: 'El agente cumple los requisitos esenciales. Puede lanzarlo cuando quiera.',
  },
  WARNINGS: {
    label: 'Publicable con advertencias',
    tone: 'warning',
    icon: 'alert',
    description: 'Puede lanzarlo, pero hay mejoras recomendadas antes de usarlo con toda la empresa.',
  },
  BLOCKED: {
    label: 'Publicación bloqueada',
    tone: 'danger',
    icon: 'xCircle',
    description: 'Resuelva los hallazgos bloqueantes antes de lanzar el agente.',
  },
};

/** Deriva el estado de publicación a partir de las revisiones de salud. Lógica pura y testeable (§4.3). */
export function derivePublishState(checks: readonly Pick<HealthCheck, 'passed' | 'severity'>[]): PublishState {
  const pending = checks.filter((c) => !c.passed);
  if (pending.some((c) => c.severity === 'CRITICAL')) return 'BLOCKED';
  if (pending.some((c) => c.severity === 'WARNING')) return 'WARNINGS';
  return 'READY';
}

/** Cuenta los hallazgos (revisiones no superadas) por severidad, para el resumen del panel de salud. */
export function countFindingsBySeverity(
  checks: readonly Pick<HealthCheck, 'passed' | 'severity'>[],
): Record<HealthSeverity, number> {
  const counts: Record<HealthSeverity, number> = { CRITICAL: 0, WARNING: 0, INFO: 0 };
  for (const c of checks) if (!c.passed) counts[c.severity]++;
  return counts;
}

/** Normaliza la respuesta de `GET /agents/health` a una lista de resúmenes. */
export function normalizeHealthSummary(raw: unknown): AgentHealthSummary[] {
  const wrapped = raw as { agents?: unknown[]; items?: unknown[] } | null;
  const list = Array.isArray(raw) ? raw : (wrapped?.agents ?? wrapped?.items ?? []);
  return list
    .map((r) => r as Record<string, unknown>)
    .filter((r) => typeof r['agentId'] === 'string' || typeof r['id'] === 'string')
    .map((r) => ({
      agentId: String(r['agentId'] ?? r['id']),
      name: String(r['name'] ?? r['agentName'] ?? (r['agent'] as { name?: string } | undefined)?.name ?? 'Agente'),
      score: Number(r['score'] ?? 0),
      level: (r['level'] as HealthLevel) ?? 'CRITICAL',
    }));
}
