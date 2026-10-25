import type { TemplateContext } from '../../common/template/template.engine';
import { evaluateRule, type ConditionRule } from '../workflows/engine/executors/basic.executors';

/** Regla de validación determinista declarativa (RF29): evaluada con el motor de reglas PURO del flujo, NUNCA `eval`. */
export interface ReglaValidacion {
  combinator?: 'and' | 'or';
  rules?: ConditionRule[];
}

/** Resultado de evaluar la parte determinista de un contrato. */
export interface EvaluacionDeterminista {
  cumple: boolean;
  /** Reglas evaluadas (traza auditable, sin razonamiento de modelos). */
  resultados: boolean[];
  /** Tipos de evidencia exigidos que faltan. */
  evidenciaFaltante: string[];
}

/** `true` si la regla declara al menos una condición evaluable. */
export function tieneReglaDeterminista(regla: unknown): regla is ReglaValidacion {
  return (
    typeof regla === 'object' &&
    regla !== null &&
    Array.isArray((regla as ReglaValidacion).rules) &&
    (regla as ReglaValidacion).rules!.length > 0
  );
}

/**
 * Evalúa el contrato de forma determinista y reproducible: (1) las reglas declarativas contra el contexto observado
 * (datos del sistema fuente / evidencia), y (2) que estén presentes todos los tipos de evidencia exigidos. Cumple solo
 * si ambas condiciones se satisfacen. No llama a ningún modelo ni toca BD: es lógica pura y auditable.
 */
export function evaluarDeterminista(
  regla: ReglaValidacion,
  evidenciaExigida: string[],
  tiposEvidenciaPresentes: string[],
  ctx: TemplateContext,
): EvaluacionDeterminista {
  const rules = regla.rules ?? [];
  const resultados = rules.map((r) => evaluateRule(r, ctx));
  const reglasCumplen = regla.combinator === 'or' ? resultados.some(Boolean) : resultados.every(Boolean);
  const presentes = new Set(tiposEvidenciaPresentes);
  const evidenciaFaltante = evidenciaExigida.filter((t) => !presentes.has(t));
  return { cumple: reglasCumplen && evidenciaFaltante.length === 0, resultados, evidenciaFaltante };
}
