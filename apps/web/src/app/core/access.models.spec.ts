import {
  countFindingsBySeverity,
  derivePublishState,
  type HealthCheck,
  type HealthSeverity,
} from './access.models';

/** Construye una revisión mínima para las pruebas (solo importan `passed` y `severity`). */
function check(severity: HealthSeverity, passed: boolean): Pick<HealthCheck, 'passed' | 'severity'> {
  return { severity, passed };
}

describe('derivePublishState', () => {
  it('sin revisiones queda preparado para publicar', () => {
    expect(derivePublishState([])).toBe('READY');
  });

  it('con todas las revisiones superadas queda preparado', () => {
    expect(derivePublishState([check('CRITICAL', true), check('WARNING', true), check('INFO', true)])).toBe('READY');
  });

  it('un hallazgo informativo no bloquea ni advierte', () => {
    expect(derivePublishState([check('INFO', false), check('CRITICAL', true)])).toBe('READY');
  });

  it('un hallazgo de advertencia deja publicable con advertencias', () => {
    expect(derivePublishState([check('WARNING', false), check('INFO', false)])).toBe('WARNINGS');
  });

  it('un hallazgo bloqueante bloquea la publicación aunque haya advertencias', () => {
    expect(derivePublishState([check('WARNING', false), check('CRITICAL', false)])).toBe('BLOCKED');
  });

  it('prioriza el bloqueante sobre el estado preparado', () => {
    expect(derivePublishState([check('CRITICAL', false), check('CRITICAL', true)])).toBe('BLOCKED');
  });
});

describe('countFindingsBySeverity', () => {
  it('solo cuenta las revisiones no superadas, por severidad', () => {
    const counts = countFindingsBySeverity([
      check('CRITICAL', false),
      check('CRITICAL', true),
      check('WARNING', false),
      check('WARNING', false),
      check('INFO', false),
      check('INFO', true),
    ]);
    expect(counts).toEqual({ CRITICAL: 1, WARNING: 2, INFO: 1 });
  });

  it('devuelve ceros cuando no hay hallazgos', () => {
    expect(countFindingsBySeverity([check('CRITICAL', true)])).toEqual({ CRITICAL: 0, WARNING: 0, INFO: 0 });
  });
});
