import { render } from '../../../../common/template/template.engine';
import type { ExecutionContext, NodeExecutor, NodeResult, SubworkflowRunner, WorkflowNode } from '../workflow.types';
import { templateContext } from './basic.executors';

/** Profundidad máxima de anidamiento de sub-flujos (la ejecución raíz es el nivel 0). */
export const MAX_SUBWORKFLOW_DEPTH = 5;
export const MAX_LOOP_ITEMS = 1000;
export const MAX_LOOP_CONCURRENCY = 10;

function targetWorkflowId(node: WorkflowNode, ctx: ExecutionContext): string {
  const id = render<unknown>(node.config.workflowId ?? '', templateContext(ctx));
  if (typeof id !== 'string' || !id.trim()) throw new Error('Seleccione el flujo a ejecutar');
  return id.trim();
}

function nextDepth(ctx: ExecutionContext): number {
  const depth = (ctx.depth ?? 0) + 1;
  if (depth > MAX_SUBWORKFLOW_DEPTH) {
    throw new Error(`Se superó la profundidad máxima de sub-flujos (${MAX_SUBWORKFLOW_DEPTH} niveles)`);
  }
  return depth;
}

const asInput = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v };

/** Ejecuta otro flujo del workspace en línea: config `{ workflowId, input }`; salida = salida del sub-flujo. */
export class SubworkflowExecutor implements NodeExecutor {
  readonly type = 'subworkflow' as const;
  constructor(private readonly runSubworkflow: SubworkflowRunner) {}

  async execute(node: WorkflowNode, ctx: ExecutionContext): Promise<NodeResult> {
    const workflowId = targetWorkflowId(node, ctx);
    const depth = nextDepth(ctx);
    const input = asInput(render<unknown>(node.config.input ?? '{{ input }}', templateContext(ctx)));
    const output = await this.runSubworkflow(workflowId, input, depth, ctx);
    return { output, resolvedInput: { workflowId, input } };
  }
}

/**
 * Bucle: config `{ items, workflowId, concurrency }`. `items` (plantilla) debe resolver a un arreglo; se ejecuta el
 * sub-flujo por elemento con `{ item, index }` y la concurrencia indicada (1–10). Salida `{ results, count }` en orden.
 * Si un elemento falla, no se inician más y el nodo falla indicando el índice.
 */
export class LoopExecutor implements NodeExecutor {
  readonly type = 'loop' as const;
  constructor(private readonly runSubworkflow: SubworkflowRunner) {}

  async execute(node: WorkflowNode, ctx: ExecutionContext): Promise<NodeResult> {
    const workflowId = targetWorkflowId(node, ctx);
    const items = render<unknown>(node.config.items ?? '', templateContext(ctx));
    if (!Array.isArray(items)) throw new Error('"items" debe resolver a un arreglo');
    if (items.length > MAX_LOOP_ITEMS) throw new Error(`El bucle admite como máximo ${MAX_LOOP_ITEMS} elementos`);
    const depth = nextDepth(ctx);
    const concurrency = Math.min(
      Math.max(Math.trunc(Number(node.config.concurrency ?? 1)) || 1, 1),
      MAX_LOOP_CONCURRENCY,
    );

    const results: unknown[] = new Array<unknown>(items.length);
    let cursor = 0;
    const state: { failure?: { index: number; message: string } } = {};
    // Conserva el fallo de menor índice (varios elementos pueden fallar en paralelo).
    const fail = (index: number, message: string) => {
      if (!state.failure || index < state.failure.index) state.failure = { index, message };
    };
    const worker = async () => {
      while (!state.failure && cursor < items.length) {
        if (ctx.signal?.aborted) throw new Error('Ejecución cancelada');
        const index = cursor++;
        try {
          results[index] = await this.runSubworkflow(workflowId, { item: items[index], index }, depth, ctx);
        } catch (err) {
          fail(index, (err as Error).message);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    if (state.failure) throw new Error(`El elemento ${state.failure.index} falló: ${state.failure.message}`);
    return {
      output: { results, count: items.length },
      resolvedInput: { workflowId, count: items.length, concurrency },
    };
  }
}
