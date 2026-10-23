import { mockJudge, mockOptimizer } from '../llm/drivers/mock.driver';
import {
  buildJudgeMessage,
  buildOptimizerMessage,
  clampProfile,
  effectiveScore,
  extractFirstJsonObject,
  JUDGE_MARKER,
  JUDGE_SYSTEM_PROMPT,
  needsReview,
  OPTIMIZER_MARKER,
  OPTIMIZER_SYSTEM_PROMPT,
  parseJudgeResponse,
  parseProposal,
  stableStringify,
  summarizeResults,
} from './eval-protocol';

describe('parseJudgeResponse (parseo tolerante del juez)', () => {
  it('acepta JSON puro', () => {
    expect(parseJudgeResponse('{"score":0.9,"passed":true,"reasoning":"Bien"}')).toEqual({
      score: 0.9,
      passed: true,
      reasoning: 'Bien',
    });
  });

  it('extrae el primer objeto JSON de texto con prosa y bloques de código', () => {
    const text =
      'Mi evaluación:\n```json\n{"score": 0.5, "passed": false, "reasoning": "Parcial {incompleto}"}\n```\nFin';
    expect(parseJudgeResponse(text)).toEqual({ score: 0.5, passed: false, reasoning: 'Parcial {incompleto}' });
  });

  it('salta llaves que no son JSON y toma el siguiente objeto válido', () => {
    expect(parseJudgeResponse('Uso {llaves} sueltas y luego {"score": 1}')).toEqual({
      score: 1,
      passed: true,
      reasoning: '',
    });
  });

  it('acepta score como cadena numérica y deduce passed si falta', () => {
    expect(parseJudgeResponse('{"score":"0.2"}')).toMatchObject({ score: 0.2, passed: false });
  });

  it('devuelve null si no hay JSON o el score no es válido', () => {
    expect(parseJudgeResponse('Excelente respuesta, 10/10')).toBeNull();
    expect(parseJudgeResponse('{"score": 7}')).toBeNull();
    expect(parseJudgeResponse('{"score": -0.1}')).toBeNull();
    expect(parseJudgeResponse('{"passed": true}')).toBeNull();
    expect(parseJudgeResponse('{"score": "alto"}')).toBeNull();
    expect(parseJudgeResponse('')).toBeNull();
    expect(extractFirstJsonObject('[1,2] {"a":"\\"}"}')).toEqual({ a: '"}' });
  });
});

describe('puntaje efectivo y zona dudosa', () => {
  it('needsReview en [0.4, 0.8] y cuando no hay puntaje', () => {
    expect(needsReview(null)).toBe(true);
    expect(needsReview(0.4)).toBe(true);
    expect(needsReview(0.6)).toBe(true);
    expect(needsReview(0.8)).toBe(true);
    expect(needsReview(0.39)).toBe(false);
    expect(needsReview(0.81)).toBe(false);
    expect(needsReview(0)).toBe(false);
    expect(needsReview(1)).toBe(false);
  });

  it('el puntaje humano prevalece sobre el del juez', () => {
    expect(effectiveScore({ score: 0.6, humanScore: 0.9 })).toBe(0.9);
    expect(effectiveScore({ score: 0.6, humanScore: 0 })).toBe(0);
    expect(effectiveScore({ score: 0.6, humanScore: null })).toBe(0.6);
    expect(effectiveScore({ score: null, humanScore: null })).toBeNull();
  });

  it('promedia los puntajes efectivos ignorando nulos y cuenta aprobados con el umbral', () => {
    const results = [
      { score: 1, humanScore: null },
      { score: 0.6, humanScore: null },
      { score: 0, humanScore: null },
      { score: null, humanScore: null },
    ];
    expect(summarizeResults(results, 0.7)).toEqual({ score: 0.5333, passed: 1 });
    results[1].humanScore = 0.9 as never;
    expect(summarizeResults(results, 0.7)).toEqual({ score: 0.6333, passed: 2 });
    expect(summarizeResults([{ score: null, humanScore: null }], 0.7)).toEqual({ score: null, passed: 0 });
  });
});

describe('parseProposal (normalización de propuestas)', () => {
  it('normaliza el perfil con la lógica del módulo de agentes y recorta a los límites del DTO', () => {
    const text = `Propuesta: ${JSON.stringify({
      rationale: '  Más precisión  ',
      systemPrompt: '  Sé preciso.  ',
      profile: {
        role: '  Soporte  ',
        goals: ['  Resolver ', '', 3, 'x'.repeat(600)],
        tone: '',
        desconocido: 'se descarta',
        boundaries: 'no es lista',
      },
    })}`;
    const parsed = parseProposal(text)!;
    expect(parsed.rationale).toBe('Más precisión');
    expect(parsed.proposal.systemPrompt).toBe('Sé preciso.');
    expect(parsed.proposal.profile).toEqual({ role: 'Soporte', goals: ['Resolver', 'x'.repeat(500)] });
  });

  it('acepta solo systemPrompt o solo profile y pone una justificación por defecto', () => {
    expect(parseProposal('{"systemPrompt":"Nuevo"}')).toEqual({
      rationale: 'El modelo no incluyó una justificación.',
      proposal: { systemPrompt: 'Nuevo' },
    });
    expect(parseProposal('{"rationale":"r","profile":{"language":"español"}}')?.proposal).toEqual({
      profile: { language: 'español' },
    });
  });

  it('rechaza respuestas sin JSON o sin cambios utilizables', () => {
    expect(parseProposal('No tengo propuestas')).toBeNull();
    expect(parseProposal('{"rationale":"nada"}')).toBeNull();
    expect(parseProposal('{"systemPrompt":"   ","profile":{"role":""}}')).toBeNull();
    expect(parseProposal('{"profile":["a"]}')).toBeNull();
  });

  it('clampProfile limita la cantidad de elementos de las listas', () => {
    const goals = Array.from({ length: 30 }, (_, i) => `meta ${i}`);
    expect(clampProfile({ goals }).goals).toHaveLength(20);
  });
});

describe('MockDriver: juez y optimizador deterministas', () => {
  const judge = (expected: string | null, output: string) =>
    JSON.parse(mockJudge(buildJudgeMessage({ input: 'pregunta', expected, output }))) as {
      score: number;
      passed: boolean;
    };

  it('los prompts reales llevan los marcadores', () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain(JUDGE_MARKER);
    expect(OPTIMIZER_SYSTEM_PROMPT).toContain(OPTIMIZER_MARKER);
  });

  it('1 si la salida contiene el esperado (sin mayúsculas ni acentos)', () => {
    expect(judge('la capital es PARÍS', 'Eco: La Capital es  Paris, claro')).toMatchObject({ score: 1, passed: true });
  });

  it('0.6 si comparte al menos la mitad de las palabras de 4+ letras; 0 si no', () => {
    expect(judge('equipo ventas nacional completo', 'Hola equipo de ventas regional').score).toBe(0.6);
    expect(judge('respuesta totalmente distinta', 'Hola equipo de ventas').score).toBe(0);
  });

  it('sin esperado califica 1 si hay salida', () => {
    expect(judge(null, 'algo').score).toBe(1);
    expect(judge(null, '').score).toBe(0);
  });

  it('el optimizador propone un JSON válido derivado de los casos fallidos', () => {
    const msg = buildOptimizerMessage({ systemPrompt: 'Eres útil.', profile: { goals: ['Ayudar'] } }, [
      { input: 'a', expected: 'respuesta A', output: 'x', reasoning: 'mal' },
    ]);
    const parsed = parseProposal(mockOptimizer(msg))!;
    expect(parsed.proposal.systemPrompt).toContain('Eres útil.');
    expect(parsed.proposal.systemPrompt).toContain('«respuesta A»');
    expect(parsed.proposal.profile?.goals).toEqual([
      'Ayudar',
      'Cubrir las respuestas esperadas de los casos de evaluación',
    ]);
  });
});

describe('stableStringify', () => {
  it('no depende del orden de las claves', () => {
    expect(stableStringify({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(
      stableStringify({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }),
    );
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});
