import { render, type TemplateContext } from '../../../../common/template/template.engine';
import type { ExecutionContext, NodeExecutor, NodeResult, WorkflowNode } from '../workflow.types';

export const templateContext = (ctx: ExecutionContext): TemplateContext => ({
  input: ctx.input,
  nodes: ctx.nodes,
  execution: { id: ctx.executionId },
});

/** Punto de entrada: expone la carga recibida (manual, webhook, cron o MCP). */
export class TriggerExecutor implements NodeExecutor {
  readonly type = 'trigger' as const;
  async execute(_: WorkflowNode, ctx: ExecutionContext): Promise<NodeResult> {
    return { output: ctx.input };
  }
}

/** Construye un objeto nuevo a partir de plantillas: config.output = { campo: "{{ ... }}" }. */
export class TransformExecutor implements NodeExecutor {
  readonly type = 'transform' as const;
  async execute(node: WorkflowNode, ctx: ExecutionContext): Promise<NodeResult> {
    return { output: render(node.config.output ?? {}, templateContext(ctx)) };
  }
}

/** Define la salida final del flujo (respuesta del webhook / tool MCP). */
export class OutputExecutor implements NodeExecutor {
  readonly type = 'output' as const;
  async execute(node: WorkflowNode, ctx: ExecutionContext): Promise<NodeResult> {
    return { output: render(node.config.output ?? '{{ input }}', templateContext(ctx)) };
  }
}

export const MAX_DELAY_MS = 5 * 60_000;

export class DelayExecutor implements NodeExecutor {
  readonly type = 'delay' as const;
  constructor(private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {}
  async execute(node: WorkflowNode): Promise<NodeResult> {
    const ms = Math.min(Math.max(Number(node.config.ms ?? 1000), 0), MAX_DELAY_MS);
    await this.sleep(ms);
    return { output: { waitedMs: ms } };
  }
}

export type Operator =
  'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'notContains' | 'exists' | 'empty' | 'regex';

export interface ConditionRule {
  left: string;
  operator: Operator;
  right?: unknown;
}

export function evaluateRule(rule: ConditionRule, ctx: TemplateContext): boolean {
  const left = render(rule.left, ctx);
  const right = render(rule.right, ctx);
  switch (rule.operator) {
    case 'eq':
      return left == right;
    case 'neq':
      return left != right;
    case 'gt':
      return Number(left) > Number(right);
    case 'gte':
      return Number(left) >= Number(right);
    case 'lt':
      return Number(left) < Number(right);
    case 'lte':
      return Number(left) <= Number(right);
    case 'contains':
      return Array.isArray(left) ? left.includes(right) : String(left ?? '').includes(String(right ?? ''));
    case 'notContains':
      return !(Array.isArray(left) ? left.includes(right) : String(left ?? '').includes(String(right ?? '')));
    case 'exists':
      return left !== undefined && left !== null;
    case 'empty':
      return left === undefined || left === null || left === '' || (Array.isArray(left) && left.length === 0);
    case 'regex': {
      const pattern = String(right ?? '');
      if (pattern.length > 200) throw new Error('Expresión regular demasiado larga');
      return new RegExp(pattern).test(String(left ?? ''));
    }
    default:
      throw new Error(`Operador desconocido: ${String(rule.operator)}`);
  }
}

/** Bifurca el flujo: las aristas con sourceHandle 'true' o 'false' definen cada rama. */
export class ConditionExecutor implements NodeExecutor {
  readonly type = 'condition' as const;
  async execute(node: WorkflowNode, ctx: ExecutionContext): Promise<NodeResult> {
    const rules = (node.config.rules ?? []) as ConditionRule[];
    const tctx = templateContext(ctx);
    const results = rules.map((r) => evaluateRule(r, tctx));
    const passed = node.config.combinator === 'or' ? results.some(Boolean) : results.every(Boolean);
    return { output: { result: passed, rules: results }, branch: passed ? 'true' : 'false' };
  }
}
