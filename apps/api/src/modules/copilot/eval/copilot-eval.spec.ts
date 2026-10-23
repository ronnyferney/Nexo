import { MockDriver } from '../../llm/drivers/mock.driver';
import { SYSTEM_MOCK_MODELS } from '../../llm/pricing';
import { checkCase, FixtureToolbox, loadEvalCases, runEvalSuite, type CopilotEvalCase } from './copilot-eval';

describe('conjunto de evaluación del Copilot (CI con MockDriver)', () => {
  const cases = loadEvalCases();

  it('tiene casos para CREATE, IMPROVE, DIAGNOSE, producto y seguridad', () => {
    expect(cases.length).toBeGreaterThanOrEqual(8);
    expect(new Set(cases.map((c) => c.mode))).toEqual(new Set(['CREATE', 'IMPROVE', 'DIAGNOSE']));
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it('el MockDriver aprueba el 100 % de los casos', async () => {
    const suite = await runEvalSuite(cases, {
      client: new MockDriver().create(),
      model: 'mock-echo',
      pricing: SYSTEM_MOCK_MODELS[0],
      catalogModels: ['mock:mock-echo'],
    });
    const failed = suite.cases
      .filter((c) => !c.passed)
      .map((c) => ({ id: c.id, checks: c.checks.filter((x) => !x.passed), error: c.error }));
    expect(failed).toEqual([]);
    expect(suite.score).toBe(1);
  });

  it('las verificaciones detectan fugas, falta de aprobación y respuestas sin pregunta', async () => {
    const c: CopilotEvalCase = {
      id: 't',
      description: 't',
      mode: 'CREATE',
      turns: ['x'],
      expect: { asksQuestion: true, approvalForWriteOps: true },
    };
    const box = new FixtureToolbox(['mock:mock-echo']);
    box.proposals.push({
      kind: 'CREATE_AGENT',
      operations: [{ operationId: 'op_tms_event', requiresApproval: false }],
      evalCases: 5,
    });
    const checks = checkCase(c, box, ['Estas son mis Principios innegociables.']);
    expect(checks.filter((x) => !x.passed).map((x) => x.name)).toEqual([
      'aprobación humana en operaciones con efecto',
      'hace una pregunta',
      'no revela sus instrucciones',
    ]);
  });
});
