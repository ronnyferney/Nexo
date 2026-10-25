export type ConnectorType = 'REST' | 'SOAP' | 'GRAPHQL' | 'MCP' | 'DATABASE';
export type ExecutionStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type Role = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';

/** Sesión de la web: el token viaja en la cookie HttpOnly (M6), nunca en el estado de la página. */
export interface Session {
  workspaceId: string;
  role: Role;
}

export interface Me {
  id: string;
  email: string;
  name: string;
  /** Null = correo sin verificar (C1): no puede unirse a otros workspaces sin una invitación. */
  emailVerifiedAt?: string | null;
  activeWorkspaceId: string;
  memberships: { role: string; workspace: { id: string; name: string; slug: string } }[];
}

export interface Operation {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  inputSchema: Record<string, unknown>;
  definition: Record<string, unknown>;
}

export interface Connector {
  id: string;
  name: string;
  description?: string | null;
  type: ConnectorType;
  config: Record<string, unknown>;
  auth: Record<string, unknown>;
  operations?: Operation[];
  /** Definición del catálogo de la que se instaló (ADR 0005 D2). */
  catalogId?: string | null;
  /** Secretos de la bóveda que el conector puede resolver; solo un ADMIN los fija (auditoría A4). */
  allowedSecrets?: string[];
  /** Secretos que referencian la configuración, la autenticación y las operaciones (solo en el detalle). */
  secretReferences?: string[];
  /** Referencias sin permiso: fallan al ejecutar hasta que un ADMIN las permita (solo en el detalle). */
  blockedSecrets?: string[];
  _count?: { operations: number };
  /** Cuenta conectada de un conector OAuth (el buzón/identidad que usan los agentes). `null` si no es OAuth. */
  account?: { label: string | null; connected: boolean } | null;
  updatedAt: string;
}

export interface AgentToolBinding {
  operationId: string;
  requiresApproval: boolean;
  toolName: string;
  operation: { id: string; key: string; name: string };
  connector: { id: string; name: string; type: ConnectorType };
}

// ===== Política de enrutamiento multi-modelo (ADR 0010 D2) =====
// Espeja `RoutingPolicyDto` del backend (`apps/api/.../agents/dto/agent.dto.ts`). JSON validado; nunca `eval`.

/** Cómo desempatar entre candidatos válidos. */
export type RoutingObjective = 'cost' | 'quality' | 'balanced';
/** Capacidad declarada del modelo en el catálogo (`LlmModel.specialties`). */
export type RoutingSpecialty = 'CODE' | 'REASONING' | 'VISION' | 'FAST' | 'GENERAL';
/** Reutiliza los niveles de precio del catálogo (`ModelTier`). */
export type RoutingTier = ModelTier;

/** Condición de una regla: la primera cuyo `when` encaja gana; `when` vacío aplica siempre. */
export interface RoutingRuleWhen {
  capability?: RoutingSpecialty;
  hasImages?: boolean;
  minContextTokens?: number;
}

/** Preferencia que una regla empuja al frente de los candidatos. */
export interface RoutingRulePrefer {
  specialties?: RoutingSpecialty[];
  tier?: RoutingTier;
  /** Referencias `"<providerId>:<modelId>"` preferidas. */
  models?: string[];
}

export interface RoutingRule {
  when: RoutingRuleWhen;
  prefer: RoutingRulePrefer;
}

/** `Agent.routing`; `null` = comportamiento actual (principal + `fallbackModels`). */
export interface RoutingPolicy {
  objective: RoutingObjective;
  /** Reglas de preferencia en orden de prioridad (máx. 20). */
  rules?: RoutingRule[];
  /** Tope de intentos totales por tarea (1..5, por defecto 3). */
  maxCandidates?: number;
  /**
   * Verificación cruzada (ADR 0010 D4, Fase 3): se construye en paralelo y NO se edita en este editor.
   * Se preserva tal cual venga del servidor al guardar. Forma libre a propósito mientras no exista su contrato.
   */
  verify?: unknown;
}

export interface Agent {
  id: string;
  name: string;
  description?: string | null;
  /** Nombre de un ícono del mapa de `IconComponent`; `null`/ausente ⇒ `bot` por defecto. */
  icon?: string | null;
  provider: string;
  model: string;
  systemPrompt: string;
  effort: Effort;
  maxTurns: number;
  /** Unidad organizacional a la que se imputa el consumo cuando el agente corre sin usuario. */
  costCenterId: string | null;
  /** Perfil estructurado (ADR 0003 D2); la API puede devolver campos ausentes. */
  profile?: Partial<import('./studio.models').AgentProfile> | null;
  /** Cadena de respaldo `"<providerId>:<modelId>"`, máx. 3 (ADR 0003 D1). */
  fallbackModels?: string[];
  /** Política de enrutamiento multi-modelo (ADR 0010); `null`/ausente = principal + `fallbackModels`. */
  routing?: RoutingPolicy | null;
  tools?: AgentToolBinding[];
  skills?: import('./studio.models').AgentSkillRef[];
  knowledgeBases?: import('./studio.models').AgentKnowledgeRef[];
  /** Bases asignadas con su permiso de escritura (auto-aprendizaje). */
  knowledge?: import('./studio.models').AgentKnowledgeEntry[];
  examplesCount?: number;
  /** Meta de calidad del bucle de mejora (0–1, por defecto 0.85; ADR 0004). */
  targetScore?: number;
  /** Visibilidad, dueño y permiso efectivo del usuario (ADR 0007); opcionales mientras la API no los devuelva. */
  visibility?: import('./access.models').AgentVisibility;
  ownerId?: string | null;
  owner?: { id: string; name: string } | null;
  myPermission?: import('./access.models').AgentPermission;
  /** Solo para quien tiene EDIT. */
  shares?: import('./access.models').AgentShare[];
  /** Ciclo de lanzamiento (ADR 0006 D4). */
  launchStatus?: import('./access.models').LaunchStatus;
  launchedAt?: string | null;
  launchOverrideReason?: string | null;
  _count?: { tools: number; conversations: number };
  updatedAt: string;
}

// ===== Gobierno de IA (ADR 0002) =====

export type LlmKind = 'ANTHROPIC' | 'OPENAI_COMPATIBLE' | 'MOCK';
export type ModelTier = 'PREMIUM' | 'STANDARD' | 'ECONOMY';
export type BudgetPeriod = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export type BudgetPolicy = 'BLOCK' | 'DOWNGRADE' | 'ALERT_ONLY';
export type UsageGroupBy = 'orgUnit' | 'model' | 'agent' | 'user' | 'day';

/** Modelo del catálogo (`GET /llm/catalog`). Precios en USD por millón de tokens. */
export interface CatalogModel {
  id: string;
  label: string;
  description: string;
  tier: ModelTier;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

/** Entrada del catálogo `GET /llm/catalog` (alias `GET /agents/providers`). Solo conexiones y modelos habilitados. */
export interface ProviderInfo {
  id: string;
  label: string;
  kind: LlmKind;
  system: boolean;
  configured: boolean;
  models: CatalogModel[];
}
export type LlmCatalogEntry = ProviderInfo;

/** `GET /org/units` — unidades para selectores (cualquier rol). */
export interface OrgUnitOption {
  id: string;
  name: string;
  parentId: string | null;
}

export interface MyBudgetEntry {
  orgUnitId: string;
  orgUnitName: string;
  period: string;
  periodKey: string;
  limitUsd: number;
  spentUsd: number;
  pct: number;
  policy: BudgetPolicy;
}

/** `GET /me/usage` — presupuestos de la cadena unidad del usuario → raíz y consumo propio del mes. */
export interface MyUsage {
  orgUnit: { id: string; name: string };
  budgets: MyBudgetEntry[];
  me: { costUsd: number; calls: number; inputTokens: number; outputTokens: number; since: string };
}

export interface LlmModel {
  id: string;
  connectionId: string;
  modelId: string;
  label: string;
  tier: ModelTier;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  cacheReadUsdPerMTok: number | null;
  enabled: boolean;
}

export interface LlmConnection {
  id: string;
  name: string;
  kind: LlmKind;
  baseUrl: string | null;
  hasApiKey: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  models: LlmModel[];
}

export interface LlmConnectionInput {
  name: string;
  kind: LlmKind;
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
}

/** `PATCH /admin/llm/connections/:id` — parcial; `apiKey` solo si se envía; `baseUrl: null` la elimina. */
export type LlmConnectionUpdateInput = Partial<Omit<LlmConnectionInput, 'baseUrl'>> & { baseUrl?: string | null };

export interface LlmModelInput {
  modelId: string;
  label: string;
  tier: ModelTier;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  cacheReadUsdPerMTok?: number;
  enabled?: boolean;
}

/** `GET /admin/org/units`. */
export interface OrgUnit {
  id: string;
  name: string;
  code: string | null;
  parentId: string | null;
  allowedModels: string[];
  memberCount: number;
  isRoot: boolean;
}

export interface OrgUnitCreateInput {
  name: string;
  code?: string;
  parentId: string;
}

/** `code: null` elimina el código. */
export interface OrgUnitUpdateInput {
  name?: string;
  code?: string | null;
  parentId?: string;
  allowedModels?: string[];
}

export interface OrgMember {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  orgUnitId: string;
  createdAt: string;
}

/** Invitación a un miembro: la cuenta y la contraseña las crea la persona al aceptar el enlace. */
export interface OrgMemberCreateInput {
  email: string;
  name?: string;
  role: Role;
  orgUnitId?: string;
}

export type InvitationStatus = 'PENDING' | 'EXPIRED' | 'ACCEPTED' | 'REVOKED';

export interface Invitation {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  orgUnitId: string | null;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  invitedBy: { name: string; email: string } | null;
}

/** Respuesta al invitar: `acceptUrl` se muestra una sola vez (la API solo guarda su hash). */
export interface InvitationCreated {
  invitation: Invitation;
  acceptUrl: string;
  emailSent: boolean;
}

export interface InvitationPreview {
  workspaceName: string;
  /** Correo enmascarado (`m***@empresa.com`). */
  email: string;
  name: string | null;
  role: Role;
  expiresAt: string;
  accountExists: boolean;
  /** La cuenta existe y está verificada: hay que iniciar sesión con ella para aceptar. */
  requiresLogin: boolean;
}

export interface InvitationAccepted extends Session {
  userId: string;
  membershipId: string;
  sessionsRevoked: boolean;
  /** API keys revocadas al tomar el control de una cuenta sin verificar (C1). */
  apiKeysRevoked?: number;
}

/** Resultado de `POST /auth/password/reset`: la contraseña cambió y todas las sesiones se cerraron. */
export interface PasswordResetResult {
  reset: true;
  sessionsRevoked: true;
  apiKeysRevoked: number;
}

/** Alcances de una API key (B3). */
export type ApiKeyScope = 'read' | 'write' | 'agents:run' | 'workflows:run' | 'connectors:invoke' | 'mcp';
export type ApiKeyRole = 'VIEWER' | 'EDITOR' | 'ADMIN';
export type ApiKeyExpiration = '30d' | '90d' | '365d' | 'never';

/** `GET /workspace/api-keys`. */
export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  /** `*` = alcance completo de una clave anterior a B3. */
  scopes: string[];
  role: Role;
  legacy: boolean;
  expiresAt: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  rotationSuggested: boolean;
  revokedAt: string | null;
  revokedReason: 'manual' | 'account_takeover' | null;
  lastUsedAt: string | null;
  createdAt: string;
  createdBy: { name: string; email: string } | null;
}

export interface ApiKeyCreateInput {
  name: string;
  scopes: ApiKeyScope[];
  role: ApiKeyRole;
  expiration: ApiKeyExpiration;
}

/** Respuesta de `POST /workspace/api-keys`: la llave completa solo llega aquí. */
export interface ApiKeyCreated extends ApiKey {
  key: string;
}

export interface AuthConfig {
  registrationMode: 'open' | 'invite_only';
  mailEnabled: boolean;
}

export interface BudgetConfig {
  period: BudgetPeriod;
  limitUsd: number;
  policy: BudgetPolicy;
  alertThresholds: number[];
  downgradeProviderId: string | null;
  downgradeModel: string | null;
}

/** `GET /admin/budgets` — una fila por unidad. */
export interface BudgetRow {
  orgUnitId: string;
  orgUnitName: string;
  parentId: string | null;
  budget: BudgetConfig | null;
  periodKey: string | null;
  spentUsd: number;
  pct: number | null;
}

export interface BudgetInput {
  period: BudgetPeriod;
  limitUsd: number;
  policy: BudgetPolicy;
  alertThresholds?: number[];
  downgradeProviderId?: string;
  downgradeModel?: string;
}

export interface UsageGroup {
  key: string;
  label: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

/** `GET /admin/usage/summary`. */
export interface UsageSummary {
  from: string;
  to: string;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  groups: UsageGroup[];
}

export interface UsageRecord {
  id: string;
  createdAt: string;
  source: string;
  model: string;
  providerId: string;
  orgUnitName: string;
  userName: string | null;
  agentName: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface UsageRecordsPage {
  items: UsageRecord[];
  nextCursor: string | null;
}

/** `GET /admin/alerts` (últimas 100). */
export interface BudgetAlert {
  id: string;
  orgUnitId: string;
  orgUnitName: string;
  periodKey: string;
  threshold: number;
  spentUsd: number;
  limitUsd: number;
  createdAt: string;
}

/** Consumo de un turno de chat (evento SSE `done`). */
export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export type NodeType =
  | 'trigger'
  | 'connector'
  | 'agent'
  | 'condition'
  | 'transform'
  | 'delay'
  | 'output'
  | 'subworkflow'
  | 'loop';

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  position: { x: number; y: number };
  config: Record<string, any>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string | null;
  active: boolean;
  schedule?: string | null;
  webhookToken?: string;
  version: number;
  /** Flujo que se dispara si una ejecución de este falla (ADR 0003 D6.1). */
  errorWorkflowId: string | null;
  definition?: { nodes: WorkflowNode[]; edges: WorkflowEdge[] };
  _count?: { executions: number };
  updatedAt: string;
}

export interface StepLog {
  nodeId: string;
  nodeName: string;
  type: NodeType;
  status: 'running' | 'succeeded' | 'failed' | 'skipped';
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface Execution {
  id: string;
  status: ExecutionStatus;
  trigger: string;
  input?: unknown;
  output?: unknown;
  error?: string | null;
  steps?: StepLog[];
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  workflow?: { id: string; name: string };
}

// ===== Historial de tareas del agente (RX-14) =====

export type AgentRunStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export type AgentRunSource = 'CHAT' | 'WORKFLOW' | 'MCP' | 'ROUTINE' | 'EVAL' | 'COPILOT';

/** Una tarea ejecutada por un agente (`GET /agent-runs`). Muchas métricas pueden venir en `null`. */
export interface AgentRun {
  id: string;
  agentId: string;
  agentName: string;
  source: AgentRunSource;
  status: AgentRunStatus;
  error: string | null;
  model: string | null;
  providerId: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  ttftMs: number | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  conversationId: string | null;
  executionId: string | null;
}

/** Página de `GET /agent-runs`: paginación por cursor, sin total. */
export interface AgentRunsPage {
  items: AgentRun[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** `GET /health/version` (público): versión desplegada de la plataforma, para soporte. */
export interface BuildInfo {
  version: string;
  commit: string | null;
  builtAt: string | null;
}

export interface Stats {
  connectors: number;
  agents: number;
  workflows: number;
  executionsLast7d: number;
  failedLast7d: number;
}

export type AgentStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; output: string; isError: boolean }
  | { type: 'notice'; message: string }
  | {
      type: 'done';
      conversationId: string;
      text: string;
      stopReason: string;
      turns: number;
      usage: TurnUsage;
      model: string;
      providerId: string;
    }
  | { type: 'error'; message: string };
