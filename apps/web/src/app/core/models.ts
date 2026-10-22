export type ConnectorType = 'REST' | 'SOAP' | 'GRAPHQL' | 'MCP';
export type ExecutionStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface Session {
  accessToken: string;
  workspaceId: string;
  role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
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
  tools?: AgentToolBinding[];
  _count?: { tools: number; conversations: number };
  updatedAt: string;
}

export interface ProviderInfo {
  id: string;
  label: string;
  configured: boolean;
  models: { id: string; label: string; description: string }[];
}

export type NodeType = 'trigger' | 'connector' | 'agent' | 'condition' | 'transform' | 'delay' | 'output';

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
  | { type: 'done'; conversationId: string; text: string; stopReason: string; turns: number }
  | { type: 'error'; message: string };
