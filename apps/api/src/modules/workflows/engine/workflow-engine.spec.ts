import {
  ConditionExecutor,
  DelayExecutor,
  OutputExecutor,
  TransformExecutor,
  TriggerExecutor,
} from './executors/basic.executors';
import { WorkflowEngine } from './workflow-engine';
import type { ExecutionContext, NodeExecutor, WorkflowDefinition } from './workflow.types';
import { validateDefinition } from './workflow.validator';

const ctx = (input: Record<string, unknown> = {}): ExecutionContext => ({
  workspaceId: 'w',
  executionId: 'e',
  input,
  nodes: {},
});
const noSleep = async () => undefined;

function engine(extra: NodeExecutor[] = []) {
  return new WorkflowEngine([
    new TriggerExecutor(),
    new TransformExecutor(),
    new OutputExecutor(),
    new ConditionExecutor(),
    new DelayExecutor(noSleep),
    ...extra,
  ]);
}

const branching: WorkflowDefinition = {
  nodes: [
    { id: 't', type: 'trigger', name: 'Inicio', config: {} },
    {
      id: 'c',
      type: 'condition',
      name: '¿Monto alto?',
      config: { rules: [{ left: '{{ input.amount }}', operator: 'gt', right: 1000 }] },
    },
    { id: 'hi', type: 'transform', name: 'Alto', config: { output: { tier: 'premium' } } },
    { id: 'lo', type: 'transform', name: 'Bajo', config: { output: { tier: 'standard' } } },
    {
      id: 'o',
      type: 'output',
      name: 'Salida',
      config: { output: { tier: "{{ nodes.hi.output.tier | default:'standard' }}" } },
    },
  ],
  edges: [
    { id: 'e1', source: 't', target: 'c' },
    { id: 'e2', source: 'c', target: 'hi', sourceHandle: 'true' },
    { id: 'e3', source: 'c', target: 'lo', sourceHandle: 'false' },
    { id: 'e4', source: 'hi', target: 'o' },
    { id: 'e5', source: 'lo', target: 'o' },
  ],
};

describe('WorkflowEngine', () => {
  it('toma la rama verdadera y omite la falsa', async () => {
    const r = await engine().run(branching, ctx({ amount: 5000 }));
    expect(r.status).toBe('SUCCEEDED');
    expect(r.output).toEqual({ tier: 'premium' });
    expect(r.steps.find((s) => s.nodeId === 'lo')?.status).toBe('skipped');
  });

  it('toma la rama falsa y une en el nodo de salida', async () => {
    const r = await engine().run(branching, ctx({ amount: 10 }));
    expect(r.output).toEqual({ tier: 'standard' });
    expect(r.steps.find((s) => s.nodeId === 'hi')?.status).toBe('skipped');
    expect(r.steps.find((s) => s.nodeId === 'o')?.status).toBe('succeeded');
  });

  it('reintenta y luego falla con el error del nodo', async () => {
    let calls = 0;
    const flaky: NodeExecutor = {
      type: 'connector',
      execute: async () => {
        calls++;
        throw new Error('timeout');
      },
    };
    const def: WorkflowDefinition = {
      nodes: [
        { id: 't', type: 'trigger', name: 'T', config: {} },
        { id: 'x', type: 'connector', name: 'API', config: { retries: 2 } },
      ],
      edges: [{ id: 'e', source: 't', target: 'x' }],
    };
    const r = await engine([flaky]).run(def, ctx(), { sleep: noSleep });
    expect(calls).toBe(3);
    expect(r.status).toBe('FAILED');
    expect(r.error).toContain('timeout');
  });

  it('continúa cuando onError = continue', async () => {
    const failing: NodeExecutor = { type: 'connector', execute: async () => Promise.reject(new Error('boom')) };
    const def: WorkflowDefinition = {
      nodes: [
        { id: 't', type: 'trigger', name: 'T', config: {} },
        { id: 'x', type: 'connector', name: 'API', config: { onError: 'continue' } },
        { id: 'o', type: 'output', name: 'O', config: { output: '{{ nodes.x.output.error }}' } },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'x' },
        { id: 'e2', source: 'x', target: 'o' },
      ],
    };
    const r = await engine([failing]).run(def, ctx());
    expect(r.status).toBe('SUCCEEDED');
    expect(r.output).toBe('boom');
  });

  it('ejecuta ramas paralelas', async () => {
    const def: WorkflowDefinition = {
      nodes: [
        { id: 't', type: 'trigger', name: 'T', config: {} },
        { id: 'a', type: 'transform', name: 'A', config: { output: { v: 1 } } },
        { id: 'b', type: 'transform', name: 'B', config: { output: { v: 2 } } },
        {
          id: 'o',
          type: 'output',
          name: 'O',
          config: { output: { a: '{{ nodes.a.output.v }}', b: '{{ nodes.b.output.v }}' } },
        },
      ],
      edges: [
        { id: '1', source: 't', target: 'a' },
        { id: '2', source: 't', target: 'b' },
        { id: '3', source: 'a', target: 'o' },
        { id: '4', source: 'b', target: 'o' },
      ],
    };
    expect((await engine().run(def, ctx())).output).toEqual({ a: 1, b: 2 });
  });
});

describe('validateDefinition', () => {
  it('detecta ciclos y disparadores faltantes', () => {
    const errors = validateDefinition({
      nodes: [
        { id: 'a', type: 'transform', name: 'A', config: {} },
        { id: 'b', type: 'transform', name: 'B', config: {} },
      ],
      edges: [
        { id: '1', source: 'a', target: 'b' },
        { id: '2', source: 'b', target: 'a' },
      ],
    });
    expect(errors.join(' ')).toMatch(/disparador/);
    expect(errors.join(' ')).toMatch(/ciclos/);
  });
});
