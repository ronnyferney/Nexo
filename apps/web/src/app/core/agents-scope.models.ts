import type { AgentPermission, AgentVisibility, HealthLevel, LaunchStatus } from './access.models';
import type { Agent } from './models';

/** Ámbito de la lista de agentes (`GET /agents?scope=`, ADR 0007). `all` solo ADMIN/OWNER. */
/** `available` = todos los que el usuario puede usar (GET /agents sin `scope`): propios, compartidos y de la empresa. */
export type AgentScope = 'available' | 'mine' | 'shared' | 'workspace' | 'all';

/** Agente de la lista por ámbito: `Agent` ya incluye visibilidad, dueño, permiso y lanzamiento (opcionales). */
export type ScopedAgent = Agent;

/** Agente de equipo/empresa disponible para el usuario y que no es suyo (`GET /agents/explore`). */
export interface ExploreAgent {
  id: string;
  name: string;
  description?: string | null;
  visibility?: AgentVisibility;
  owner?: { id: string; name: string } | null;
  launchStatus?: LaunchStatus;
  healthScore?: number | null;
  myPermission?: AgentPermission;
  model?: string;
  updatedAt?: string;
}

/** `GET/PATCH /workspace/settings` (ADR 0007 D3). */
export interface WorkspaceSettings {
  allowPersonalAgents: boolean;
}

// ----- Tablero de agentes (`GET /agents/dashboard`, RX-11) -----

/**
 * Agente del tablero con sus métricas de los últimos 30 días. `area` se aproxima con el centro de costo (OrgUnit)
 * y puede ser `null`. `health` es `null` cuando el agente aún no se ha evaluado.
 */
export interface DashboardAgent {
  id: string;
  name: string;
  description: string | null;
  visibility: AgentVisibility;
  status: LaunchStatus;
  health: { score: number; level: HealthLevel } | null;
  executions: number;
  users: number;
  costUsd: number;
  area: string | null;
}

/**
 * KPIs del tablero. Los campos que el modelo de datos no sostiene llegan como `null` (§6, nunca se inventan):
 * `testing` (no existe el estado «en pruebas»), `successRatePct` (no se registra éxito por llamada) y los deltas
 * porcentuales sin periodo base de comparación.
 */
export interface AgentDashboardKpis {
  totalAgents: number;
  testing: number | null;
  active: number;
  activeDelta: number;
  published: number;
  executions: number;
  executionsDeltaPct: number | null;
  successRatePct: number | null;
  costUsd: number;
  costDeltaPct: number | null;
  alerts: number;
}

/** Recuentos por pestaña. `testing` y `archived` son `null`: esos estados no existen en el modelo. */
export interface AgentDashboardCounts {
  all: number;
  active: number;
  testing: number | null;
  draft: number;
  archived: number | null;
}

/** Respuesta de `GET /agents/dashboard`: ventana, KPIs, recuentos por pestaña y agentes con métricas. */
export interface AgentDashboard {
  window: { from: string; to: string; days: number };
  kpis: AgentDashboardKpis;
  counts: AgentDashboardCounts;
  agents: DashboardAgent[];
}
