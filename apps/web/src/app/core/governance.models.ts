/**
 * Tipos del gobierno de acciones (E6 · ADR 0013): aprobaciones, políticas y suspensiones. Reflejan el contrato del
 * módulo `apps/api/src/modules/governance` (controladores de `actions`). Los campos `Json` del backend llegan como
 * objetos/arreglos ya parseados; `Decimal` llega serializado como texto.
 */

export type PolicyEffect = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
export type PolicyStatus = 'BORRADOR' | 'ACTIVA' | 'ARCHIVADA';
export type ApprovalRisk = 'BAJO' | 'MEDIO' | 'ALTO';
export type ApprovalStatus =
  | 'PENDIENTE'
  | 'APROBADA'
  | 'RECHAZADA'
  | 'AJUSTE'
  | 'EJECUTADA'
  | 'CADUCADA'
  | 'INVALIDADA';
export type ApprovalDecisionKind = 'APRUEBA' | 'RECHAZA' | 'AJUSTE';
export type SuspensionScope = 'AGENTE' | 'PROCESO' | 'CONECTOR' | 'ORGANIZACION';

export const POLICY_EFFECTS: readonly PolicyEffect[] = ['ALLOW', 'REQUIRE_APPROVAL', 'DENY'];
export const POLICY_STATUSES: readonly PolicyStatus[] = ['BORRADOR', 'ACTIVA', 'ARCHIVADA'];
export const APPROVAL_RISKS: readonly ApprovalRisk[] = ['BAJO', 'MEDIO', 'ALTO'];
export const APPROVAL_STATUSES: readonly ApprovalStatus[] = [
  'PENDIENTE',
  'APROBADA',
  'RECHAZADA',
  'AJUSTE',
  'EJECUTADA',
  'CADUCADA',
  'INVALIDADA',
];
export const SUSPENSION_SCOPES: readonly SuspensionScope[] = ['AGENTE', 'PROCESO', 'CONECTOR', 'ORGANIZACION'];

/** Firma de una decisión registrada sobre una aprobación. */
export interface DecisionRecord {
  actorUserId: string;
  decision: ApprovalDecisionKind;
  comentario?: string | null;
  at: string;
}

/** Identidad de ejecución almacenada en la aprobación. */
export interface IdentidadEjec {
  agentId?: string | null;
  agentVersionId?: string | null;
  herramienta?: string | null;
}

/** Aprobación persistente (RF12). El `contentHash` fija el contenido aprobado; recomputarlo al ejecutar detecta cambios. */
export interface Aprobacion {
  id: string;
  workspaceId: string;
  empresaId?: string | null;
  tareaId?: string | null;
  proposito?: string | null;
  tipoAccion: string;
  operacion: Record<string, unknown>;
  identidadEjec: IdentidadEjec;
  destinatarios: string[];
  contenido: Record<string, unknown>;
  adjuntos?: unknown[] | null;
  contentHash: string;
  importe?: string | number | null;
  moneda?: string | null;
  riesgo: ApprovalRisk;
  evidencia?: unknown;
  requiredApprovals: number;
  allowSelfApproval: boolean;
  solicitanteUserId?: string | null;
  solicitanteAgentId?: string | null;
  orgUnitId?: string | null;
  decisiones: DecisionRecord[];
  estado: ApprovalStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

/** Política versionada (RF11). Un cambio archiva la versión vigente y crea otra. */
export interface Politica {
  id: string;
  workspaceId: string;
  empresaId?: string | null;
  nombre: string;
  tipoAccion: string;
  selector: PolicySelector;
  efecto: PolicyEffect;
  requiredApprovals: number;
  allowSelfApproval: boolean;
  version: number;
  vigenteDesde: string;
  vigenteHasta?: string | null;
  estado: PolicyStatus;
  createdAt: string;
  updatedAt: string;
}

/** Selector declarativo de una política. Un selector vacío aplica a toda acción de su `tipoAccion`. */
export interface PolicySelector {
  agentIds?: string[];
  userIds?: string[];
  orgUnitIds?: string[];
  conectorIds?: string[];
  recursos?: string[];
  operaciones?: string[];
  destinatarios?: string[];
  montoMin?: number;
  montoMax?: number;
  clasificaciones?: string[];
  horario?: { desde?: number; hasta?: number; dias?: number[] };
}

/** Política/versión que disparó una decisión registrada. */
export interface MatchedPolicy {
  policyId: string;
  version: number;
  efecto: PolicyEffect;
  requiredApprovals: number;
}

/** Decisión del motor de políticas, inmutable (auditoría). */
export interface DecisionPolitica {
  id: string;
  workspaceId: string;
  tipoAccion: string;
  actionContextHash: string;
  efecto: PolicyEffect;
  requiredApprovals: number;
  policyVersions: MatchedPolicy[];
  motivo: string;
  aprobacionId?: string | null;
  createdAt: string;
}

/** Suspensión de emergencia (RF13). */
export interface Suspension {
  id: string;
  workspaceId: string;
  alcance: SuspensionScope;
  targetId: string;
  activa: boolean;
  motivo: string;
  actorUserId?: string | null;
  createdAt: string;
  reactivadaPor?: string | null;
  reactivadaMotivo?: string | null;
  reactivadaAt?: string | null;
}

// ---------- Entradas ----------

export interface PoliticaInput {
  nombre: string;
  tipoAccion: string;
  empresaId?: string | null;
  selector?: PolicySelector;
  efecto: PolicyEffect;
  requiredApprovals?: number;
  allowSelfApproval?: boolean;
  estado?: PolicyStatus;
}

export interface SuspensionInput {
  alcance: SuspensionScope;
  targetId: string;
  motivo: string;
}

export interface ApprovalDecisionInput {
  decision: ApprovalDecisionKind;
  comentario?: string;
}
