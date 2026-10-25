/** Utilidades puras de la confirmación de publicación del agente (RX-8, §4.4). Solo derivan presentación. */

import type { HealthCheck, HealthSeverity } from '../../core/access.models';
import type { Agent } from '../../core/models';

/** Hallazgos = revisiones de salud no superadas. */
export const pendingFindings = (checks: readonly HealthCheck[] = []): HealthCheck[] => checks.filter((c) => !c.passed);

/** Hallazgos pendientes de una severidad concreta (CRITICAL = bloqueantes, WARNING = advertencias). */
export const findingsOf = (checks: readonly HealthCheck[] = [], severity: HealthSeverity): HealthCheck[] =>
  pendingFindings(checks).filter((c) => c.severity === severity);

export interface PublishDependency {
  icon: string;
  label: string;
  count: number;
}

/**
 * Dependencias que el agente pondrá en producción al publicarse: herramientas de conectores, bases de conocimiento,
 * skills y modelos de respaldo. Se usan para el resumen de pre-publicación (lista completa, aunque el conteo sea 0).
 */
export function publishDependencies(
  agent: Pick<Agent, 'tools' | 'knowledgeBases' | 'skills' | 'fallbackModels'>,
): PublishDependency[] {
  return [
    { icon: 'tool', label: 'Herramientas de conectores', count: agent.tools?.length ?? 0 },
    { icon: 'book', label: 'Bases de conocimiento', count: agent.knowledgeBases?.length ?? 0 },
    { icon: 'sparkles', label: 'Skills', count: agent.skills?.length ?? 0 },
    { icon: 'shuffle', label: 'Modelos de respaldo', count: agent.fallbackModels?.length ?? 0 },
  ];
}
