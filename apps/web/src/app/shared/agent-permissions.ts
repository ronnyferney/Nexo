import type { AgentPermission, AgentVisibility } from '../core/access.models';
import type { Role } from '../core/models';

/**
 * Espejo de `canEdit` de la API (`apps/api/src/modules/agent-access/agent-permissions.ts`, ADR 0007 D2): escribir sobre
 * un agente (editarlo, gestionar sus rutinas, revisar su feedback) requiere OWNER, EDIT o gobierno (ADMIN_VIEW), y el
 * rol del workspace es un tope: un VIEWER solo edita sus agentes PRIVATE (un share EDIT no le basta).
 */
export function canWriteAgent(
  permission: AgentPermission | null | undefined,
  role: Role | null | undefined,
  visibility: AgentVisibility | null | undefined,
): boolean {
  if (!permission || permission === 'USE') return false;
  if (role === 'VIEWER') return permission === 'OWNER' && (visibility ?? 'PRIVATE') === 'PRIVATE';
  return true;
}

/** Eliminar y transferir: solo el dueño o ADMIN/OWNER del workspace (`assertOwnerOrAdmin` de la API). */
export function canManageAgentOwnership(permission: AgentPermission | null | undefined, role: Role | null | undefined): boolean {
  return permission === 'OWNER' || role === 'ADMIN' || role === 'OWNER';
}
