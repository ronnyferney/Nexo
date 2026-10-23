import { ConditionExecutor, OutputExecutor, TransformExecutor, TriggerExecutor } from './executors/basic.executors';
import { LoopExecutor, MAX_SUBWORKFLOW_DEPTH, SubworkflowExecutor } from './executors/flow.executors';
import { WorkflowEngine } from './workflow-engine';
import type { ExecutionContext, NodeExecutor, SubworkflowRunner, WorkflowDefinition } from './workflow.types';
import { validateDefinition } from './workflow.validator';

const ctx = (input: Record<string, unknown> = {}): ExecutionContext => ({
  workspaceId: 'w',
  executionId: 'e',
  input,
  nodes: {},
});

/** Construye un motor cuyos sub-flujos se resuelven contra un catálogo en memoria y se ejecutan en línea. */
function harness(catalog: Record<string, WorkflowDefinition>, extra: NodeExecutor[] = []) {
  const calls: { workflowId: string; input: Record<string, unknown>; depth: number }[] = [];
  const runSub: SubworkflowRunner = async (workflowId, input, depth, parent) => {
    calls.push({ workflowId, input, depth });
    const def = catalog[workflowId];
    if (!def) throw new Error(`Sub-flujo no encontrado: ${workflowId}`);
    const r = await engine.run(def, { ...parent, workflowId, input, nodes: {}, depth });
    if (r.status === 'FAILED') throw new Error(r.error);
    return r.output;
  };
  const engine: WorkflowEngine = new WorkflowEngine([
    new TriggerExecutor(),
    new TransformExecutor(),
    new OutputExecutor(),
    new ConditionExecutor(),
    new SubworkflowExecutor(runSub),
    new LoopExecutor(runSub),
    ...extra,
  ]);
  return { engine, calls };
}

const trigger = { id: 't', type: 'trigger' as const, name: 'Inicio', config: {} };

const doubler: WorkflowDefinition = {
  nodes: [
    trigger,
    {
      id: 'o',
      type: 'output',
      name: 'Salida',
      config: { output: { value: '{{ input.item }}', index: '{{ input.index }}' } },
    },
  ],
  edges: [{ id: 'e1', source: 't', target: 'o' }],
};

const greeter: WorkflowDefinition = {
  nodes: [
    trigger,
    { id: 'o', type: 'output', name: 'Salida', config: { output: { saludo: 'Hola {{ input.name }}' } } },
  ],
  edges: [{ id: 'e1', source: 't', target: 'o' }],
};

const failing: WorkflowDefinition = {
  nodes: [
    trigger,
    {
      id: 'c',
      type: 'condition',
      name: 'Regex',
      config: { rules: [{ left: '{{ input.item }}', operator: 'regex', right: 'x'.repeat(300) }] },
    },
  ],
  edges: [{ id: 'e1', source: 't', target: 'c' }],
};

const parentWith = (node: WorkflowDefinition['nodes'][number]): WorkflowDefinition => ({
  nodes: [
    trigger,
    node,
    { id: 'out', type: 'output', name: 'Fin', config: { output: `{{ nodes.${node.id}.output }}` } },
  ],
  edges: [
    { id: 'e1', source: 't', target: node.id },
    { id: 'e2', source: node.id, target: 'out' },
  ],
});

describe('Nodo subworkflow', () => {
  it('ejecuta el sub-flujo en línea con la entrada mapeada y devuelve su salida', async () => {
    const { engine, calls } = harness({ greeter });
    const def = parentWith({
      id: 's',
      type: 'subworkflow',
      name: 'Saludar',
      config: { workflowId: 'greeter', input: { name: '{{ input.user }}' } },
    });
    const r = await engine.run(def, ctx({ user: 'Ana' }));
    expect(r.status).toBe('SUCCEEDED');
    expect(r.output).toEqual({ saludo: 'Hola Ana' });
    expect(calls).toEqual([{ workflowId: 'greeter', input: { name: 'Ana' }, depth: 1 }]);
  });

  it('falla si el sub-flujo falla', async () => {
    const { engine } = harness({ failing });
    const def = parentWith({ id: 's', type: 'subworkflow', name: 'Sub', config: { workflowId: 'failing' } });
    const r = await engine.run(def, ctx({ item: 'a' }));
    expect(r.status).toBe('FAILED');
    expect(r.error).toContain('Expresión regular demasiado larga');
  });

  it('exige seleccionar el flujo', async () => {
    const { engine } = harness({});
    const r = await engine.run(parentWith({ id: 's', type: 'subworkflow', name: 'Sub', config: {} }), ctx());
    expect(r.status).toBe('FAILED');
    expect(r.error).toContain('Seleccione el flujo');
  });

  it(`corta la recursión al superar ${MAX_SUBWORKFLOW_DEPTH} niveles`, async () => {
    const recursive = parentWith({ id: 's', type: 'subworkflow', name: 'Yo mismo', config: { workflowId: 'self' } });
    const { engine, calls } = harness({ self: recursive });
    const r = await engine.run(recursive, ctx());
    expect(r.status).toBe('FAILED');
    expect(r.error).toContain('profundidad máxima');
    expect(Math.max(...calls.map((c) => c.depth))).toBe(MAX_SUBWORKFLOW_DEPTH);
  });
});

describe('Nodo loop', () => {
  const loop = (config: Record<string, unknown>) =>
    parentWith({ id: 'l', type: 'loop', name: 'Bucle', config: { workflowId: 'doubler', ...config } });

  it('ejecuta el sub-flujo por elemento con { item, index } y conserva el orden', async () => {
    const { engine, calls } = harness({ doubler });
    const r = await engine.run(loop({ items: '{{ input.list }}', concurrency: 3 }), ctx({ list: ['a', 'b', 'c'] }));
    expect(r.status).toBe('SUCCEEDED');
    expect(r.output).toEqual({
      results: [
        { value: 'a', index: 0 },
        { value: 'b', index: 1 },
        { value: 'c', index: 2 },
      ],
      count: 3,
    });
    expect(calls.map((c) => c.input)).toEqual([
      { item: 'a', index: 0 },
      { item: 'b', index: 1 },
      { item: 'c', index: 2 },
    ]);
    expect(calls.every((c) => c.depth === 1)).toBe(true);
  });

  it('respeta la concurrencia máxima indicada', async () => {
    let active = 0;
    let peak = 0;
    const runSub: SubworkflowRunner = async (_id, input) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return input.index;
    };
    const engine = new WorkflowEngine([new TriggerExecutor(), new OutputExecutor(), new LoopExecutor(runSub)]);
    const items = Array.from({ length: 12 }, (_, i) => i);
    const r = await engine.run(loop({ items: '{{ input.items }}', concurrency: 4 }), ctx({ items }));
    expect(r.status).toBe('SUCCEEDED');
    expect((r.output as { results: number[] }).results).toEqual(items);
    expect(peak).toBe(4);

    peak = 0;
    await engine.run(loop({ items: '{{ input.items }}', concurrency: 50 }), ctx({ items }));
    expect(peak).toBeLessThanOrEqual(10);
  });

  it('devuelve resultados vacíos para un arreglo vacío', async () => {
    const { engine } = harness({ doubler });
    const r = await engine.run(loop({ items: '{{ input.list }}' }), ctx({ list: [] }));
    expect(r.output).toEqual({ results: [], count: 0 });
  });

  it('falla si items no es un arreglo o supera 1.000 elementos', async () => {
    const { engine } = harness({ doubler });
    const notArray = await engine.run(loop({ items: '{{ input.list }}' }), ctx({ list: 'abc' }));
    expect(notArray.status).toBe('FAILED');
    expect(notArray.error).toContain('debe resolver a un arreglo');
    const tooMany = await engine.run(loop({ items: '{{ input.list }}' }), ctx({ list: new Array(1001).fill(0) }));
    expect(tooMany.status).toBe('FAILED');
    expect(tooMany.error).toContain('1000');
  });

  it('falla indicando el índice del elemento que falló', async () => {
    const runSub: SubworkflowRunner = async (_id, input) => {
      if (input.index === 1) throw new Error('boom');
      return input.item;
    };
    const engine = new WorkflowEngine([new TriggerExecutor(), new OutputExecutor(), new LoopExecutor(runSub)]);
    const r = await engine.run(loop({ items: '{{ input.list }}' }), ctx({ list: ['a', 'b', 'c'] }));
    expect(r.status).toBe('FAILED');
    expect(r.error).toContain('El elemento 1 falló: boom');
  });
});

describe('WorkflowEngine.runSingle', () => {
  it('ejecuta un nodo con salidas fijadas de nodos previos', async () => {
    const { engine } = harness({});
    const node = {
      id: 'x',
      type: 'transform' as const,
      name: 'T',
      config: { output: { total: '{{ nodes.prev.output.n }}' } },
    };
    const r = await engine.runSingle(node, { ...ctx(), nodes: { prev: { output: { n: 7 } } } });
    expect(r).toMatchObject({ ok: true, output: { total: 7 }, error: null });
  });

  it('informa el error sin lanzar', async () => {
    const { engine } = harness({});
    const r = await engine.runSingle({ id: 's', type: 'subworkflow', name: 'S', config: {} }, ctx());
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Seleccione el flujo');
  });
});

describe('validateDefinition · nodos nuevos', () => {
  it('acepta subworkflow y loop', () => {
    expect(validateDefinition(loop())).toEqual([]);
    function loop(): WorkflowDefinition {
      return parentWith({ id: 'l', type: 'loop', name: 'B', config: { workflowId: 'x', items: '[]' } });
    }
  });
});
