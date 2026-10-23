import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './utils/app';
import {
  addMember,
  createAgent,
  publishAgent,
  createUnit,
  LONG_MESSAGE,
  records,
  registerOwner,
  rootUnit,
  type Session,
} from './utils/fixtures';

interface Feedback {
  id: string;
  agentId: string;
  agentName: string;
  rating: 'UP' | 'DOWN';
  correction: string | null;
  status: 'PENDING' | 'APPROVED' | 'DISCARDED';
  reviewedAt: string | null;
}

interface EvalCase {
  id: string;
  input: string;
  expected: string | null;
  criteria: string | null;
  tags: string[];
}

interface Result {
  id: string;
  caseId: string;
  input: string;
  expected: string | null;
  output: string | null;
  score: number | null;
  passed: boolean;
  reasoning: string | null;
  needsReview: boolean;
  humanScore: number | null;
  humanNote: string | null;
  effectiveScore: number | null;
}

interface Run {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  versionId: string | null;
  version: number | null;
  score: number | null;
  passed: number;
  total: number;
  costUsd: number;
  judgeModel: string;
  error: string | null;
  finishedAt: string | null;
  results?: Result[];
}

interface Version {
  id: string;
  version: number;
  note: string | null;
  createdByName: string | null;
  bestScore: number | null;
}

interface Suggestion {
  id: string;
  runId: string;
  status: 'PENDING' | 'APPLIED' | 'REJECTED';
  rationale: string;
  proposal: { systemPrompt?: string; profile?: Record<string, unknown> };
}

const JUDGE = { judgeProviderId: 'mock', judgeModel: 'mock-echo' };

/** El agente mock responde en eco ("Eco: <entrada>"): el juez mock compara esa salida con lo esperado. */
const CASES = [
  { input: '¿Cuál es la capital de Francia?', expected: 'capital de francia' }, // contiene → 1
  { input: 'Hola equipo de ventas regional', expected: 'equipo ventas nacional completo' }, // 2 de 4 → 0.6
  { input: 'Dame el horario de atención', expected: 'respuesta totalmente distinta' }, // nada → 0
];

async function waitRun(s: Session, runId: string, timeoutMs = 30_000): Promise<Run> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = (await s.api.get(`/eval-runs/${runId}`).expect(200)).body as Run;
    if (run.status === 'SUCCEEDED' || run.status === 'FAILED') return run;
    if (Date.now() > deadline) throw new Error(`La corrida ${runId} no terminó (estado ${run.status})`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('Bucle de mejora supervisada · feedback, evaluaciones, versiones y sugerencias (E2E)', () => {
  let app: INestApplication;
  let owner: Session;
  let viewer: Session;
  let other: Session;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app, 'entrenamiento');
    viewer = await addMember(app, owner, { role: 'VIEWER' });
    other = await registerOwner(app, 'entrenamiento-b');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Retroalimentación y bandeja (D1)', () => {
    let agentId: string;

    beforeAll(async () => {
      agentId = (await createAgent(owner, { name: 'Agente feedback' })).id;
      await publishAgent(owner, agentId); // el VIEWER usa (USE) un agente de la empresa (ADR 0007)
    });

    it('👍 sin corrección queda aprobado; 👎 con corrección entra a la bandeja', async () => {
      const up = (
        await viewer.api
          .post(`/agents/${agentId}/feedback`, { userMessage: 'Hola', agentResponse: 'Eco: Hola', rating: 'UP' })
          .expect(201)
      ).body as Feedback;
      expect(up).toMatchObject({ status: 'APPROVED', agentName: 'Agente feedback', rating: 'UP' });

      const down = (
        await viewer.api
          .post(`/agents/${agentId}/feedback`, {
            userMessage: '¿Plazo de reembolso?',
            agentResponse: 'No sé',
            rating: 'DOWN',
            comment: 'Debe citar el plazo',
            correction: 'Los reembolsos tardan diez días hábiles.',
          })
          .expect(201)
      ).body as Feedback;
      expect(down.status).toBe('PENDING');

      const upWithCorrection = (
        await viewer.api
          .post(`/agents/${agentId}/feedback`, {
            userMessage: 'Saluda',
            agentResponse: 'Hola',
            rating: 'UP',
            correction: '¡Hola! ¿En qué puedo ayudarte?',
          })
          .expect(201)
      ).body as Feedback;
      expect(upWithCorrection.status).toBe('PENDING');

      await viewer.api
        .post(`/agents/${agentId}/feedback`, { userMessage: 'x', agentResponse: 'y', rating: 'MEH' })
        .expect(400);

      const inbox = (await owner.api.get('/feedback?status=PENDING').expect(200)).body as Feedback[];
      expect(inbox.map((f) => f.id)).toEqual(expect.arrayContaining([down.id, upWithCorrection.id]));
      expect(inbox.map((f) => f.id)).not.toContain(up.id);
      expect(inbox.find((f) => f.id === down.id)?.agentName).toBe('Agente feedback');
      const approved = (await viewer.api.get(`/agents/${agentId}/feedback?status=APPROVED`).expect(200))
        .body as Feedback[];
      expect(approved.map((f) => f.id)).toEqual([up.id]);
      await owner.api.get('/feedback?status=OTRO').expect(400);
    });

    it('aprobar con corrección crea ejemplo y caso de evaluación; descartar no crea nada', async () => {
      const pending = (await owner.api.get(`/agents/${agentId}/feedback?status=PENDING`).expect(200))
        .body as Feedback[];
      const down = pending.find((f) => f.rating === 'DOWN')!;
      const upc = pending.find((f) => f.rating === 'UP')!;

      await viewer.api.post(`/feedback/${down.id}/review`, { action: 'APPROVE' }).expect(403);

      const res = await owner.api
        .post(`/feedback/${down.id}/review`, { action: 'APPROVE', addAsEvalCase: true })
        .expect(200);
      const body = res.body as { feedback: Feedback; exampleId: string; evalCaseId: string };
      expect(body.feedback.status).toBe('APPROVED');
      expect(body.feedback.reviewedAt).not.toBeNull();
      expect(body.exampleId).toBeTruthy();
      expect(body.evalCaseId).toBeTruthy();

      const examples = (await owner.api.get(`/agents/${agentId}/examples`).expect(200)).body as {
        input: string;
        output: string;
      }[];
      expect(examples).toEqual([
        expect.objectContaining({ input: '¿Plazo de reembolso?', output: 'Los reembolsos tardan diez días hábiles.' }),
      ]);
      const cases = (await viewer.api.get(`/agents/${agentId}/eval-cases`).expect(200)).body as EvalCase[];
      expect(cases).toEqual([
        expect.objectContaining({
          id: body.evalCaseId,
          input: '¿Plazo de reembolso?',
          expected: 'Los reembolsos tardan diez días hábiles.',
          criteria: 'Debe citar el plazo',
        }),
      ]);

      await owner.api.post(`/feedback/${down.id}/review`, { action: 'DISCARD' }).expect(409);
      const discarded = await owner.api.post(`/feedback/${upc.id}/review`, { action: 'DISCARD' }).expect(200);
      expect((discarded.body as { feedback: Feedback; exampleId: null }).feedback.status).toBe('DISCARDED');
      expect(((await owner.api.get(`/agents/${agentId}/examples`).expect(200)).body as unknown[]).length).toBe(1);
      expect(((await owner.api.get('/feedback?status=PENDING').expect(200)).body as Feedback[]).length).toBe(0);
    });

    it('con 20 ejemplos, aprobar una corrección responde 409 y la retroalimentación sigue pendiente', async () => {
      const full = (await createAgent(owner, { name: 'Agente lleno' })).id;
      for (let i = 0; i < 20; i++) {
        await owner.api.post(`/agents/${full}/examples`, { input: `p${i}`, output: `r${i}` }).expect(201);
      }
      const fb = (
        await owner.api
          .post(`/agents/${full}/feedback`, { userMessage: 'q', agentResponse: 'a', rating: 'DOWN', correction: 'b' })
          .expect(201)
      ).body as Feedback;
      const res = await owner.api.post(`/feedback/${fb.id}/review`, { action: 'APPROVE', addAsEvalCase: true });
      expect(res.status).toBe(409);
      expect((res.body as { message: string }).message).toMatch(/máximo de 20 ejemplos/);
      const after = (await owner.api.get(`/agents/${full}/feedback`).expect(200)).body as Feedback[];
      expect(after[0].status).toBe('PENDING');
      expect(((await owner.api.get(`/agents/${full}/eval-cases`).expect(200)).body as unknown[]).length).toBe(0);
    });
  });

  describe('Casos, corridas, revisión humana, sugerencias y versiones (D2–D4)', () => {
    let agentId: string;
    let run: Run;
    const ORIGINAL_PROMPT = 'Eres un asistente de pruebas.';

    beforeAll(async () => {
      agentId = (await createAgent(owner, { name: `Agente evaluado ${Date.now()}`, systemPrompt: ORIGINAL_PROMPT })).id;
      await publishAgent(owner, agentId);
    });

    it('CRUD de casos (EDITOR+) con validación', async () => {
      await viewer.api.post(`/agents/${agentId}/eval-cases`, { input: 'x' }).expect(403);
      await owner.api.post(`/agents/${agentId}/eval-cases`, { input: '' }).expect(400);
      const tmp = (
        await owner.api
          .post(`/agents/${agentId}/eval-cases`, { input: 'temporal', tags: ['a', 'a', ' b '] })
          .expect(201)
      ).body as EvalCase;
      expect(tmp.tags).toEqual(['a', 'b']);
      const patched = (
        await owner.api.patch(`/eval-cases/${tmp.id}`, { expected: 'algo', criteria: 'Breve' }).expect(200)
      ).body as EvalCase;
      expect(patched).toMatchObject({ input: 'temporal', expected: 'algo', criteria: 'Breve' });
      await viewer.api.patch(`/eval-cases/${tmp.id}`, { input: 'y' }).expect(403);
      await viewer.api.delete(`/eval-cases/${tmp.id}`).expect(403);
      await owner.api.delete(`/eval-cases/${tmp.id}`).expect(200);
      await owner.api.patch(`/eval-cases/${tmp.id}`, { input: 'y' }).expect(404);
    });

    it('validaciones al crear corridas: sin casos, juez inexistente, VIEWER', async () => {
      await owner.api.post(`/agents/${agentId}/eval-runs`, JUDGE).expect(400);
      for (const c of CASES) await owner.api.post(`/agents/${agentId}/eval-cases`, c).expect(201);
      await owner.api.post(`/agents/${agentId}/eval-runs`, { ...JUDGE, judgeModel: 'no-existe' }).expect(400);
      await owner.api.post(`/agents/${agentId}/eval-runs`, { judgeProviderId: 'nada', judgeModel: 'x' }).expect(400);
      await owner.api.post(`/agents/${agentId}/eval-runs`, { ...JUDGE, passThreshold: 2 }).expect(400);
      await viewer.api.post(`/agents/${agentId}/eval-runs`, JUDGE).expect(403);
    });

    it('corrida completa: aprobado, dudoso y fallido, con su costo (agente + juez, source EVAL)', async () => {
      const queued = (
        await owner.api.post(`/agents/${agentId}/eval-runs`, { ...JUDGE, versionNote: 'Línea base' }).expect(201)
      ).body as Run;
      expect(queued).toMatchObject({ status: 'QUEUED', version: 1, total: 3, judgeModel: 'mock-echo' });

      run = await waitRun(owner, queued.id);
      expect(run.status).toBe('SUCCEEDED');
      expect(run.error).toBeNull();
      expect(run.finishedAt).not.toBeNull();
      expect(run.total).toBe(3);
      const byInput = new Map(run.results!.map((r) => [r.input, r]));
      const ok = byInput.get(CASES[0].input)!;
      const doubtful = byInput.get(CASES[1].input)!;
      const failed = byInput.get(CASES[2].input)!;
      expect(ok).toMatchObject({ score: 1, passed: true, needsReview: false, effectiveScore: 1 });
      expect(ok.output).toContain('Eco: ¿Cuál es la capital de Francia?');
      expect(doubtful).toMatchObject({ score: 0.6, passed: false, needsReview: true, effectiveScore: 0.6 });
      expect(failed).toMatchObject({ score: 0, passed: false, needsReview: false });
      expect(failed.reasoning).toMatch(/palabras clave/);
      expect(run.passed).toBe(1);
      expect(run.score).toBeCloseTo(0.5333, 4);
      expect(run.costUsd).toBeGreaterThan(0);

      const evalUsage = (await records(owner)).filter((r) => r.source === 'EVAL');
      expect(evalUsage.length).toBe(6); // 3 del agente + 3 del juez
      const sum = evalUsage.reduce((acc, r) => acc + r.costUsd, 0);
      expect(run.costUsd).toBeCloseTo(sum, 6);

      const list = (await viewer.api.get(`/agents/${agentId}/eval-runs`).expect(200)).body as Run[];
      expect(list[0]).toMatchObject({ id: run.id, status: 'SUCCEEDED', version: 1, passed: 1, total: 3 });
    });

    it('la revisión humana recalcula el puntaje de la corrida (EDITOR+)', async () => {
      const doubtful = run.results!.find((r) => r.needsReview)!;
      await viewer.api.patch(`/eval-results/${doubtful.id}`, { humanScore: 0.9 }).expect(403);
      await owner.api.patch(`/eval-results/${doubtful.id}`, { humanScore: 1.5 }).expect(400);
      const res = (
        await owner.api.patch(`/eval-results/${doubtful.id}`, { humanScore: 0.9, humanNote: 'Aceptable' }).expect(200)
      ).body as { result: Result; run: Run };
      expect(res.result).toMatchObject({ humanScore: 0.9, humanNote: 'Aceptable', effectiveScore: 0.9, passed: true });
      expect(res.run.passed).toBe(2);
      expect(res.run.score).toBeCloseTo(0.6333, 4);
      const detail = (await owner.api.get(`/eval-runs/${run.id}`).expect(200)).body as Run;
      expect(detail.score).toBeCloseTo(0.6333, 4);
      run = detail;
    });

    it('sugerencia → aplicar crea versión previa y modifica el agente; no se aplica dos veces', async () => {
      await viewer.api.post(`/eval-runs/${run.id}/suggestions`, { providerId: 'mock', model: 'mock-echo' }).expect(403);
      const created = (
        await owner.api.post(`/eval-runs/${run.id}/suggestions`, { providerId: 'mock', model: 'mock-echo' }).expect(201)
      ).body as Suggestion & { costUsd: number };
      expect(created.status).toBe('PENDING');
      expect(created.runId).toBe(run.id);
      expect(created.costUsd).toBeGreaterThan(0);
      expect(created.proposal.systemPrompt).toContain(ORIGINAL_PROMPT);
      expect(created.proposal.systemPrompt).toContain('«respuesta totalmente distinta»');
      // El caso dudoso ya tiene puntaje humano aprobado: solo se envía el fallido.
      expect(created.proposal.systemPrompt).not.toContain('equipo ventas nacional');
      expect(created.proposal.profile?.goals).toEqual(['Cubrir las respuestas esperadas de los casos de evaluación']);

      const listed = (await viewer.api.get(`/agents/${agentId}/suggestions`).expect(200)).body as Suggestion[];
      expect(listed[0].id).toBe(created.id);

      await viewer.api.post(`/suggestions/${created.id}/apply`).expect(403);
      const applied = (await owner.api.post(`/suggestions/${created.id}/apply`).expect(200)).body as {
        suggestion: Suggestion;
        previousVersion: { version: number };
        agent: { systemPrompt: string; profile: { goals?: string[] } };
      };
      expect(applied.suggestion.status).toBe('APPLIED');
      expect(applied.previousVersion.version).toBe(1); // la configuración evaluada ya era la versión 1
      expect(applied.agent.systemPrompt).toBe(created.proposal.systemPrompt);
      expect(applied.agent.profile.goals).toEqual(created.proposal.profile?.goals);
      await owner.api.post(`/suggestions/${created.id}/apply`).expect(409);
      await owner.api.post(`/suggestions/${created.id}/reject`).expect(409);

      const second = (
        await owner.api.post(`/eval-runs/${run.id}/suggestions`, { providerId: 'mock', model: 'mock-echo' }).expect(201)
      ).body as Suggestion;
      expect(((await owner.api.post(`/suggestions/${second.id}/reject`).expect(200)).body as Suggestion).status).toBe(
        'REJECTED',
      );
    });

    it('una nueva corrida versiona automáticamente la configuración modificada; resumen del ciclo', async () => {
      const queued = (await owner.api.post(`/agents/${agentId}/eval-runs`, JUDGE).expect(201)).body as Run;
      expect(queued.version).toBe(2);
      const done = await waitRun(owner, queued.id);
      expect(done.status).toBe('SUCCEEDED');
      expect(done.score).toBeCloseTo(0.5333, 4);

      const versions = (await viewer.api.get(`/agents/${agentId}/versions`).expect(200)).body as Version[];
      expect(versions.map((v) => v.version)).toEqual([2, 1]);
      expect(versions[1]).toMatchObject({ note: 'Línea base', createdByName: 'Dueño entrenamiento' });
      expect(versions[1].bestScore).toBeCloseTo(0.6333, 4);
      expect(versions[0].bestScore).toBeCloseTo(0.5333, 4);

      const summary = (await viewer.api.get(`/agents/${agentId}/training-summary`).expect(200)).body as {
        targetScore: number;
        latestScore: number;
        bestScore: number;
        bestVersion: number;
        runs: { id: string; version: number; score: number }[];
        pendingFeedback: number;
        evalCases: number;
        examples: number;
      };
      expect(summary).toMatchObject({
        targetScore: 0.85,
        bestVersion: 1,
        pendingFeedback: 0,
        evalCases: 3,
        examples: 0,
      });
      expect(summary.bestScore).toBeCloseTo(0.6333, 4);
      expect(summary.latestScore).toBeCloseTo(0.5333, 4);
      expect(summary.runs.map((r) => r.id)).toEqual([run.id, done.id]);
    });

    it('publicar una versión anterior restaura la configuración (ejemplos incluidos) e informa skills eliminadas', async () => {
      const skill = (
        await owner.api
          .post('/skills', { name: 'Habilidad temporal', description: 'Temporal', instructions: 'Haz algo' })
          .expect(201)
      ).body as { id: string };
      await owner.api.put(`/agents/${agentId}/skills`, { skillIds: [skill.id] }).expect(200);
      await owner.api.post(`/agents/${agentId}/examples`, { input: 'uno', output: 'primero' }).expect(201);
      await owner.api.post(`/agents/${agentId}/examples`, { input: 'dos', output: 'segundo' }).expect(201);
      await viewer.api.post(`/agents/${agentId}/versions`, { note: 'x' }).expect(403);
      const v3 = (await owner.api.post(`/agents/${agentId}/versions`, { note: 'Con skill y ejemplos' }).expect(201))
        .body as Version;
      expect(v3.version).toBe(3);

      const v1 = ((await owner.api.get(`/agents/${agentId}/versions`).expect(200)).body as Version[]).find(
        (v) => v.version === 1,
      )!;
      await viewer.api.post(`/agents/${agentId}/versions/${v1.id}/publish`).expect(403);
      const restored = (await owner.api.post(`/agents/${agentId}/versions/${v1.id}/publish`).expect(200)).body as {
        published: { version: number };
        backupVersion: { version: number } | null;
        missingSkillIds: string[];
        warnings: string[];
        agent: { systemPrompt: string; profile: Record<string, unknown>; skills: unknown[]; examplesCount: number };
      };
      expect(restored.published.version).toBe(1);
      expect(restored.backupVersion).toBeNull(); // la configuración actual ya era la versión 3
      expect(restored.agent).toMatchObject({
        systemPrompt: ORIGINAL_PROMPT,
        profile: {},
        skills: [],
        examplesCount: 0,
      });

      // La skill de la versión 3 se elimina: al publicarla se omite y se informa.
      await owner.api.delete(`/skills/${skill.id}`).expect(200);
      const back = (await owner.api.post(`/agents/${agentId}/versions/${v3.id}/publish`).expect(200)).body as {
        backupVersion: { version: number } | null;
        missingSkillIds: string[];
        warnings: string[];
        agent: { skills: unknown[]; systemPrompt: string };
      };
      expect(back.backupVersion).toBeNull(); // idéntica a la versión 1
      expect(back.missingSkillIds).toEqual([skill.id]);
      expect(back.warnings[0]).toMatch(/habilidad/);
      expect(back.agent.skills).toEqual([]);
      expect(back.agent.systemPrompt).toContain('Instrucciones derivadas de la evaluación');
      const examples = (await owner.api.get(`/agents/${agentId}/examples`).expect(200)).body as { input: string }[];
      expect(examples.map((e) => e.input)).toEqual(['uno', 'dos']);

      await owner.api.post(`/agents/${agentId}/versions/no-existe/publish`).expect(404);
    });

    it('targetScore editable en el agente (0..1)', async () => {
      await owner.api.patch(`/agents/${agentId}`, { targetScore: 1.5 }).expect(400);
      await owner.api.patch(`/agents/${agentId}`, { targetScore: 0.9 }).expect(200);
      const summary = (await owner.api.get(`/agents/${agentId}/training-summary`).expect(200)).body as {
        targetScore: number;
      };
      expect(summary.targetScore).toBe(0.9);
    });

    it('aislamiento multi-tenant: otro workspace no ve ni opera nada del ciclo', async () => {
      const result = run.results![0];
      const suggestion = ((await owner.api.get(`/agents/${agentId}/suggestions`).expect(200)).body as Suggestion[])[0];
      const version = ((await owner.api.get(`/agents/${agentId}/versions`).expect(200)).body as Version[])[0];
      const evalCase = ((await owner.api.get(`/agents/${agentId}/eval-cases`).expect(200)).body as EvalCase[])[0];
      const fb = (
        await owner.api
          .post(`/agents/${agentId}/feedback`, { userMessage: 'q', agentResponse: 'a', rating: 'DOWN' })
          .expect(201)
      ).body as Feedback;

      await other.api
        .post(`/agents/${agentId}/feedback`, { userMessage: 'q', agentResponse: 'a', rating: 'UP' })
        .expect(404);
      await other.api.get(`/agents/${agentId}/feedback`).expect(404);
      expect(((await other.api.get('/feedback').expect(200)).body as Feedback[]).map((f) => f.id)).not.toContain(fb.id);
      await other.api.post(`/feedback/${fb.id}/review`, { action: 'DISCARD' }).expect(404);
      await other.api.get(`/agents/${agentId}/eval-cases`).expect(404);
      await other.api.post(`/agents/${agentId}/eval-cases`, { input: 'x' }).expect(404);
      await other.api.patch(`/eval-cases/${evalCase.id}`, { input: 'x' }).expect(404);
      await other.api.delete(`/eval-cases/${evalCase.id}`).expect(404);
      await other.api.post(`/agents/${agentId}/eval-runs`, JUDGE).expect(404);
      await other.api.get(`/agents/${agentId}/eval-runs`).expect(404);
      await other.api.get(`/eval-runs/${run.id}`).expect(404);
      await other.api.patch(`/eval-results/${result.id}`, { humanScore: 0 }).expect(404);
      await other.api.post(`/eval-runs/${run.id}/suggestions`, { providerId: 'mock', model: 'mock-echo' }).expect(404);
      await other.api.get(`/agents/${agentId}/suggestions`).expect(404);
      await other.api.post(`/suggestions/${suggestion.id}/apply`).expect(404);
      await other.api.post(`/suggestions/${suggestion.id}/reject`).expect(404);
      await other.api.get(`/agents/${agentId}/versions`).expect(404);
      await other.api.post(`/agents/${agentId}/versions`, {}).expect(404);
      await other.api.post(`/agents/${agentId}/versions/${version.id}/publish`).expect(404);
      await other.api.get(`/agents/${agentId}/training-summary`).expect(404);

      // Nada cambió en el workspace dueño.
      const after = (await owner.api.get(`/eval-runs/${run.id}`).expect(200)).body as Run;
      expect(after.results!.find((r) => r.id === result.id)!.humanScore).toBe(result.humanScore);
      expect(((await owner.api.get('/feedback?status=PENDING').expect(200)).body as Feedback[])[0].id).toBe(fb.id);
    });
  });

  describe('Gobierno de costos', () => {
    it('presupuesto agotado → corrida FAILED con mensaje y costo de lo ya consumido', async () => {
      const unit = await createUnit(owner, 'Centro evaluaciones', (await rootUnit(owner)).id);
      await owner.api
        .put(`/admin/budgets/${unit.id}`, { period: 'MONTHLY', limitUsd: 0.0001, policy: 'BLOCK' })
        .expect(200);
      const agent = await createAgent(owner, { name: 'Agente con presupuesto', costCenterId: unit.id });
      await owner.api.post(`/agents/${agent.id}/eval-cases`, { input: LONG_MESSAGE, expected: 'consumo' }).expect(201);

      const queued = (await owner.api.post(`/agents/${agent.id}/eval-runs`, JUDGE).expect(201)).body as Run;
      const failed = await waitRun(owner, queued.id);
      expect(failed.status).toBe('FAILED');
      expect(failed.error).toMatch(/Presupuesto de IA agotado/);
      expect(failed.costUsd).toBeGreaterThan(0); // el agente alcanzó a responder; el juez quedó bloqueado
      expect(failed.results).toHaveLength(1);
      expect(failed.results![0]).toMatchObject({ score: null, needsReview: true });
      expect(failed.results![0].output).toContain('Eco:');

      const again = (await owner.api.post(`/agents/${agent.id}/eval-runs`, JUDGE).expect(201)).body as Run;
      const blocked = await waitRun(owner, again.id);
      expect(blocked).toMatchObject({ status: 'FAILED', costUsd: 0 });
      expect(blocked.results).toHaveLength(0);
      expect(blocked.error).toMatch(/Presupuesto/);
    });
  });
});
