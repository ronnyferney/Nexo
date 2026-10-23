import type { NodeType, WorkflowEdge, WorkflowNode } from '../../core/models';

export interface NodeMeta {
  type: NodeType;
  label: string;
  description: string;
  icon: string;
  color: string;
  defaults: Record<string, unknown>;
}

export const NODE_CATALOG: NodeMeta[] = [
  { type: 'trigger', label: 'Disparador', description: 'Manual, webhook, cron o MCP', icon: 'flag', color: '#5b5bf7', defaults: {} },
  { type: 'connector', label: 'Conector', description: 'Llamar REST / SOAP / GraphQL / MCP', icon: 'plug', color: '#1f84d6', defaults: { operationId: '', input: {}, retries: 0 } },
  { type: 'agent', label: 'Agente IA', description: 'Delegar una tarea a un agente', icon: 'bot', color: '#9b5cf6', defaults: { agentId: '', message: '{{ input | json }}', parseJson: false } },
  { type: 'condition', label: 'Condición', description: 'Bifurcar en verdadero / falso', icon: 'branch', color: '#d98a0b', defaults: { combinator: 'and', rules: [{ left: '{{ input.valor }}', operator: 'eq', right: '' }] } },
  { type: 'transform', label: 'Transformar', description: 'Mapear y construir datos', icon: 'shuffle', color: '#12a46b', defaults: { output: { campo: '{{ input.valor }}' } } },
  { type: 'delay', label: 'Espera', description: 'Pausar unos segundos', icon: 'clock', color: '#6b7189', defaults: { ms: 1000 } },
  { type: 'subworkflow', label: 'Sub-flujo', description: 'Ejecutar otro flujo en línea', icon: 'layers', color: '#0e9aa7', defaults: { workflowId: '', input: { datos: '{{ input }}' } } },
  { type: 'loop', label: 'Bucle', description: 'Un sub-flujo por elemento de una lista', icon: 'repeat', color: '#c2410c', defaults: { items: '{{ input.items }}', workflowId: '', concurrency: 1 } },
  { type: 'output', label: 'Respuesta', description: 'Salida final del flujo', icon: 'check', color: '#e0435c', defaults: { output: { resultado: '{{ input }}' } } },
];

export const nodeMeta = (type: NodeType) => NODE_CATALOG.find((n) => n.type === type)!;

export const OPERATORS = [
  { id: 'eq', label: '= igual' },
  { id: 'neq', label: '≠ distinto' },
  { id: 'gt', label: '> mayor' },
  { id: 'gte', label: '≥ mayor o igual' },
  { id: 'lt', label: '< menor' },
  { id: 'lte', label: '≤ menor o igual' },
  { id: 'contains', label: 'contiene' },
  { id: 'notContains', label: 'no contiene' },
  { id: 'exists', label: 'existe' },
  { id: 'empty', label: 'está vacío' },
  { id: 'regex', label: 'regex' },
];

export const NODE_W = 220;
export const NODE_H = 64;

/**
 * Validación local del grafo (espejo de `workflow.validator.ts` de la API):
 * exactamente un disparador, conexiones válidas y sin ciclos. Devuelve el primer problema o null.
 */
export function validateGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): string | null {
  const triggers = nodes.filter((n) => n.type === 'trigger').length;
  if (triggers === 0) return 'Agregue un nodo disparador';
  if (triggers > 1) return 'El flujo debe tener un solo disparador';
  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) return 'Hay nodos con el mismo ID';
  if (edges.some((e) => !ids.has(e.source) || !ids.has(e.target))) return 'Hay conexiones a nodos inexistentes';
  const adj = new Map<string, string[]>();
  for (const e of edges) adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const next of adj.get(id) ?? []) if (visit(next)) return true;
    state.set(id, 2);
    return false;
  };
  if (nodes.some((n) => visit(n.id))) return 'El flujo contiene un ciclo; elimine la conexión que lo cierra';
  return null;
}
