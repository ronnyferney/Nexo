import type { NodeType } from '../../core/models';

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
