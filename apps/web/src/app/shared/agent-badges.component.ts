import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  type AgentVisibility,
  HEALTH_LEVEL_META,
  type HealthLevel,
  type LaunchStatus,
  VISIBILITY_META,
} from '../core/access.models';

/** Distintivo visual por visibilidad (ADR 0007 D1). */
export const VISIBILITY_EMOJI: Record<AgentVisibility, string> = { PRIVATE: '🔒', TEAM: '👥', WORKSPACE: '🏢' };

/**
 * Nivel derivado del puntaje cuando la API solo envía `healthScore` (p. ej. `GET /agents/explore`).
 * Cortes supuestos 90/70/40 (70 = mínimo de lanzamiento, ADR 0006 D4); si la API envía `level`, prevalece.
 */
export function healthLevelFor(score: number): HealthLevel {
  if (score >= 90) return 'EXCELLENT';
  if (score >= 70) return 'GOOD';
  if (score >= 40) return 'NEEDS_WORK';
  return 'CRITICAL';
}

/** Distintivo de visibilidad del agente. */
@Component({
  selector: 'nx-visibility-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (meta(); as m) {
    <span class="badge" [title]="m.description"><span aria-hidden="true">{{ m.emoji }}</span>{{ m.label }}</span>
  }`,
})
export class VisibilityBadgeComponent {
  readonly visibility = input<AgentVisibility | null | undefined>();
  readonly meta = computed(() => {
    const v = this.visibility();
    return v ? { ...VISIBILITY_META[v], emoji: VISIBILITY_EMOJI[v] } : null;
  });
}

/** Estado de lanzamiento (ADR 0006 D4): Borrador / Lanzado. */
@Component({
  selector: 'nx-launch-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (status(); as s) {
    <span class="badge" [class.success]="s === 'LAUNCHED'"><span class="dot"></span>{{ s === 'LAUNCHED' ? 'Lanzado' : 'Borrador' }}</span>
  }`,
})
export class LaunchBadgeComponent {
  readonly status = input<LaunchStatus | null | undefined>();
}

/** Puntaje de salud (0–100) con color por nivel. */
@Component({
  selector: 'nx-health-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (score() !== null && score() !== undefined) {
    <span class="badge {{ meta().tone }}" [title]="'Salud: ' + meta().label" [attr.aria-label]="'Salud ' + score() + ' de 100, ' + meta().label">
      <span class="dot"></span>Salud {{ score() }}</span>
  }`,
})
export class HealthBadgeComponent {
  readonly score = input<number | null | undefined>();
  readonly level = input<HealthLevel | null | undefined>();
  readonly meta = computed(() => HEALTH_LEVEL_META[this.level() ?? healthLevelFor(this.score() ?? 0)]);
}
