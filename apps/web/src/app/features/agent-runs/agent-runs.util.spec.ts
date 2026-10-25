import { buildRunsQuery, EMPTY_RUN_FILTERS, formatDuration, hasActiveFilters, sourceLabel } from './agent-runs.util';

describe('agent-runs.util', () => {
  describe('formatDuration', () => {
    it('devuelve «—» cuando la métrica no existe', () => {
      expect(formatDuration(null)).toBe('—');
      expect(formatDuration(undefined)).toBe('—');
      expect(formatDuration(NaN)).toBe('—');
    });

    it('muestra milisegundos por debajo de un segundo', () => {
      expect(formatDuration(0)).toBe('0 ms');
      expect(formatDuration(850)).toBe('850 ms');
      expect(formatDuration(999)).toBe('999 ms');
    });

    it('muestra segundos con un decimal entre 1 s y 1 min', () => {
      expect(formatDuration(1000)).toBe('1.0 s');
      expect(formatDuration(1500)).toBe('1.5 s');
      expect(formatDuration(59900)).toBe('59.9 s');
    });

    it('muestra minutos y segundos a partir de un minuto', () => {
      expect(formatDuration(60000)).toBe('1 min');
      expect(formatDuration(125000)).toBe('2 min 5 s');
    });
  });

  describe('sourceLabel', () => {
    it('traduce los orígenes conocidos', () => {
      expect(sourceLabel('CHAT')).toBe('Chat');
      expect(sourceLabel('WORKFLOW')).toBe('Flujo');
      expect(sourceLabel('EVAL')).toBe('Evaluación');
    });

    it('devuelve el valor crudo si es desconocido', () => {
      expect(sourceLabel('OTRO')).toBe('OTRO');
    });
  });

  describe('hasActiveFilters', () => {
    it('es falso sin filtros', () => {
      expect(hasActiveFilters(EMPTY_RUN_FILTERS)).toBeFalse();
    });

    it('es verdadero con cualquier filtro', () => {
      expect(hasActiveFilters({ ...EMPTY_RUN_FILTERS, agentId: 'a1' })).toBeTrue();
      expect(hasActiveFilters({ ...EMPTY_RUN_FILTERS, status: 'FAILED' })).toBeTrue();
      expect(hasActiveFilters({ ...EMPTY_RUN_FILTERS, from: '2026-01-01' })).toBeTrue();
    });
  });

  describe('buildRunsQuery', () => {
    it('incluye take por defecto y omite filtros vacíos', () => {
      expect(buildRunsQuery(EMPTY_RUN_FILTERS)).toEqual({ take: '25' });
    });

    it('respeta take y cursor personalizados', () => {
      expect(buildRunsQuery(EMPTY_RUN_FILTERS, { take: 50, cursor: 'abc' })).toEqual({ take: '50', cursor: 'abc' });
    });

    it('ignora un cursor nulo', () => {
      expect(buildRunsQuery(EMPTY_RUN_FILTERS, { cursor: null })).toEqual({ take: '25' });
    });

    it('añade los filtros presentes', () => {
      const q = buildRunsQuery({ agentId: 'a1', status: 'SUCCEEDED', source: 'CHAT', from: '', to: '' });
      expect(q).toEqual(jasmine.objectContaining({ agentId: 'a1', status: 'SUCCEEDED', source: 'CHAT' }));
    });

    it('convierte el rango de fechas a instantes ISO del día local', () => {
      const q = buildRunsQuery({ ...EMPTY_RUN_FILTERS, from: '2026-03-01', to: '2026-03-02' });
      expect(q['from']).toBe(new Date('2026-03-01T00:00:00').toISOString());
      expect(q['to']).toBe(new Date('2026-03-02T23:59:59.999').toISOString());
    });
  });
});
