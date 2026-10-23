export type ConnectorType = 'REST' | 'SOAP' | 'GRAPHQL' | 'MCP' | 'DATABASE';
export type ExecutionStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type Role = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';

export interface Session {
  accessToken: string;
  workspaceId: string;
  role: Role;
}

export interface Me {
  id: string;
  email: string;
  name: string;
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
  _count?: { operations: number };
  updatedAt: string;
}

export interface AgentToolBinding {
  operationId: string;
  requiresApproval: boolean;
  toolName: string;
  operation: { id: string; key: string; name: string };
  connector: { id: string; name: string; type: ConnectorType };
}

export interface Agent {
  id: string;
  name: string;
  description?: string | null;
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
  tools?: AgentToolBinding[];
  skills?: import('./studio.models').AgentSkillRef[];
  knowledgeBases?: import('./studio.models').AgentKnowledgeRef[];
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

export interface OrgMemberCreateInput {
  email: string;
  name: string;
  role: Role;
  orgUnitId?: string;
  password?: string;
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
