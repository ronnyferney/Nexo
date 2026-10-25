import type { AgentRunSource, AgentRunStatus } from '../../core/models';

/** Filtros del historial de tareas. Cadenas vacías = sin filtro. Fechas en `YYYY-MM-DD` (día local). */
export interface AgentRunFilters {
  agentId: string;
  status: '' | AgentRunStatus;
  source: '' | AgentRunSource;
  from: string;
  to: string;
}

export const EMPTY_RUN_FILTERS: AgentRunFilters = { agentId: '', status: '', source: '', from: '', to: '' };

/** Estados seleccionables, con su etiqueta en español. */
export const RUN_STATUSES: { value: AgentRunStatus; label: string }[] = [
  { value: 'RUNNING', label: 'Ejecutando' },
  { value: 'SUCCEEDED', label: 'Exitosa' },
  { value: 'FAILED', label: 'Fallida' },
  { value: 'CANCELLED', label: 'Cancelada' },
];

/** Orígenes seleccionables, con su etiqueta en español. */
export const RUN_SOURCES: { value: AgentRunSource; label: string }[] = [
  { value: 'CHAT', label: 'Chat' },
  { value: 'WORKFLOW', label: 'Flujo' },
  { value: 'MCP', label: 'MCP' },
  { value: 'ROUTINE', label: 'Rutina' },
  { value: 'EVAL', label: 'Evaluación' },
  { value: 'COPILOT', label: 'Copilot' },
];

const SOURCE_LABELS: Record<string, string> = Object.fromEntries(RUN_SOURCES.map((s) => [s.value, s.label]));

/** Etiqueta en español de un origen; si es desconocido, devuelve el valor crudo. */
export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/** ¿Hay algún filtro activo? Distingue «sin historial» de «sin resultados». */
export function hasActiveFilters(f: AgentRunFilters): boolean {
  return !!(f.agentId || f.status || f.source || f.from || f.to);
}

/**
 * Formatea una duración en milisegundos de forma legible: `—` si es nula, `850 ms`, `1.5 s`
 * o `2 min 5 s`. Nunca inventa un valor cuando la métrica no existe.
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

/**
 * Construye los parámetros de query de `GET /agent-runs`. Omite los filtros vacíos, convierte el
 * rango de fechas local a instantes ISO (`from` al inicio del día, `to` al final) y añade el cursor.
 */
export function buildRunsQuery(
  f: AgentRunFilters,
  opts: { take?: number; cursor?: string | null } = {},
): Record<string, string> {
  const q: Record<string, string> = { take: String(opts.take ?? 25) };
  if (f.agentId) q['agentId'] = f.agentId;
  if (f.status) q['status'] = f.status;
  if (f.source) q['source'] = f.source;
  if (f.from) q['from'] = new Date(`${f.from}T00:00:00`).toISOString();
  if (f.to) q['to'] = new Date(`${f.to}T23:59:59.999`).toISOString();
  if (opts.cursor) q['cursor'] = opts.cursor;
  return q;
}
