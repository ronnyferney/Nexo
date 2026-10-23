import type { AgentPermission, AgentVisibility, LaunchStatus } from './access.models';
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
