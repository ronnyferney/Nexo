import { Injectable } from '@nestjs/common';
import type { RoutingVerifyPolicy, VerifyIssuePolicy } from '../llm/routing.types';

/** Veredicto del verificador. El código es auditable; el texto de la crítica es contenido, nunca "motivo" de ruteo. */
export type VerifyVerdict = 'OK' | 'PROBLEMA';

/** Código auditable del resultado de la verificación cruzada (ADR 0010 D5: código, no razonamiento del modelo). */
export type VerifyOutcomeCode =
  'VERIFICACION_OK' | 'VERIFICACION_ADVERTENCIA' | 'VERIFICACION_REVISION_HUMANA' | 'VERIFICACION_OMITIDA';

/** Resultado estructurado de una verificación cruzada que ya se ejecutó (hubo un verificador que respondió). */
export interface VerificationOutcome {
  verdict: VerifyVerdict;
  code: VerifyOutcomeCode;
  /** El veredicto exige que una persona revise antes de continuar (acción sensible, ADR 0010 D4/decisión 6). */
  requiresHumanReview: boolean;
  /** Texto de la crítica del verificador (contenido del notice). Vacío cuando el veredicto es OK. */
  critique: string;
  /** Modelo que verificó. */
  verifier: { providerId: string; model: string };
}

/** Límite del texto de la crítica que se propaga como contenido del notice. */
const CRITIQUE_MAX = 2_000;
/** Límite del fragmento del redactor/entrada que se le pasa al verificador. */
const SOURCE_MAX = 20_000;

const clamp = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…[truncado]` : s);
const providerOf = (ref: string): string => {
  const i = ref.indexOf(':');
  return i > 0 ? ref.slice(0, i) : ref;
};

/**
 * Lógica **pura** de la verificación cruzada (ADR 0010 D4, fase 3): elegir el verificador, construir su prompt, leer su
 * veredicto y decidir el efecto (advertir vs. exigir revisión humana). No llama al proveedor ni toca BD ni presupuesto:
 * la orquestación (resolver, medir, imputar, emitir notices) la hace `AgentRuntimeService` por encima del gateway, y el
 * gobierno de costos / DataGuard se reutilizan íntegros. Así la verificación es orquestación, nunca driver.
 */
@Injectable()
export class AgentVerificationService {
  /**
   * Referencias `"<providerId>:<modelId>"` candidatas a verificador, en orden de preferencia. Se prefiere **otro**
   * modelo que el redactor y, si la política lo exige, de **otro `providerId`** (reduce la correlación de sesgos). Un
   * `verify.model` explícito manda. Lista vacía ⇒ no hay verificador independiente posible (la verificación se omite).
   */
  selectVerifierRefs(verify: RoutingVerifyPolicy, draftRef: string, orderedRefs: string[]): string[] {
    if (verify.model) {
      if (verify.requireDifferentProvider && providerOf(verify.model) === providerOf(draftRef)) return [];
      return [verify.model];
    }
    let pool = orderedRefs.filter((r) => r !== draftRef);
    if (verify.requireDifferentProvider) pool = pool.filter((r) => providerOf(r) !== providerOf(draftRef));
    return pool;
  }

  /** System prompt y mensaje del verificador: contrasta con las fuentes/entradas, nunca opina en el vacío. */
  buildPrompt(input: { userMessage: string; draftText: string }): { system: string; userMessage: string } {
    const system = [
      'Eres un verificador independiente. Otro modelo redactó una respuesta para un usuario y tu tarea es revisarla de',
      'forma crítica contrastándola ÚNICAMENTE con las fuentes y entradas que se te entregan: no inventes información ni',
      'opines en el vacío. Detecta errores factuales, afirmaciones sin respaldo en las fuentes, incoherencias o riesgos.',
      'Responde SIEMPRE en español y comienza tu respuesta EXACTAMENTE con una de estas dos líneas: "VEREDICTO: OK" si la',
      'respuesta es correcta y está respaldada, o "VEREDICTO: PROBLEMA" si detectas algún problema. Luego, en un párrafo',
      'breve, explica tu crítica contrastando con las fuentes. No incluyas tu cadena de razonamiento.',
    ].join(' ');
    const userMessage = [
      '## Entrada y fuentes de la tarea',
      clamp(input.userMessage, SOURCE_MAX),
      '',
      '## Respuesta del redactor a verificar',
      clamp(input.draftText, SOURCE_MAX),
    ].join('\n');
    return { system, userMessage };
  }

  /** Lee el veredicto del texto del verificador. Ambiguo/ilegible ⇒ OK (no se bloquea por un verificador que no decide). */
  parseVerdict(text: string): { verdict: VerifyVerdict; critique: string } {
    const trimmed = (text ?? '').trim();
    const problema = /VEREDICTO:\s*PROBLEMA/i.test(trimmed);
    const critique = clamp(trimmed.replace(/^VEREDICTO:\s*(OK|PROBLEMA)\s*/i, '').trim(), CRITIQUE_MAX);
    return { verdict: problema ? 'PROBLEMA' : 'OK', critique };
  }

  /**
   * Efecto de un veredicto con problema (ADR 0010 D4, decisión 6). `auto`: advierte en tareas informativas y exige
   * revisión humana antes de una acción sensible; `warn`: solo advierte; `require_human`: siempre exige revisión humana.
   */
  resolveIssueOutcome(
    onIssue: VerifyIssuePolicy | undefined,
    sensitiveAction: boolean,
  ): { code: VerifyOutcomeCode; requiresHumanReview: boolean } {
    const policy = onIssue ?? 'auto';
    if (policy === 'warn') return { code: 'VERIFICACION_ADVERTENCIA', requiresHumanReview: false };
    if (policy === 'require_human') return { code: 'VERIFICACION_REVISION_HUMANA', requiresHumanReview: true };
    return sensitiveAction
      ? { code: 'VERIFICACION_REVISION_HUMANA', requiresHumanReview: true }
      : { code: 'VERIFICACION_ADVERTENCIA', requiresHumanReview: false };
  }
}
