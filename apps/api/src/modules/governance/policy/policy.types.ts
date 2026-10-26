/**
 * Tipos puros del motor de políticas (E6 · ADR 0013 D1). Sin dependencias de Nest ni Prisma: el álgebra de efectos se
 * prueba de forma aislada. El motor solo recibe HECHOS estructurados del `ActionContext`; nada de lo que "diga" el
 * modelo (que ya está aprobado, que es urgente) entra aquí ni altera la decisión.
 */

export type PolicyEffect = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';

/**
 * Tipos de acción con efecto externo configurados como sensibles por defecto (RF13/§5): si no hay política explícita
 * que los permita, se DENIEGAN (denegación por defecto). El resto de acciones sin política se permiten (compatibilidad
 * con el gate de bajo riesgo del runtime).
 */
export const SENSITIVE_ACTION_TYPES = [
  'PAYMENT',
  'BANK_ACCOUNT_CHANGE',
  'DATA_DELETE',
  'PERMISSION_CHANGE',
  'EXTERNAL_PUBLISH',
] as const;

/** Contexto de evaluación: solo hechos estructurados (ADR 0013 D1). */
export interface ActionContext {
  workspaceId: string;
  empresaId?: string | null;
  orgUnitId?: string | null;
  agentId?: string | null;
  /** Usuario solicitante. */
  userId?: string | null;
  /** Nivel jerárquico / cargo del solicitante (opcional). */
  nivel?: string | null;
  tipoAccion: string;
  /** Conector/recurso objetivo. */
  conectorId?: string | null;
  recurso?: string | null;
  operacion?: string | null;
  /** Proceso/flujo origen (para suspensión por PROCESO). */
  procesoId?: string | null;
  destinatarios?: string[];
  monto?: number | null;
  moneda?: string | null;
  /** Clasificación del dato del contenido (de DataGuard). */
  clasificacionDato?: string | null;
  /** Hora local 0-23 según la sede. */
  horaLocal?: number | null;
  /** Día de la semana 0-6 (0 = domingo) según la sede. */
  diaSemana?: number | null;
  /** Estado de presupuesto (de `budgets.chainState`): bolsa agotada con política de bloqueo. */
  presupuestoBloqueado?: boolean;
  /** Suspensión de emergencia activa que alcanza esta acción (de `Suspension`). */
  suspendido?: boolean;
  /** La verificación cruzada (ADR 0010) exige revisión humana para esta acción sensible. */
  requiereRevisionCruzada?: boolean;
}

/** Selector declarativo de una política. Un selector vacío aplica a toda acción de su `tipoAccion`. */
export interface PolicySelector {
  agentIds?: string[];
  userIds?: string[];
  orgUnitIds?: string[];
  conectorIds?: string[];
  recursos?: string[];
  operaciones?: string[];
  /** Coincidencia exacta o por sufijo con comodín inicial (p. ej. `*@dominio.com`). */
  destinatarios?: string[];
  montoMin?: number;
  montoMax?: number;
  clasificaciones?: string[];
  horario?: { desde?: number; hasta?: number; dias?: number[] };
}

/** Regla ACTIVA y vigente ya cargada para evaluar (el filtrado por estado/vigencia es del servicio Prisma). */
export interface PolicyRule {
  id: string;
  version: number;
  tipoAccion: string;
  empresaId?: string | null;
  selector: PolicySelector;
  efecto: PolicyEffect;
  requiredApprovals: number;
  allowSelfApproval: boolean;
}

/** Política/versión que disparó la decisión (se persiste en `DecisionPolitica.policyVersions`). */
export interface MatchedPolicy {
  policyId: string;
  version: number;
  efecto: PolicyEffect;
  requiredApprovals: number;
}

/** Nivel de riesgo (espejo PURO del enum Prisma `NivelRiesgo`, sin importar Prisma en el motor). */
export type NivelRiesgoCatalogo = 'BAJO' | 'MEDIO' | 'ALTO' | 'CRITICO' | 'DESCONOCIDO';

/**
 * Entrada EFECTIVA del catálogo de acciones sensibles (E6+ · punto 7) resuelta para el `tipoAccion` del contexto (la
 * entrada específica de empresa tiene prioridad sobre la de workspace). Es un INSUMO más del motor, ADITIVO a las
 * políticas de BD: sus exigencias de aprobación compiten con las reglas y gana el control más restrictivo. Si no hay
 * entrada (`undefined`), el comportamiento previo se conserva íntegro.
 */
export interface CatalogoAccionEfectivo {
  codigo: string;
  requiereAprobacion: boolean;
  requiereDobleAprobacion: boolean;
  nivelRiesgoPorDefecto: NivelRiesgoCatalogo;
}

export interface PolicyDecision {
  efecto: PolicyEffect;
  /** 0 para ALLOW/DENY; 1 o 2 para REQUIRE_APPROVAL (el más restrictivo de las reglas que ganaron). */
  requiredApprovals: number;
  /** Si se admite autoaprobación (solo relevante en REQUIRE_APPROVAL; false si cualquier regla ganadora lo prohíbe). */
  allowSelfApproval: boolean;
  /** Código auditable del motivo ganador. NUNCA razonamiento del modelo. */
  motivo: string;
  /** Políticas de BD que coincidieron (para auditoría). */
  matched: MatchedPolicy[];
  /** Nivel de riesgo por defecto del catálogo para esta acción (null si no hay entrada). Informativo/auditable. */
  nivelRiesgo?: NivelRiesgoCatalogo | null;
}

export interface EvaluateInput {
  ctx: ActionContext;
  rules: PolicyRule[];
  sensitiveActionTypes?: readonly string[];
  /** Entrada efectiva del catálogo de acciones sensibles para `ctx.tipoAccion`, si existe. */
  catalogo?: CatalogoAccionEfectivo | null;
}
