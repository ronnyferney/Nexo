import type { LaunchStatus } from '../../core/access.models';
import type { AgentDashboardCounts, DashboardAgent } from '../../core/agents-scope.models';

/** Pestañas de estado del tablero (RX-11). `testing`/`archived` solo aparecen si el backend trae el dato. */
export type StatusTab = 'all' | 'active' | 'draft' | 'testing' | 'archived';

export interface DashboardTab {
  id: StatusTab;
  label: string;
  count: number;
}

const TAB_LABELS: Record<StatusTab, string> = {
  all: 'Todos',
  active: 'Activos',
  draft: 'Borradores',
  testing: 'En pruebas',
  archived: 'Archivados',
};

/**
 * Pestañas visibles con sus contadores. Siempre: Todos / Activos / Borradores. «En pruebas» y «Archivados» solo
 * se muestran cuando su recuento NO es `null` (§6: datos que el backend no modela no se muestran con cifras falsas).
 */
export function buildStatusTabs(counts: AgentDashboardCounts): DashboardTab[] {
  const tabs: DashboardTab[] = [
    { id: 'all', label: TAB_LABELS.all, count: counts.all },
    { id: 'active', label: TAB_LABELS.active, count: counts.active },
    { id: 'draft', label: TAB_LABELS.draft, count: counts.draft },
  ];
  if (counts.testing !== null) tabs.push({ id: 'testing', label: TAB_LABELS.testing, count: counts.testing });
  if (counts.archived !== null) tabs.push({ id: 'archived', label: TAB_LABELS.archived, count: counts.archived });
  return tabs;
}

/** ¿El agente pertenece a la pestaña de estado? `all` (y las inexistentes) no filtran por estado. */
export function statusMatchesTab(tab: StatusTab, agent: DashboardAgent): boolean {
  if (tab === 'active') return agent.status === 'LAUNCHED';
  if (tab === 'draft') return agent.status === 'DRAFT';
  return true;
}

/** Estado explícito del filtro del tablero: vacío = todos, o uno de los cinco estados de ciclo de vida. */
export type StatusFilterValue = '' | LaunchStatus;

/** Filtros cliente del tablero: pestaña de estado, búsqueda de texto, área y estado explícito. */
export interface AgentFilter {
  tab: StatusTab;
  query: string;
  area: string | null;
  status: StatusFilterValue;
}

/** Aplica todos los filtros (AND) sobre el arreglo de agentes. Búsqueda por nombre, descripción y área. */
export function filterAgents(agents: readonly DashboardAgent[], f: AgentFilter): DashboardAgent[] {
  const q = f.query.trim().toLowerCase();
  return agents.filter(
    (a) =>
      statusMatchesTab(f.tab, a) &&
      (!f.status || a.status === f.status) &&
      (!f.area || a.area === f.area) &&
      (!q || [a.name, a.description ?? '', a.area ?? ''].some((v) => v.toLowerCase().includes(q))),
  );
}

/** Áreas distintas (sin `null`) ordenadas alfabéticamente en español, para el filtro de área. */
export function distinctAreas(agents: readonly DashboardAgent[]): string[] {
  const set = new Set<string>();
  for (const a of agents) if (a.area) set.add(a.area);
  return [...set].sort((x, y) => x.localeCompare(y, 'es'));
}

// ----- Variaciones (deltas) -----

export interface DeltaView {
  text: string;
  dir: 'up' | 'down' | 'flat';
  tone: 'success' | 'danger' | 'muted';
  icon: 'chevronUp' | 'chevronDown' | null;
}

const DELTA_NUM = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });
const PCT_NUM = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });

/**
 * Formatea la tasa de éxito del tablero (`kpis.successRatePct`), un porcentaje ya calculado por el backend como
 * SUCCEEDED/(SUCCEEDED+FAILED) sobre las ejecuciones registradas (`AgentRun`). Devuelve `null` cuando no hay dato
 * (`null`/`undefined`/`NaN`): la vista muestra «sin datos», nunca un 0 % inventado (§6).
 */
export function formatSuccessRate(value: number | null | undefined): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return `${PCT_NUM.format(value)} %`;
}

function deltaView(value: number, magnitude: string, higherIsBetter: boolean): DeltaView {
  if (value === 0) return { text: 'Sin cambios', dir: 'flat', tone: 'muted', icon: null };
  const up = value > 0;
  const good = up === higherIsBetter;
  return {
    text: `${up ? '+' : '-'}${magnitude}`,
    dir: up ? 'up' : 'down',
    tone: good ? 'success' : 'danger',
    icon: up ? 'chevronUp' : 'chevronDown',
  };
}

/**
 * Variación porcentual (`executionsDeltaPct`, `costDeltaPct`). `null`/`undefined` → `null` (sin periodo base de
 * comparación: la vista muestra «sin datos», nunca un 0 % inventado). `higherIsBetter=false` para el costo (subir es malo).
 */
export function formatDeltaPct(value: number | null | undefined, higherIsBetter = true): DeltaView | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return deltaView(value, `${DELTA_NUM.format(Math.abs(value))} %`, higherIsBetter);
}

/** Variación absoluta (`activeDelta`: agentes lanzados en la ventana frente al periodo anterior). */
export function formatDeltaCount(value: number | null | undefined, higherIsBetter = true): DeltaView | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return deltaView(value, DELTA_NUM.format(Math.abs(value)), higherIsBetter);
}

// ----- Paginación cliente -----

/** Número total de páginas (mínimo 1) para `total` elementos con tamaño `size`. */
export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

/** Página `page` (base 1) de `items` con tamaño `size`. */
export function pageSlice<T>(items: readonly T[], page: number, size: number): T[] {
  const start = (page - 1) * size;
  return items.slice(start, start + size);
}

/** Acota `page` al rango [1, pageCount(total, size)]. Útil al cambiar filtros. */
export function clampPage(page: number, total: number, size: number): number {
  return Math.min(Math.max(1, page), pageCount(total, size));
}
