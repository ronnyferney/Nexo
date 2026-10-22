import { SetMetadata } from '@nestjs/common';

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
export const ROLE_RANK: Record<WorkspaceRole, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2, OWNER: 3 };
export const MIN_ROLE = 'minRole';

/** Rol mínimo requerido en el workspace activo. */
export const MinRole = (role: WorkspaceRole) => SetMetadata(MIN_ROLE, role);
