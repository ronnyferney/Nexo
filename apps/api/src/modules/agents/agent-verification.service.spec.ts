import { AgentVerificationService } from './agent-verification.service';
import type { RoutingVerifyPolicy } from '../llm/routing.types';

describe('AgentVerificationService (lógica pura de verificación cruzada, ADR 0010 D4)', () => {
  const svc = new AgentVerificationService();
  const verify = (over: Partial<RoutingVerifyPolicy> = {}): RoutingVerifyPolicy => ({ enabled: true, ...over });

  describe('selectVerifierRefs', () => {
    it('prefiere otro modelo que el redactor y mantiene el orden del enrutamiento', () => {
      const refs = svc.selectVerifierRefs(verify(), 'p1:draft', ['p1:draft', 'p1:otro', 'p2:tercero']);
      expect(refs).toEqual(['p1:otro', 'p2:tercero']);
    });

    it('con requireDifferentProvider descarta los candidatos del mismo proveedor que el redactor', () => {
      const refs = svc.selectVerifierRefs(verify({ requireDifferentProvider: true }), 'p1:draft', [
        'p1:draft',
        'p1:otro',
        'p2:tercero',
      ]);
      expect(refs).toEqual(['p2:tercero']);
    });

    it('un verificador explícito manda, salvo que viole requireDifferentProvider', () => {
      expect(svc.selectVerifierRefs(verify({ model: 'p3:juez' }), 'p1:draft', ['p1:otro'])).toEqual(['p3:juez']);
      // Mismo proveedor que el redactor y se exige distinto proveedor ⇒ no hay verificador válido.
      expect(
        svc.selectVerifierRefs(verify({ model: 'p1:juez', requireDifferentProvider: true }), 'p1:draft', []),
      ).toEqual([]);
    });
  });

  describe('parseVerdict', () => {
    it('reconoce PROBLEMA y extrae la crítica sin la línea del veredicto', () => {
      const r = svc.parseVerdict('VEREDICTO: PROBLEMA\nLa cifra no coincide con la fuente.');
      expect(r.verdict).toBe('PROBLEMA');
      expect(r.critique).toBe('La cifra no coincide con la fuente.');
    });

    it('reconoce OK y, ante un texto ambiguo, no bloquea (OK por defecto)', () => {
      expect(svc.parseVerdict('VEREDICTO: OK, todo correcto.').verdict).toBe('OK');
      expect(svc.parseVerdict('no sigue el formato esperado').verdict).toBe('OK');
    });
  });

  describe('resolveIssueOutcome (decisión 6)', () => {
    it('auto: advierte en informativas y exige revisión humana ante una acción sensible', () => {
      expect(svc.resolveIssueOutcome('auto', false)).toEqual({
        code: 'VERIFICACION_ADVERTENCIA',
        requiresHumanReview: false,
      });
      expect(svc.resolveIssueOutcome(undefined, true)).toEqual({
        code: 'VERIFICACION_REVISION_HUMANA',
        requiresHumanReview: true,
      });
    });

    it('warn nunca bloquea y require_human siempre exige revisión humana', () => {
      expect(svc.resolveIssueOutcome('warn', true)).toEqual({
        code: 'VERIFICACION_ADVERTENCIA',
        requiresHumanReview: false,
      });
      expect(svc.resolveIssueOutcome('require_human', false)).toEqual({
        code: 'VERIFICACION_REVISION_HUMANA',
        requiresHumanReview: true,
      });
    });
  });

  it('buildPrompt pide contrastar con las fuentes y un veredicto con formato fijo', () => {
    const { system, userMessage } = svc.buildPrompt({ userMessage: 'Pregunta', draftText: 'Borrador' });
    expect(system).toContain('VEREDICTO: OK');
    expect(system).toContain('VEREDICTO: PROBLEMA');
    expect(system).toContain('fuentes');
    expect(userMessage).toContain('Pregunta');
    expect(userMessage).toContain('Borrador');
  });
});
