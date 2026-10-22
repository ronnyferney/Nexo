export type NodeType = 'trigger' | 'connector' | 'agent' | 'condition' | 'transform' | 'delay' | 'output';

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  position?: { x: number; y: number };
  config: Record<string, unknown> & {
    /** Comportamiento ante error: detener el flujo (por defecto) o continuar. */
    onError?: 'fail' | 'continue';
    /** Reintentos con backoff exponencial (0-5). */
    retries?: number;
  };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  /** Para nodos condición: 'true' | 'false'. */
  sourceHandle?: string;
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export type StepStatus = 'running' | 'succeeded' | 'failed' | 'skipped';

export interface StepLog {
  nodeId: string;
  nodeName: string;
  type: NodeType;
  status: StepStatus;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface ExecutionContext {
  workspaceId: string;
  executionId: string;
  input: Record<string, unknown>;
  nodes: Record<string, { output: unknown }>;
}

export interface NodeResult {
  output: unknown;
  /** Rama tomada (nodos condición). */
  branch?: string;
  /** Entrada efectiva tras renderizar plantillas (para la bitácora). */
  resolvedInput?: unknown;
}

export interface NodeExecutor {
  readonly type: NodeType;
  execute(node: WorkflowNode, ctx: ExecutionContext): Promise<NodeResult>;
}
