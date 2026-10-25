import type { AgentDashboardCounts, DashboardAgent } from '../../core/agents-scope.models';
import {
  buildStatusTabs,
  clampPage,
  distinctAreas,
  filterAgents,
  formatDeltaCount,
  formatDeltaPct,
  formatSuccessRate,
  pageCount,
  pageSlice,
  statusMatchesTab,
} from './agents-dashboard.util';

function agent(over: Partial<DashboardAgent> = {}): DashboardAgent {
  return {
    id: over.id ?? 'a1',
    name: over.name ?? 'Agente',
    description: over.description ?? null,
    visibility: over.visibility ?? 'PRIVATE',
    status: over.status ?? 'DRAFT',
    health: over.health ?? null,
    executions: over.executions ?? 0,
    users: over.users ?? 0,
    costUsd: over.costUsd ?? 0,
    area: over.area ?? null,
  };
}

const counts = (over: Partial<AgentDashboardCounts> = {}): AgentDashboardCounts => ({
  all: 10,
  active: 4,
  testing: null,
  draft: 6,
  archived: null,
  ...over,
});

describe('buildStatusTabs', () => {
  it('siempre incluye Todos/Activos/Borradores con sus contadores', () => {
    const tabs = buildStatusTabs(counts());
    expect(tabs.map((t) => t.id)).toEqual(['all', 'active', 'draft']);
    expect(tabs.map((t) => t.count)).toEqual([10, 4, 6]);
  });

  it('oculta «En pruebas» y «Archivados» cuando el recuento es null (§6)', () => {
    expect(buildStatusTabs(counts()).some((t) => t.id === 'testing' || t.id === 'archived')).toBe(false);
  });

  it('muestra «En pruebas»/«Archivados» solo cuando hay dato', () => {
    const tabs = buildStatusTabs(counts({ testing: 2, archived: 3 }));
    expect(tabs.find((t) => t.id === 'testing')?.count).toBe(2);
    expect(tabs.find((t) => t.id === 'archived')?.count).toBe(3);
  });
});

describe('statusMatchesTab', () => {
  it('active solo admite LAUNCHED y draft solo DRAFT', () => {
    expect(statusMatchesTab('active', agent({ status: 'LAUNCHED' }))).toBe(true);
    expect(statusMatchesTab('active', agent({ status: 'DRAFT' }))).toBe(false);
    expect(statusMatchesTab('draft', agent({ status: 'DRAFT' }))).toBe(true);
    expect(statusMatchesTab('draft', agent({ status: 'LAUNCHED' }))).toBe(false);
  });

  it('all no filtra por estado', () => {
    expect(statusMatchesTab('all', agent({ status: 'DRAFT' }))).toBe(true);
    expect(statusMatchesTab('all', agent({ status: 'LAUNCHED' }))).toBe(true);
  });
});

describe('filterAgents', () => {
  const list: DashboardAgent[] = [
    agent({ id: '1', name: 'Soporte', status: 'LAUNCHED', area: 'Ventas', description: 'atención a clientes' }),
    agent({ id: '2', name: 'Cobranzas', status: 'DRAFT', area: 'Finanzas' }),
    agent({ id: '3', name: 'Reportes', status: 'LAUNCHED', area: 'Finanzas' }),
  ];
  const base = { tab: 'all' as const, query: '', area: null, status: '' as const };

  it('filtra por pestaña de estado', () => {
    expect(filterAgents(list, { ...base, tab: 'active' }).map((a) => a.id)).toEqual(['1', '3']);
    expect(filterAgents(list, { ...base, tab: 'draft' }).map((a) => a.id)).toEqual(['2']);
  });

  it('busca por nombre, descripción y área sin distinguir mayúsculas', () => {
    expect(filterAgents(list, { ...base, query: 'clientes' }).map((a) => a.id)).toEqual(['1']);
    expect(filterAgents(list, { ...base, query: 'finanzas' }).map((a) => a.id)).toEqual(['2', '3']);
    expect(filterAgents(list, { ...base, query: 'COBRA' }).map((a) => a.id)).toEqual(['2']);
  });

  it('combina filtros de área y estado con AND', () => {
    expect(filterAgents(list, { ...base, area: 'Finanzas', status: 'LAUNCHED' }).map((a) => a.id)).toEqual(['3']);
    expect(filterAgents(list, { ...base, tab: 'active', status: 'DRAFT' })).toEqual([]);
  });
});

describe('distinctAreas', () => {
  it('devuelve áreas únicas sin null, ordenadas en español', () => {
    const list = [agent({ area: 'Ventas' }), agent({ area: 'Finanzas' }), agent({ area: 'Ventas' }), agent({ area: null })];
    expect(distinctAreas(list)).toEqual(['Finanzas', 'Ventas']);
  });
});

describe('formatDeltaPct / formatDeltaCount', () => {
  it('devuelve null cuando no hay base de comparación', () => {
    expect(formatDeltaPct(null)).toBeNull();
    expect(formatDeltaPct(undefined)).toBeNull();
    expect(formatDeltaCount(null)).toBeNull();
  });

  it('subir es bueno por defecto (verde, flecha arriba)', () => {
    const d = formatDeltaPct(12.5);
    expect(d).toEqual({ text: '+12,5 %', dir: 'up', tone: 'success', icon: 'chevronUp' });
  });

  it('bajar es malo por defecto (rojo, flecha abajo)', () => {
    const d = formatDeltaCount(-3);
    expect(d).toEqual({ text: '-3', dir: 'down', tone: 'danger', icon: 'chevronDown' });
  });

  it('con higherIsBetter=false (costo) subir es malo', () => {
    expect(formatDeltaPct(8, false)?.tone).toBe('danger');
    expect(formatDeltaPct(-8, false)?.tone).toBe('success');
  });

  it('cero es «Sin cambios» neutro', () => {
    expect(formatDeltaCount(0)).toEqual({ text: 'Sin cambios', dir: 'flat', tone: 'muted', icon: null });
  });
});

describe('formatSuccessRate', () => {
  it('devuelve null cuando no hay dato (§6: no se inventa 0 %)', () => {
    expect(formatSuccessRate(null)).toBeNull();
    expect(formatSuccessRate(undefined)).toBeNull();
    expect(formatSuccessRate(Number.NaN)).toBeNull();
  });

  it('formatea el porcentaje con coma decimal en español', () => {
    expect(formatSuccessRate(100)).toBe('100 %');
    expect(formatSuccessRate(87.5)).toBe('87,5 %');
    expect(formatSuccessRate(0)).toBe('0 %');
  });
});

describe('paginación', () => {
  it('pageCount es al menos 1', () => {
    expect(pageCount(0, 9)).toBe(1);
    expect(pageCount(10, 9)).toBe(2);
    expect(pageCount(18, 9)).toBe(2);
  });

  it('pageSlice toma la ventana correcta', () => {
    const items = [1, 2, 3, 4, 5];
    expect(pageSlice(items, 1, 2)).toEqual([1, 2]);
    expect(pageSlice(items, 3, 2)).toEqual([5]);
  });

  it('clampPage acota al rango válido', () => {
    expect(clampPage(5, 10, 9)).toBe(2);
    expect(clampPage(0, 10, 9)).toBe(1);
    expect(clampPage(2, 10, 9)).toBe(2);
  });
});
