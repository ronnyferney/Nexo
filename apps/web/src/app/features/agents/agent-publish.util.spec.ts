import type { HealthCheck } from '../../core/access.models';
import type { AgentToolBinding } from '../../core/models';
import { findingsOf, pendingFindings, publishDependencies } from './agent-publish.util';

function check(partial: Partial<HealthCheck>): HealthCheck {
  return {
    id: partial.id ?? 'c',
    category: partial.category ?? 'PROFILE',
    severity: partial.severity ?? 'INFO',
    passed: partial.passed ?? false,
    message: partial.message ?? 'msg',
    recommendation: partial.recommendation ?? 'rec',
  };
}

describe('agent-publish.util', () => {
  const checks: HealthCheck[] = [
    check({ id: '1', severity: 'CRITICAL', passed: false, message: 'Falta el rol' }),
    check({ id: '2', severity: 'WARNING', passed: false, message: 'Sin bases de conocimiento' }),
    check({ id: '3', severity: 'WARNING', passed: true }),
    check({ id: '4', severity: 'INFO', passed: false }),
  ];

  describe('pendingFindings', () => {
    it('devuelve solo las revisiones no superadas', () => {
      expect(pendingFindings(checks).map((c) => c.id)).toEqual(['1', '2', '4']);
    });
    it('tolera entrada vacía o ausente', () => {
      expect(pendingFindings()).toEqual([]);
      expect(pendingFindings([])).toEqual([]);
    });
  });

  describe('findingsOf', () => {
    it('filtra por severidad entre los pendientes', () => {
      expect(findingsOf(checks, 'CRITICAL').map((c) => c.id)).toEqual(['1']);
      expect(findingsOf(checks, 'WARNING').map((c) => c.id)).toEqual(['2']);
      expect(findingsOf(checks, 'INFO').map((c) => c.id)).toEqual(['4']);
    });
  });

  describe('publishDependencies', () => {
    it('resume las dependencias con sus conteos, incluyendo las de conteo cero', () => {
      const deps = publishDependencies({
        tools: [{ operationId: 'o1' }, { operationId: 'o2' }] as AgentToolBinding[],
        knowledgeBases: [{ id: 'k', name: 'Base' }],
        skills: [],
        fallbackModels: ['anthropic:claude'],
      });
      expect(deps.map((d) => d.count)).toEqual([2, 1, 0, 1]);
      expect(deps.map((d) => d.label)).toEqual([
        'Herramientas de conectores',
        'Bases de conocimiento',
        'Skills',
        'Modelos de respaldo',
      ]);
    });

    it('trata los campos ausentes como cero', () => {
      expect(publishDependencies({}).map((d) => d.count)).toEqual([0, 0, 0, 0]);
    });
  });
});
