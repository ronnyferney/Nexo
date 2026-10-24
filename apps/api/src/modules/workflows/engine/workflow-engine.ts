import type {
  ExecutionContext,
  NodeExecutor,
  NodeType,
  StepLog,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from './workflow.types';
import { checkInput, inputErrorMessage } from './workflow-input';
import { validateDefinition } from './workflow.validator';

export interface EngineHooks {
  onStep?: (step: StepLog, all: StepLog[]) => void | Promise<void>;
  signal?: AbortSignal;
  /** Espera entre reintentos (inyectable para pruebas). */
  sleep?: (ms: number) => Promise<void>;
}

export interface EngineResult {
  status: 'SUCCEEDED' | 'FAILED';
  output: unknown;
  error?: string;
  steps: StepLog[];
}

export interface SingleNodeResult {
  ok: boolean;
  output: unknown;
  error: string | null;
  durationMs: number;
}

type NodeState = 'pending' | 'done' | 'skipped' | 'failed';

/**
 * Ejecuta un DAG por oleadas: los nodos cuyos predecesores están resueltos corren en paralelo.
 * Una arista está activa si su origen terminó y (si es condición) tomó esa rama;
 * un nodo sin aristas entrantes activas se marca como omitido.
 */
export class WorkflowEngine {
  private readonly executors: Map<NodeType, NodeExecutor>;

  constructor(executors: NodeExecutor[]) {
    this.executors = new Map(executors.map((e) => [e.type, e]));
  }

  async run(def: WorkflowDefinition, ctx: ExecutionContext, hooks: EngineHooks = {}): Promise<EngineResult> {
    const errors = validateDefinition(def);
    if (errors.length) return { status: 'FAILED', output: null, error: errors.join('; '), steps: [] };
    // Esquema de entrada declarado en el disparador: se comprueba antes del primer nodo (cron, sub-flujos y bucles
    // llegan aquí sin pasar por la API; las vías HTTP ya respondieron 400 antes de encolar).
    const inputError = inputErrorMessage(checkInput(def, ctx.input));
    if (inputError) return { status: 'FAILED', output: null, error: inputError, steps: [] };

    const sleep = hooks.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    if (hooks.signal && !ctx.signal) ctx.signal = hooks.signal;
    const incoming = new Map<string, WorkflowEdge[]>();
    for (const n of def.nodes) incoming.set(n.id, []);
    for (const e of def.edges) incoming.get(e.target)!.push(e);

    const state = new Map<string, NodeState>(def.nodes.map((n) => [n.id, 'pending']));
    const branch = new Map<string, string | undefined>();
    const steps: StepLog[] = [];
    let lastOutput: unknown = null;
    let explicitOutput: { value: unknown } | undefined;
    let failure: string | undefined;

    const emit = async (step: StepLog) => {
      const idx = steps.findIndex((s) => s.nodeId === step.nodeId);
      if (idx >= 0) steps[idx] = step;
      else steps.push(step);
      await hooks.onStep?.(step, steps);
    };

    const edgeActive = (e: WorkflowEdge) =>
      state.get(e.source) === 'done' && (!e.sourceHandle || e.sourceHandle === branch.get(e.source));

    while (!failure) {
      if (hooks.signal?.aborted) {
        failure = 'Ejecución cancelada';
        break;
      }
      const ready = def.nodes.filter(
        (n) => state.get(n.id) === 'pending' && incoming.get(n.id)!.every((e) => state.get(e.source) !== 'pending'),
      );
      if (!ready.length) break;

      const toRun: WorkflowNode[] = [];
      for (const node of ready) {
        const inEdges = incoming.get(node.id)!;
        if (inEdges.length && !inEdges.some(edgeActive)) {
          state.set(node.id, 'skipped');
          await emit({ nodeId: node.id, nodeName: node.name, type: node.type, status: 'skipped', attempts: 0 });
        } else {
          toRun.push(node);
        }
      }

      await Promise.all(
        toRun.map(async (node) => {
          const outcome = await this.runNode(node, ctx, emit, sleep);
          if (outcome.ok) {
            state.set(node.id, 'done');
            branch.set(node.id, outcome.branch);
            ctx.nodes[node.id] = { output: outcome.output };
            lastOutput = outcome.output;
            if (node.type === 'output') explicitOutput = { value: outcome.output };
          } else if (node.config.onError === 'continue') {
            state.set(node.id, 'done');
            ctx.nodes[node.id] = { output: { error: outcome.error } };
          } else {
            state.set(node.id, 'failed');
            failure ??= `Nodo "${node.name}" falló: ${outcome.error}`;
          }
        }),
      );
    }

    if (failure) return { status: 'FAILED', output: null, error: failure, steps };
    return { status: 'SUCCEEDED', output: explicitOutput ? explicitOutput.value : lastOutput, steps };
  }

  /**
   * Ejecuta un único nodo (sin reintentos ni aristas) con el contexto dado: base de "probar nodo" con datos fijados.
   * Los efectos del ejecutor son reales (un conector o agente sí se invoca).
   */
  async runSingle(node: WorkflowNode, ctx: ExecutionContext): Promise<SingleNodeResult> {
    const started = Date.now();
    const executor = this.executors.get(node.type);
    if (!executor) return { ok: false, output: null, error: `Sin ejecutor para "${node.type}"`, durationMs: 0 };
    try {
      const result = await executor.execute(node, ctx);
      return { ok: true, output: result.output, error: null, durationMs: Date.now() - started };
    } catch (err) {
      return { ok: false, output: null, error: (err as Error).message, durationMs: Date.now() - started };
    }
  }

  private async runNode(
    node: WorkflowNode,
    ctx: ExecutionContext,
    emit: (s: StepLog) => Promise<void>,
    sleep: (ms: number) => Promise<void>,
  ): Promise<{ ok: true; output: unknown; branch?: string } | { ok: false; error: string }> {
    const executor = this.executors.get(node.type);
    const startedAt = new Date().toISOString();
    const maxAttempts = 1 + Math.min(Math.max(Number(node.config.retries ?? 0), 0), 5);
    const base: StepLog = {
      nodeId: node.id,
      nodeName: node.name,
      type: node.type,
      status: 'running',
      attempts: 0,
      startedAt,
    };
    if (!executor) {
      await emit({
        ...base,
        status: 'failed',
        error: `Sin ejecutor para "${node.type}"`,
        finishedAt: new Date().toISOString(),
      });
      return { ok: false, error: `Sin ejecutor para "${node.type}"` };
    }

    let lastError = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await emit({ ...base, attempts: attempt });
      try {
        const result = await executor.execute(node, ctx);
        await emit({
          ...base,
          status: 'succeeded',
          attempts: attempt,
          input: result.resolvedInput,
          output: result.output,
          finishedAt: new Date().toISOString(),
        });
        return { ok: true, output: result.output, branch: result.branch };
      } catch (err) {
        lastError = (err as Error).message;
        if (attempt < maxAttempts) await sleep(Math.min(500 * 2 ** (attempt - 1), 10_000));
      }
    }
    await emit({
      ...base,
      status: 'failed',
      attempts: maxAttempts,
      error: lastError,
      finishedAt: new Date().toISOString(),
    });
    return { ok: false, error: lastError };
  }
}
