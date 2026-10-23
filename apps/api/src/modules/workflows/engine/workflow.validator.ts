import type { NodeType, WorkflowDefinition } from './workflow.types';

export const NODE_TYPES: NodeType[] = [
  'trigger',
  'connector',
  'agent',
  'condition',
  'transform',
  'delay',
  'output',
  'subworkflow',
  'loop',
];
export const MAX_NODES = 200;

/** Valida estructura del grafo: tipos, referencias, un disparador y ausencia de ciclos. */
export function validateDefinition(def: WorkflowDefinition): string[] {
  const errors: string[] = [];
  if (!def || !Array.isArray(def.nodes) || !Array.isArray(def.edges))
    return ['La definición debe tener "nodes" y "edges"'];
  if (def.nodes.length > MAX_NODES) errors.push(`Máximo ${MAX_NODES} nodos por flujo`);

  const ids = new Set<string>();
  for (const n of def.nodes) {
    if (!n.id || ids.has(n.id)) errors.push(`ID de nodo duplicado o vacío: "${n.id}"`);
    ids.add(n.id);
    if (!NODE_TYPES.includes(n.type)) errors.push(`Tipo de nodo desconocido: "${n.type}" (${n.id})`);
  }
  const triggers = def.nodes.filter((n) => n.type === 'trigger');
  if (triggers.length !== 1) errors.push('El flujo debe tener exactamente un nodo disparador (trigger)');

  for (const e of def.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) errors.push(`Conexión ${e.id} referencia nodos inexistentes`);
    if (e.source === e.target) errors.push(`Conexión ${e.id} apunta al mismo nodo`);
  }
  for (const t of triggers) {
    if (def.edges.some((e) => e.target === t.id)) errors.push('El disparador no puede tener entradas');
  }
  if (hasCycle(def)) errors.push('El flujo contiene ciclos; debe ser un grafo acíclico');
  return errors;
}

function hasCycle(def: WorkflowDefinition): boolean {
  const adj = new Map<string, string[]>();
  for (const e of def.edges) adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const next of adj.get(id) ?? []) if (visit(next)) return true;
    state.set(id, 2);
    return false;
  };
  return def.nodes.some((n) => visit(n.id));
}
