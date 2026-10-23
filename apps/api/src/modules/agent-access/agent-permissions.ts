import type { AgentVisibility } from '@prisma/client';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import type { AgentNeed, AgentPermission } from './agent-access.types';

/**
 * Matriz de permisos de agentes (ADR 0007 D2) como funciones puras: el servicio reúne los hechos (dueño, shares que
 * aplican al usuario, rol) y estas funciones deciden. Se prueban en `agent-permissions.spec.ts`.
 */
export interface AccessFacts {
  /** El usuario autenticado es el dueño del agente. */
  isOwner: boolean;
  role: AuthContext['role'];
  /** Las API keys no tienen identidad de usuario: nunca son dueñas, administradoras ni destinatarias de shares. */
  via: AuthContext['via'];
  visibility: AgentVisibility;
  /** Mejor permiso entre los shares que aplican al usuario (USER directo o UNIT de su cadena de unidades). */
  share: 'USE' | 'EDIT' | null;
}

export const isWorkspaceAdmin = (auth: Pick<AuthContext, 'role' | 'via'>): boolean =>
  auth.via === 'jwt' && (auth.role === 'ADMIN' || auth.role === 'OWNER');

/** Un share con EDIT gana sobre USE. */
export function bestShare(perms: ('USE' | 'EDIT')[]): 'USE' | 'EDIT' | null {
  if (perms.includes('EDIT')) return 'EDIT';
  return perms.length ? 'USE' : null;
}

/**
 * Permiso efectivo (null = el agente no es visible: 404).
 * - OWNER: dueño.
 * - EDIT: share EDIT (solo en TEAM/WORKSPACE: los shares de un agente PRIVATE quedan inactivos).
 * - ADMIN_VIEW: ADMIN/OWNER del workspace sobre agentes ajenos sin share EDIT (gobierno: ve la configuración, el
 *   costo y la salud, y puede editar; nunca ve conversaciones ajenas).
 * - USE: share USE o visibilidad WORKSPACE (cualquier miembro, incluidas las API keys).
 */
export function effectivePermission(f: AccessFacts): AgentPermission | null {
  if (f.isOwner && f.via === 'jwt') return 'OWNER';
  const share = f.visibility === 'PRIVATE' || f.via !== 'jwt' ? null : f.share;
  if (share === 'EDIT') return 'EDIT';
  if (isWorkspaceAdmin(f)) return 'ADMIN_VIEW';
  if (share === 'USE' || f.visibility === 'WORKSPACE') return 'USE';
  return null;
}

/**
 * ¿Puede escribir sobre el agente? Requiere OWNER, EDIT o gobierno (ADMIN_VIEW) y el rol del workspace sigue siendo
 * un tope: un VIEWER solo edita sus agentes PRIVATE.
 */
export function canEdit(f: AccessFacts, permission: AgentPermission | null): boolean {
  if (!permission || permission === 'USE') return false;
  if (f.role === 'VIEWER') return permission === 'OWNER' && f.visibility === 'PRIVATE';
  return true;
}

/** Resultado de la matriz para una necesidad: 'NOT_FOUND' (404), 'FORBIDDEN' (403) u 'OK'. */
export function decide(
  f: AccessFacts,
  need: AgentNeed,
): { outcome: 'OK' | 'NOT_FOUND' | 'FORBIDDEN'; permission: AgentPermission | null } {
  const permission = effectivePermission(f);
  if (!permission) return { outcome: 'NOT_FOUND', permission };
  if (need === 'EDIT' && !canEdit(f, permission)) return { outcome: 'FORBIDDEN', permission };
  return { outcome: 'OK', permission };
}

/** Pasar a TEAM/WORKSPACE (o crear así) y compartir exige rol EDITOR+ (ADR 0007 D3). */
export const canShare = (auth: Pick<AuthContext, 'role' | 'via'>): boolean =>
  auth.via === 'jwt' && auth.role !== 'VIEWER';
