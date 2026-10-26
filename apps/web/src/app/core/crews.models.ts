/**
 * Tipos de Cuadrillas (ADR 0014 · D1 · E11): plantillas de equipo de empleados digitales GOBERNADAS, versionadas y
 * 100 % DECLARATIVAS. Espejan el contrato del backend (`modules/crews`). Una Cuadrilla es configuración, nunca código:
 * no admite hooks, scripts, comandos ni URLs de arranque. Instanciarla NO concede acceso a datos: los conectores y
 * skills de cada miembro son SUGERENCIAS que un humano concede después por el camino normal (shares, bóveda).
 */

/** Estado del ciclo de vida de una plantilla de Cuadrilla. */
export type CrewEstado = 'BORRADOR' | 'PUBLICADA' | 'RETIRADA';
export const CREW_ESTADOS: readonly CrewEstado[] = ['BORRADOR', 'PUBLICADA', 'RETIRADA'];

/** Etiquetas en español de los estados. */
export const CREW_ESTADO_LABELS: Record<CrewEstado, string> = {
  BORRADOR: 'Borrador',
  PUBLICADA: 'Publicada',
  RETIRADA: 'Retirada',
};

/** Clase de badge del design system para cada estado. */
export const CREW_ESTADO_BADGE: Record<CrewEstado, string> = {
  BORRADOR: 'warning',
  PUBLICADA: 'success',
  RETIRADA: '',
};

/** Un rol del equipo dentro de una versión. Todo es declarativo. */
export interface CrewMember {
  id: string;
  workspaceId: string;
  versionId: string;
  rol: string;
  cargoId: string | null;
  nivelEsperado: string | null;
  skills: string[];
  /** Referencias a conector/operación SUGERIDAS (no conceden acceso). */
  conectoresSugeridos: unknown[];
  politicaSugerida: Record<string, unknown>;
  criteriosResultado: Record<string, unknown>;
  /** Roles/ids de miembro a los que puede delegar. */
  delegaA: string[];
  createdAt: string;
}

/** Versión inmutable (append-only) de la configuración de una Cuadrilla. */
export interface CrewVersion {
  id: string;
  workspaceId: string;
  plantillaId: string;
  version: number;
  definicion: Record<string, unknown>;
  publicadaPorUserId: string | null;
  publicadaAt: string | null;
  miembros: CrewMember[];
  createdAt: string;
}

/** Campos comunes de la plantilla (identidad estable; la configuración vive en sus versiones). */
export interface CrewBase {
  id: string;
  workspaceId: string;
  orgUnitId: string | null;
  nombre: string;
  proposito: string | null;
  procesoObjetivo: string | null;
  estado: CrewEstado;
  /** Humano que creó la plantilla (nunca un agente). */
  creadaPorUserId: string;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Item del catálogo (`GET /crews`): plantilla + recuentos. */
export interface CrewSummary extends CrewBase {
  versionesCount: number;
  instanciasCount: number;
}

/** Detalle (`GET /crews/:id`): plantilla + versiones con sus miembros. */
export interface CrewDetail extends CrewBase {
  versiones: CrewVersion[];
}

/** Instancia creada al instanciar una versión publicada. */
export interface CrewInstance {
  id: string;
  workspaceId: string;
  plantillaId: string;
  versionId: string;
  instanciadaPorUserId: string;
  orgUnitId: string | null;
  agentesCreados: string[];
  objetivosCreados: string[];
  createdAt: string;
}

/** Un permiso pendiente de conceder tras instanciar (por agente creado). */
export interface PermisoPendiente {
  agentId: string;
  rol: string;
  cargoId: string | null;
  skills: string[];
  conectoresSugeridos: unknown;
  politicaSugerida: unknown;
}

/** Respuesta de `POST /crews/:id/instantiate`. Instanciar NO concede acceso. */
export interface InstantiateResult {
  instancia: CrewInstance;
  agentesCreados: string[];
  permisosPendientes: PermisoPendiente[];
  aviso: string;
}

// ============================ Inputs (DTOs del backend) ============================

/** Crea una plantilla en BORRADOR. */
export interface CreateCrewInput {
  nombre: string;
  proposito?: string;
  procesoObjetivo?: string;
  orgUnitId?: string;
}

/** Un miembro declarativo de una versión. */
export interface CrewMemberInput {
  rol: string;
  cargoId?: string;
  nivelEsperado?: string;
  skills?: string[];
  conectoresSugeridos?: unknown[];
  politicaSugerida?: Record<string, unknown>;
  criteriosResultado?: Record<string, unknown>;
  delegaA?: string[];
}

/** Crea una versión nueva (append-only) con sus miembros. */
export interface CreateCrewVersionInput {
  definicion?: Record<string, unknown>;
  miembros: CrewMemberInput[];
}

/** Responsable humano por rol al instanciar. */
export interface CrewResponsableInput {
  rol: string;
  responsableUserId: string;
}

/** Instancia una versión PUBLICADA. */
export interface InstantiateCrewInput {
  versionId?: string;
  orgUnitId?: string;
  responsables?: CrewResponsableInput[];
}
