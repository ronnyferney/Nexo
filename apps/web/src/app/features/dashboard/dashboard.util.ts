import type { Stats } from '../../core/models';

/** Rangos de tiempo del selector del encabezado del inicio. */
export type DashboardRange = 'today' | '7' | '30';

export interface RangeOption {
  value: DashboardRange;
  label: string;
}

/** Opciones del selector de rango; el orden es el que ve el usuario. */
export const RANGE_OPTIONS: readonly RangeOption[] = [
  { value: 'today', label: 'Hoy' },
  { value: '7', label: 'Últimos 7 días' },
  { value: '30', label: 'Últimos 30 días' },
];

/** Rango por defecto: las métricas disponibles hoy (`Stats`) cubren los últimos 7 días. */
export const DEFAULT_RANGE: DashboardRange = '7';

/** Valida un valor arbitrario (p. ej. de `localStorage`) y lo normaliza al rango por defecto. */
export function parseRange(value: unknown): DashboardRange {
  return RANGE_OPTIONS.some((o) => o.value === value) ? (value as DashboardRange) : DEFAULT_RANGE;
}

const PCT = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });
const COUNT = new Intl.NumberFormat('es');

/** Porcentaje en español con hasta un decimal; «—» si no hay dato (no se inventa 0 %). */
export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${PCT.format(value)} %`;
}

/** Entero con separador de miles; «—» si no hay dato. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return COUNT.format(value);
}

/**
 * Tasa de éxito (0–100) a partir del total y los fallidos.
 * Devuelve `null` cuando no hay base (sin dato o cero ejecuciones): no se inventa un 0 % ni un 100 %.
 */
export function successRate(total: number | null | undefined, failed: number | null | undefined): number | null {
  if (total === null || total === undefined || !Number.isFinite(total) || total <= 0) return null;
  const f = Math.min(Math.max(failed ?? 0, 0), total);
  return ((total - f) / total) * 100;
}

export interface KpiCard {
  label: string;
  value: string;
  subline: string;
  icon: string;
  link: string;
}

/**
 * Tarjetas KPI del inicio a partir de `Stats` (ventana de 7 días del backend).
 * Degrada con «—»/sublíneas neutrales cuando el dato no existe: no inventa desgloses ni estados.
 */
export function buildKpis(stats: Stats | null): KpiCard[] {
  const s = stats;
  const rate = successRate(s?.executionsLast7d, s?.failedLast7d);
  return [
    {
      label: 'Agentes',
      value: formatCount(s?.agents),
      subline: 'Instrucciones, modelo y herramientas',
      icon: 'bot',
      link: '/agents',
    },
    {
      label: 'Conectores',
      value: formatCount(s?.connectors),
      subline: 'REST, SOAP, GraphQL y MCP',
      icon: 'plug',
      link: '/connectors',
    },
    {
      label: 'Flujos',
      value: formatCount(s?.workflows),
      subline: 'Automatizaciones de tu plataforma',
      icon: 'flow',
      link: '/workflows',
    },
    {
      label: 'Ejecuciones',
      value: s ? `${formatCount(s.executionsLast7d)} · ${formatCount(s.failedLast7d)} fallidas` : '—',
      subline: rate === null ? 'Sin ejecuciones en 7 días' : `Tasa de éxito ${formatPct(rate)} · últimos 7 días`,
      icon: 'zap',
      link: '/executions',
    },
  ];
}
