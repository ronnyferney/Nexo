import { TransformExecutor, TriggerExecutor } from './executors/basic.executors';
import { WorkflowEngine } from './workflow-engine';
import {
  checkInput,
  declaredInputFields,
  inputErrorMessage,
  inputFieldOfExpression,
  inputWarnings,
  referencedInputFields,
} from './workflow-input';
import type { WorkflowDefinition, WorkflowNode } from './workflow.types';
import { validateDefinition } from './workflow.validator';

const trigger = (config: WorkflowNode['config'] = {}): WorkflowNode => ({
  id: 'trigger',
  type: 'trigger',
  name: 'Inicio',
  config,
});

/** Flujo del caso real: un conector de clima con `{{ input.latitude }}` y `{{ input.longitude }}`. */
const weather = (triggerConfig: WorkflowNode['config'] = {}): WorkflowDefinition => ({
  nodes: [
    trigger(triggerConfig),
    {
      id: 'clima_actual',
      type: 'connector',
      name: 'Clima actual',
      config: {
        operationId: 'op',
        input: {
          latitude: '{{ input.latitude }}',
          longitude: '{{input["longitude"]}}',
          units: '{{ input.units | default:"metric" }}',
        },
      },
    },
    {
      id: 'resumen',
      type: 'transform',
      name: 'Resumen',
      config: {
        output: { texto: 'Clima en {{ input.ciudad.nombre | upper }} ({{ input.latitude }})', todo: '{{ input }}' },
      },
    },
    {
      id: 'cond',
      type: 'condition',
      name: '¿Alerta?',
      config: {
        rules: [{ left: '{{ nodes.clima_actual.output.temp }}', operator: 'gt', right: '{{ input[umbral] }}' }],
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'trigger', target: 'clima_actual' },
    { id: 'e2', source: 'clima_actual', target: 'resumen' },
    { id: 'e3', source: 'resumen', target: 'cond' },
  ],
});

describe('Análisis estático de la entrada del flujo', () => {
  it('extrae el campo de primer nivel de input en sus distintas formas', () => {
    expect(inputFieldOfExpression('input.latitude')).toEqual({ name: 'latitude', hasDefault: false });
    expect(inputFieldOfExpression(' input.ciudad.nombre | upper ')).toEqual({ name: 'ciudad', hasDefault: false });
    expect(inputFieldOfExpression('input[umbral]')).toEqual({ name: 'umbral', hasDefault: false });
    expect(inputFieldOfExpression('input["longitude"]')).toEqual({ name: 'longitude', hasDefault: false });
    expect(inputFieldOfExpression("input.units | default:'metric'")).toEqual({ name: 'units', hasDefault: true });
    expect(inputFieldOfExpression('input')).toBeNull();
    expect(inputFieldOfExpression('input | json')).toBeNull();
    expect(inputFieldOfExpression('nodes.http.output.input')).toBeNull();
    expect(inputFieldOfExpression('input.__proto__')).toBeNull();
    expect(inputFieldOfExpression("'input.literal'")).toBeNull();
  });

  it('lista los campos que usan las plantillas de los nodos, con sus nodos y si tienen valor por defecto', () => {
    const refs = referencedInputFields(weather());
    expect(refs).toEqual([
      { name: 'latitude', optional: false, nodeIds: ['clima_actual', 'resumen'] },
      { name: 'longitude', optional: false, nodeIds: ['clima_actual'] },
      { name: 'units', optional: true, nodeIds: ['clima_actual'] },
      { name: 'ciudad', optional: false, nodeIds: ['resumen'] },
      { name: 'umbral', optional: false, nodeIds: ['cond'] },
    ]);
  });

  it('un mismo campo usado con y sin default se considera esperado', () => {
    const def: WorkflowDefinition = {
      nodes: [
        trigger(),
        { id: 'a', type: 'transform', name: 'A', config: { output: { x: "{{ input.x | default:'1' }}" } } },
        { id: 'b', type: 'transform', name: 'B', config: { output: { x: '{{ input.x }}' } } },
      ],
      edges: [],
    };
    expect(referencedInputFields(def)).toEqual([{ name: 'x', optional: false, nodeIds: ['a', 'b'] }]);
  });

  it('tolera definiciones vacías o históricas sin config', () => {
    expect(referencedInputFields(null)).toEqual([]);
    expect(
      referencedInputFields({ nodes: [{ id: 'x', type: 'output', name: 'x' } as WorkflowNode], edges: [] }),
    ).toEqual([]);
    expect(declaredInputFields({ nodes: [trigger()], edges: [] })).toBeNull();
  });
});

describe('Comprobación de la entrada', () => {
  it('sin esquema declarado: los campos faltantes de las plantillas son solo advertencias', () => {
    const check = checkInput(weather(), { latitude: 4.6, ciudad: { nombre: 'Bogotá' } });
    expect(check.missing).toEqual([]);
    expect(check.invalid).toEqual([]);
    expect(check.missingReferenced).toEqual(['longitude', 'umbral']);
    expect(inputErrorMessage(check)).toBeNull();
    expect(inputWarnings(check)[0]).toContain('longitude, umbral');
  });

  it('con esquema: un requerido ausente, nulo o vacío bloquea con un mensaje en español', () => {
    const def = weather({
      inputFields: [
        { name: 'latitude', type: 'number', required: true },
        { name: 'longitude', type: 'number', required: true },
        { name: 'ciudad', type: 'object' },
      ],
    });
    const check = checkInput(def, { latitude: null, longitude: '' });
    expect(check.missing).toEqual(['latitude', 'longitude']);
    expect(inputErrorMessage(check)).toBe('Faltan datos de entrada requeridos: latitude, longitude.');
    // El campo opcional declarado no se reclama; `umbral` (usado y no declarado) sigue como advertencia.
    expect(check.missingReferenced).toEqual(['umbral']);
  });

  it('con esquema: valida el tipo de los campos presentes, requeridos u opcionales', () => {
    const def = weather({
      inputFields: [
        { name: 'latitude', type: 'number', required: true },
        { name: 'ciudad', type: 'object' },
        { name: 'tags', type: 'array' },
        { name: 'activo', type: 'boolean' },
        { name: 'libre' },
      ],
    });
    const check = checkInput(def, { latitude: '4.6', ciudad: [], tags: [], activo: true, libre: 3 });
    expect(check.missing).toEqual([]);
    expect(check.invalid).toEqual([
      { name: 'latitude', expected: 'number' },
      { name: 'ciudad', expected: 'object' },
    ]);
    expect(inputErrorMessage(check)).toBe(
      'El dato de entrada "latitude" debe ser número. El dato de entrada "ciudad" debe ser objeto.',
    );
    expect(inputErrorMessage(checkInput(def, { latitude: 4.6 }))).toBeNull();
  });

  it('no lee propiedades heredadas del prototipo como datos presentes', () => {
    const def = weather({ inputFields: [{ name: 'toString', required: true }] });
    expect(checkInput(def, {}).missing).toEqual(['toString']);
  });
});

describe('Validación del esquema declarado en el disparador', () => {
  const withFields = (inputFields: unknown) => validateDefinition({ nodes: [trigger({ inputFields })], edges: [] });

  it('acepta flujos sin esquema y esquemas válidos', () => {
    expect(validateDefinition({ nodes: [trigger()], edges: [] })).toEqual([]);
    expect(withFields([{ name: 'latitude', type: 'number', required: true, description: 'Grados' }])).toEqual([]);
  });

  it('rechaza nombres inválidos, duplicados, tipos desconocidos y formas incorrectas', () => {
    expect(withFields('latitude')).toEqual(['"inputFields" del disparador debe ser una lista']);
    expect(withFields([{ name: 'con espacio' }])[0]).toContain('nombre inválido');
    expect(withFields([{ name: '__proto__' }])[0]).toContain('nombre inválido');
    expect(withFields([{ name: 'a' }, { name: 'a' }])).toEqual(['Campo de entrada duplicado: "a"']);
    expect(withFields([{ name: 'a', type: 'fecha' }])[0]).toContain('tipo desconocido');
    expect(withFields([{ name: 'a', required: 'sí' }])[0]).toContain('"required"');
    expect(withFields(Array.from({ length: 51 }, (_, i) => ({ name: `f${i}` })))[0]).toContain('como máximo 50');
  });
});

describe('Motor: entrada declarada antes del primer nodo', () => {
  const engine = new WorkflowEngine([new TriggerExecutor(), new TransformExecutor()]);
  const def: WorkflowDefinition = {
    nodes: [
      trigger({ inputFields: [{ name: 'nombre', type: 'string', required: true }] }),
      { id: 'saludo', type: 'transform', name: 'Saludo', config: { output: { texto: 'Hola {{ input.nombre }}' } } },
    ],
    edges: [{ id: 'e1', source: 'trigger', target: 'saludo' }],
  };
  const ctx = (input: Record<string, unknown>) => ({ workspaceId: 'w', executionId: 'e', input, nodes: {} });

  it('falla sin ejecutar ningún nodo cuando falta un requerido (cron, sub-flujos y bucles)', async () => {
    const r = await engine.run(def, ctx({}));
    expect(r.status).toBe('FAILED');
    expect(r.error).toBe('Faltan datos de entrada requeridos: nombre.');
    expect(r.steps).toEqual([]);
  });

  it('ejecuta normalmente con la entrada completa', async () => {
    const r = await engine.run(def, ctx({ nombre: 'Ana' }));
    expect(r.status).toBe('SUCCEEDED');
    expect(r.output).toEqual({ texto: 'Hola Ana' });
  });
});
