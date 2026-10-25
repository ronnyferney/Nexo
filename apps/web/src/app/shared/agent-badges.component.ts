import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  type AgentShare,
  type AgentVisibility,
  HEALTH_LEVEL_META,
  type HealthLevel,
  type LaunchStatus,
  PRINCIPAL_META,
  type SharePrincipal,
  VISIBILITY_META,
} from '../core/access.models';
import { LAUNCH_STATUS_META } from '../features/agents/agent-lifecycle.util';
import { IconComponent } from './icon.component';

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

/** Estado de ciclo de vida del empleado digital (E2/RF05/RF06): Borrador / En validación / Publicado / Suspendido / Retirado. */
@Component({
  selector: 'nx-launch-badge',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (meta(); as m) {
    <span class="badge {{ m.tone === 'neutral' ? '' : m.tone }}" [title]="m.description"><nx-icon [name]="m.icon" [size]="12" />{{ m.label }}</span>
  }`,
})
export class LaunchBadgeComponent {
  readonly status = input<LaunchStatus | null | undefined>();
  readonly meta = computed(() => {
    const s = this.status();
    return s ? LAUNCH_STATUS_META[s] : null;
  });
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

const AUDIENCE_PLURAL: Record<SharePrincipal, [string, string]> = {
  USER: ['persona', 'personas'],
  UNIT: ['unidad', 'unidades'],
  GROUP: ['grupo', 'grupos'],
};
/** Grupos que se nombran individualmente antes de resumir con «+N». */
const AUDIENCE_GROUPS_SHOWN = 2;

/**
 * Destinatarios de un agente compartido (ADR 0007 D6): nombra los grupos (la audiencia de publicación) y resume
 * personas y unidades con su conteo. Solo se muestra si hay shares (los ve quien tiene EDIT).
 */
@Component({
  selector: 'nx-share-audience',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (g of groupsShown(); track g.principalId) {
      <span class="badge primary" [title]="'Grupo · ' + permissionLabel(g)"><nx-icon [name]="meta.GROUP.icon" [size]="12" />
        <span class="sr-only">Grupo:</span>{{ g.principalName }}</span>
    }
    @if (groupsHidden(); as rest) {
      <span class="badge primary" [title]="rest.names"><nx-icon [name]="meta.GROUP.icon" [size]="12" />+{{ rest.count }} {{ rest.count === 1 ? 'grupo' : 'grupos' }}</span>
    }
    @for (s of summary(); track s.type) {
      <span class="badge" [title]="s.names"><nx-icon [name]="meta[s.type].icon" [size]="12" />{{ s.label }}</span>
    }
  `,
  styles: `:host { display: contents; }`,
})
export class ShareAudienceComponent {
  readonly shares = input<AgentShare[] | null | undefined>();
  readonly meta = PRINCIPAL_META;

  private readonly groups = computed(() => (this.shares() ?? []).filter((s) => s.principalType === 'GROUP'));
  readonly groupsShown = computed(() => this.groups().slice(0, AUDIENCE_GROUPS_SHOWN));
  readonly groupsHidden = computed(() => {
    const rest = this.groups().slice(AUDIENCE_GROUPS_SHOWN);
    return rest.length ? { count: rest.length, names: rest.map((s) => s.principalName).join(', ') } : null;
  });
  readonly summary = computed(() =>
    (['UNIT', 'USER'] as const)
      .map((type) => {
        const list = (this.shares() ?? []).filter((s) => s.principalType === type);
        const [one, many] = AUDIENCE_PLURAL[type];
        return { type, label: `${list.length} ${list.length === 1 ? one : many}`, names: list.map((s) => s.principalName).join(', '), n: list.length };
      })
      .filter((s) => s.n > 0),
  );

  permissionLabel(s: AgentShare) {
    return s.permission === 'EDIT' ? 'Puede editar' : 'Puede usar';
  }
}
