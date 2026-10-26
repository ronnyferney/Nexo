/**
 * Lógica pura de Cuadrillas (sin Angular): qué acciones de gobierno ofrece la UI según estado + rol, y el resumen
 * legible de los permisos PENDIENTES tras instanciar. Se mantiene aparte, con pruebas propias, para que los
 * componentes sean solo presentación.
 */
import type { CrewEstado, PermisoPendiente } from '../../core/crews.models';

/** Flags de rol derivados de la sesión. `isAdmin` incluye OWNER; `canEdit` es EDITOR+. */
export interface CrewRole {
  isAdmin: boolean;
  canEdit: boolean;
}

/** Acciones de gobierno que la UI debe mostrar para una plantilla. */
export interface CrewActions {
  /** Agregar una versión nueva (append-only). ADMIN, salvo si está RETIRADA. */
  addVersion: boolean;
  /** Publicar (BORRADOR → PUBLICADA). ADMIN, exige al menos una versión con miembros. */
  publish: boolean;
  /** Retirar. ADMIN, salvo si ya está RETIRADA. */
  retire: boolean;
  /** Instanciar. EDITOR+, solo si está PUBLICADA. */
  instantiate: boolean;
}

/**
 * Decide las acciones visibles. Reglas (ADR 0014 · D1):
 *  - Gobernar la plantilla (versionar/publicar/retirar) es cosa de ADMIN; instanciar basta con EDITOR+.
 *  - Publicar exige una versión con al menos un miembro (`hasMembers`).
 *  - Solo una PUBLICADA se instancia; una RETIRADA no admite versiones ni publicación.
 */
export function crewActions(estado: CrewEstado, role: CrewRole, hasMembers: boolean): CrewActions {
  return {
    addVersion: role.isAdmin && estado !== 'RETIRADA',
    publish: role.isAdmin && estado === 'BORRADOR' && hasMembers,
    retire: role.isAdmin && estado !== 'RETIRADA',
    instantiate: role.canEdit && estado === 'PUBLICADA',
  };
}

/** Un permiso pendiente ya resumido para mostrar (recuentos, no objetos crudos). */
export interface PermisoPendienteResumen {
  agentId: string;
  rol: string;
  cargoId: string | null;
  skillsCount: number;
  conectoresCount: number;
  tienePolitica: boolean;
}

/** Cuenta elementos de un valor que puede venir como arreglo (o no venir). */
function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/** `true` si el objeto de política trae alguna clave (no es `{}` ni nulo). */
function hasPolitica(value: unknown): boolean {
  return !!value && typeof value === 'object' && Object.keys(value as object).length > 0;
}

/** Resume cada permiso pendiente a recuentos legibles para la UI. */
export function resumirPermisosPendientes(permisos: readonly PermisoPendiente[]): PermisoPendienteResumen[] {
  return permisos.map((p) => ({
    agentId: p.agentId,
    rol: p.rol,
    cargoId: p.cargoId,
    skillsCount: countArray(p.skills),
    conectoresCount: countArray(p.conectoresSugeridos),
    tienePolitica: hasPolitica(p.politicaSugerida),
  }));
}

/** Totales agregados de los permisos pendientes (para el encabezado del diálogo). */
export interface PermisosTotales {
  agentes: number;
  skills: number;
  conectores: number;
  politicas: number;
}

/** Suma los recuentos de todos los permisos pendientes. */
export function totalesPermisosPendientes(permisos: readonly PermisoPendiente[]): PermisosTotales {
  const resumen = resumirPermisosPendientes(permisos);
  return {
    agentes: resumen.length,
    skills: resumen.reduce((n, r) => n + r.skillsCount, 0),
    conectores: resumen.reduce((n, r) => n + r.conectoresCount, 0),
    politicas: resumen.reduce((n, r) => n + (r.tienePolitica ? 1 : 0), 0),
  };
}
